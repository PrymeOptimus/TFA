import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Holder = { pool: pg.Pool; db: Db };
const g = globalThis as unknown as { __crmDb?: Holder };

/** Runtime database handle (role crm_app: no ownership, no BYPASSRLS). */
export function appDb(): Holder {
  if (!g.__crmDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
    g.__crmDb = { pool, db: drizzle(pool, { schema }) };
  }
  return g.__crmDb;
}

export async function closeAppDb() {
  if (g.__crmDb) {
    await g.__crmDb.pool.end();
    g.__crmDb = undefined;
  }
}

/**
 * Runs fn in a transaction with tenant (and optionally user) context bound transaction-locally.
 * This is the only supported way to touch tenant-owned tables at runtime.
 */
export async function withTenant<T>(tenantId: string, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb().db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId ?? ""}, true)`);
    return fn(tx);
  });
}

/** User-only context (no tenant): may read the user's own memberships and their tenants. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb().db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/** No context at all. Tenant tables return nothing; used for SECURITY DEFINER queue functions. */
export async function withoutContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb().db.transaction(fn);
}
