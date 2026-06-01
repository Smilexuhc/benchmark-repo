CREATE INDEX "idx_bic_item_id_created" ON "benchmark_item_comments" USING btree ("item_id","created_at");
