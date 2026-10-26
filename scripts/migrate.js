import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { databaseConfig } from "../lib/db-config.js";
const c = new pg.Client(databaseConfig());
await c.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(75412023)");
  await c.query(
    "CREATE TABLE IF NOT EXISTS rfa_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((n) => /^\d+_[a-z0-9_]+\.sql$/.test(n))
    .sort()) {
    if (
      (await c.query("SELECT name FROM rfa_migrations WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    await c.query(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
    await c.query("INSERT INTO rfa_migrations(name) VALUES($1)", [name]);
    console.log("Migração aplicada:", name);
  }
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
