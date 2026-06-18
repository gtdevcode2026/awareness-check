// Custom AI provider — Test connection + field order (deterministic, route-mocked).
// Proves the Config "Test connection" button is not a silent no-op and that the
// AI settings card reads Provider -> Base URL -> API Key -> Available Models ->
// Model. No live endpoint required: the chat-completions probe is intercepted
// with page.route, so these pass even when the gateway/relay is unreachable.

const { test, expect } = require("@playwright/test");

const BASE_URL = "http://127.0.0.1:8799/v1"; // the loopback relay base

async function openCustomConfig(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto("/config.html", { waitUntil: "domcontentloaded" });
  await page.selectOption("#ai-provider", "custom");
  await expect(page.locator("#ai-base-url")).toBeVisible();
}

test.describe("custom AI: Test connection + field order", () => {
  test("card order is Base URL -> API Key -> Available Models -> Model", async ({ page }) => {
    await openCustomConfig(page);
    const pos = await page.evaluate(() => {
      const get = (id) => document.getElementById(id);
      // DOCUMENT_POSITION_FOLLOWING (4): b comes after a in document order.
      const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        baseBeforeKey: before(get("ai-base-url"), get("ai-key")),
        keyBeforeModels: before(get("ai-key"), get("ai-custom-models-field")),
        modelsBeforeModel: before(get("ai-custom-models-field"), get("ai-model")),
      };
    });
    expect(pos.baseBeforeKey, "Base URL should come before API Key").toBe(true);
    expect(pos.keyBeforeModels, "API Key should come before Available Models").toBe(true);
    expect(pos.modelsBeforeModel, "Available Models should come before the Model field").toBe(true);
  });

  test("Test connection with no model shows Load-models guidance (not a no-op)", async ({ page }) => {
    await openCustomConfig(page);
    await page.fill("#ai-base-url", BASE_URL);
    // No model chosen on purpose.
    await page.click("#ai-custom-test-btn");
    await expect(page.locator("#ai-custom-test-status")).toContainText(/Load models/i);
  });

  test("Test connection reports Connected when the endpoint returns 200", async ({ page }) => {
    await openCustomConfig(page);
    await page.fill("#ai-base-url", BASE_URL);
    await page.fill("#ai-model", "openai/gpt-4o-mini");
    await page.route("**/chat/completions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      })
    );
    await page.click("#ai-custom-test-btn");
    await expect(page.locator("#ai-custom-test-status")).toContainText(/Connected/i);
  });

  test("Test connection surfaces an HTTP error (401) from the endpoint", async ({ page }) => {
    await openCustomConfig(page);
    await page.fill("#ai-base-url", BASE_URL);
    await page.fill("#ai-model", "openai/gpt-4o-mini");
    await page.route("**/chat/completions", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthorized" }),
      })
    );
    await page.click("#ai-custom-test-btn");
    await expect(page.locator("#ai-custom-test-status")).toContainText("401");
  });
});
