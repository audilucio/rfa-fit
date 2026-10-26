// Local full-stack browser test. The Google SDK and signing keys are test fixtures.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { identityFixture, clientId } from "../tests/google-fixture.js";
if (
  !/^postgresql:\/\/rfa_test:.*@127\.0\.0\.1:55439\/rfa_test$/.test(
    process.env.DATABASE_URL || "",
  )
)
  throw Error("Banco sintético local obrigatório.");
Object.assign(process.env, {
  PGSSL: "disable",
  IDENTITY_SECRET: "synthetic-test-only-secret-32-characters",
  REFERRALS_ENABLED: "true",
  APP_ORIGIN: "http://127.0.0.1:3008",
  GOOGLE_CLIENT_ID: clientId,
  ADMIN_EMAILS: "admin@gmail.com",
});
assert.equal(
  spawnSync(process.execPath, ["scripts/migrate.js"], {
    env: process.env,
    encoding: "utf8",
  }).status,
  0,
);
const fixture = await identityFixture();
const { createHandler } = await import("../api/referral.js");
const { createDevServer } = await import("./dev.js");
const { transaction } = await import("../lib/db.js");
const s = await import("../lib/service.js");
const server = createDevServer(createHandler({ verifyToken: fixture.verify }));
await new Promise((ok) => server.listen(3008, "127.0.0.1", ok));
const browser = await chromium.launch({ headless: true });
const suffix = randomUUID().slice(0, 8),
  base = "http://127.0.0.1:3008";
const errors = [];
async function login(email, ref) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "x-vercel-forwarded-for": "browser-" + suffix },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let sdkLoads = 0;
  await page.exposeFunction("__fixtureGoogleToken", (nonce) =>
    fixture.sign(email, nonce),
  );
  await page.route("https://accounts.google.com/gsi/client", async (route) => {
    sdkLoads++;
    await route.fulfill({
      contentType: "text/javascript",
      body: `window.google={accounts:{id:{initialize(c){this.config=c;},renderButton(el){const b=document.createElement('button');b.id='fixtureGoogle';b.textContent='Google test identity';b.onclick=async()=>this.config.callback({credential:await window.__fixtureGoogleToken(this.config.nonce)});el.append(b);},disableAutoSelect(){}}}};`,
    });
  });
  await page.goto(base + "/indicacoes.html" + (ref ? "?ref=" + ref : ""));
  await page.locator("#registration").waitFor({ state: "visible" });
  assert.equal(sdkLoads, 0);
  assert.equal(await page.locator("input[type=email]").count(), 0);
  await page.locator("input[name=consent]").check();
  await page.locator("#prepareGoogle").click();
  await page.locator("#fixtureGoogle").click();
  await page.locator("#dashboard").waitFor({ state: "visible" });
  assert.equal(sdkLoads, 1);
  const cookie = (await context.cookies()).find(
    (c) => c.name === "rfa_session",
  );
  assert.ok(cookie?.httpOnly);
  const p = await transaction((c) => s.participant(c, cookie.value));
  return { context, page, p };
}
async function actionRecord(page, id, label) {
  const action = label === "Confirmar venda" ? "confirm" : "approve";
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/referral") &&
      r.request().postDataJSON()?.operation?.action === action,
  );
  await page
    .locator(".admin-record")
    .filter({ has: page.locator("pre").filter({ hasText: id }) })
    .filter({ has: page.getByRole("button", { name: label, exact: true }) })
    .getByRole("button", { name: label, exact: true })
    .click();
  assert.equal((await response).status(), 200);
}
async function adminPanel(page) {
  await page.goto(base + "/admin-indicacoes.html");
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Últimos 200"),
  );
  await page.locator("#reason").fill("Revisão de cadastro sintético em teste");
}
try {
  const owner = await login(`browser-${suffix}@example.com`);
  const admin = await login("admin@gmail.com");
  await adminPanel(admin.page);
  await actionRecord(admin.page, owner.p.id, "Aprovar legitimidade");
  for (let n = 0; n < 3; n++) {
    await adminPanel(admin.page);
    const friend = await login(
      `friend-${suffix}-${n}@example.net`,
      owner.p.code,
    );
    await adminPanel(admin.page);
    await actionRecord(admin.page, friend.p.id, "Aprovar legitimidade");
    await friend.context.close();
  }
  const page = owner.page;
  await page.locator("#refresh").click();
  await page.waitForFunction(
    () => document.getElementById("progress").value === 3,
  );
  await page.locator("#redeem").click();
  await page.waitForFunction(() =>
    document.getElementById("coupon").textContent.includes("RFA-"),
  );
  const coupon = (await page.locator("#coupon").innerText()).match(
    /RFA-[A-F0-9]+/,
  )[0];
  assert.ok(await page.locator("#redeem").isDisabled());
  await page.goto(base);
  await page.waitForFunction(() => PRODUCTS.length === 5);
  await page.evaluate(() => {
    currentProduct = PRODUCTS[0];
    currentVariantIndex = 0;
    selectedSize = "M";
    currentQty = 2;
    addToCart();
    window.open = () => null;
  });
  await page.locator("#couponBox").waitFor({ state: "visible" });
  await page.locator("#couponInput").fill(coupon);
  await page.locator("#applyCoupon").click();
  await page.waitForFunction(() =>
    document.getElementById("cartFinal").textContent.includes("179,82"),
  );
  const pendingResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/referral") &&
      r.request().postDataJSON()?.action === "checkout",
  );
  await page.locator('button[onclick="checkoutWhatsApp()"]').click();
  const order = await (await pendingResponse).json();
  assert.equal(order.total, 17982);
  assert.equal(order.discount, 1998);
  const href = await page.locator("#couponStatus a").getAttribute("href");
  assert.equal(new URL(href).searchParams.get("text"), order.message);
  assert.equal(
    (await transaction((c) => s.dashboard(c, owner.p))).coupon.used,
    false,
  );
  await page.goto(base + "/indicacoes.html");
  await page.locator("#dashboard").waitFor({ state: "visible" });
  await page.locator("#orders button").first().click();
  await page.waitForFunction(() =>
    document.getElementById("orders").textContent.includes("cancelled"),
  );
  const pending = await page.evaluate(async (coupon) => {
    const r = await fetch("/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "checkout",
        coupon,
        items: [{ id: "modelo-01", variantIndex: 0, size: "M", qty: 2 }],
      }),
    });
    return r.json();
  }, coupon);
  await adminPanel(admin.page);
  await admin.page.locator("#verified").check();
  await actionRecord(admin.page, pending.id, "Confirmar venda");
  await admin.page.waitForFunction(
    (id) =>
      [...document.querySelectorAll(".admin-record pre")].some((p) => {
        try {
          const r = JSON.parse(p.textContent);
          return r.id === id && r.status === "confirmed";
        } catch {
          return false;
        }
      }),
    pending.id,
  );
  assert.equal(
    (await transaction((c) => s.dashboard(c, owner.p))).coupon.used,
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile full stack OK: Google SDK/RSA local fixtures, consent, challenge/nonce, login/session, referral, administrative approval, single redemption, cart and WhatsApp totals, cancellation and sale confirmation. Real Google authentication NOT tested.",
  );
} finally {
  await browser.close();
  await new Promise((ok) => server.close(ok));
}
process.exit(0);
