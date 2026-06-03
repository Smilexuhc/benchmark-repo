ALTER TABLE video_benchmark_items
    ADD COLUMN IF NOT EXISTS expected_video_time_in_sec INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_video_benchmark_expected_video_time'
          AND conrelid = 'video_benchmark_items'::regclass
    ) THEN
        ALTER TABLE video_benchmark_items
            ADD CONSTRAINT chk_video_benchmark_expected_video_time
            CHECK (expected_video_time_in_sec IS NULL OR expected_video_time_in_sec >= 0);
    END IF;
END $$;

COMMENT ON COLUMN video_benchmark_items.expected_video_time_in_sec IS '预期视频时长（秒）';
