import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context.js';
import { AiError } from '../services/ai/openrouter.js';

const AI_CODE_TO_TRPC: Record<string, string> = {
  AI_RATE_LIMITED: 'TOO_MANY_REQUESTS',
  AI_AUTH_FAILED: 'INTERNAL_SERVER_ERROR',
  AI_NO_IMAGE: 'UNPROCESSABLE_CONTENT',
  AI_PARSE_ERROR: 'UNPROCESSABLE_CONTENT',
};

export const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (error.cause instanceof AiError) {
      return {
        ...shape,
        message: error.cause.message,
        data: {
          ...shape.data,
          code: AI_CODE_TO_TRPC[error.cause.code] ?? shape.data.code,
          aiCode: error.cause.code,
        },
      };
    }
    return { ...shape, data: { ...shape.data, aiCode: null } };
  },
});
