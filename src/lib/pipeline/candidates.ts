import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { Catalog, trackInputFromDeezer, type TrackInput } from "../catalog";
import { db, schema } from "../db";
import { lastfmEnabled } from "../env";
import { trackFeatures } from "../engine/features";
import { logger } from "../logger";
import { songKey } from "../normalize";
import {
  deezerArtistRadio,
  deezerArtistTop,
  deezerTrack,
  type DeezerTrack,
} from "../providers/deezer";
import { lfmTagTopTracks } from "../providers/lastfm";
import { getSettings } from "../settings";
import { CANDIDATE_STATUS, type CandidateSource, type ProfileData } from "../types";
import { chunk, mapLimit } from "../util";
import { enrichArtist, enrichTrack } from "./enrich";
import { loadIdf, loadTrackCards } from "./facts";
import type { JobReporter } from "./jobs";

export interface CandidateBudget {
  seeds: number;
  newArtists: number;
  knownArtists: number;
  tags: number;
  radios: number;
  tracksPerArtist: number;
  maxCandidates: number;
  enrichArtists: number;
}

export const QUICK_BUDGET: CandidateBudget = {
  seeds: 12,
  newArtists: 30,
  knownArtists: 8,
  tags: 3,
  radios: 2,
  tracksPerArtist: 8,
  maxCandidates: 300,
  enrichArtists: 40,
};

export const FULL_BUDGET: CandidateBudget = {
  seeds: 40,
  newArtists: 80,
  knownArtists: 25,
  tags: 8,
  radios: 6,
  tracksPerArtist: 12,
  maxCandidates: 1200,
  enrichArtists: 200,
};

interface Pending {
  key: string;
  deezer?: DeezerTrack;
  named?: { title: string; artist: string };
  trackId?: string;
  sources: CandidateSource[];
}

/**
 * Candidate generation: gathers unheard songs from five independent sources,
 * resolves them on Deezer (so they can be previewed), computes model features and
 * stores the pool. Scoring happens at request time so feedback applies instantly.
 */
