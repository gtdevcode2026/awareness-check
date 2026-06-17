// Advisory sender generator (js/advisory_send_script.js → App.AdvisorySendScript).
//
// render(advisories, defaults) emits a SELF-CONTAINED Python sender that
// replicates the nessus_advisory / cve_alert "zip" method: no relay, one email
// per advisory, straight over SMTP. These tests guard the pure generator —
// the embedded base64(JSON) payload round-trips, and the emitted Python keeps
// the structural markers (STARTTLS, sendmail loop, cid inline images, runtime
// credential prompt) with NO relay references.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function loadModule() {
  const context = { console };
  context.window = context;
  context.App = {};
  const ctx = vm.createContext(context);
  vm.runInContext(
    readFileSync(path.join(rootDir, "js/advisory_send_script.js"), "utf8"),
    ctx,
    { filename: path.join(rootDir, "js/advisory_send_script.js") }
  );
  return ctx.App.AdvisorySendScript;
}

// Pull the base64 payload back out of the emitted Python and decode it.
function decodePayload(py) {
  const m = py.match(/_PAYLOAD_B64 = "([^"]*)"/);
  assert.ok(m, "emitted Python must assign _PAYLOAD_B64");
  const json = Buffer.from(m[1], "base64").toString("utf-8");
  return JSON.parse(json);
}

const SAMPLE = [
  {
    subject: "[ABSOC4041] Security Advisory — Critical: Remote code execution in widget",
    html: '<html><body><img src="cid:aw-abi-png"><p>Patch now.</p></body></html>',
    attachments: [
      { contentId: "aw-abi-png", base64: "aGVsbG8=", contentType: "image/png", filename: "abi.png" },
    ],
  },
  {
    subject: "[ABSOC7625] Security Advisory — High: SQL injection",
    html: "<html><body><p>Naïve fix — review.</p></body></html>",
    attachments: [],
  },
];

const DEFAULTS = {
  senderName: "ABI Global SOC",
  senderEmail: "soc@example.com",
  host: "smtp.gmail.com",
  port: "465",
  username: "soc@example.com",
  recipients: "a@example.com, b@example.com",
};

test("emits a runnable Python script header and entry point", () => {
  const { render } = loadModule();
  const py = render(SAMPLE, DEFAULTS);
  assert.match(py, /^#!\/usr\/bin\/env python3/);
  assert.match(py, /if __name__ == "__main__":\s*\n\s*main\(\)\s*$/);
});

test("payload round-trips advisories + defaults through base64(JSON)", () => {
  const { render } = loadModule();
  const payload = decodePayload(render(SAMPLE, DEFAULTS));
  assert.equal(payload.advisories.length, 2);
  assert.equal(payload.advisories[0].subject, SAMPLE[0].subject);
  assert.equal(payload.advisories[0].html, SAMPLE[0].html);
  assert.equal(payload.advisories[0].attachments[0].contentId, "aw-abi-png");
  assert.equal(payload.advisories[0].attachments[0].base64, "aGVsbG8=");
  // port coerced to a number even when the default arrives as a string
  assert.equal(payload.defaults.port, 465);
  assert.equal(payload.defaults.recipients, "a@example.com, b@example.com");
});

test("non-ASCII (em dash, accents) survives the base64 round-trip", () => {
  const { render } = loadModule();
  const payload = decodePayload(render(SAMPLE, DEFAULTS));
  assert.match(payload.advisories[0].subject, /—/);
  assert.match(payload.advisories[1].html, /Naïve/);
});

test("keeps the nessus send method: STARTTLS, per-advisory sendmail loop, cid images, runtime prompt", () => {
  const { render } = loadModule();
  const py = render(SAMPLE, DEFAULTS);
  assert.match(py, /server\.starttls\(\)/);
  assert.match(py, /smtplib\.SMTP_SSL/);
  assert.match(py, /for advisory in ADVISORIES:/);
  assert.match(py, /server\.sendmail\(sender, recipients, message\.as_string\(\)\)/);
  assert.match(py, /MIMEImage\(raw, _subtype=subtype\)/);
  assert.match(py, /Content-ID/);
  assert.match(py, /getpass\.getpass/);
  // regex backslashes must survive (String.raw), or the Python is corrupt
  assert.match(py, /<br\\s\*\/\?>/);
  assert.match(py, /<\/\\1>/);
});

test("uses nessus_advisory.py credentials: env vars GMAIL_SENDER / GMAIL_PASSWORD / EMAIL_TO", () => {
  const { render } = loadModule();
  const py = render(SAMPLE, DEFAULTS);
  assert.match(py, /os\.environ\.get\("GMAIL_SENDER"\)/);
  assert.match(py, /os\.environ\.get\("GMAIL_PASSWORD"\)/);
  assert.match(py, /os\.environ\.get\("EMAIL_TO"\)/);
  // env-set run is non-interactive; prompt is only the fallback for missing values
  assert.match(py, /if not sender:\s*\n\s*sender = ask/);
});

test("NO relay machinery — this is the no-server method", () => {
  const { render } = loadModule();
  // Check the CODE only (drop the base64 payload line); the docstring is allowed
  // to mention "no relay" as prose.
  const code = render(SAMPLE, DEFAULTS)
    .replace(/_PAYLOAD_B64 = "[^"]*"/, "")
    .toLowerCase();
  assert.doesNotMatch(code, /relayurl/);
  assert.doesNotMatch(code, /callrelay/);
  assert.doesNotMatch(code, /relay endpoint/);
  assert.doesNotMatch(code, /127\.0\.0\.1/);
  assert.doesNotMatch(code, /http:\/\//);
  assert.doesNotMatch(code, /urllib|requests\.post/);
});

test("drops attachments missing a contentId or base64", () => {
  const { render } = loadModule();
  const payload = decodePayload(
    render(
      [{ subject: "x", html: "<p>x</p>", attachments: [{ contentId: "", base64: "abc" }, { contentId: "ok", base64: "" }] }],
      {}
    )
  );
  assert.equal(payload.advisories[0].attachments.length, 0);
});

test("tolerates empty input", () => {
  const { render } = loadModule();
  const py = render([], undefined);
  const payload = decodePayload(py);
  assert.deepEqual(payload.advisories, []);
  assert.equal(payload.defaults.host, "smtp.gmail.com");
  assert.equal(payload.defaults.port, 587);
});
