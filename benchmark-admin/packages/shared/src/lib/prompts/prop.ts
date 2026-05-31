// Prop prompt builder — ported verbatim from backend/ai.py

export const PROP_PROMPT_SYSTEM = `你是道具/静物概念图提示词工程师。根据用户给出的道具信息，输出一段**英文** AI 绘图提示词。

要求：
- 单个道具的产品级静物图，纯净背景（solid white / clean studio background），不出现任何人物。
- 道具居中、完整呈现，准确反映名称、类别与关键细节（材质、形状、颜色、年代感）。
- 棚拍质感，结尾点明 product photography, studio lighting, photorealistic, ultra-detailed, 8k。
- 只输出提示词本身，不要解释、不要引号、不要 markdown。`;

const PROP_FIELD_LABELS: Record<string, string> = {
  name: '道具名称',
  category: '类别',
};

export function buildPropUserMessage(
  data: Record<string, unknown>,
  description?: string,
): string {
  if (description?.trim()) return `道具自由描述：\n${description.trim()}`;
  const lines: string[] = [];
  for (const [k, label] of Object.entries(PROP_FIELD_LABELS)) {
    const val = String(data[k] ?? '').trim();
    if (val) lines.push(`${label}：${val}`);
  }
  if (lines.length === 0) throw new Error('道具信息为空，无法生成提示词');
  return `道具信息：\n${lines.join('\n')}`;
}
