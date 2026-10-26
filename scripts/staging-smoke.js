// Real Neon staging DB; synthetic Google identities invoke the service layer only.
// Rolls back all rows and does NOT claim real Google authentication.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { databaseConfig } from "../lib/db-config.js";
import * as s from "../lib/service.js";
import { tier, quote, message } from "../lib/domain.js";
import { person as makePerson, login } from "../tests/helpers.js";
if (process.env.NEON_PROJECT_ID !== "orange-glade-30690745")
  throw Error("Somente Neon de homologação RFA.FIT é permitido.");
const client = new pg.Client(databaseConfig());
const suffix = randomUUID().slice(0, 8);
const tables = [
  "participants",
  "coupons",
  "orders",
  "tokens",
  "sessions",
  "limits",
  "audit",
  "deletion_requests",
  "participant_contacts",
  "google_auth_challenges",
  "admin_bindings",
];
async function counts() {
  const q = tables
    .map((t) => `SELECT '${t}' AS name,count(*)::text AS count FROM ${t}`)
    .join(" UNION ALL ");
  return Object.fromEntries(
    (await client.query(q)).rows.map((r) => [r.name, Number(r.count)]),
  );
}
const person = (name, ref) =>
  makePerson(client, `staging-${suffix}-${name}@example.invalid`, ref);
let connected = false,
  inTransaction = false;
try {
  await client.connect();
  connected = true;
  assert.equal(client.connection.stream.authorized, true);
  const before = await counts();
  await client.query("BEGIN");
  inTransaction = true;
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SELECT pg_advisory_xact_lock(75412023)");
  const p = await person("owner");
  await assert.rejects(() => login(client, p.email, p.code), /Autoconvite/);
  await assert.rejects(
    () => login(client, `bad-${suffix}@example.invalid`, "f".repeat(20)),
    /inválido/,
  );
  for (let n = 0; n <= 10; n++) {
    const d = await s.dashboard(client, p);
    assert.equal(d.percent, tier(n));
    assert.equal(d.counted, Math.min(n, 9));
    if (n < 3) await assert.rejects(() => s.redeem(client, p));
    if (n < 10) await person("friend" + n, p.code);
    if ([0, 1, 2, 3, 6, 9, 10].includes(n))
      console.log("STAGING_TIER", { referrals: n, percent: d.percent });
  }
  await login(client, `staging-${suffix}-friend0+alias@example.invalid`);
  assert.equal((await s.dashboard(client, p)).confirmed, 10);
  await s.redeem(client, p);
  await assert.rejects(() => s.redeem(client, p));
  const cp = (await s.dashboard(client, p)).coupon;
  assert.equal(cp.percent, 30);
  const items = [
    {
      id: "modelo-01",
      variantIndex: 0,
      size: "M",
      qty: 2,
      price: 1,
      discount: 100,
    },
  ];
  const b = { items, coupon: cp.code };
  const o = await s.checkout(client, b, p, true);
  assert.equal(o.total, 13986);
  assert.equal(o.discount, 5994);
  assert.equal(o.message, message(o, o.id));
  assert.equal((await s.dashboard(client, p)).coupon.used, false);
  assert.equal((await s.checkout(client, b, p, true)).id, o.id);
  await s.admin(
    client,
    { action: "cancel", id: o.id, reason: "Teste isolado cancelado" },
    "staging",
  );
  const final = await s.checkout(client, b, p, true);
  await assert.rejects(() =>
    s.admin(
      client,
      { action: "confirm", id: final.id, reason: "Sem identidade conferida" },
      "staging",
    ),
  );
  await s.admin(
    client,
    {
      action: "confirm",
      id: final.id,
      reason: "Venda sintética, sem pagamento real",
      ownerVerified: true,
    },
    "staging",
  );
  assert.equal((await s.dashboard(client, p)).coupon.used, true);
  await assert.rejects(() => s.checkout(client, b, p, true));
  for (const n of [3, 6]) {
    const owner = await person("early" + n);
    for (let i = 0; i < n; i++) await person("early" + n + "-" + i, owner.code);
    await s.redeem(client, owner);
    assert.equal(
      (await s.dashboard(client, owner)).coupon.percent,
      (n / 3) * 10,
    );
    await assert.rejects(() => s.redeem(client, owner));
    await assert.rejects(() =>
      login(client, `late-${suffix}-${n}@example.invalid`, owner.code),
    );
  }
  assert.equal(quote([{ ...items[0], qty: 1 }], 30).total, 6993);
  await client.query("ROLLBACK");
  inTransaction = false;
  assert.deepEqual(await counts(), before);
  console.log("STAGING_GOOGLE_RULES_OK", {
    tlsVerified: true,
    allRowsRolledBack: true,
    realGoogleAuthenticationTested: false,
    productionChanged: false,
  });
} finally {
  if (connected) {
    try {
      if (inTransaction) await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}
