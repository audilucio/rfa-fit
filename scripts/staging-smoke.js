// This probes the RFA.FIT Neon staging database only, rolling back every test row.
// It does not send mail, create sales, or prove production email delivery.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { databaseConfig } from "../lib/db-config.js";
import * as service from "../lib/service.js";
import { quote, message, tier } from "../lib/domain.js";
if (process.env.NEON_PROJECT_ID !== "orange-glade-30690745")
  throw Error(
    "Somente o projeto Neon exclusivo de homologação RFA.FIT é permitido.",
  );
const client = new pg.Client(databaseConfig());
const tables = [
  "participants",
  "coupons",
  "orders",
  "tokens",
  "sessions",
  "limits",
  "audit",
  "deletion_requests",
];
async function counts() {
  const sql = tables
    .map((t) => `SELECT '${t}' AS name, count(*)::text AS count FROM ${t}`)
    .join(" UNION ALL ");
  return Object.fromEntries(
    (await client.query(sql)).rows.map((r) => [r.name, Number(r.count)]),
  );
}
const suffix = randomUUID().slice(0, 8);
let before;
let connected = false;
let inTransaction = false;
async function person(name, ref) {
  const mail = await service.register(client, {
    email: `staging-${suffix}-${name}@example.invalid`,
    ref,
    consent: true,
  });
  const session = await service.verify(client, mail.token);
  await assert.rejects(() => service.verify(client, mail.token), /inválido/);
  const p = await service.participant(client, session);
  await service.admin(
    client,
    { action: "approve", id: p.id, reason: "Teste isolado com rollback" },
    "staging-smoke",
  );
  return { ...p, approved: true };
}
try {
  await client.connect();
  connected = true;
  assert.equal(client.connection.stream.authorized, true);
  before = await counts();
  await client.query("BEGIN");
  inTransaction = true;
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SELECT pg_advisory_xact_lock(75412023)");
  const owner = await person("owner");
  await assert.rejects(
    () =>
      service.register(client, {
        email: owner.email,
        ref: owner.code,
        consent: true,
      }),
    /Autoconvite/,
  );
  await assert.rejects(
    () =>
      service.register(client, {
        email: `staging-${suffix}-bad@example.invalid`,
        ref: "invalid",
        consent: true,
      }),
    /inválido/,
  );
  for (let n = 0; n <= 10; n++) {
    const d = await service.dashboard(client, owner);
    assert.equal(d.percent, tier(n));
    assert.equal(d.counted, Math.min(n, 9));
    if (n < 3) await assert.rejects(() => service.redeem(client, owner));
    if (n < 10) await person("friend" + n, owner.code);
    if ([0, 1, 2, 3, 6, 9, 10].includes(n))
      console.log("STAGING_TIER", { referrals: n, percent: d.percent });
  }
  await service.register(client, {
    email: `staging-${suffix}-friend0+alias@example.invalid`,
    consent: true,
  });
  assert.equal((await service.dashboard(client, owner)).confirmed, 10);
  await service.redeem(client, owner);
  const coupon = (await service.dashboard(client, owner)).coupon;
  assert.equal(coupon.percent, 30);
  await assert.rejects(() => service.redeem(client, owner));
  const item = {
    id: "modelo-01",
    variantIndex: 0,
    size: "M",
    qty: 2,
    price: 1,
    discount: 100,
  };
  const order = await service.checkout(
    client,
    { items: [item], coupon: coupon.code },
    owner,
    true,
  );
  assert.equal(order.subtotal, 19980);
  assert.equal(order.total, 13986);
  assert.equal(order.discount, 5994);
  assert.equal(order.message, message(order, order.id));
  assert.equal((await service.dashboard(client, owner)).coupon.used, false);
  assert.equal(
    (
      await service.checkout(
        client,
        { items: [item], coupon: coupon.code },
        owner,
        true,
      )
    ).id,
    order.id,
  );
  await service.admin(
    client,
    {
      action: "cancel",
      id: order.id,
      reason: "Cancelamento sintético isolado",
    },
    "staging-smoke",
  );
  const final = await service.checkout(
    client,
    { items: [item], coupon: coupon.code },
    owner,
    true,
  );
  await assert.rejects(() =>
    service.admin(
      client,
      { action: "confirm", id: final.id, reason: "Sem identidade conferida" },
      "staging-smoke",
    ),
  );
  await service.admin(
    client,
    {
      action: "confirm",
      id: final.id,
      reason: "Venda sintética sem pagamento real",
      ownerVerified: true,
    },
    "staging-smoke",
  );
  assert.equal((await service.dashboard(client, owner)).coupon.used, true);
  await assert.rejects(() =>
    service.checkout(
      client,
      { items: [item], coupon: coupon.code },
      owner,
      true,
    ),
  );
  for (const n of [3, 6]) {
    const p = await person("early" + n);
    for (let i = 0; i < n; i++) await person("early" + n + "-" + i, p.code);
    await service.redeem(client, p);
    const d = await service.dashboard(client, p);
    assert.equal(d.coupon.percent, (n / 3) * 10);
    await assert.rejects(() => service.redeem(client, p));
    await assert.rejects(() =>
      service.register(client, {
        email: `staging-${suffix}-late${n}@example.invalid`,
        ref: p.code,
        consent: true,
      }),
    );
  }
  assert.equal(quote([{ ...item, qty: 1 }], 30).total, 6993);
  await client.query("ROLLBACK");
  inTransaction = false;
  assert.deepEqual(await counts(), before);
  console.log("STAGING_SMOKE_OK", {
    tls: "certificate verified",
    backend: "Neon PostgreSQL pooler",
    tiers: "3/6/9 = 10/20/30; 10 capped at 30",
    order: "R$199,80 - R$59,94 = R$139,86",
    coupon: "reservation, cancellation, confirmation, single use",
    allRowsRolledBack: true,
    emailDeliveryTested: false,
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
