// Read-only smoke test for the deployed store while the campaign is disabled.
// Never sends a WhatsApp message, email, or registration request.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const origin = "https://rfa-fit-loja.vercel.app";
const response = await fetch(origin + "/api/referral", {
  signal: AbortSignal.timeout(15000),
});
assert.equal(response.status, 200);
assert.equal(
  (await response.json()).enabled,
  false,
  "This check requires the campaign to remain disabled.",
);
const products = await (await fetch(origin + "/data/products.json")).json();
assert.equal(products.products.length, 5);
for (const product of products.products.filter((p) => p.active))
  assert.equal(product.price, 99.9);
for (const path of [
  "/lib/db.js",
  "/lib/db-config.js",
  "/scripts/staging-smoke.js",
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
    assert.ok(await page.locator("#referralPromo").isHidden());
    assert.ok(await page.locator("#couponBox").isHidden());
    await page.evaluate(() => {
      currentProduct = PRODUCTS[0];
      currentVariantIndex = 0;
      selectedSize = "M";
      currentQty = 2;
      addToCart();
    });
    assert.ok(
      (await page.locator("#cartTotal").innerText()).includes("199,80"),
    );
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
    await page.goto(origin + "/indicacoes.html");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("ainda não disponível"),
    );
    assert.ok(await page.locator("#registration").isHidden());
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
    assert.equal(blocked, 503);
    await page.goto(origin + "/admin-indicacoes.html");
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("indisponível"),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Public store ${width}px: catalog, R$99.90, cart, legacy WhatsApp, disabled campaign/admin and no JavaScript errors verified.`,
    );
  }
} finally {
  await browser.close();
}
console.log(
  "Public smoke OK. No emails, registrations or WhatsApp messages sent.",
);