export async function generateCandidates(
  userId: string,
  profile: ProfileData,
  budget: CandidateBudget,
  report: JobReporter,
): Promise<number> {
  const runStart = new Date();
  const catalog = new Catalog();
  const settings = await getSettings(userId);
  const blockedTags = new Set(settings.blockedTags);
  const t = schema.tracks;
  const a = schema.artists;
  const ut = schema.userTracks;

  // What to exclude: everything already in the library or decided on.
  const library = await db()
    .select({ trackId: ut.trackId, title: t.title, artist: a.name, artistId: t.artistId })
    .from(ut)
    .innerJoin(t, eq(t.id, ut.trackId))
    .innerJoin(a, eq(a.id, t.artistId))
    .where(eq(ut.userId, userId));
  const libraryIds = new Set(library.map((r) => r.trackId));
  const libraryKeys = new Set(library.map((r) => songKey(r.artist, r.title)));
  const knownArtists = new Set(Object.keys(profile.artists));
  const decided = new Set(
    (
      await db()
        .select({ trackId: schema.candidates.trackId })
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.userId, userId),
            inArray(schema.candidates.status, [2, 3, 4, 5]),
          ),
        )
    ).map((r) => r.trackId),
  );
  const blockedArtists = new Set(
    (
      await db()
        .select({ id: schema.userArtists.artistId })
        .from(schema.userArtists)
        .where(and(eq(schema.userArtists.userId, userId), eq(schema.userArtists.blocked, true)))
    ).map((r) => r.id),
  );

  const pending = new Map<string, Pending>();
  const add = (key: string, item: Omit<Pending, "key" | "sources">, source: CandidateSource) => {
    if (libraryKeys.has(key)) return;
    let p = pending.get(key);
    if (!p) pending.set(key, (p = { key, ...item, sources: [] }));
    if (!p.deezer && item.deezer) p.deezer = item.deezer;
    if (!p.sources.some((s) => s.type === source.type && s.seedId === source.seedId))
      p.sources.push(source);
  };

  // 1. Similar tracks of your most-loved songs (Last.fm co-listening).
  await report.progress(
    "Finding songs similar to your favourites",
    0,
    budget.seeds,
    undefined,
    true,
  );
  const seeds = await db()
    .select({ track: t, artistName: a.name, affinity: ut.affinity })
    .from(ut)
    .innerJoin(t, eq(t.id, ut.trackId))
    .innerJoin(a, eq(a.id, t.artistId))
    .where(and(eq(ut.userId, userId), isNotNull(ut.affinity), eq(ut.banned, false)))
    .orderBy(desc(ut.affinity))
    .limit(budget.seeds);
  const maxAffinity = Math.max(1e-6, ...seeds.map((s) => s.affinity ?? 0));
  if (lastfmEnabled()) {
    let i = 0;
    await mapLimit(seeds, 4, async (s) => {
      await enrichTrack(
        { ...s.track, artistName: s.artistName },
        { tags: false, similar: true, catalog },
      );
      await report.progress("Finding songs similar to your favourites", ++i, seeds.length);
    });
    const ts = schema.trackSimilar;
    const sim = seeds.length
      ? await db()
          .select({
            seedId: ts.trackId,
            similarId: ts.similarId,
            score: ts.score,
            title: t.title,
            artist: a.name,
          })
          .from(ts)
          .innerJoin(t, eq(t.id, ts.similarId))
          .innerJoin(a, eq(a.id, t.artistId))
          .where(
            inArray(
              ts.trackId,
              seeds.map((s) => s.track.id),
            ),
          )
      : [];
    const seedById = new Map(seeds.map((s) => [s.track.id, s]));
    for (const r of sim) {
      const seed = seedById.get(r.seedId)!;
      const weight = 0.5 + 0.5 * ((seed.affinity ?? 0) / maxAffinity);
      add(
        songKey(r.artist, r.title),
        { trackId: r.similarId, named: { title: r.title, artist: r.artist } },
        {
          type: "similar-track",
          seedId: r.seedId,
          seedLabel: seed.track.title,
          score: round(r.score * weight),
        },
      );
    }
  }

  // 2. Artists reached through the similarity graph (new) and deeper cuts from known artists.
  const graphRanked = Object.entries(profile.graph).sort((x, y) => y[1] - x[1]);
  const newArtistIds = graphRanked
    .filter(([id]) => !knownArtists.has(id) && !blockedArtists.has(id))
    .slice(0, budget.newArtists)
    .map(([id]) => id);
  const knownArtistIds = settings.includeKnownArtists
    ? Object.entries(profile.artists)
        .filter(([id]) => !blockedArtists.has(id))
        .sort((x, y) => y[1] - x[1])
        .slice(0, budget.knownArtists)
        .map(([id]) => id)
    : [];
  const artistRows = new Map(
    (newArtistIds.length + knownArtistIds.length
      ? await db()
          .select()
          .from(a)
          .where(inArray(a.id, [...newArtistIds, ...knownArtistIds]))
      : []
    ).map((r) => [r.id, r]),
  );

  // Which of your artists links to each new artist most strongly (for "fans of X" reasons).
  const via = new Map<string, { name: string; score: number }>();
  if (newArtistIds.length && knownArtists.size) {
    const s = schema.artistSimilar;
    const links = await db()
      .select({ from: s.artistId, to: s.similarId, score: s.score })
      .from(s)
      .where(sql`(${inArray(s.artistId, newArtistIds)} OR ${inArray(s.similarId, newArtistIds)})`);
    const names = new Map<string, string>();
    const libIds = [
      ...new Set(links.flatMap((l) => [l.from, l.to]).filter((id) => knownArtists.has(id))),
    ];
    for (const part of chunk(libIds, 1000))
      for (const r of await db()
        .select({ id: a.id, name: a.name })
        .from(a)
        .where(inArray(a.id, part)))
        names.set(r.id, r.name);
    for (const l of links) {
      const [lib, other] = knownArtists.has(l.from) ? [l.from, l.to] : [l.to, l.from];
      if (!knownArtists.has(lib) || knownArtists.has(other)) continue;
      const score = l.score * (profile.artists[lib] ?? 0);
      if ((via.get(other)?.score ?? 0) < score)
        via.set(other, { name: names.get(lib) ?? "", score });
    }
  }

  let done = 0;
  const totalArtists = newArtistIds.length + knownArtistIds.length;
  await mapLimit([...newArtistIds, ...knownArtistIds], 4, async (artistId) => {
    const artist = artistRows.get(artistId);
    if (!artist) return;
    await enrichArtist(artist, { similar: false, catalog });
    const [fresh] = await db()
      .select({ deezerId: a.deezerId })
      .from(a)
      .where(eq(a.id, artistId))
      .limit(1);
    if (fresh?.deezerId) {
      const known = knownArtists.has(artistId);
      const top = await deezerArtistTop(
        fresh.deezerId,
        known ? budget.tracksPerArtist * 2 : budget.tracksPerArtist,
      );
      for (const [i, track] of top.entries()) {
        const decay = Math.exp(-i / (known ? 12 : 6));
        add(
          songKey(track.artist.name, track.title),
          { deezer: track },
          known
            ? {
                type: "deep-cut",
                seedId: artistId,
                seedLabel: artist.name,
                score: round((profile.artists[artistId] ?? 0) * decay * 0.8),
              }
            : {
                type: "similar-artist",
                seedId: artistId,
                seedLabel: via.get(artistId)?.name || undefined,
                score: round((profile.graph[artistId] ?? 0) * decay),
              },
        );
      }
    }
    await report.progress("Exploring artists near your taste", ++done, totalArtists);
  });

  // 3. Top tracks of your most characteristic tags (serendipity across artists).
  if (lastfmEnabled()) {
    const tags = Object.entries(profile.tags)
      .filter(([tag]) => !blockedTags.has(tag))
      .sort((x, y) => y[1] - x[1])
      .slice(0, budget.tags);
    for (const [tag, weight] of tags) {
      const top = await lfmTagTopTracks(tag, 30);
      for (const tr of top)
        add(
          songKey(tr.artist, tr.name),
          { named: { title: tr.name, artist: tr.artist } },
          {
            type: "tag",
            seedLabel: tag,
            score: round(weight * (1 - tr.rank / 60)),
          },
        );
    }
  }

  // 4. Deezer artist radio for your top artists.
  const radioArtists = Object.entries(profile.artists)
    .sort((x, y) => y[1] - x[1])
    .slice(0, budget.radios)
    .map(([id]) => id);
  if (radioArtists.length) {
    const rows = await db()
      .select({ id: a.id, name: a.name, deezerId: a.deezerId })
      .from(a)
      .where(inArray(a.id, radioArtists));
    for (const r of rows) {
      if (!r.deezerId) continue;
      for (const track of await deezerArtistRadio(r.deezerId))
        add(
          songKey(track.artist.name, track.title),
          { deezer: track },
          {
            type: "radio",
            seedId: r.id,
            seedLabel: r.name,
            score: round(0.5 * (profile.artists[r.id] ?? 0)),
          },
        );
    }
  }

  // Keep the strongest (by summed source evidence) and resolve them in the catalog.
  const ranked = [...pending.values()]
    .map((p) => ({ p, prelim: p.sources.reduce((s, x) => s + x.score, 0) }))
    .sort((x, y) => y.prelim - x.prelim)
    .slice(0, budget.maxCandidates)
    .map((x) => x.p);

  done = 0;
  const resolved = new Map<string, CandidateSource[]>();
  await mapLimit(ranked, 6, async (p) => {
    try {
      let trackId = p.trackId;
      if (!trackId) {
        let input: TrackInput;
        if (p.deezer) {
          // Top/radio listings lack release dates and BPM; the full record has them.
          const full = (await deezerTrack(p.deezer.id)) ?? p.deezer;
          input = trackInputFromDeezer({ ...p.deezer, ...full });
        } else {
          input = { title: p.named!.title, artist: { name: p.named!.artist } };
        }
        trackId = await catalog.track(input);
      }
      if (!p.deezer) {
        const [row] = await db()
          .select()
          .from(t)
          .innerJoin(a, eq(a.id, t.artistId))
          .where(eq(t.id, trackId))
          .limit(1);
        if (row)
          await enrichTrack(
            { ...row.tracks, artistName: row.artists.name },
            { tags: false, similar: false, catalog },
          );
      }
      if (libraryIds.has(trackId) || decided.has(trackId)) return;
      const prev = resolved.get(trackId) ?? [];
      resolved.set(trackId, [...prev, ...p.sources]);
    } catch (err) {
      logger.warn({ err, key: p.key }, "could not resolve candidate");
    } finally {
      if (++done % 10 === 0) await report.progress("Preparing previews", done, ranked.length);
    }
  });

  const cards = await loadTrackCards([...resolved.keys()]);

  // Make sure new artists have tags so content similarity works for them.
  const needTags = [...new Set([...cards.values()].map((c) => c.artistId))].filter(
    (id) => !knownArtists.has(id),
  );
  const toEnrich = needTags.length
    ? await db()
        .select()
        .from(a)
        .where(
          and(
            inArray(a.id, needTags.slice(0, 5000)),
            lastfmEnabled()
              ? sql`${a.lastfmCheckedAt} IS NULL`
              : sql`${a.musicbrainzCheckedAt} IS NULL`,
          ),
        )
        .limit(budget.enrichArtists)
    : [];
  done = 0;
  await mapLimit(toEnrich, 4, async (row) => {
    await enrichArtist(row, { similar: false, catalog });
    await report.progress("Learning about new artists", ++done, toEnrich.length);
  });
  const finalCards = toEnrich.length ? await loadTrackCards([...resolved.keys()]) : cards;

  const idf = await loadIdf();
  const values: (typeof schema.candidates.$inferInsert)[] = [];
  for (const [trackId, sources] of resolved) {
    const card = finalCards.get(trackId);
    if (!card) continue;
    if (blockedArtists.has(card.artistId)) continue;
    if (!settings.allowExplicit && card.explicit) continue;
    if (!(card.deezerId && card.previewable !== false) && !card.spotifyId) continue;
    if (Object.keys(card.tags).some((tag) => blockedTags.has(tag) && card.tags[tag]! > 0.5))
      continue;
    const features = trackFeatures(
      {
        trackId,
        artistId: card.artistId,
        tags: card.tags,
        releaseYear: card.releaseYear,
        rank: card.rank,
        explicit: card.explicit,
        bpm: card.bpm,
        sources,
        knownArtist: knownArtists.has(card.artistId),
      },
      profile,
      idf,
    );
    values.push({
      userId,
      trackId,
      sources,
      features,
      status: CANDIDATE_STATUS.NEW,
      generatedAt: new Date(),
    });
  }

  for (const part of chunk(values, 300)) {
    await db()
      .insert(schema.candidates)
      .values(part)
      .onConflictDoUpdate({
        target: [schema.candidates.userId, schema.candidates.trackId],
        set: {
          sources: sql`excluded.sources`,
          features: sql`excluded.features`,
          generatedAt: sql`excluded.generated_at`,
        },
        setWhere: sql`${schema.candidates.status} IN (0, 1)`,
      });
  }
  // Drop stale, never-shown candidates that this run did not produce again.
  await db()
    .delete(schema.candidates)
    .where(
      and(
        eq(schema.candidates.userId, userId),
        eq(schema.candidates.status, CANDIDATE_STATUS.NEW),
        lt(schema.candidates.generatedAt, runStart),
      ),
    );
  report.count("candidates", values.length);
  return values.length;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
