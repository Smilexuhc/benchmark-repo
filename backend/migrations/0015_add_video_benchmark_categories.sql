ALTER TABLE video_benchmark_items
    ADD COLUMN IF NOT EXISTS category_l1 TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS category_l2 TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS category_l3 TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS category_definition TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN video_benchmark_items.category_l1 IS '新分类一级分类';
COMMENT ON COLUMN video_benchmark_items.category_l2 IS '新分类二级分类';
COMMENT ON COLUMN video_benchmark_items.category_l3 IS '新分类三级分类';
COMMENT ON COLUMN video_benchmark_items.category_definition IS '新分类定义/出题意图';

CREATE INDEX IF NOT EXISTS idx_video_benchmark_items_category
    ON video_benchmark_items(category_l1, category_l2, category_l3);
