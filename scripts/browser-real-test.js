import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
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
  RESEND_API_KEY: "synthetic",
  EMAIL_FROM: "test@example.com",
  ADMIN_EMAILS: "admin@example.com",
});
const { transaction } = await import("../lib/db.js");
const s = await import("../lib/service.js");
const suffix = randomUUID().slice(0, 8);
async function person(email, ref) {
  return transaction(async (c) => {
    const r = await s.register(c, { email, ref, consent: true });
    const session = await s.verify(c, r.token);
    const p = await s.participant(c, session);
    await s.admin(
      c,
      { action: "approve", id: p.id, reason: "Pessoa sintética distinta" },
      "test",
    );
    return { ...p, approved: true };
  });
}
const owner = await person(`browser-${suffix}@example.com`);
for (let i = 0; i < 3; i++)
  await person(`browser-${suffix}-${i}@example.net`, owner.code);
const login = await transaction((c) =>
  s.register(c, { email: owner.email, consent: true }),
);
const server = spawn(process.execPath, ["scripts/dev.js"], {
  env: { ...process.env, PORT: "3008" },
  stdio: "pipe",
});
await new Promise((ok, no) => {
  server.stdout.once("data", ok);
  server.once("error", no);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:3008/indicacoes.html#token=${login.token}`);
  await page.locator("#dashboard").waitFor({ state: "visible" });
  assert.equal(await page.locator("#progress").getAttribute("value"), "3");
  assert.ok(!page.url().includes("token"));
  const cookies = await page.context().cookies();
  assert.ok(cookies.find((c) => c.name === "rfa_session").httpOnly);
  await page.locator("#redeem").click();
  await page.waitForFunction(() =>
    document.getElementById("coupon").textContent.includes("RFA-"),
  );
  const coupon = (await page.locator("#coupon").innerText()).match(
    /RFA-[A-F0-9]+/,
  )[0];
  assert.equal(await page.locator("#redeem").isDisabled(), true);
  await page.goto("http://127.0.0.1:3008");
  await page.waitForFunction(() => PRODUCTS.length === 5);
  await page.evaluate(() => {
    currentProduct = PRODUCTS[0];
    currentVariantIndex = 0;
    selectedSize = "M";
    currentQty = 2;
    addToCart();
  });
  await page.locator("#couponBox").waitFor({ state: "visible" });
  await page.locator("#couponInput").fill(coupon);
  await page.locator("#applyCoupon").click();
  await page.waitForFunction(() =>
    document.getElementById("cartFinal").textContent.includes("179,82"),
  );
  await page.evaluate(() => {
    window.open = () => null;
  });
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/referral") &&
      r.request().postDataJSON()?.action === "checkout",
  );
  await page.locator('button[onclick="checkoutWhatsApp()"]').click();
  const result = await (await response).json();
  assert.equal(result.total, 17982);
  assert.equal(result.discount, 1998);
  const href = await page.locator("#couponStatus a").getAttribute("href");
  assert.equal(new URL(href).searchParams.get("text"), result.message);
  assert.ok(result.message.includes("2 un."));
  assert.ok(result.message.includes("179,82"));
  const state = await transaction((c) => s.dashboard(c, owner));
  assert.equal(state.coupon.used, false);
  assert.equal(state.orders, undefined);
  await page.goto("http://127.0.0.1:3008/indicacoes.html");
  await page.locator("#dashboard").waitFor({ state: "visible" });
  await page.locator("#orders button").click();
  await page.waitForFunction(() =>
    document.getElementById("orders").textContent.includes("cancelled"),
  );
  // Exercise the protected admin UI against the real local API, including sale confirmation.
  const review = await transaction(async (c) => {
    const r = await s.register(c, {
      email: `review-${suffix}@example.net`,
      consent: true,
    });
    const token = await s.verify(c, r.token);
    return s.participant(c, token);
  });
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
    if (!r.ok) throw Error("Second local test order failed");
    return r.json();
  }, coupon);
  await person("admin@example.com");
  const adminLogin = await transaction((c) =>
    s.register(c, { email: "admin@example.com", consent: true }),
  );
  const adminContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const adminPage = await adminContext.newPage();
  await adminPage.goto(
    `http://127.0.0.1:3008/indicacoes.html#token=${adminLogin.token}`,
  );
  await adminPage.locator("#dashboard").waitFor({ state: "visible" });
  await adminPage.goto("http://127.0.0.1:3008/admin-indicacoes.html");
  await adminPage.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Últimos 200"),
  );
  await adminPage
    .locator("#reason")
    .fill("Cadastro sintético revisado em teste");
  await adminPage
    .locator(".admin-record")
    .filter({ has: adminPage.locator("pre").filter({ hasText: review.id }) })
    .filter({
      has: adminPage.getByRole("button", { name: "Aprovar legitimidade" }),
    })
    .getByRole("button", { name: "Aprovar legitimidade" })
    .click();
  await adminPage.waitForFunction(
    (id) =>
      [...document.querySelectorAll(".admin-record pre")].some((p) => {
        try {
          const v = JSON.parse(p.textContent);
          return v.id === id && v.approved === true;
        } catch {
          return false;
        }
      }),
    review.id,
  );
  await adminPage
    .locator("#reason")
    .fill("Pagamento fictício e titular conferidos no teste");
  await adminPage.locator("#verified").check();
  await adminPage
    .locator(".admin-record")
    .filter({ has: adminPage.locator("pre").filter({ hasText: pending.id }) })
    .filter({ has: adminPage.getByRole("button", { name: "Confirmar venda" }) })
    .getByRole("button", { name: "Confirmar venda" })
    .click();
  await adminPage.waitForFunction(
    (id) =>
      [...document.querySelectorAll(".admin-record pre")].some((p) => {
        try {
          const v = JSON.parse(p.textContent);
          return v.id === id && v.status === "confirmed";
        } catch {
          return false;
        }
      }),
    pending.id,
  );
  assert.equal(
    (await transaction((c) => s.dashboard(c, owner))).coupon.used,
    true,
  );
  const reuse = await page.evaluate(async (coupon) => {
    const r = await fetch("/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "checkout",
        coupon,
        items: [{ id: "modelo-01", variantIndex: 0, size: "M", qty: 2 }],
      }),
    });
    return r.status;
  }, coupon);
  assert.equal(reuse, 400);
  await adminContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "Fluxo móvel REAL: link de acesso, cookie, painel, resgate, cupom, cotação, pedido e link WhatsApp idênticos ao servidor e cancelamento, aprovação no painel administrativo e confirmação de venda sintética passaram. Cupom consumido uma vez; e-mail e envio no WhatsApp não realizados.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
process.exit(0);
