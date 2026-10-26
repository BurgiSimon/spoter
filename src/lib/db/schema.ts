import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CandidateSource,
  FeatureVector,
  JobProgress,
  ModelWeights,
  ProfileData,
  TagVector,
  UserSettings,
} from "../types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};
const tz = (name: string) => timestamp(name, { withTimezone: true });

// ─── Accounts ────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    settings: jsonb("settings").$type<Partial<UserSettings>>().notNull().default({}),
    lastActiveAt: tz("last_active_at"),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256(token); the raw token only lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: tz("expires_at").notNull(),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: tz("window_start").notNull(),
  count: integer("count").notNull(),
});

export const spotifyAccounts = pgTable("spotify_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  displayName: text("display_name"),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: tz("expires_at").notNull(),
  scope: text("scope").notNull(),
  playlistId: text("playlist_id"),
  lastSyncAt: tz("last_sync_at"),
  ...timestamps,
});

// ─── Shared music catalog ────────────────────────────────────────────────────

export const artists = pgTable(
  "artists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spotifyId: text("spotify_id").unique(),
    deezerId: bigint("deezer_id", { mode: "number" }).unique(),
    mbid: text("mbid"),
    name: text("name").notNull(),
    nameNorm: text("name_norm").notNull(),
    imageUrl: text("image_url"),
    genres: text("genres")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags: jsonb("tags").$type<TagVector>().notNull().default({}),
    listeners: integer("listeners"),
    fans: integer("fans"),
    lastfmCheckedAt: tz("lastfm_checked_at"),
    musicbrainzCheckedAt: tz("musicbrainz_checked_at"),
    deezerCheckedAt: tz("deezer_checked_at"),
    similarCheckedAt: tz("similar_checked_at"),
    ...timestamps,
  },
  (t) => [index("artists_name_norm_idx").on(t.nameNorm)],
);

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spotifyId: text("spotify_id").unique(),
    deezerId: bigint("deezer_id", { mode: "number" }).unique(),
    isrc: text("isrc"),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    artistNames: text("artist_names").notNull(),
    albumName: text("album_name"),
    imageUrl: text("image_url"),
    durationMs: integer("duration_ms"),
    releaseYear: smallint("release_year"),
    explicit: boolean("explicit"),
    /** Deezer rank (0 – ~1,000,000), our popularity proxy. */
    rank: integer("rank"),
    bpm: real("bpm"),
    tags: jsonb("tags").$type<TagVector>().notNull().default({}),
    previewable: boolean("previewable"),
    lastfmCheckedAt: tz("lastfm_checked_at"),
    deezerCheckedAt: tz("deezer_checked_at"),
    similarCheckedAt: tz("similar_checked_at"),
    ...timestamps,
  },
  (t) => [
    index("tracks_artist_title_idx").on(t.artistId, t.titleNorm),
    index("tracks_isrc_idx").on(t.isrc),
  ],
);

/** Artist similarity graph. source: 1 = Last.fm, 2 = Deezer, 3 = ListenBrainz. */
export const artistSimilar = pgTable(
  "artist_similar",
  {
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    similarId: uuid("similar_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    source: smallint("source").notNull(),
    score: real("score").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.artistId, t.similarId, t.source] }),
    index("artist_similar_similar_idx").on(t.similarId),
  ],
);

export const trackSimilar = pgTable(
  "track_similar",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    similarId: uuid("similar_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.similarId] })],
);

/** Number of artists carrying each tag; used for IDF weighting. */
export const tagStats = pgTable("tag_stats", {
  tag: text("tag").primaryKey(),
  df: integer("df").notNull(),
});

export const providerCache = pgTable(
  "provider_cache",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
  },
  (t) => [index("provider_cache_expires_idx").on(t.expiresAt)],
);

// ─── Per-user library and signals ────────────────────────────────────────────

export const userTracks = pgTable(
  "user_tracks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    sources: integer("sources").notNull().default(0),
    savedAt: tz("saved_at"),
    playlistCount: smallint("playlist_count").notNull().default(0),
    playCount: integer("play_count").notNull().default(0),
    msPlayed: bigint("ms_played", { mode: "number" }).notNull().default(0),
    skipCount: integer("skip_count").notNull().default(0),
    firstPlayedAt: tz("first_played_at"),
    lastPlayedAt: tz("last_played_at"),
    topShort: smallint("top_short"),
    topMedium: smallint("top_medium"),
    topLong: smallint("top_long"),
    banned: boolean("banned").notNull().default(false),
    /** Pairwise rating (TrueSkill-style). Null until the track takes part in a duel or ranking. */
    ratingMu: real("rating_mu"),
    ratingSigma: real("rating_sigma"),
    comparisons: integer("comparisons").notNull().default(0),
    /** Listening-based weight and its z-score, refreshed whenever the profile is rebuilt. */
    affinity: real("affinity"),
    affinityZ: real("affinity_z"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);

export const userArtists = pgTable(
  "user_artists",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    followed: boolean("followed").notNull().default(false),
    topShort: smallint("top_short"),
    topMedium: smallint("top_medium"),
    topLong: smallint("top_long"),
    blocked: boolean("blocked").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.artistId] })],
);

export const listeningEvents = pgTable(
  "listening_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    playedAt: tz("played_at").notNull(),
    msPlayed: integer("ms_played").notNull(),
    skipped: boolean("skipped").notNull().default(false),
  },
  (t) => [
    uniqueIndex("listening_events_dedupe_key").on(t.userId, t.trackId, t.playedAt),
    index("listening_events_user_time_idx").on(t.userId, t.playedAt),
  ],
);

// ─── Recommendation state ────────────────────────────────────────────────────

export const candidates = pgTable(
  "candidates",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    sources: jsonb("sources").$type<CandidateSource[]>().notNull().default([]),
    features: jsonb("features").$type<FeatureVector>().notNull().default({}),
    status: smallint("status").notNull().default(0),
    shownAt: tz("shown_at"),
    decidedAt: tz("decided_at"),
    /** When the song was added to the user's Spoter playlist on Spotify. */
    exportedAt: tz("exported_at"),
    generatedAt: tz("generated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId] }),
    index("candidates_user_status_idx").on(t.userId, t.status),
  ],
);

/** Append-only log of every explicit signal. The model can always be retrained from it. */
export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    otherTrackId: uuid("other_track_id").references(() => tracks.id, { onDelete: "cascade" }),
    value: real("value").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [index("feedback_user_time_idx").on(t.userId, t.createdAt)],
);

export const tasteModels = pgTable("taste_models", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  weights: jsonb("weights").$type<ModelWeights>().notNull().default({}),
  updates: integer("updates").notNull().default(0),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const tasteProfiles = pgTable("taste_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<ProfileData>().notNull(),
  builtAt: tz("built_at").notNull().defaultNow(),
});

/** User-visible background work (Spotify sync, history import, recommendation refresh). */
export const userJobs = pgTable(
  "user_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    progress: jsonb("progress").$type<JobProgress>(),
    stats: jsonb("stats").$type<Record<string, number>>(),
    error: text("error"),
    startedAt: tz("started_at"),
    finishedAt: tz("finished_at"),
    ...timestamps,
  },
  (t) => [index("user_jobs_user_idx").on(t.userId, t.createdAt)],
);

/** Gzipped, already-parsed data export waiting for the worker. Deleted after ingest. */
export const importPayloads = pgTable("import_payloads", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => userJobs.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
  ...timestamps,
});
