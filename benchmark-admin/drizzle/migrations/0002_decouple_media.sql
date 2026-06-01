ALTER TABLE "asset_images" RENAME TO "media";--> statement-breakpoint
ALTER TABLE "media" RENAME CONSTRAINT "asset_images_pkey" TO "media_pkey";--> statement-breakpoint
ALTER TABLE "media" RENAME CONSTRAINT "chk_asset_images_media_type" TO "chk_media_media_type";--> statement-breakpoint
ALTER TABLE "media" RENAME CONSTRAINT "asset_images_asset_id_assets_id_fk" TO "media_asset_id_assets_id_fk";--> statement-breakpoint
ALTER TABLE "assets" RENAME CONSTRAINT "assets_cover_image_id_asset_images_id_fk" TO "assets_cover_image_id_media_id_fk";--> statement-breakpoint
ALTER TABLE "video_benchmark_media_links" RENAME CONSTRAINT "video_benchmark_media_links_media_id_asset_images_id_fk" TO "video_benchmark_media_links_media_id_media_id_fk";--> statement-breakpoint
ALTER INDEX "idx_asset_images_asset_id" RENAME TO "idx_media_asset_id";--> statement-breakpoint
ALTER INDEX "idx_asset_images_media_type" RENAME TO "idx_media_media_type";--> statement-breakpoint
ALTER INDEX "idx_asset_images_object_key" RENAME TO "idx_media_object_key";--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "benchmark_item_comments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "idx_media_links_single_cardinality";
