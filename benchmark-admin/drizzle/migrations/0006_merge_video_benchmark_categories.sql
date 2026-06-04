UPDATE "video_benchmark_items"
   SET "category_l3" = '人物场景融合和交互',
       "category_definition" = '检查人物与门窗、墙面、家具、桌面、通道等场景元素的融合、遮挡、接触和交互是否真实可信'
 WHERE "category_l1" = '单镜头'
   AND "category_l2" = '场景与空间'
   AND "category_l3" IN ('人物场景融合、交互', '场景可行动性', '场景可交互性', '人物场景融合和交互');
--> statement-breakpoint
UPDATE "video_benchmark_items"
   SET "category_l3" = '动作执行',
       "category_definition" = '检查走路、转身、坐下、抬手、奔跑、舞蹈、打斗、追逐等动作是否按提示自然、连贯、可信地完成'
 WHERE "category_l1" = '单镜头'
   AND "category_l2" = '表演与动作'
   AND "category_l3" IN ('简单动作执行', '复杂动作执行', '物理反馈、受力', '动作执行');
