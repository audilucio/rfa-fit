import { readFileSync } from "node:fs";
import pg from "pg";
import { databaseConfig } from "../lib/db-config.js";
const c = new pg.Client(databaseConfig());
await c.connect();
try {
  await c.query("BEGIN");
  await c.query(
    readFileSync(
      new URL("../migrations/001_referrals.sql", import.meta.url),
      "utf8",
    ),
  );
  await c.query("COMMIT");
  console.log("Migração aplicada.");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
