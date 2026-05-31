import OpenAI from 'openai';
import { env } from '@benchmark-admin/shared/env';

export class AiError extends Error {
  constructor(
    public readonly code: 'AI_RATE_LIMITED' | 'AI_AUTH_FAILED' | 'AI_NO_IMAGE' | 'AI_PARSE_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export function translateError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const low = msg.toLowerCase();
  if (
    low.includes('quota') ||
    msg.includes('402') ||
    low.includes('insufficient') ||
    low.includes('credit') ||
    msg.includes('429') ||
    low.includes('rate limit')
  ) {
    return new AiError('AI_RATE_LIMITED', '接口额度不足：请检查 OpenRouter 账户余额 / 额度');
  }
  if (
    msg.includes('401') ||
    low.includes('unauthorized') ||
    low.includes('api key')
  ) {
    return new AiError('AI_AUTH_FAILED', '接口鉴权失败：请检查 OPENROUTER_API_KEY');
  }
  return e instanceof Error ? e : new Error(msg);
}

// Tolerant JSON extractor — port of backend/ai.py _parse_json
export function parseJson(text: string): Record<string, unknown> {
  let t = (text ?? '').trim();
  if (t.startsWith('```')) {
    // Strip all leading/trailing backticks (mirrors Python str.strip('`'))
    t = t.replace(/^`+|`+$/g, '');
    if (t.slice(0, 4).toLowerCase() === 'json') t = t.slice(4);
    t = t.trim();
  }
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1) throw new AiError('AI_PARSE_ERROR', '模型未返回有效 JSON');
  return JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>;
}

// Single shared OpenAI client for all OpenRouter calls
export const openai = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.OPENROUTER_BASE_URL,
  timeout: 600_000,
});
