CREATE TABLE "artist_similar" (
	"artist_id" uuid NOT NULL,
	"similar_id" uuid NOT NULL,
	"source" smallint NOT NULL,
	"score" real NOT NULL,
	CONSTRAINT "artist_similar_artist_id_similar_id_source_pk" PRIMARY KEY("artist_id","similar_id","source")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spotify_id" text,
	"deezer_id" bigint,
	"mbid" text,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"image_url" text,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"listeners" integer,
	"fans" integer,
	"lastfm_checked_at" timestamp with time zone,
	"musicbrainz_checked_at" timestamp with time zone,
	"deezer_checked_at" timestamp with time zone,
	"similar_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_spotify_id_unique" UNIQUE("spotify_id"),
	CONSTRAINT "artists_deezer_id_unique" UNIQUE("deezer_id")
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" smallint DEFAULT 0 NOT NULL,
	"shown_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"track_id" uuid NOT NULL,
	"other_track_id" uuid,
	"value" real NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_payloads" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"ms_played" integer NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spotify_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"spotify_user_id" text NOT NULL,
	"display_name" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"playlist_id" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spotify_accounts_spotify_user_id_unique" UNIQUE("spotify_user_id")
);
--> statement-breakpoint
CREATE TABLE "tag_stats" (
	"tag" text PRIMARY KEY NOT NULL,
	"df" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taste_models" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updates" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taste_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_similar" (
	"track_id" uuid NOT NULL,
	"similar_id" uuid NOT NULL,
	"score" real NOT NULL,
	CONSTRAINT "track_similar_track_id_similar_id_pk" PRIMARY KEY("track_id","similar_id")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spotify_id" text,
	"deezer_id" bigint,
	"isrc" text,
	"title" text NOT NULL,
	"title_norm" text NOT NULL,
	"artist_id" uuid NOT NULL,
	"artist_names" text NOT NULL,
	"album_name" text,
	"image_url" text,
	"duration_ms" integer,
	"release_year" smallint,
	"explicit" boolean,
	"rank" integer,
	"bpm" real,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previewable" boolean,
	"lastfm_checked_at" timestamp with time zone,
	"deezer_checked_at" timestamp with time zone,
	"similar_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_spotify_id_unique" UNIQUE("spotify_id"),
	CONSTRAINT "tracks_deezer_id_unique" UNIQUE("deezer_id")
);
--> statement-breakpoint
CREATE TABLE "user_artists" (
	"user_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"followed" boolean DEFAULT false NOT NULL,
	"top_short" smallint,
	"top_medium" smallint,
	"top_long" smallint,
	"blocked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_artists_user_id_artist_id_pk" PRIMARY KEY("user_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "user_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" jsonb,
	"stats" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tracks" (
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"sources" integer DEFAULT 0 NOT NULL,
	"saved_at" timestamp with time zone,
	"playlist_count" smallint DEFAULT 0 NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"ms_played" bigint DEFAULT 0 NOT NULL,
	"skip_count" integer DEFAULT 0 NOT NULL,
	"first_played_at" timestamp with time zone,
	"last_played_at" timestamp with time zone,
	"top_short" smallint,
	"top_medium" smallint,
	"top_long" smallint,
	"banned" boolean DEFAULT false NOT NULL,
	"rating_mu" real,
	"rating_sigma" real,
	"comparisons" integer DEFAULT 0 NOT NULL,
	"affinity" real,
	"affinity_z" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tracks_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"password_hash" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_similar" ADD CONSTRAINT "artist_similar_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_similar" ADD CONSTRAINT "artist_similar_similar_id_artists_id_fk" FOREIGN KEY ("similar_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_other_track_id_tracks_id_fk" FOREIGN KEY ("other_track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_payloads" ADD CONSTRAINT "import_payloads_job_id_user_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."user_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_accounts" ADD CONSTRAINT "spotify_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_models" ADD CONSTRAINT "taste_models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_profiles" ADD CONSTRAINT "taste_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_similar" ADD CONSTRAINT "track_similar_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_similar" ADD CONSTRAINT "track_similar_similar_id_tracks_id_fk" FOREIGN KEY ("similar_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_artists" ADD CONSTRAINT "user_artists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_artists" ADD CONSTRAINT "user_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_jobs" ADD CONSTRAINT "user_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tracks" ADD CONSTRAINT "user_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tracks" ADD CONSTRAINT "user_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_similar_similar_idx" ON "artist_similar" USING btree ("similar_id");--> statement-breakpoint
CREATE INDEX "artists_name_norm_idx" ON "artists" USING btree ("name_norm");--> statement-breakpoint
CREATE INDEX "candidates_user_status_idx" ON "candidates" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "feedback_user_time_idx" ON "feedback_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listening_events_dedupe_key" ON "listening_events" USING btree ("user_id","track_id","played_at");--> statement-breakpoint
CREATE INDEX "listening_events_user_time_idx" ON "listening_events" USING btree ("user_id","played_at");--> statement-breakpoint
CREATE INDEX "provider_cache_expires_idx" ON "provider_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tracks_artist_title_idx" ON "tracks" USING btree ("artist_id","title_norm");--> statement-breakpoint
CREATE INDEX "tracks_isrc_idx" ON "tracks" USING btree ("isrc");--> statement-breakpoint
CREATE INDEX "user_jobs_user_idx" ON "user_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));