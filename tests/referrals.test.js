import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { tier, quote, message, emailIdentity, hash } from "../lib/domain.js";
import * as s from "../lib/service.js";
import { migrate, login, person as makePerson, claims } from "./helpers.js";
process.env.IDENTITY_SECRET = "synthetic-test-only-secret-32-characters";
let db;
const item = { id: "modelo-01", variantIndex: 0, size: "M", qty: 1 };
before(async () => {
  db = new PGlite();
  await migrate(db);
});
after(async () => db.close());
const person = (email, ref, extra) => makePerson(db, email, ref, extra);
test("níveis 0,1,2,3,6,9,10 e limite", () => {
  for (const [n, v] of [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 10],
    [6, 20],
    [9, 30],
    [10, 30],
  ])
    assert.equal(tier(n), v);
});
test("preço vigente, arredondamento, entradas adulteradas e WhatsApp", () => {
  for (const percent of [0, 10, 20, 30]) {
    const q = quote([{ ...item, qty: 3, price: 1, discount: 100 }], percent);
    assert.equal(q.subtotal, 29970);
    assert.equal(q.discount, Math.round((29970 * percent) / 100));
    assert.equal(q.total, q.subtotal - q.discount);
    const m = message(q, "test-order");
    assert.ok(m.includes("3 un."));
    assert.ok(m.includes("R$ 299,70"));
    assert.ok(m.includes("Total:"));
  }
  assert.equal(quote([item], 30).total, 6993);
  for (const qty of [0, -1, 1.2, 21, "1"])
    assert.throws(() => quote([{ ...item, qty }]));
  assert.throws(() => quote([item], 31));
  assert.throws(() => quote([{ ...item, variantIndex: 99 }]));
  assert.throws(() => quote([{ ...item, id: "fake" }]));
});
test("identidade normalizada, aliases e endereços inválidos", () => {
  assert.equal(
    emailIdentity("A.B+um@gmail.com").identity_hash,
    emailIdentity("ab@googlemail.com").identity_hash,
  );
  assert.throws(() => emailIdentity("no"));
});
test("Google challenge single use, expiry, contact deduplication and self referral", async () => {
  const owner = await person("owner@example.com");
  await assert.rejects(() => login(db, owner.email, owner.code), /Autoconvite/);
  await assert.rejects(
    () => login(db, "new@example.com", "f".repeat(20)),
    /inválido/,
  );
  const ch = await s.googleChallenge(db, owner.code);
  assert.equal((await s.dashboard(db, owner)).confirmed, 0);
  const payload = claims("friend@example.com", ch.nonce);
  const session = await s.googleLogin(
    db,
    payload,
    { csrfToken: ch.csrfToken, consent: true },
    ch.csrfToken,
  );
  await assert.rejects(
    () =>
      s.googleLogin(
        db,
        payload,
        { csrfToken: ch.csrfToken, consent: true },
        ch.csrfToken,
      ),
    /utilizado/,
  );
  const friend = await s.participant(db, session);
  assert.equal((await s.dashboard(db, owner)).confirmed, 0);
  await s.admin(
    db,
    { action: "approve", id: friend.id, reason: "Legitimidade revisada" },
    "admin",
  );
  assert.equal((await s.dashboard(db, owner)).confirmed, 1);
  await login(db, "friend+alias@example.com");
  assert.equal((await s.dashboard(db, owner)).confirmed, 1);
  await assert.rejects(
    () =>
      login(db, "friend@example.com", undefined, {
        sub: "another-google-account",
      }),
    /vinculado/,
  );
  const expired = await s.googleChallenge(db);
  await db.query(
    "UPDATE google_auth_challenges SET expires_at=now()-interval '1 second' WHERE hash=$1",
    [hash(expired.csrfToken)],
  );
  await assert.rejects(() =>
    s.googleLogin(
      db,
      claims("expired@example.com", expired.nonce),
      { csrfToken: expired.csrfToken, consent: true },
      expired.csrfToken,
    ),
  );
});
test("progressão persistente, resgate único concorrente, reserva, expiração, fraude e confirmação", async () => {
  const p = await person("levels@example.com");
  for (let n = 0; n <= 10; n++) {
    const d = await s.dashboard(db, p);
    assert.equal(d.percent, tier(n));
    assert.equal(d.counted, Math.min(n, 9));
    if (n < 3) await assert.rejects(() => s.redeem(db, p));
    if (n < 10) await person(`level-${n}@example.net`, p.code);
  }
  // PGlite transaction queue models simultaneous clients; production uses the same DB transaction + advisory lock.
  const redeem = () => db.transaction((c) => s.redeem(c, p));
  const attempts = await Promise.allSettled([redeem(), redeem()]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const coupon = (await s.dashboard(db, p)).coupon;
  assert.equal(coupon.percent, 30);
  assert.equal((await s.dashboard(db, p)).percent, 0);
  const b = { items: [{ ...item, qty: 2 }], coupon: coupon.code };
  await assert.rejects(() => s.checkout(db, b, null, true));
  const other = await person("other@example.com");
  await assert.rejects(() => s.checkout(db, b, other, true));
  const o = await s.checkout(db, b, p, true);
  assert.equal(o.total, 13986);
  assert.equal((await s.checkout(db, b, p, false)).total, 13986);
  assert.equal(o.message, message(o, o.id));
  assert.equal((await s.dashboard(db, p)).coupon.used, false);
  assert.equal((await s.checkout(db, b, p, true)).id, o.id);
  await assert.rejects(
    () => s.checkout(db, { ...b, items: [item] }, p, true),
    /reservado/,
  );
  await s.admin(
    db,
    { action: "cancel", id: o.id, reason: "Cancelamento de teste" },
    "admin",
  );
  const next = await s.checkout(db, b, p, true);
  assert.notEqual(next.id, o.id);
  await db.query(
    "UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=$1",
    [next.id],
  );
  await s.expire(db);
  await assert.rejects(() =>
    s.admin(
      db,
      {
        action: "confirm",
        id: next.id,
        reason: "Confirmação atrasada",
        ownerVerified: true,
      },
      "admin",
    ),
  );
  const final = await s.checkout(db, b, p, true);
  await assert.rejects(() =>
    s.admin(
      db,
      { action: "confirm", id: final.id, reason: "Sem conferir titular" },
      "admin",
    ),
  );
  await s.admin(
    db,
    {
      action: "confirm",
      id: final.id,
      reason: "Titular e venda conferidos",
      ownerVerified: true,
    },
    "admin",
  );
  assert.equal((await s.dashboard(db, p)).coupon.used, true);
  await assert.rejects(() => s.checkout(db, b, p, true));
  await assert.rejects(() => s.redeem(db, p));
});
test("resgate em 3 e 6 encerra progressão e cupom expira em 30 dias", async () => {
  for (const n of [3, 6]) {
    const p = await person(`early${n}@example.com`);
    for (let i = 0; i < n; i++)
      await person(`early${n}-${i}@example.net`, p.code);
    await s.redeem(db, p);
    const d = await s.dashboard(db, p);
    assert.equal(d.coupon.percent, (n / 3) * 10);
    assert.ok(new Date(d.coupon.expires_at) - Date.now() > 29 * 86400000);
    await assert.rejects(() => login(db, "late@example.com", p.code));
    await db.query(
      "UPDATE coupons SET expires_at=now()-interval '1 second' WHERE participant=$1",
      [p.id],
    );
    await assert.rejects(() =>
      s.checkout(db, { items: [item], coupon: d.coupon.code }, p, true),
    );
    await assert.rejects(() => s.redeem(db, p));
  }
});
test("revogação de indicação invalida benefício e exclusão remove acessos", async () => {
  const p = await person("fraud-owner@example.com");
  const friends = [];
  for (let i = 0; i < 3; i++)
    friends.push(await person(`fraud-${i}@example.net`, p.code));
  await s.redeem(db, p);
  const coupon = (await s.dashboard(db, p)).coupon;
  await s.admin(
    db,
    { action: "block", id: friends[0].id, reason: "Duplicidade comprovada" },
    "admin",
  );
  await assert.rejects(
    () => s.checkout(db, { items: [item], coupon: coupon.code }, p, true),
    /suspenso/,
  );
  await db.query("INSERT INTO deletion_requests(participant) VALUES($1)", [
    p.id,
  ]);
  await s.admin(
    db,
    { action: "delete", id: p.id, reason: "Solicitação do titular" },
    "admin",
  );
  const r = (await db.query("SELECT * FROM participants WHERE id=$1", [p.id]))
    .rows[0];
  assert.equal(r.deleted, true);
  assert.ok(r.email.endsWith("@invalid.local"));
});
test("rate limiting persiste e limita", async () => {
  assert.equal(await s.rate(db, "test-rate", 2), true);
  assert.equal(await s.rate(db, "test-rate", 2), true);
  assert.equal(await s.rate(db, "test-rate", 2), false);
});
test("stable Google sub survives email changes; historical contacts cannot be reused or auto linked", async () => {
  const first = await login(db, "stable@example.com", undefined, {
    sub: "stable-sub",
  });
  const p = await s.participant(db, first);
  const second = await login(db, "renamed@example.com", undefined, {
    sub: "stable-sub",
  });
  assert.equal((await s.participant(db, second)).id, p.id);
  await assert.rejects(
    () => login(db, "stable@example.com", undefined, { sub: "different-sub" }),
    /vinculado/,
  );
  const legacyEmail = emailIdentity("legacy@example.com");
  const id = "11111111-1111-4111-8111-111111111111";
  await db.query(
    "INSERT INTO participants(id,email,identity_hash,code,confirmed) VALUES($1,$2,$3,$4,true)",
    [id, legacyEmail.email, legacyEmail.identity_hash, "legacy-code"],
  );
  await db.query("INSERT INTO participant_contacts VALUES($1,$2)", [
    legacyEmail.identity_hash,
    id,
  ]);
  await assert.rejects(() => login(db, "legacy@example.com"), /vinculado/);
});
test("CSRF and nonce required, no consent means no registration", async () => {
  const ch = await s.googleChallenge(db);
  const p = claims("csrf@example.com", ch.nonce);
  await assert.rejects(
    () =>
      s.googleLogin(db, p, { csrfToken: "bad", consent: true }, ch.csrfToken),
    /CSRF/,
  );
  await assert.rejects(
    () =>
      s.googleLogin(
        db,
        p,
        { csrfToken: ch.csrfToken, consent: false },
        ch.csrfToken,
      ),
    /Aceite/,
  );
  await assert.rejects(
    () =>
      s.googleLogin(
        db,
        { ...p, nonce: "bad" },
        { csrfToken: ch.csrfToken, consent: true },
        ch.csrfToken,
      ),
    /nonce/,
  );
});
test("admin is pinned to Google subject and cannot transfer with changed email", async () => {
  process.env.ADMIN_EMAILS = "admin@gmail.com";
  const sess = await login(db, "admin@gmail.com", undefined, {
    sub: "admin-stable",
  });
  const admin = await s.participant(db, sess);
  assert.equal(await s.isAdmin(db, admin), true);
  const changed = await login(db, "admin-renamed@gmail.com", undefined, {
    sub: "admin-stable",
  });
  assert.equal(await s.isAdmin(db, await s.participant(db, changed)), true);
  await assert.rejects(
    () => login(db, "admin@gmail.com", undefined, { sub: "different-admin" }),
    /vinculado/,
  );
  process.env.ADMIN_EMAILS = "custom@example.com";
  const nonAuthority = await login(db, "custom@example.com");
  assert.equal(
    await s.isAdmin(db, await s.participant(db, nonAuthority)),
    false,
  );
});
