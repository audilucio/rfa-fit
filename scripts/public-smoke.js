// Public read-only check. --active verifies the launched campaign without creating orders or registrations.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const origin = "https://rfa-fit-loja.vercel.app",
  active = process.argv.includes("--active");
const response = await fetch(origin + "/api/referral", {
  signal: AbortSignal.timeout(15000),
});
assert.equal(response.status, 200);
const config = await response.json();
assert.equal(config.enabled, active, "Unexpected campaign state");
if (active) {
  assert.equal(config.authenticationAvailable, true);
  assert.match(config.googleClientId, /\.apps\.googleusercontent\.com$/);
}
const products = await (await fetch(origin + "/data/products.json")).json();
assert.equal(products.products.length, 5);
for (const p of products.products.filter((p) => p.active))
  assert.equal(p.price, 99.9);
for (const path of [
  "/lib/db.js",
  "/lib/google-auth.js",
  "/scripts/staging-smoke.js",
  "/tests/google-fixture.js",
  "/.env",
  "/.env.preview.local",
  "/package.json",
  "/data/products.json.bkp",
])
  assert.equal(
    (await fetch(origin + path)).status,
    404,
    path + " must not be public",
  );
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.waitForFunction(
      () => typeof PRODUCTS !== "undefined" && PRODUCTS.length === 5,
    );
    if (active)
      await page.locator("#referralPromo").waitFor({ state: "visible" });
    else assert.ok(await page.locator("#referralPromo").isHidden());
    await page.evaluate(() => {
      currentProduct = PRODUCTS[0];
      currentVariantIndex = 0;
      selectedSize = "M";
      currentQty = 2;
      addToCart();
    });
    if (active) {
      await page.locator("#couponBox").waitFor({ state: "visible" });
      await page.waitForFunction(() =>
        document.getElementById("cartFinal").textContent.includes("199,80"),
      );
      assert.ok(
        (await page.locator("#cartDiscount").innerText()).includes("0,00"),
      );
      const q = await page.evaluate(async () => {
        const r = await fetch("/api/referral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "quote",
            items: [
              { id: "modelo-01", variantIndex: 0, size: "M", qty: 2, price: 1 },
            ],
            percent: 100,
            discount: 19980,
          }),
        });
        return { status: r.status, data: await r.json() };
      });
      assert.equal(q.status, 200);
      assert.equal(q.data.subtotal, 19980);
      assert.equal(q.data.discount, 0);
      assert.equal(q.data.total, 19980);
    } else {
      assert.ok(await page.locator("#couponBox").isHidden());
      await page.evaluate(() => {
        window.open = (href) => {
          window.__testOrderHref = href;
          return null;
        };
        checkoutWhatsApp();
      });
      assert.ok(
        decodeURIComponent(
          await page.evaluate(() => window.__testOrderHref),
        ).includes("199,80"),
      );
    }
    assert.ok(
      (await page.locator("#cartTotal").innerText()).includes("199,80"),
    );
    await page.goto(origin + "/indicacoes.html");
    if (active) {
      await page.locator("#registration").waitFor({ state: "visible" });
      assert.ok(await page.locator("#prepareGoogle").isVisible());
      assert.equal(await page.locator("input[type=email]").count(), 0);
    } else {
      await page.waitForFunction(() =>
        document
          .getElementById("status")
          .textContent.includes("ainda não disponível"),
      );
      assert.ok(await page.locator("#registration").isHidden());
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const blocked = await page.evaluate(async () => {
      const r = await fetch("/api/referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin",
          operation: { action: "list" },
        }),
      });
      return r.status;
    });
    assert.equal(blocked, active ? 400 : 503);
    await page.goto(origin + "/admin-indicacoes.html");
    await page.waitForFunction(
      (active) =>
        document
          .getElementById("status")
          .textContent.includes(active ? "Google" : "indisponível"),
      active,
    );
    assert.equal(await page.locator("#records").innerText(), "");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Public ${width}px OK: ${active ? "active campaign, server prices and protected admin" : "disabled campaign and legacy checkout"}, R$99.90, no JavaScript errors.`,
    );
  }
} finally {
  await browser.close();
}
console.log(
  "Public smoke passed. No registrations, orders, sales or WhatsApp messages created.",
);
