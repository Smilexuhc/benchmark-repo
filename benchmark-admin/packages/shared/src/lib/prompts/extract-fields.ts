// Extract-fields system prompts — ported verbatim from backend/ai.py

export const EXTRACT_SYSTEM = `你从用户的中文角色描述里提取结构化字段，只输出一个 JSON 对象，不要任何多余文字。
字段（值均用中文，描述未提及的填空字符串 ""）：
- era 时代、type 类型、gender 性别、age 年龄段、genre 常见题材：
  尽量从给定「候选值」中选最贴切的一个；候选里确实没有合适的再自拟简短词。
- persona 人设/服装造型、body 身材、features 特征：简短中文短语。`;

export const SCENE_EXTRACT_SYSTEM = `你从用户的中文场景描述里提取结构化字段，只输出一个 JSON 对象，不要任何多余文字。
字段（值均用中文，描述未提及的填空字符串 ""）：
- era 时代、scene_type 场景类型（室内/室外）、genre 题材风格、mood 氛围时段：
  尽量从给定「候选值」中选最贴切的一个；候选里确实没有合适的再自拟简短词。
- name 场景名称、elements 关键元素：简短中文短语。`;

export function buildExtractUserMessage(
  description: string,
  options?: Record<string, string[]>,
): string {
  if (!description.trim()) throw new Error('自由描述为空');
  const opts = JSON.stringify(options ?? {}, null, 0);
  return `候选值：\n${opts}\n\n角色描述：\n${description.trim()}`;
}

export function buildSceneExtractUserMessage(
  description: string,
  options?: Record<string, string[]>,
): string {
  if (!description.trim()) throw new Error('自由描述为空');
  const opts = JSON.stringify(options ?? {}, null, 0);
  return `候选值：\n${opts}\n\n场景描述：\n${description.trim()}`;
}
