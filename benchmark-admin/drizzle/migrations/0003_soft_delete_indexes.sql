CREATE INDEX "idx_media_asset_active" ON "media" USING btree ("asset_id") WHERE "media"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_assets_cover_image_id" ON "assets" USING btree ("cover_image_id");--> statement-breakpoint
CREATE INDEX "idx_bic_active" ON "benchmark_item_comments" USING btree ("item_id","created_at") WHERE "benchmark_item_comments"."deleted_at" IS NULL;
