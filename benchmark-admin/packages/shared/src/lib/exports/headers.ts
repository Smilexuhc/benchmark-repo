export const EXPORT_HEADERS: Record<string, string> = {
  id: 'ID',
  shotType: '镜头类型',
  taskType: '任务类型',
  questionType: '问题类型',
  manualTag: '手工标签',
  scene: '场景',
  screenSize: '画幅',
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
