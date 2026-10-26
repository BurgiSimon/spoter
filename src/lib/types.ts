/** Normalized tag weights in [0, 1], e.g. { "shoegaze": 1, "dream pop": 0.62 }. */
export type TagVector = Record<string, number>;

/** Sparse feature vector used by the preference model. */
export type FeatureVector = Record<string, number>;

/** Gaussian belief per feature weight: [mean, variance]. */
export type ModelWeights = Record<string, [number, number]>;

export type CandidateSourceType =
  | "similar-track" // Last.fm track.getSimilar from one of your tracks
  | "similar-artist" // artist reached through the similarity graph
  | "deep-cut" // unheard track from an artist you already like
  | "tag" // top track of a tag you like
  | "radio"; // Deezer artist radio

export interface CandidateSource {
  type: CandidateSourceType;
  /** Track or artist id (internal uuid) that led to this candidate. */
  seedId?: string;
  /** Display label for explanations, e.g. "Radiohead" or "shoegaze". */
  seedLabel?: string;
  score: number;
}

export interface UserSettings {
  /** 0 = stay close to what I know, 1 = surprise me. */
  adventurousness: number;
  /** -1 = underground, 0 = no preference, 1 = mainstream. */
  popularity: number;
  allowExplicit: boolean;
  includeKnownArtists: boolean;
  blockedTags: string[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  adventurousness: 0.35,
  popularity: 0,
  allowExplicit: true,
  includeKnownArtists: true,
  blockedTags: [],
};

export interface ProfileData {
  /** TF-IDF weighted, L2-normalized tag profile. */
  tags: TagVector;
  /** Artist affinity in [0, 1] for artists in the library (top N). */
  artists: Record<string, number>;
  /** Personalized PageRank over the artist similarity graph, rank-normalized to [0, 1]. */
  graph: Record<string, number>;
  /** Smoothed decade histogram, sums to 1. Keys like "1990". */
  decades: Record<string, number>;
  /** Mean / std of log10 Deezer rank across weighted library. */
  popularity: { mean: number; std: number };
  stats: {
    tracks: number;
    artists: number;
    plays: number;
    hours: number;
    explicitShare: number;
  };
}

export type CandidateStatus = 0 | 1 | 2 | 3 | 4 | 5;
export const CANDIDATE_STATUS = {
  NEW: 0,
  SHOWN: 1,
  LIKED: 2,
  DISLIKED: 3,
  SUPERLIKED: 4,
  DISMISSED: 5,
} as const;

/** Bit flags describing how a track got into a user's library. */
export const TRACK_SOURCE = {
  SAVED: 1,
  PLAYLIST: 2,
  TOP: 4,
  RECENT: 8,
  HISTORY: 16,
  EXPORT_LIBRARY: 32,
  DISCOVERED: 64,
} as const;

export interface JobProgress {
  step: string;
  done: number;
  total: number;
  message?: string;
}
