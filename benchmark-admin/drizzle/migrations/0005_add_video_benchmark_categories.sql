ALTER TABLE "video_benchmark_items" ADD COLUMN "category_l1" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_benchmark_items" ADD COLUMN "category_l2" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_benchmark_items" ADD COLUMN "category_l3" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_benchmark_items" ADD COLUMN "category_definition" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_vbi_category" ON "video_benchmark_items" USING btree ("category_l1","category_l2","category_l3");
