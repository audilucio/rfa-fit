import pg from "pg";
import { databaseConfig } from "./db-config.js";
let pool;
export async function transaction(fn) {
  pool ??= new pg.Pool({
    ...databaseConfig(),
    max: 3,
  });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = '15s'");
    await c.query("SELECT pg_advisory_xact_lock(75412023)");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
