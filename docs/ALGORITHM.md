# The Spoter recommendation engine

All engine code lives in [`src/lib/engine`](../src/lib/engine). It is pure TypeScript with no I/O,
and every piece is covered by [`tests/engine.test.ts`](../tests/engine.test.ts). The worker
([`src/lib/pipeline`](../src/lib/pipeline)) feeds it data and the API
([`src/lib/serve.ts`](../src/lib/serve.ts), [`src/lib/feedback.ts`](../src/lib/feedback.ts)) applies it.

## Design goals

1. **Every interaction teaches the same model.** Swipes, duels and rankings are different
   questions about one underlying utility function, so none of the signals are wasted.
2. **Learn instantly.** No nightly batch training: a swipe changes the next card.
3. **Know what it doesn't know.** Calibrated uncertainty drives exploration and decides which
   question to ask next.
4. **Explain itself.** Every recommendation can say why.
5. **No dependence on deprecated Spotify endpoints.** Recommendations, audio features and related
   artists are gone for new apps, so everything is built from open data.

## 1. Implicit weight of a library song (`profile.ts`)

For each song in your library:

```
w = log(1 + plays) · (0.45 + 0.55 · e^(−age/540d))      listening, diminishing + recency
  + 1.5 · saved + 1.2 · in export library
  + 0.6 · log(1 + playlists)
  + top-track bonus (short 1.6, medium 1.3, long 1.1, scaled by rank)
  + 1.4 liked on Spoter / 2.4 super-liked
w ← w · (1 − 0.6 · skip_ratio)                          when ≥ 3 plays
w ← w · e^(0.6 · μ_rating)                              when you rated it (section 5)
```

A play counts when it lasted at least 30 s, the same threshold Spotify uses.

## 2. Taste profile

- **Tags.** Each song's tags blend track tags (Last.fm), artist tags (Last.fm, else MusicBrainz,
  else Deezer genres) and Spotify genres. The profile is `Σ w · tags`, weighted by
  **IDF** = `log((N+1)/(df+1)) + 1` over all tagged artists and tracks, then L2-normalized. IDF is
  what makes _dream pop_ define you more than _rock_.
- **Eras.** A weighted decade histogram, smoothed into neighbouring decades.
- **Popularity.** Weighted mean and standard deviation of log Deezer rank.
- **Artist affinity.** `log(1 + Σw) / log(1 + max)`, plus bonuses for followed and top artists.

## 3. Artist graph and personalized PageRank (`graph.ts`)

Edges come from Last.fm `artist.getSimilar` (match score), Deezer related artists (rank-decayed)
and ListenBrainz session-based similarity. The graph is symmetrized and a random walk with
restart probability 0.25 jumps back to your artists in proportion to `affinity²`. The stationary
distribution rewards artists that are reachable from **many** of your favourites, which one-hop
"similar artists" lists cannot express. Scores are rank-normalized to [0, 1].

## 4. Candidates and features (`candidates.ts`, `features.ts`)

Candidates come from five sources: Last.fm similar tracks of your top 40 songs, top tracks of
graph neighbours, deeper cuts of known artists, Last.fm tag charts of your top tags, and Deezer
artist radio. Every candidate is matched on Deezer, which gives the preview, popularity, release
year and BPM.

Each candidate becomes a sparse vector **x**:

| Feature                                             | Meaning                                            |
| --------------------------------------------------- | -------------------------------------------------- |
| `d:tagSim`                                          | cosine(TF-IDF tags of the song, profile tags)      |
| `d:graph`                                           | personalized PageRank of the artist                |
| `d:artist`                                          | your affinity to the artist (0 for new artists)    |
| `d:trackSim`                                        | Last.fm co-listening similarity to your seed songs |
| `d:consensus`                                       | how many independent sources proposed it           |
| `d:era`, `d:pop`                                    | fit to your era histogram and popularity range     |
| `d:novel`                                           | 1 if you don't know the artist                     |
| `t:<tag>`                                           | top-8 TF-IDF tags (L2-normalized)                  |
| `a:<artist>`, `y:<decade>`, `p:<bucket>`, `b:<bpm>` | identity indicators                                |
| `bias`                                              | base rate                                          |

