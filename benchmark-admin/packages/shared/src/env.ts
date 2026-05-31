import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    OPENROUTER_API_KEY: z.string().min(1),
    OPENROUTER_BASE_URL: z.string().url(),
    TEXT_MODEL: z.string().min(1),
    IMAGE_MODEL: z.string().min(1),
    IMAGE_ASPECT_RATIO: z.string().default('3:2'),
    IMAGE_SIZE: z.string().default('2K'),
    TOS_BUCKET: z.string().min(1),
    TOS_REGION: z.string().min(1),
    TOS_ENDPOINT: z.string().url(),
    TOS_ACCESS_KEY_ID: z.string().min(1),
    TOS_SECRET_ACCESS_KEY: z.string().min(1),
    // SESSION_SECRET must be >=64 hex chars (256-bit) — boot fails if missing or short
    // generate with: openssl rand -hex 32
    SESSION_SECRET: z
      .string()
      .regex(/^[0-9a-f]+$/i)
      .min(64),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(1),
  },
  runtimeEnv: process.env,
});
