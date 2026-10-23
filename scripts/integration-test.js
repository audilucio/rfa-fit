// Only a dedicated local synthetic database may be used by this script.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
const url = process.env.DATABASE_URL || "";
if (!/^postgresql:\/\/rfa_test:.*@127\.0\.0\.1:55439\/rfa_test$/.test(url))
  throw Error(
    "Use exclusivamente o PostgreSQL sintético documentado na porta 55439.",
  );
process.env.PGSSL = "disable";
process.env.IDENTITY_SECRET = "synthetic-test-only-secret-32-characters";
process.env.REFERRALS_ENABLED = "true";
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
process.env.RESEND_API_KEY = "synthetic";
process.env.EMAIL_FROM = "test@example.com";
process.env.ADMIN_EMAILS = "admin@example.com";
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(readFileSync("migrations/001_referrals.sql", "utf8"));
const { transaction } = await import("../lib/db.js");
const s = await import("../lib/service.js");
const { default: handler } = await import("../api/referral.js");
let mail;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  assert.equal(url, "https://api.resend.com/emails");
  mail = JSON.parse(opt.body);
  return { ok: true };
};
async function api(
  body,
  session = "",
  origin = process.env.APP_ORIGIN,
  ip = "test-ip",
) {
  const headers = {};
  let status;
  let result;
  await handler(
    {
      method: "POST",
      body,
      headers: {
        origin,
        "content-type": "application/json",
        cookie: "rfa_session=" + session,
        "x-vercel-forwarded-for": ip,
      },
      socket: {},
    },
    {
      setHeader: (k, v) => (headers[k] = v),
      status: (n) => {
        status = n;
        return { json: (b) => (result = b) };
      },
    },
  );
  return { status, result, headers };
}
const suffix = randomUUID().slice(0, 8);
const join = await api({
  action: "register",
  email: `api-${suffix}@example.com`,
  consent: true,
});
assert.equal(join.status, 200);
assert.ok(mail.text.includes("#token="));
const token = mail.text.match(/#token=([a-f0-9]+)/)[1];
assert.ok(!JSON.stringify(join.result).includes(token));
const verify = await api({ action: "verify", token });
assert.equal(verify.status, 200);
assert.match(verify.headers["Set-Cookie"], /HttpOnly; SameSite=Strict/);
const session = verify.headers["Set-Cookie"].match(/rfa_session=([^;]+)/)[1];
assert.equal((await api({ action: "verify", token })).status, 400);
assert.equal(
  (await api({ action: "dashboard" }, session, "https://evil.example")).status,
  403,
);
assert.equal(
  (await api({ action: "admin", operation: { action: "list" } }, session))
    .status,
  400,
);
const owner = await transaction(async (c) => {
  const p = await s.participant(c, session);
  await s.admin(
    c,
    { action: "approve", id: p.id, reason: "Revisão sintética" },
    "test",
  );
  return { ...p, approved: true };
});
for (let i = 0; i < 3; i++)
  await transaction(async (c) => {
    const r = await s.register(c, {
      email: `pg-${suffix}-${i}@example.net`,
      ref: owner.code,
      consent: true,
    });
    const t = await s.verify(c, r.token);
    const p = await s.participant(c, t);
    await s.admin(
      c,
      { action: "approve", id: p.id, reason: "Pessoa sintética distinta" },
      "test",
    );
  });
const redeemed = await Promise.allSettled([
  transaction((c) => s.redeem(c, owner)),
  transaction((c) => s.redeem(c, owner)),
]);
assert.equal(redeemed.filter((r) => r.status === "fulfilled").length, 1);
const d = await transaction((c) => s.dashboard(c, owner));
const items = [
  {
    id: "modelo-01",
    variantIndex: 1,
    size: "M",
    qty: 2,
    price: 1,
    percent: 100,
  },
];
const results = await Promise.all([
  api({ action: "checkout", items, coupon: d.coupon.code }, session),
  api({ action: "checkout", items, coupon: d.coupon.code }, session),
]);
assert.equal(results[0].status, 200);
assert.equal(results[1].status, 200);
assert.equal(results[0].result.id, results[1].result.id);
assert.equal(results[0].result.subtotal, 19980);
assert.equal(results[0].result.discount, 1998);
assert.equal(results[0].result.total, 17982);
assert.ok(results[0].result.message.includes("179,82"));
assert.ok(results[0].result.message.includes("2 un."));
await client.query(
  "UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=$1",
  [results[0].result.id],
);
const recovered = await api(
  { action: "checkout", items, coupon: d.coupon.code },
  session,
);
assert.equal(recovered.status, 200);
assert.notEqual(recovered.result.id, results[0].result.id);
for (let i = 0; i < 5; i++)
  assert.equal(
    (
      await api(
        {
          action: "register",
          email: `rate-${suffix}@example.org`,
          consent: true,
        },
        "",
        "http://127.0.0.1:3000",
        "rate-" + suffix,
      )
    ).status,
    200,
  );
assert.equal(
  (
    await api(
      {
        action: "register",
        email: `rate-${suffix}@example.org`,
        consent: true,
      },
      "",
      "http://127.0.0.1:3000",
      "rate-" + suffix,
    )
  ).status,
  429,
);
process.env.REFERRALS_ENABLED = "false";
assert.equal((await api({ action: "redeem" }, session)).status, 503);
globalThis.fetch = realFetch;
await client.end();
console.log(
  "PostgreSQL real: API, e-mail transacional simulado, sessão, CSRF, admin negado, concorrência de resgate e reserva, totais, recuperação e limites passaram.",
);
process.exit(0);
