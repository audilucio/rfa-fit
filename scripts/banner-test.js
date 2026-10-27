import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3011",
  destination = "https://rfa-fit-loja.vercel.app/indicacoes.html";
const server = spawn(process.execPath, ["scripts/dev.js"], {
  env: { ...process.env, PORT: "3011", REFERRALS_ENABLED: "false" },
  stdio: "pipe",
});
await new Promise((ok, no) => {
  server.stdout.once("data", ok);
  server.once("error", no);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [360, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/referral", (route) =>
      route.fulfill({
        json:
          route.request().method() === "GET"
            ? { enabled: true }
            : {
                lines: [],
                subtotal: 19980,
                discount: 0,
                total: 19980,
                percent: 0,
              },
      }),
    );
    await page.route(destination, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Campaign destination</title><h1>Indique &amp; Ganhe</h1>",
      }),
    );
    await page.goto(base);
    await page.locator("#referralPromo").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    const title = (await page.locator("#referralPromoTitle").innerText())
      .replace(/\s+/g, " ")
      .trim();
    assert.equal(title, "INDIQUE & GANHE — ATÉ 30% OFF!");
    assert.ok(
      (await page.locator("#referralPromoValidation").innerText()).includes(
        "aprovação administrativa",
      ),
    );
    const cta = page.locator("#referralPromoButton");
    assert.equal(await cta.innerText(), "QUERO PARTICIPAR 🎁");
    assert.equal(await cta.getAttribute("href"), destination);
    const box = await cta.boundingBox();
    assert.ok(
      box.y + box.height <= 900,
      "CTA must be visible before scrolling",
    );
    assert.ok(
      await page.evaluate(
        () =>
          document.getElementById("referralPromo").getBoundingClientRect()
            .bottom <=
          document.querySelector(".hero").getBoundingClientRect().top + 1,
      ),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.ok(
      await page.evaluate(() => PRODUCTS.every((p) => p.price === 99.9)),
    );
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `.vercel/banner-${width}.png` });
    await cta.click();
    await page.waitForURL(destination);
    assert.equal(await page.title(), "Campaign destination");
    await page.goto(base);
    await page.locator("#referralPromo").waitFor({ state: "visible" });
    if (width <= 900) {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Menu", exact: true })
          .getAttribute("aria-expanded"),
        "true",
      );
    }
    const menuLink = page.locator("#referralNavLink");
    assert.ok(await menuLink.isVisible());
    assert.equal(await menuLink.getAttribute("href"), destination);
    await menuLink.click();
    await page.waitForURL(destination);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Banner ${width}px: visible above hero/CTA before scrolling, valid native navigation, menu, prices and layout passed.`,
    );
  }
  for (const scenario of [
    { name: "disabled", status: 200, json: { enabled: false } },
    { name: "server error", status: 503, json: { enabled: true } },
    { name: "malformed response", status: 200, json: { enabled: "true" } },
    { name: "network failure", abort: true },
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.route("**/api/referral", (r) =>
      scenario.abort
        ? r.abort()
        : r.fulfill({ status: scenario.status, json: scenario.json }),
    );
    await page.goto(base);
    await page.waitForFunction(
      () => typeof PRODUCTS !== "undefined" && PRODUCTS.length === 5,
    );
    await page.waitForTimeout(100);
    assert.ok(await page.locator("#referralPromo").isHidden());
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    assert.ok(await page.locator("#referralNavLink").isHidden());
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Menu", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    await page.close();
    console.log("Promotion hidden safely:", scenario.name);
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/api/referral", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ json: { enabled: true } })
      : r.fulfill({ status: 503, json: { error: "Cotação indisponível" } }),
  );
  await page.route(destination, (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Campaign destination</title>",
    }),
  );
  await page.goto(base);
  await page.locator("#referralPromo").waitFor({ state: "visible" });
  await page.evaluate(() => {
    currentProduct = PRODUCTS[0];
    currentVariantIndex = 0;
    selectedSize = "M";
    currentQty = 2;
    addToCart();
  });
  await page.waitForFunction(() =>
    document
      .getElementById("couponStatus")
      .textContent.includes("Cotação indisponível"),
  );
  await page.evaluate(() => closeCart());
  await page.locator("#referralPromoButton").click();
  await page.waitForURL(destination);
  console.log("CTA remains functional independently of cart quote failure.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
