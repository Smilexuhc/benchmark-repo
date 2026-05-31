// Scene prompt builders — ported verbatim from backend/ai.py

export const SCENE_PROMPT_SYSTEM = `你是场景概念图提示词工程师。根据用户给出的场景信息，输出一段**英文** AI 绘图提示词。

要求：
- 描述一个环境/场景，画面中不出现任何人物（empty scene, no people, no characters）。
- 单张环境图，不要 split-screen、不要多视角。
- 准确反映时代、室内或室外、题材风格、氛围与时段、关键元素。
- 电影感构图，结尾点明 photorealistic, cinematic lighting, ultra-detailed, 8k。
- 只输出提示词本身，不要解释、不要引号、不要 markdown。`;

const SCENE_FIELD_LABELS: Record<string, string> = {
  name: '场景名称',
  era: '时代',
  scene_type: '场景类型',
  genre: '题材风格',
  mood: '氛围时段',
  elements: '关键元素',
};

export function buildSceneUserMessage(
  data: Record<string, unknown>,
  description?: string,
): string {
  if (description?.trim()) return `场景自由描述：\n${description.trim()}`;
  const lines: string[] = [];
  for (const [k, label] of Object.entries(SCENE_FIELD_LABELS)) {
    const raw = data[k];
    const val = Array.isArray(raw) ? raw.join('、') : String(raw ?? '').trim();
    if (val) lines.push(`${label}：${val}`);
  }
  if (lines.length === 0) throw new Error('场景信息为空，无法生成提示词');
  return `场景信息：\n${lines.join('\n')}`;
}
