/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeArtist(name: string): string {
  return normalizeText(name).replace(/^the /, "");
}

const TITLE_NOISE = [
  // " - Remastered 2011", " - 2011 Remaster", " - Radio Edit", " - Single Version", " - Mono"
  /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|re-?master(?:ed)?|radio edit|single version|album version|mono|stereo|original mix|edit)(?:\s+\d{4})?(?:\s+version)?\s*$/i,
  // "(Remastered 2009)", "[Remastered]", "(feat. X)", "(with X)"
  /\s*[([](?:\d{4}\s+)?(?:remaster(?:ed)?|re-?master(?:ed)?)(?:\s+\d{4})?(?:\s+version)?[)\]]/gi,
  /\s*[([](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]/gi,
  /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i,
];

/** Title normalized for matching the same recording across providers. */
export function normalizeTitle(title: string): string {
  let t = title;
  for (const re of TITLE_NOISE) t = t.replace(re, "");
  return normalizeText(t);
}

/** Canonical key used to dedupe "the same song" across providers. */
export function songKey(artist: string, title: string): string {
  return `${normalizeArtist(artist)}::${normalizeTitle(title)}`;
}

const JUNK_TAGS = new Set([
  "seen live",
  "favorites",
  "favourites",
  "favorite",
  "favourite",
  "my favorite",
  "favorite songs",
  "favourite songs",
  "love",
  "loved",
  "awesome",
  "beautiful",
  "amazing",
  "cool",
  "good",
  "great",
  "best",
  "albums i own",
  "spotify",
  "under 2000 listeners",
  "all",
  "music",
  "songs",
  "check out",
  "to listen",
  "my music",
  "catchy",
  "fun",
  "sexy",
  "playlist",
  "youtube",
  "vinyl",
]);

const TAG_SYNONYMS: Record<string, string> = {
  "hip hop": "hip hop",
  hiphop: "hip hop",
  "hip hop rap": "hip hop",
  rnb: "r and b",
  "r b": "r and b",
  "rhythm and blues": "r and b",
  "drum n bass": "drum and bass",
  dnb: "drum and bass",
  "d and b": "drum and bass",
  electronica: "electronic",
  electro: "electro",
  "alt rock": "alternative rock",
  alternative: "alternative",
  "post punk": "post punk",
  postpunk: "post punk",
  "synth pop": "synthpop",
  "synth-pop": "synthpop",
  "indie pop": "indie pop",
  "female vocalist": "female vocalists",
  "male vocalist": "male vocalists",
  "lo fi": "lo fi",
  lofi: "lo fi",
  "k pop": "k pop",
  kpop: "k pop",
  "j pop": "j pop",
  jpop: "j pop",
  edm: "edm",
};

/**
 * Normalizes a user-generated tag. Returns null for junk, years and very short tags.
 * Era is modeled separately from release years, so numeric tags are dropped.
 */
export function normalizeTag(raw: string, artistNameNorm?: string): string | null {
  const t = normalizeText(raw);
  if (t.length < 2 || t.length > 40) return null;
  if (JUNK_TAGS.has(t)) return null;
  if (/^\d+s?$/.test(t) || /^\d{2,4}s? /.test(t) || / \d{4}$/.test(t)) return null;
  if (artistNameNorm && normalizeArtist(t) === artistNameNorm) return null;
  return TAG_SYNONYMS[t] ?? t;
}
