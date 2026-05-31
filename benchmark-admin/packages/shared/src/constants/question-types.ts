// Cascading shot → task → question hierarchy used in video benchmark items

export const SHOT_TYPES = ['单人', '双人', '多人', '场景'] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const TASK_TYPES = ['角色一致性', '场景一致性', '动作理解', '综合理解'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const QUESTION_TYPES = ['选择题', '是非题', '填空题', '简答题'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
