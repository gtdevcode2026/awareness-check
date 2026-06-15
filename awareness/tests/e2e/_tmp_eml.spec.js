const { test } = require("@playwright/test");
test("eml-evidence", async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const out = await page.evaluate(() => {
    const NB = window.App.NewsletterBuilder;
    const html = NB.build("bankpage1_dynamic", { org: "ACME", soc: "soc@acme.test", freq: "Weekly", portal: "https://p", pname: "P" }, [
      { type: "Phishing", title: "Pirates in the crosshairs cybercrime gang infecting fans", summary: "x.", source: "Securelist (Kaspersky)", url: "https://x.com/s", pubDate: "2026-05-28", threatLevel: 3 },
      { type: "Malware", title: "2026 World Cup Discussing The World's Biggest Game's Attack Surface", summary: "y.", source: "Palo Alto Unit 42", url: "https://y.com/s", pubDate: "2026-05-28", threatLevel: 4 }
    ], { useLinks: false, usePoster: false, useQR: false, useIllus: false });
    const flat = window.App.Utils.flattenEmailColors(html);
    // grab the CARD 1 anchor block
    const i = flat.indexOf('Article&nbsp;1') - 600;
    const j = flat.indexOf('Read article', i) + 60;
    return { card: flat.slice(Math.max(0,i), j) };
  });
  console.log("=====CARD1 (post-flatten)=====\n" + out.card);
});
