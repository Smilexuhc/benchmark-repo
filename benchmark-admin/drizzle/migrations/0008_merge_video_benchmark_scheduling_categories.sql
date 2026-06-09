UPDATE "video_benchmark_items"
   SET "category_l3" = '人物站位合理性',
       "category_definition" = '检查人物在场景中的站位是否合理、清晰、符合关系'
 WHERE "category_l1" = '单镜头'
   AND "category_l2" = '调度与场面组织'
   AND "category_l3" IN ('主次关系与画面重心', '多人物场面组织');
--> statement-breakpoint
UPDATE "video_benchmark_items"
   SET "category_l3" = '人物距离与互动空间',
       "category_definition" = '检查聊天、争吵、拥抱、跟随等关系中的人物距离是否合理'
 WHERE "category_l1" = '单镜头'
   AND "category_l2" = '调度与场面组织'
   AND "category_l3" = '视线组织';
