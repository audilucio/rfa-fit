import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server = spawn(process.execPath, ["scripts/dev.js"], {
  env: { ...process.env, PORT: "3007", REFERRALS_ENABLED: "false" },
  stdio: "pipe",
});
await new Promise((ok, no) => {
  server.stdout.once("data", ok);
  server.once("error", no);
});
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [360, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3007");
    await page.waitForFunction(
      () => typeof PRODUCTS !== "undefined" && PRODUCTS.length === 5,
    );
    assert.equal(await page.locator("#referralPromo").isHidden(), true);
    await page.evaluate(() => {
      currentProduct = PRODUCTS[0];
      currentVariantIndex = 0;
      selectedSize = "M";
      currentQty = 2;
      addToCart();
    });
    await page.locator("#cartDrawer.open").waitFor();
    assert.ok(
      (await page.locator("#cartTotal").innerText()).includes("199,80"),
    );
    await page.evaluate(() => {
      window.open = (href) => {
        window.testWhats = href;
        return null;
      };
      checkoutWhatsApp();
    });
    assert.ok(
      decodeURIComponent(await page.evaluate(() => window.testWhats)).includes(
        "199,80",
      ),
    );
    await page.goto("http://127.0.0.1:3007/indicacoes.html");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("ainda não disponível"),
    );
    assert.equal(await page.locator("#registration").isHidden(), true);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    for (const path of [
      "regulamento.html",
      "privacidade.html",
      "admin-indicacoes.html",
    ]) {
      await page.goto("http://127.0.0.1:3007/" + path);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Viewport ${width}px: catálogo, sacola, checkout legado, campanha desativada e páginas responsivas passaram.`,
    );
  }
  // Active UI integration uses deterministic API fixtures; backend rules tested against real PostgreSQL separately.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/api/referral", async (route) => {
    const b = route.request().postDataJSON();
    const data =
      route.request().method() === "GET"
        ? { enabled: true }
        : b.action === "dashboard"
          ? {
              confirmed: 6,
              counted: 6,
              percent: 20,
              approved: true,
              code: "sample-code",
              orders: [],
            }
          : {
              lines: [],
              subtotal: 19980,
              discount: 3996,
              total: 15984,
              percent: 20,
              id: "fixture-order",
              message:
                "Pedido fixture-order\n2 un.\nSubtotal: R$ 199,80\nDesconto (20%): R$ 39,96\nTotal: R$ 159,84",
            };
    await route.fulfill({ json: data });
  });
  await page.goto("http://127.0.0.1:3007/indicacoes.html");
  await page.locator("#dashboard").waitFor({ state: "visible" });
  assert.equal(await page.locator("#progress").getAttribute("value"), "6");
  assert.ok(
    (await page.locator("#share").getAttribute("href")).includes("sample-code"),
  );
  await page.screenshot({
    path: "/tmp/rfa-fit-campaign-mobile.png",
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3007");
  await page.waitForFunction(() => PRODUCTS.length === 5);
  await page.evaluate(() => {
    currentProduct = PRODUCTS[0];
    currentVariantIndex = 0;
    selectedSize = "M";
    currentQty = 2;
    addToCart();
  });
  await page.locator("#couponBox").waitFor({ state: "visible" });
  await page.locator("#couponInput").fill("RFA-EXAMPLE");
  await page.locator("#applyCoupon").click();
  await page.waitForFunction(() =>
    document.getElementById("cartFinal").textContent.includes("159,84"),
  );
  assert.ok(
    (await page.locator("#cartDiscount").innerText()).includes("39,96"),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  console.log(
    "Interface ativa móvel: painel, compartilhamento, progresso e totais do servidor passaram com fixtures.",
  );
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
