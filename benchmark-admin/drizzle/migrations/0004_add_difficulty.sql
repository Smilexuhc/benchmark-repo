ALTER TABLE "video_benchmark_items" ADD COLUMN "difficulty" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_benchmark_items" ADD CONSTRAINT "chk_vbi_difficulty" CHECK ("video_benchmark_items"."difficulty" IN ('', '易', '中', '难'));
