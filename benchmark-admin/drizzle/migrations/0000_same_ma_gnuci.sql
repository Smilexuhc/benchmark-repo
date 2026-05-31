CREATE TABLE "asset_images" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"asset_id" bigint NOT NULL,
	"object_key" text NOT NULL,
	"source" text DEFAULT 'generated' NOT NULL,
	"media_type" text DEFAULT 'image' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_asset_images_media_type" CHECK ("asset_images"."media_type" IN ('image', 'audio', 'video'))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"era" text,
	"genre" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cover_image_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chk_assets_kind" CHECK ("assets"."kind" IN ('character', 'scene', 'prop'))
);
--> statement-breakpoint
CREATE TABLE "benchmark_item_comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" bigint NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_benchmark_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shot_type" text DEFAULT '' NOT NULL,
	"task_type" text DEFAULT '' NOT NULL,
	"question_type" text DEFAULT '' NOT NULL,
	"manual_tag" text DEFAULT '' NOT NULL,
	"scene" text DEFAULT '' NOT NULL,
	"screen_size" text DEFAULT '' NOT NULL,
	"text_prompt" text DEFAULT '' NOT NULL,
	"judging_criteria" text DEFAULT '' NOT NULL,
	"score" smallint,
	"needs_revision" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chk_vbi_score" CHECK ("video_benchmark_items"."score" IS NULL OR ("video_benchmark_items"."score" >= 0 AND "video_benchmark_items"."score" <= 5))
);
--> statement-breakpoint
CREATE TABLE "video_benchmark_media_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" bigint NOT NULL,
	"media_id" bigint NOT NULL,
	"role" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_links_item_role_media" UNIQUE("item_id","role","media_id"),
	CONSTRAINT "chk_media_links_role" CHECK ("video_benchmark_media_links"."role" IN ('character_image', 'scene_image', 'prop_image', 'audio_input', 'video_input', 'video_output'))
);
--> statement-breakpoint
ALTER TABLE "asset_images" ADD CONSTRAINT "asset_images_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_cover_image_id_asset_images_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."asset_images"("id") ON DELETE set null ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "benchmark_item_comments" ADD CONSTRAINT "benchmark_item_comments_item_id_video_benchmark_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."video_benchmark_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_benchmark_media_links" ADD CONSTRAINT "video_benchmark_media_links_item_id_video_benchmark_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."video_benchmark_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_benchmark_media_links" ADD CONSTRAINT "video_benchmark_media_links_media_id_asset_images_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."asset_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_images_asset_id" ON "asset_images" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_asset_images_media_type" ON "asset_images" USING btree ("media_type");--> statement-breakpoint
CREATE INDEX "idx_asset_images_object_key" ON "asset_images" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "idx_assets_data" ON "assets" USING gin ("data");--> statement-breakpoint
CREATE INDEX "idx_assets_kind_deleted" ON "assets" USING btree ("kind","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_assets_kind_era" ON "assets" USING btree ("kind","era");--> statement-breakpoint
CREATE INDEX "idx_assets_kind_genre" ON "assets" USING btree ("kind","genre");--> statement-breakpoint
CREATE INDEX "idx_vbi_shot_question" ON "video_benchmark_items" USING btree ("shot_type","question_type");--> statement-breakpoint
CREATE INDEX "idx_vbi_active" ON "video_benchmark_items" USING btree ("id") WHERE "video_benchmark_items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_media_links_item_role" ON "video_benchmark_media_links" USING btree ("item_id","role");--> statement-breakpoint
CREATE INDEX "idx_media_links_media" ON "video_benchmark_media_links" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_media_links_single_cardinality" ON "video_benchmark_media_links" ("item_id","role") WHERE role IN ('audio_input', 'video_input', 'video_output');