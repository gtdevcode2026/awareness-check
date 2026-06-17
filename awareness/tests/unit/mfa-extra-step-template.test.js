// mfa_extra_step — an original, email-safe ABI multi-factor-authentication
// awareness poster. These tests lock the message (a stolen password alone is not
// enough — the one-time code lives on the user's phone) and the email-safety
// rules the gen_* posters must follow (no rgba in colours, hex only, the AI
// credit in the footer).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function loadScript(context, relativePath) {
  const filename = path.join(rootDir, relativePath);
  vm.runInContext(readFileSync(filename, "utf8"), context, { filename });
}

function buildMfa(extraCfg) {
  const context = {
    window: {}, URL, Date, console, setTimeout, clearTimeout,
    navigator: { hardwareConcurrency: 4 }, performance: { now: () => 0 },
  };
  context.window = context;
  context.App = {
    Utils: {
      log() {}, fmtDate(v) { return v || ""; },
      stripTags(v) { return String(v || "").replace(/<[^>]*>/g, ""); },
      truncate(v, n) { return String(v || "").slice(0, n); },
      normalizeWebUrl(v) { const s = String(v || "").trim(); if (!s) return ""; if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s; return `https://${s.replace(/^\/+/, "")}`; },
    },
    Graphics: new Proxy({}, { get: () => () => "<svg/>" }),
  };
  const ctx = vm.createContext(context);
  loadScript(ctx, "js/feed_scoring.js");
  loadScript(ctx, "js/rss_fetcher.js");
  loadScript(ctx, "js/newsletter_builder.js");
  loadScript(ctx, "js/newsletter/bank_page.js");
  loadScript(ctx, "js/newsletter/core_templates.js");
  const cfg = Object.assign(
    { org: "ACME", soc: "soc@acme.test", freq: "Weekly", portal: "https://portal.example", pname: "Portal" },
    extraCfg || {}
  );
  return ctx.App.NewsletterBuilder.build("mfa_extra_step", cfg, [], { useLinks: false, usePoster: false, useQR: true, useIllus: false });
}

test("mfa_extra_step is registered and builds a non-empty poster", () => {
  const html = buildMfa();
  assert.ok(typeof html === "string" && html.length > 500, "should build substantial HTML");
});

test("carries the MFA message: extra code, the demo one-time code, and the login scene", () => {
  const html = buildMfa();
  assert.match(html, /multi-factor authentication/i, "states multi-factor authentication");
  assert.match(html, /Enter the additional code/i, "laptop asks for the additional code");
  assert.ok(html.includes("3K825Fi"), "the demo one-time code appears (on the laptop field and the phone)");
  // The same code shown twice = the whole point (phone code matches the login field).
  assert.ok((html.match(/3K825Fi/g) || []).length >= 2, "code appears on both the phone and the login field");
  assert.ok(html.includes(">Log in<"), "the login button is present");
  assert.match(html, /Only you have this code on your phone/i, "phone framing: only you hold the code");
});

test("is ABI-branded (masthead logo) and ends with the portal footer + AI credit", () => {
  const html = buildMfa();
  assert.match(html, /alt="ABInBev"/, "ABI masthead logo");
  assert.ok(html.includes(">Visit Portal<"), "portal footer present");
  assert.ok(html.includes("Disclaimer: The above content is curated and created with AI"), "footer carries the AI credit");
});

test("is email-safe: no rgba() in backgrounds, borders, or text (Word/Outlook drops rgba)", () => {
  const html = buildMfa();
  // box-shadow rgba (from the shared outer wrapper) is fine — Outlook ignores
  // shadows. What must never be rgba is a colour/background/border value.
  const withoutShadows = html.replace(/box-shadow:[^;"']*/gi, "");
  assert.ok(!/rgba\(/i.test(withoutShadows), "must not use rgba() in backgrounds, borders, or text");
});

test("honours the configured portal + SOC contact", () => {
  const html = buildMfa({ portal: "https://sec.acme.test/aware", soc: "report@acme.test", pname: "ACME Awareness Hub" });
  assert.ok(html.includes("https://sec.acme.test/aware"), "uses the configured portal URL");
  assert.ok(html.includes("mailto:report@acme.test"), "uses the configured SOC mailbox for the report CTA");
  assert.ok(html.includes("ACME Awareness Hub"), "uses the configured portal name");
});
