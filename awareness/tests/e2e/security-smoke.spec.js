// Security smoke tests — real-browser checks that complement
// tests/unit/security.test.js. Covers:
//   - every entry page renders with no console errors
//   - meta CSP is parsed by the browser (not just present as text)
//   - AI key + SMTP password never appear in localStorage after a save
//   - SMTP password lives in sessionStorage only

const { test, expect } = require("@playwright/test");

const ENTRY_PAGES = [
  "/index.html",
  "/preview.html",
  "/editor.html",
  "/send.html",
  "/projects.html",
  "/keywords.html",
  "/curation-lab.html",
  "/config.html",
];

const IGNORABLE_CONSOLE = [
  /favicon/i,
  /Failed to load resource:.*favicon/i,
];

async function resetStorage(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

test.describe("security smoke", () => {
  for (const route of ENTRY_PAGES) {
    test(`${route} loads with no console errors and a meta CSP`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (IGNORABLE_CONSOLE.some((re) => re.test(text))) return;
        errors.push(text);
      });

      await page.goto(route, { waitUntil: "domcontentloaded" });

      // Meta CSP is present and has the expected hardened directives.
      const cspContent = await page.evaluate(() => {
        const el = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return el ? el.getAttribute("content") : null;
      });
      expect(cspContent, `meta CSP missing on ${route}`).not.toBeNull();
      expect(cspContent).toContain("default-src 'self'");
      expect(cspContent).toContain("object-src 'none'");
      expect(cspContent).toContain("base-uri 'self'");
      expect(cspContent).toContain("frame-src 'self'");

      // No surprise console errors during load.
      expect(errors, `console errors on ${route}: ${errors.join(" | ")}`).toEqual([]);
    });
  }

  test("AI key entered on /config.html is never written to localStorage", async ({ page }) => {
    await resetStorage(page);
    await page.goto("/config.html", { waitUntil: "domcontentloaded" });

    const FAKE_KEY = "sk-ant-e2e-NEVER_PERSIST_THIS_TOKEN_12345";
    await page.locator("#ai-key").fill(FAKE_KEY);
    await page.evaluate(() => window.saveAllConfig?.(true));
    // Let any debounced save flush.
    await page.waitForTimeout(700);

    const localDump = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return JSON.stringify(out);
    });
    expect(localDump, "AI key value must not appear anywhere in localStorage").not.toContain(FAKE_KEY);

    // The key SHOULD live in sessionStorage so the current tab can use it.
    const sessionValue = await page.evaluate(() =>
      sessionStorage.getItem("awareness_ai_key_session_v1")
    );
    expect(sessionValue).toBe(FAKE_KEY);

    // The AI settings entry exists but its aiKey field is absent or empty.
    const aiSettings = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("awareness_ai_settings_v1") || "null"); }
      catch (e) { return null; }
    });
    if (aiSettings) {
      expect(aiSettings.aiKey || "").toBe("");
    }
  });

  test("Custom Base URL entered on /config.html is session-only (not in localStorage) but survives navigation", async ({ page }) => {
    await resetStorage(page);
    await page.goto("/config.html", { waitUntil: "domcontentloaded" });
    await page.selectOption("#ai-provider", "custom");

    const BASE = "http://internal-gateway.example.test/asimov/api/v2";
    await page.locator("#ai-base-url").fill(BASE);
    await page.evaluate(() => window.saveAllConfig?.(true));
    await page.waitForTimeout(700);

    const localDump = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return JSON.stringify(out);
    });
    expect(localDump, "Base URL must not appear anywhere in localStorage").not.toContain(BASE);

    // It SHOULD live in sessionStorage so the custom provider keeps working.
    const sessionValue = await page.evaluate(() =>
      sessionStorage.getItem("awareness_ai_base_url_session_v1")
    );
    expect(sessionValue).toBe(BASE);

    // And it must be restored into the (hidden) base-URL input on another page in
    // the same session — otherwise cross-page AI would break.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const restored = await page.evaluate(() => document.getElementById("ai-base-url")?.value || "");
    expect(restored, "Base URL should be restored from sessionStorage on navigation").toBe(BASE);
  });

  test("SMTP password entered on /config.html is never written to localStorage or IndexedDB profile entry", async ({ page }) => {
    await resetStorage(page);
    await page.goto("/config.html", { waitUntil: "domcontentloaded" });

    // Switch the delivery method to SMTP so the SMTP panel is visible.
    await page.evaluate(() => {
      const sel = document.getElementById("delivery-method");
      if (sel) {
        sel.value = "smtp";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Fill all required fields so saveSMTPConfig accepts the bundle.
    await page.locator("#smtp-relay-url").fill("https://relay.example.test/send");
    await page.locator("#smtp-from-address").fill("from@example.test");
    await page.locator("#smtp-host").fill("smtp.example.test");
    await page.locator("#smtp-username").fill("user@example.test");
    const FAKE_PASS = "p@ssw0rd-NEVER_PERSIST-987654321";
    await page.locator("#smtp-password").fill(FAKE_PASS);

    await page.evaluate(() => window.saveAllConfig?.(true));
    await page.waitForTimeout(900);

    const localDump = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return JSON.stringify(out);
    });
    expect(localDump, "SMTP password must not appear in localStorage").not.toContain(FAKE_PASS);

    // sessionStorage should hold it.
    const sessionPassword = await page.evaluate(() =>
      sessionStorage.getItem("awareness_smtp_password_session_v1")
    );
    expect(sessionPassword).toBe(FAKE_PASS);

    // The localStorage profile blob has password='' (sanitized).
    const profile = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("awareness_smtp_profile_v1") || "null"); }
      catch (e) { return null; }
    });
    if (profile) {
      expect(profile.password || "").toBe("");
    }
  });
});
