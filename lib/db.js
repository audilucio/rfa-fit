import pg from "pg";
let pool;
export async function transaction(fn) {
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: true },
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
