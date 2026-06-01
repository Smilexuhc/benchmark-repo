ALTER TABLE video_benchmark_items
    ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT '';