Dense features are centered so that an average candidate sits near zero.

## 5. The preference model (`model.ts`, `rating.ts`)

**Bayesian probit regression with assumed-density filtering**, in the spirit of Microsoft's
AdPredictor. Every weight has a Gaussian belief `N(μᵢ, σᵢ²)`.

```
s = Σ xᵢ μᵢ          v² = β² + Σ xᵢ² σᵢ²          P(like) = Φ(s / v)
```

An observation `y ∈ {+1, −1}` updates each touched weight in closed form:

```
t  = y·s / v
μᵢ ← μᵢ + y · xᵢ σᵢ² / v · 𝒱(t)
σᵢ² ← σᵢ² · (1 − xᵢ² σᵢ² / v² · 𝒲(t))
```

where `𝒱(t) = φ(t)/Φ(t)` and `𝒲(t) = 𝒱(t)(𝒱(t)+t)`. Surprising answers move the model a lot;
expected ones barely move it.

| Signal               | Update                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| Like / pass          | `y = ±1` on the song's vector                                                   |
| Super like           | `y = +1` with 2.5× strength (lower noise β)                                     |
| Skip                 | `y = −1` with 0.15× strength                                                    |
| Duel "A over B"      | `y = +1` on **x_A − x_B** (Thurstone paired comparison; shared features cancel) |
| Both great / neither | `y = ±1` on each, 0.6× strength                                                 |
| Ranking of n songs   | all n(n−1)/2 implied pairs, each at 1/(n−1) strength                            |

Dense meta-features start with positive priors (`d:tagSim` 2.2, `d:graph` 1.6…), so cold-start
recommendations are already sensible. Feedback then learns _how much each signal matters to you_,
plus fine-grained likes and dislikes for individual tags, artists and eras. Variances slowly drift
back toward the prior (1 % per day), so the model follows changing taste.

Songs **in your library** also carry a **TrueSkill-style rating** (μ, σ), with the prior taken from
the z-score of their implicit weight. Duels and rankings between known songs update these
ratings, which feed back into the profile weights in section 1. That is how ranking your own
songs improves recommendations for new ones.

Undo restores the exact pre-swipe beliefs, which are snapshotted in the feedback log.

## 6. Serving (`recommend.ts`, `rerank.ts`, `active.ts`)

- **Discover** draws one Thompson sample of the weight vector (temperature grows with your
  _adventurousness_ setting), scores the pool, then applies **MMR**:
  `λ · relevance − (1−λ) · max similarity to picks`, with similarity = 0.6 · tag cosine + 0.4 · same
  artist, one song per artist per batch and a penalty for recently shown artists.
- **For you** ranks by posterior mean (no exploration noise) with the same diversity pass.
- **Duels** sample candidate pairs and pick the one with the highest expected information
  `(σ²_A + σ²_B) · exp(−(μ_A − μ_B)² / (2(σ²_A + σ²_B + β²)))`, i.e. uncertain songs the model
  can't call yet. Modes mix known vs. known, new vs. known and new vs. new.
- **Rank sets** take the most uncertain library songs, stratified across the rating range, so
  every ordering is informative.
- **Settings** shift scores without touching the learned model: adventurousness boosts new
  artists, and the popularity slider adds `±1.6 · (log rank / 6 − 0.5)`.

## 7. Explanations (`explain.ts`)

Reasons come from the largest positive contributions `xᵢ μᵢ`, mapped to text using the candidate's
sources: _"Similar to 'Alison', which you love"_, _"Fans of Beach House listen to this"_,
_"Matches your taste in dream pop, shoegaze"_, _"From the 1990s, an era you play a lot"_.

## Pipeline timing

The worker runs a **quick pass** (60 artists, about 300 candidates, ready in 1–3 minutes) before
a **full pass** (300 artists, up to 1,200 candidates). Every provider response is cached in
Postgres (30–90 days) and shared across users, so later users with overlapping taste are much
faster. Providers are rate-limited per process: Deezer 7/s, Last.fm 4/s, MusicBrainz 1/s,
ListenBrainz 2/s.
