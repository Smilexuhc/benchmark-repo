// Character prompt builders — ported verbatim from backend/ai.py

export const PROMPT_SYSTEM = `你是角色设定提示词工程师。根据用户给出的角色信息，输出一段**英文**的 AI 绘图提示词。

要求：
- 固定为「分屏角色设计稿」结构：A split-screen character design sheet, solid white background. [Left 1/3]: extreme close-up ... [Right 2/3]: full-body turnaround (front, side, back) ...
- 结尾点明写实风格与画质，如 Photorealistic, 8k.
- 准确反映角色的时代、人种/类型、性别、年龄、人设造型、身材、特征。
- 只输出提示词本身，不要解释、不要引号、不要 markdown。`;

export const ANIMAL_PROMPT_SYSTEM = `你是动物形象设定提示词工程师。根据用户给出的动物信息，输出一段**英文** AI 绘图提示词。

要求：
- 「分屏动物设计稿」结构：A split-screen animal design sheet, solid white background. [Left 1/3]: extreme close-up of the animal's head ... [Right 2/3]: full-body turnaround (front, side, back) ...
- **真实世界照片写实风格**（photorealistic wildlife photography），绝不要插画、卡通、拟人化。
- 准确反映动物种类、外观特征、体型与典型姿态。
- 结尾点明 photorealistic wildlife photography, natural lighting, 8k, ultra-detailed.
- 只输出提示词本身，不要解释、不要引号、不要 markdown。`;

export const CREATURE_PROMPT_SYSTEM = `你是幻想生物设定提示词工程师。根据用户给出的幻想生物信息，输出一段**英文** AI 绘图提示词。

要求：
- 「分屏幻想生物设计稿」结构：A split-screen creature design sheet, solid white background. [Left 1/3]: extreme close-up of the creature's head ... [Right 2/3]: full-body turnaround (front, side, back) ...
- 写实质感的幻想生物（photorealistic fantasy creature, highly detailed），既不是真人、也不是普通现实动物。
- 准确反映生物的种类、外观特征、体型与姿态。
- 结尾点明 photorealistic fantasy creature, cinematic lighting, 8k, ultra-detailed.
- 只输出提示词本身，不要解释、不要引号、不要 markdown。`;

export const ANTHRO_PROMPT_SYSTEM = `你是拟人化动物角色设定提示词工程师。根据用户给出的角色信息，输出一段**英文** AI 绘图提示词。

要求：
- 「分屏角色设计稿」结构：A split-screen character design sheet, solid white background. [Left 1/3]: extreme close-up of the character's head ... [Right 2/3]: full-body turnaround (front, side, back) ...
- 角色是**拟人化动物**（anthropomorphic animal character）：直立行走、穿着服饰、具人的体态与神情，但保留该动物的头部、毛皮/鳞羽等特征。
- 写实质感（photorealistic, highly detailed），不是卡通扁平。
- 准确反映动物种类、人设、服饰、体型与神态。
- 结尾点明 photorealistic anthropomorphic character, cinematic lighting, 8k, ultra-detailed.
- 只输出提示词本身，不要解释、不要引号、不要 markdown。`;

const FIELD_LABELS: Record<string, string> = {
  era: '时代',
  type: '类型',
  gender: '性别',
  age: '年龄段',
  persona: '人设/服装造型',
  body: '身材',
  features: '特征',
  genre: '常见题材',
};

export function selectCharacterSystem(type: string | undefined): string {
  const t = (type ?? '').trim();
  if (t === '动物/宠物' || t === '动物') return ANIMAL_PROMPT_SYSTEM;
  if (t === '动物拟人' || t === '拟人') return ANTHRO_PROMPT_SYSTEM;
  if (t === '幻想生物' || t === '怪兽') return CREATURE_PROMPT_SYSTEM;
  return PROMPT_SYSTEM;
}

export function buildCharacterUserMessage(
  data: Record<string, unknown>,
  description?: string,
): string {
  if (description?.trim()) return `角色自由描述：\n${description.trim()}`;
  const lines: string[] = [];
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    const val = String(data[k] ?? '').trim();
    if (val) lines.push(`${label}：${val}`);
  }
  if (lines.length === 0) throw new Error('角色信息为空，无法生成提示词');
  return `角色信息：\n${lines.join('\n')}`;
}
