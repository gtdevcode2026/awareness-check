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

function createContext() {
  const context = {
    window: {},
    console,
    document: {
      getElementById() {
        return null;
      },
      createElement() {
        return {};
      },
      body: { appendChild() {} },
    },
  };
  context.window = context;
  return vm.createContext(context);
}

test("stripLegacyFooterClassification removes legacy classification strip before SOC mailto", () => {
  const context = createContext();
  loadScript(context, "js/utils.js");
  const { stripLegacyFooterClassification } = context.App.Utils;

  const legacy =
    '<div>ABC Corp · Security Awareness · RESTRICTED — INTERNAL · <a href="mailto:soc@example.com">soc@example.com</a></div>';
  const once = stripLegacyFooterClassification(legacy);
  assert.ok(!once.includes("RESTRICTED"));
  assert.ok(once.includes("Security Awareness · <a href=\"mailto:soc@example.com\""));

  const twice = stripLegacyFooterClassification(once);
  assert.equal(twice, once);

  const alreadyClean =
    '<span>ABC Corp · Security Awareness · <a href="mailto:soc@example.com">soc</a></span>';
  assert.equal(stripLegacyFooterClassification(alreadyClean), alreadyClean);
});

test("normalizeWebUrl adds https for bare hosts and preserves schemes / special cases", () => {
  const context = createContext();
  loadScript(context, "js/utils.js");
  const { normalizeWebUrl } = context.App.Utils;

  assert.equal(normalizeWebUrl(""), "");
  assert.equal(normalizeWebUrl("  "), "");
  assert.equal(normalizeWebUrl("google.com"), "https://google.com");
  assert.equal(normalizeWebUrl("www.example.com/path"), "https://www.example.com/path");
  assert.equal(normalizeWebUrl("HTTPS://Example.COM"), "HTTPS://Example.COM");
  assert.equal(normalizeWebUrl("http://local.test"), "http://local.test");
  assert.equal(normalizeWebUrl("//cdn.example.com/x"), "https://cdn.example.com/x");
  assert.equal(normalizeWebUrl("mailto:a@b.co"), "mailto:a@b.co");
  assert.equal(normalizeWebUrl("tel:+15551212"), "tel:+15551212");
  assert.equal(normalizeWebUrl("sms:555"), "sms:555");
  assert.equal(normalizeWebUrl("#section"), "#section");
  assert.equal(normalizeWebUrl("/relative/path"), "/relative/path");
  assert.equal(normalizeWebUrl("\\windows\\style"), "\\windows\\style");
  assert.equal(normalizeWebUrl("has space.com"), "has space.com");
});

test("normalizeWebUrl rejects executable/data schemes so a Portal URL can't carry XSS", () => {
  const context = createContext();
  loadScript(context, "js/utils.js");
  const { normalizeWebUrl } = context.App.Utils;

  // Dangerous schemes collapse to '' (callers fall back to '#'/mailto) — they
  // must never survive into an href in the rendered or emailed newsletter.
  assert.equal(normalizeWebUrl("javascript:alert(1)"), "");
  assert.equal(normalizeWebUrl("JavaScript:alert(document.domain)"), "");
  assert.equal(normalizeWebUrl("  javascript:alert(1)  "), "");
  assert.equal(normalizeWebUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(normalizeWebUrl("vbscript:msgbox(1)"), "");
  assert.equal(normalizeWebUrl("file:///etc/passwd"), "");
  // Legitimate schemes/hosts still pass through unchanged.
  assert.equal(normalizeWebUrl("https://portal.example.com"), "https://portal.example.com");
  assert.equal(normalizeWebUrl("portal.example.com"), "https://portal.example.com");
});
