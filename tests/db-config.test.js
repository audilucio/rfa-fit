import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { databaseConfig } from "../lib/db-config.js";
test("Neon connection strings cannot disable certificate verification", () => {
  for (const query of [
    "sslmode=require",
    "sslmode=no-verify",
    "ssl=false",
    "sslmode=disable&uselibpqcompat=true",
    "sslrootcert=untrusted.pem&sslkey=key.pem&sslcert=cert.pem",
  ]) {
    const opts = databaseConfig({
      DATABASE_URL: "postgresql://test:test@db.example.com/rfa?" + query,
    });
    const c = new pg.Client(opts);
    assert.equal(c.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(opts.enableChannelBinding, true);
  }
});
test("plaintext PostgreSQL restricted to explicit loopback development", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"])
    assert.equal(
      databaseConfig({
        DATABASE_URL: `postgresql://test:test@${host}/rfa`,
        PGSSL: "disable",
      }).ssl,
      false,
    );
  assert.throws(
    () =>
      databaseConfig({
        DATABASE_URL: "postgresql://test:test@db.example.com/rfa",
        PGSSL: "disable",
      }),
    /somente/,
  );
  assert.throws(() => databaseConfig({}), /DATABASE_URL/);
  assert.throws(
    () => databaseConfig({ DATABASE_URL: "https://example.com" }),
    /PostgreSQL/,
  );
});
