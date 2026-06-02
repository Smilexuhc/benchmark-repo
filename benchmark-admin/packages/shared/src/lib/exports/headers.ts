export const EXPORT_HEADERS: Record<string, string> = {
  id: 'ID',
  shotType: '镜头类型',
  taskType: '任务类型',
  questionType: '问题类型',
  manualTag: '手工标签',
  scene: '场景',
  screenSize: '画幅',
  difficulty: '难度',
  textPrompt: '文本提示词',
  judgingCriteria: '评判标准',
  score: '评分',
  needsRevision: '待修改',
  // Media coverage columns — make the bundle self-describing so a reviewer can
  // tell, from the manifest alone, what each item actually contains.
  characterImageCount: '角色图数量',
  sceneImageCount: '场景图数量',
  propImageCount: '道具图数量',
  audioInput: '音频输入',
  videoInput: '视频输入',
  videoOutput: '视频输出',
  completeness: '完整性',
  createdAt: '创建时间',
};

// Asset library export — per-kind manifest columns. Keys map to either a
// promoted column (id/name/era/genre), a JSONB data field, or the derived
// imageCount. An embedded 封面 (cover) image column is appended by the builder.
export const ASSET_EXPORT_HEADERS: Record<
  'character' | 'scene' | 'prop',
  Record<string, string>
> = {
  character: {
    id: 'ID',
    name: '名称',
    era: '时代',
    genre: '类型',
    type: '角色类型',
    gender: '性别',
    age: '年龄',
    persona: '人设',
    body: '体型',
    features: '特征',
    prompt: '提示词',
    description: '描述',
    imageCount: '图片数量',
  },
  scene: {
    id: 'ID',
    name: '名称',
    era: '时代',
    genre: '类型',
    scene_type: '场景类型',
    mood: '氛围',
    elements: '元素',
    prompt: '提示词',
    description: '描述',
    imageCount: '图片数量',
  },
  prop: {
    id: 'ID',
    name: '名称',
    era: '时代',
    genre: '类型',
    category: '类别',
    prompt: '提示词',
    description: '描述',
    imageCount: '图片数量',
  },
};
