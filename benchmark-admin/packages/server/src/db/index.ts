import * as schema from '@benchmark-admin/shared/db/schema';
import { env } from '@benchmark-admin/shared/env';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

// Use WebSocket Pool driver — required for interactive db.transaction() in U12/§3.6
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
