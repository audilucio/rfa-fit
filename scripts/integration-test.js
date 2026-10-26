// Real isolated PostgreSQL + real RSA validation. Google identities are local fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { identityFixture, clientId } from "../tests/google-fixture.js";
const url = process.env.DATABASE_URL || "";
if (!/^postgresql:\/\/rfa_test:.*@127\.0\.0\.1:55439\/rfa_test$/.test(url))
  throw Error("Use somente o banco sintético local RFA.FIT na porta 55439.");
Object.assign(process.env, {
  PGSSL: "disable",
  IDENTITY_SECRET: "synthetic-test-only-secret-32-characters",
  REFERRALS_ENABLED: "true",
  APP_ORIGIN: "http://127.0.0.1:3000",
  GOOGLE_CLIENT_ID: clientId,
  ADMIN_EMAILS: "admin@gmail.com",
});
function migrate() {
  const r = spawnSync(process.execPath, ["scripts/migrate.js"], {
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, "Local migration must succeed");
}
migrate();
const fixture = await identityFixture();
const { createHandler } = await import("../api/referral.js");
const handler = createHandler({ verifyToken: fixture.verify });
const { transaction } = await import("../lib/db.js");
const s = await import("../lib/service.js");
const client = new pg.Client({ connectionString: url });
await client.connect();
const testIp = "integration-" + randomUUID();
async function api(
  body,
  { cookie = "", origin = process.env.APP_ORIGIN, ip = testIp } = {},
) {
  const headers = {};
  let status, result;
  await handler(
    {
      method: "POST",
      body,
      headers: {
        origin,
        "content-type": "application/json",
        cookie,
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
async function login(email, ref, extra = {}) {
  const ch = await api({ action: "googleChallenge", ref });
  assert.equal(ch.status, 200);
  const cookie = "rfa_google_login=" + ch.result.csrfToken;
  const credential = await fixture.sign(email, ch.result.nonce, extra);
  const r = await api(
    {
      action: "googleLogin",
      credential,
      csrfToken: ch.result.csrfToken,
      consent: true,
    },
    { cookie },
  );
  assert.equal(r.status, 200);
  const values = r.headers["Set-Cookie"];
  assert.match(values[0], /HttpOnly; SameSite=Strict/);
  return {
    cookie: values[0].split(";")[0],
    challengeCookie: cookie,
    credential,
    csrfToken: ch.result.csrfToken,
  };
}
const suffix = randomUUID().slice(0, 8);
const owner = await login(`api-${suffix}@example.com`);
const admin = await login("admin@gmail.com");
const ownerP = await transaction((c) =>
  s.participant(c, owner.cookie.slice("rfa_session=".length)),
);
assert.equal(
  (
    await api(
      {
        action: "googleLogin",
        credential: owner.credential,
        csrfToken: owner.csrfToken,
        consent: true,
      },
      { cookie: owner.challengeCookie },
    )
  ).status,
  400,
);
assert.equal(
  (
    await api(
      { action: "googleLogin", credential: owner.credential, csrfToken: "bad" },
      { cookie: owner.challengeCookie },
    )
  ).status,
  403,
);
assert.equal(
  (
    await api(
      { action: "dashboard" },
      { cookie: owner.cookie, origin: "https://evil.example" },
    )
  ).status,
  403,
);
assert.equal(
  (
    await api(
      { action: "admin", operation: { action: "list" } },
      { cookie: owner.cookie },
    )
  ).status,
  400,
);
assert.equal(
  (
    await api({
      action: "register",
      email: "untrusted@example.com",
      consent: true,
    })
  ).status,
  400,
);
const invalidChallenge = await api({ action: "googleChallenge" });
const invalidCookie = "rfa_google_login=" + invalidChallenge.result.csrfToken;
const invalidToken = await fixture.sign(
  "invalid@example.com",
  invalidChallenge.result.nonce,
  { aud: "wrong-audience" },
);
assert.equal(
  (
    await api(
      {
        action: "googleLogin",
        credential: invalidToken,
        csrfToken: invalidChallenge.result.csrfToken,
        consent: true,
      },
      { cookie: invalidCookie },
    )
  ).status,
  400,
);
assert.equal(
  (
    await api(
      {
        action: "googleLogin",
        credential: invalidToken,
        csrfToken: "é".repeat(64),
        consent: true,
      },
      { cookie: invalidCookie },
    )
  ).status,
  403,
);
const oldOrigin = process.env.APP_ORIGIN;
process.env.APP_ORIGIN = "https://fixture.example";
const secureChallenge = await api(
  { action: "googleChallenge" },
  { origin: process.env.APP_ORIGIN },
);
assert.match(secureChallenge.headers["Set-Cookie"], /; Secure/);
process.env.APP_ORIGIN = oldOrigin;
migrate();
assert.equal(
  (await api({ action: "dashboard" }, { cookie: owner.cookie })).status,
  200,
  "Rerunning migrations must preserve Google sessions",
);
const act = (operation) =>
  api({ action: "admin", operation }, { cookie: admin.cookie });
assert.equal(
  (
    await act({
      action: "approve",
      id: ownerP.id,
      reason: "Cadastro sintético validado",
    })
  ).status,
  200,
);
for (let i = 0; i < 3; i++) {
  const friend = await login(`friend-${suffix}-${i}@example.net`, ownerP.code);
  const p = await transaction((c) =>
    s.participant(c, friend.cookie.slice("rfa_session=".length)),
  );
  assert.equal(
    (
      await act({
        action: "approve",
        id: p.id,
        reason: "Pessoa sintética distinta",
      })
    ).status,
    200,
  );
}
const attempts = await Promise.all([
  api({ action: "redeem" }, { cookie: owner.cookie }),
  api({ action: "redeem" }, { cookie: owner.cookie }),
]);
assert.equal(attempts.filter((r) => r.status === 200).length, 1);
const coupon = (await api({ action: "dashboard" }, { cookie: owner.cookie }))
  .result.coupon;
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
const b = { action: "checkout", items, coupon: coupon.code };
const orders = await Promise.all([
  api(b, { cookie: owner.cookie }),
  api(b, { cookie: owner.cookie }),
]);
assert.equal(orders[0].status, 200);
assert.equal(orders[1].status, 200);
assert.equal(orders[0].result.id, orders[1].result.id);
assert.equal(orders[0].result.total, 17982);
assert.ok(orders[0].result.message.includes("179,82"));
assert.ok(orders[0].result.message.includes("2 un."));
assert.equal(
  (
    await act({
      action: "confirm",
      id: orders[0].result.id,
      reason: "Sem identidade conferida",
    })
  ).status,
  400,
);
assert.equal(
  (
    await act({
      action: "confirm",
      id: orders[0].result.id,
      reason: "Venda sintética conferida",
      ownerVerified: true,
    })
  ).status,
  200,
);
assert.equal((await api(b, { cookie: owner.cookie })).status, 400);
const replayChallenge = await api({ action: "googleChallenge" });
const replayToken = await fixture.sign(
  `race-${suffix}@example.com`,
  replayChallenge.result.nonce,
);
const replay = () =>
  api(
    {
      action: "googleLogin",
      credential: replayToken,
      csrfToken: replayChallenge.result.csrfToken,
      consent: true,
    },
    { cookie: "rfa_google_login=" + replayChallenge.result.csrfToken },
  );
const logins = await Promise.all([replay(), replay()]);
assert.equal(logins.filter((r) => r.status === 200).length, 1);
for (let n = 0; n < 40; n++)
  assert.equal(
    (await api({ action: "googleChallenge" }, { ip: "limit-" + suffix }))
      .status,
    200,
  );
assert.equal(
  (await api({ action: "googleChallenge" }, { ip: "limit-" + suffix })).status,
  429,
);
process.env.REFERRALS_ENABLED = "false";
assert.equal((await api({ action: "googleChallenge" })).status, 503);
await client.end();
console.log(
  "Integration OK: PostgreSQL real, RSA fixtures, CSRF/nonce, Google session, admin pinning, idempotent migration, redemption/reservation concurrency, sale confirmation, totals, rate limits. No real Google login simulated as production.",
);
process.exit(0);
