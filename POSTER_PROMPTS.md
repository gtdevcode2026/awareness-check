# Poster Content-Generation Prompts — Bank-Page Quality, Section-Agnostic

Adapted from the **bank-page** prompt ensemble in `NEWSLETTER_PROMPTS.md` (§5.1).

**Goal:** reuse the *content-generation quality* that the bank-page templates produce, in a
**poster** generator in another project — but **without hardcoding how many sections a poster has**.

What carries over from bank-page (this is what makes the copy good — keep all of it):

1. **Employee voice** — warm, plain-language, no jargon.
2. **One edition = one threat** coherence gate.
3. **Strict grounding** — every line defensible from the articles; never invent facts/vendors/stats/CVEs.
4. **Anti-generic + SWAP TEST** — a line that would still make sense for an unrelated threat is rejected.
5. **Per-section concrete role** — each section knows exactly what kind of line it must produce.

What changes: the bank-page hardcodes four named sections (`intro`, `section1Bullets`, …). Here the
sections are a **config array** (`POSTER_SECTIONS`). The system prompt and every user builder **iterate
over that array**, so a poster can have 2, 3, 5, or N sections with no prompt edits — only config edits.

> **Rendering note (not an AI concern):** the AI never emits links, mailto, or a SOC CTA — the prompts
> forbid URLs and say "process names only". Any fixed "Report to SOC" call-to-action is added by the
> **template renderer**, after the AI fills the section copy, exactly as in the bank-page templates.

---

## 1. The section config (the only thing you edit per poster)

Each section is one object. The generator never assumes a count — it reads the array.

```js
// Example config. Order = render order. Add/remove freely; nothing downstream is hardcoded.
const POSTER_SECTIONS = [
  {
    key: 'intro',                       // JSON output key (must be unique)
    heading: 'Dear Colleague,',         // rendered heading/label (purely informational to the model)
    kind: 'paragraph',                  // 'paragraph' | 'bullets'
    sentences: '2 or 3 sentences',      // paragraph only
    maxWords: 55,                       // paragraph: total; bullets: per bullet
    role: 'Name what the attackers in THESE specific articles are doing right now; '
        + 'end on a calm, personal reason it matters to the reader — grounded, not generic.',
    rules: ['No bullet points.', 'No greeting (the salutation renders separately).'],
  },
  {
    key: 'spotBullets',
    heading: 'How to spot a fraudulent message',
    kind: 'bullets',
    count: 4,                           // bullets only
    maxWords: 16,
    maxChars: 110,
    role: 'Each bullet = a concrete signal a reader could notice in their own inbox, browser, phone, '
        + 'dev environment, or workflow — drawn from the tactic the matching article describes.',
    rules: ['No bullet may be generic enough to apply to an unrelated article.'],
  },
  {
    key: 'rememberBullets',
    heading: 'What you should remember',
    kind: 'bullets',
    count: 3,
    maxWords: 18,
    maxChars: 130,
    role: 'The highest-leverage lessons from the articles taken together; the things a reader should '
        + 'still recall a week from now when next facing this exact threat.',
    rules: ['Each bullet anchors in at least one article; one bullet may combine both.'],
  },
  {
    key: 'staySafeBullets',
    heading: 'Stay safe',
    kind: 'bullets',
    count: 3,
    maxWords: 16,
    maxChars: 110,
    role: 'Direct, immediate actions a reader can take TODAY, matched to the article threat: verify a '
        + 'sender for phishing, lock down package installs for supply-chain, rotate a leaked password '
        + 'for a breach, report a suspicious text for smishing, patch a named advisory, etc.',
    rules: ['Each bullet references something specific from the articles — no "be vigilant" filler.'],
  },
];
```

`kind: 'paragraph'` → output value is a **string**. `kind: 'bullets'` → output value is an **array of
exactly `count` strings**. That contract is the only thing the schema needs to know.

> In the **live flow** you do not hand-write these objects — the AI planner (§1A) reads the topic and
> proposes them, the user selects the ones they want and can "explore more" for additional candidates.
> The four objects above are just the default. Everything downstream (§3–§5) iterates whatever array
> the user ends up with.

---

## 1A. Dynamic sections — AI generates the config (topic → `POSTER_SECTIONS`)

The flow: AI reads the articles → proposes section **headings + roles** → user picks a subset and may
"explore more" to get extra candidates → the confirmed selection **is** the `POSTER_SECTIONS` array.
The moment the user confirms, §3–§5 run unchanged on whatever they assembled — 3 sections or 8.

One rule keeps quality identical to the hand-written config: **the planner must emit, per section, the
same fields §3 consumes** — above all `role` (the concrete per-section guideline) plus the shape fields
(`kind`, `count`/`sentences`, `maxWords`, `maxChars`). A heading alone is not enough; the `role` is what
carries bank-page quality into an AI-invented section. A section whose `role` is generic ("general info")
produces generic copy — so the planner is told to make every `role` threat-specific and SWAP-TEST-proof.

### Descriptor schema (one section — same shape as a §1 object)
```js
const SECTION_DESCRIPTOR = {
  key:       'string',                  // unique snake_case slug derived from the heading
  heading:   'string',                  // human heading shown to the user for selection
  kind:      'paragraph | bullets',
  sentences: 'string?',                 // paragraph only, e.g. "2 or 3 sentences"
  count:     'number?',                 // bullets only
  maxWords:  'number',                  // paragraph: total; bullets: per bullet
  maxChars:  'number?',                 // bullets only
  role:      'string',                  // REQUIRED — concrete job of this section, grounded in the topic
  rules:     ['string'],                // optional extra constraints
};
```

### System — `POSTER_PLAN_SYSTEM`
```js
const POSTER_PLAN_SYSTEM = `${EMPLOYEE_VOICE_BLOCK}

You are planning the SECTION LAYOUT of an internal security-awareness poster — NOT writing its content yet. Read the articles, identify the single threat they share, and propose a set of sections that together deliver that threat to non-technical staff.

${POSTER_COHERENCE_BLOCK}

Each section you propose is an object the content generator will later fill. For each one you MUST supply:
- "key": unique snake_case slug derived from the heading.
- "heading": the heading the reader sees.
- "kind": "paragraph" or "bullets".
- paragraph → also "sentences" (e.g. "2 or 3 sentences") and "maxWords".
- bullets   → also "count", "maxWords", "maxChars".
- "role": the concrete job of this section for THIS specific threat — what kind of line it must produce, grounded in the articles. It must be specific enough that a line which would also fit an unrelated threat would FAIL it (SWAP TEST). This field is what preserves content quality; never write "general info" or "overview".
- "rules": optional array of extra constraints.

Order the array in render order. Lead with one short paragraph intro and close with an action-oriented section; choose the middle sections from the threat itself, not a fixed template.

Output: a single JSON object { "sections": [ ...descriptors ] } — no markdown, no commentary, and no content text inside the sections ("role" DESCRIBES the line, it is not the line).`;
```

### User builder — `buildPosterPlanPrompt(articles, mode, opts)`
```js
function buildPosterPlanPrompt(articles, mode, opts = {}) {
  const modeCfg = MODES[mode];
  const min = opts.minSections || 3;
  const max = opts.maxSections || 6;
  return `Plan the sections for one internal security-awareness poster. Audience: general office staff, no security background. The topic is whatever the articles describe — do not assume one.

ARTICLES (full context — every role must be supportable from these facts):
${JSON.stringify(posterCompactArticles(articles))}

CURATION MODE: ${modeCfg.label}

Propose between ${min} and ${max} sections. Favour the count the threat actually needs — a simple scam needs fewer sections than a multi-stage supply-chain compromise. Each section's "role" must be specific to the threat in these articles.

Return JSON exactly: { "sections": [ { "key", "heading", "kind", "sentences"|"count", "maxWords", "maxChars"?, "role", "rules"? } ] }.`;
}
```

### "Explore more" — `buildPosterExploreMorePrompt(articles, mode, existing)`
When the user wants additional candidates beyond the first plan (call repeatedly; pass the current set):
```js
function buildPosterExploreMorePrompt(articles, mode, existing) {
  const modeCfg = MODES[mode];
  const taken = existing.map(s => `- ${s.heading} (${s.key})`).join('\n');
  return `The user already has these sections for this poster:
${taken}

Propose 2 to 4 ADDITIONAL candidate sections for the SAME threat, each covering an angle the existing set does NOT. Do not duplicate or rephrase an existing heading or key. Same descriptor shape, same grounding + SWAP-TEST rule for "role".

ARTICLES:
${JSON.stringify(posterCompactArticles(articles))}

CURATION MODE: ${modeCfg.label}

Return JSON: { "sections": [ ...new descriptors ] } only.`;
}
```

### The full dynamic flow
```
1. plan = callLLM(POSTER_PLAN_SYSTEM, buildPosterPlanPrompt(articles, mode))   → sections[]
2. User picks a subset; optionally calls buildPosterExploreMorePrompt for more candidates; repeat.
3. POSTER_SECTIONS = the user's confirmed, ordered selection. Validate each against SECTION_DESCRIPTOR:
   - unique keys (re-slug on collision),
   - role non-empty (drop the section otherwise),
   - bullets have count + maxChars; paragraph has sentences.
4. Generate content via §4 (combined) or §5 (ensemble) — both already iterate POSTER_SECTIONS,
   so N is whatever the user assembled. Nothing in §3–§5 changes.
```

Because the planner emits the same descriptor §3 consumes, an AI-invented 7-section poster gets the
identical per-section guideline treatment as the hand-written 4-section default — content delivery stays
bank-page quality at any section count.

---

## 2. Shared fragments (verbatim from bank-page — these drive the quality)

Reuse these unchanged. `EMPLOYEE_VOICE_BLOCK`, `STYLE_BLOCK`, and `ANTI_GENERIC_BLOCK` are in
`NEWSLETTER_PROMPTS.md` §2; the two below are the compact bank-page versions, restated here so this file
is self-contained.

### `POSTER_SHARED_STYLE_MINI` (= bank-page `BANKPAGE_SHARED_STYLE_MINI`)
```
STYLE (mandatory):
- Calm, factual, present tense where natural. No marketing voice, no rhetorical questions, no exclamation marks.
- Never use the word "credentials" — say "login details" or "username and password".
- Never use jargon like "threat actors", "adversaries", "TTPs", "bad actors". Use "attackers", "scammers", "criminals", "fraudsters".
- No filler phrases ("it is important to note", "in today's world", "staying vigilant", "be mindful", "in conclusion").
- No URLs, no scam-style urgency.

GROUNDING: every sentence must be supported by the articles in the user message. Never invent facts, vendors, victims, statistics, or CVEs.
```

### `POSTER_COHERENCE_BLOCK` (= the bank-page "one edition = one threat" + reject-vendor gate)
```
CRITICAL: Every article in this poster MUST cover the same threat type. Before writing, check: do all selected articles describe the same category of threat? If not, ignore the articles that don't match the majority theme. One poster = one threat. The threat topic is determined ENTIRELY by the articles — phishing, ransomware, supply-chain, breach, smishing, scam, vulnerability, insider risk, etc. Do not assume any topic; let the articles dictate the focus.

Do not treat vendor product announcements, press releases, or "what a security company is doing" as the threat. Every line must describe either a threat employees could encounter or an action they can take to protect themselves.

Ground every line in the articles — never invent facts, vendors, victims, statistics, CVEs, or details not present there. Paraphrase what the attackers are actually doing, then translate it into practical guidance for non-technical readers.
```

---

## 3. The section block helper (this is the "section-wise guideline, no hardcoded count" core)

One function turns any section config into a guideline block. The user builders just `map` over the
array and join — so the number of sections is whatever the array length is.

```js
function posterSectionBlock(section, index) {
  const shape = section.kind === 'paragraph'
    ? `Type: one paragraph, ${section.sentences}, max ${section.maxWords} words total. Output value: a string.`
    : `Type: exactly ${section.count} bullets. Max ${section.maxWords} words and max ${section.maxChars} characters per bullet. Output value: an array of ${section.count} strings.`;
  const extra = (section.rules || []).map(r => `- ${r}`).join('\n');
  return [
    '────────────',
    `SECTION ${index + 1} — "${section.key}"  (rendered under the heading "${section.heading}")`,
    `- ${shape}`,
    `- Role: ${section.role}`,
    extra,
  ].filter(Boolean).join('\n');
}
```

---

## 4. Combined call — one request fills every section

Mirrors `BANKPAGE_SLOTS_SYSTEM` + `buildBankPageUserPrompt`, but the schema and the section list are
generated from `POSTER_SECTIONS`.

### System — `POSTER_SLOTS_SYSTEM(sections)`
```js
function POSTER_SLOTS_SYSTEM(sections) {
  const schemaLines = sections.map(s =>
    s.kind === 'paragraph'
      ? `  "${s.key}": "string — see SECTION for "${s.key}" in the user message"`
      : `  "${s.key}": [${Array(s.count).fill('"..."').join(', ')}]`
  ).join(',\n');
  return `${EMPLOYEE_VOICE_BLOCK}

You are filling ${sections.length} section(s) of an internal security-awareness poster for all staff. The threat topic of this poster is determined entirely by the articles in the user message — do not assume any topic; let the articles dictate the focus.

${POSTER_COHERENCE_BLOCK}

${STYLE_BLOCK}

Output: a single JSON object with EXACTLY these keys, in this order (no markdown fences, no extra keys, no nulls). Paragraph keys take a string; bullet keys take an array of the stated length:
{
${schemaLines}
}`;
}
```

### User builder — `buildPosterUserPrompt(articles, sections, mode)`
```js
function buildPosterUserPrompt(articles, sections, mode) {
  const modeCfg = MODES[mode];
  const compact = posterCompactArticles(articles); // same compaction as bankPageCompactArticles
  const sectionBlocks = sections.map(posterSectionBlock).join('\n\n');
  return `You are writing ${sections.length} specific section(s) for one internal security-awareness poster. Audience: general office staff with no IT or cybersecurity background. The topic is whatever the articles below describe — do not assume phishing or any other category in advance.

ARTICLES (full context — every line you write must be supported by these facts):
${JSON.stringify(compact)}

CURATION MODE: ${modeCfg.label}

Return JSON exactly as the schema in your system instructions requires — the keys are the section keys below, in order. Section-specific rules:

${sectionBlocks}

────────────
RULES ACROSS ALL SECTIONS:
- No URLs, no exclamation marks, no rhetorical questions, no scam-style urgency, no filler phrases.
- ANTI-GENERIC / SWAP TEST: every line must name a concrete behaviour, signal, channel, system, or action drawn from the actual articles. If a line would still make sense for an unrelated threat type (phishing vs ransomware vs supply-chain vs smishing), it is too generic — rewrite it so it would NOT apply to an unrelated threat.
- No topic assumptions beyond what the articles state.
- Output JSON only — no markdown fences, no commentary.`;
}
```

That's the whole trick: `sections.length`, the schema, and the per-section guidelines are all derived
from the config. Hand it a 2-section poster or a 6-section poster and the prompt rewrites itself.

---

## 5. Per-section dedicated calls (optional — the bank-page best-of ensemble)

The bank-page runs a dedicated call per section in parallel and keeps the best-scoring output per
section. Same pattern, generalized: one generic system + user builder, parameterized by the section
config. Run one per section (in parallel) when you want the higher-quality ensemble; skip it and use
only §4 when one combined call is enough.

### System — `POSTER_SECTION_SYSTEM(section)`
```js
function POSTER_SECTION_SYSTEM(section) {
  const shape = section.kind === 'paragraph'
    ? `{ "${section.key}": "string" }`
    : `{ "${section.key}": [${Array(section.count).fill('"..."').join(', ')}] }`;
  return `${EMPLOYEE_VOICE_BLOCK}

You write the "${section.heading}" section for an internal security-awareness poster for all staff. The threat topic is whatever the articles in the user message describe.
Section role: ${section.role}

${POSTER_SHARED_STYLE_MINI}

Output: JSON only, exactly ${shape} — no markdown, no extra keys.`;
}
```

### User builder — `buildPosterSectionPrompt(articles, section, mode)`
```js
function buildPosterSectionPrompt(articles, section, mode) {
  const modeCfg = MODES[mode];
  const shape = section.kind === 'paragraph'
    ? `- One paragraph, ${section.sentences}, max ${section.maxWords} words total.`
    : `- Exactly ${section.count} bullets. Max ${section.maxWords} words, max ${section.maxChars} characters per bullet.`;
  const extra = (section.rules || []).map(r => `- ${r}`).join('\n');
  const out = section.kind === 'paragraph'
    ? `{ "${section.key}": "string" }`
    : `{ "${section.key}": [${Array(section.count).fill('"..."').join(', ')}] }`;
  return `Write the "${section.key}" section, rendered under the heading "${section.heading}".

ARTICLES (full context — every line you write must be supported by these facts):
${JSON.stringify(posterCompactArticles(articles))}

CURATION MODE: ${modeCfg.label}

STEP 1 (silent): Identify the dominant threat type in the articles (phishing, ransomware, smishing, supply-chain, data breach, scam & fraud, vulnerability, insider risk, etc.).

STEP 2: Produce the section so it could ONLY apply to that specific threat type.
Role: ${section.role}

Rules:
${shape}
${extra}
- SWAP TEST: if a line would still make sense for an unrelated threat type, rewrite it to be more specific. Reject generic "stay vigilant" / "cyber attacks are bad" platitudes.

Output: ${out} only.`;
}
```

---

## 6. Wiring (same as bank-page)

```
Per slot call: max_tokens ~900 (paragraphs can be lower, e.g. 240–450), temperature 0.15.
callLLM(system, userPrompt) → strip ```json fences → JSON.parse.
Combined call (§4): one request, validate it returns every section key with the right shape.
Ensemble (§5): one request per section in parallel; score; keep the best per section (best-of-N).
Per-slot local fallback so a section is never empty if the AI call fails.
```

**Curation modes** (`concise` / `balanced` / `deep`) interpolate `${modeCfg.label}` and govern source
truncation + length caps, identical to `NEWSLETTER_PROMPTS.md` §1.

---

## 7. Why this matches bank-page quality

| Bank-page mechanism | Where it lives here |
|---------------------|---------------------|
| Employee voice | `EMPLOYEE_VOICE_BLOCK` in every system prompt |
| One edition = one threat | `POSTER_COHERENCE_BLOCK` |
| Grounding (no invented facts) | `POSTER_COHERENCE_BLOCK` + `POSTER_SHARED_STYLE_MINI` GROUNDING |
| Plain language, no jargon, no "credentials" | `POSTER_SHARED_STYLE_MINI` / `STYLE_BLOCK` |
| Anti-generic + SWAP TEST | cross-section rules (§4) and per-section STEP 1→2→SWAP (§5) |
| Per-section concrete role | `section.role` carried into every prompt |
| Best-per-section ensemble | §5 dedicated calls |
| **Hardcoded 4 sections** | **removed — driven by `POSTER_SECTIONS.length`** |
| **Dynamic AI section headings** | **`POSTER_PLAN_SYSTEM` (§1A) — AI proposes headings + `role`; user selects + "explore more"** |

To recreate the exact bank-page poster, set `POSTER_SECTIONS` to the four objects in §1. To make any
other poster, change the array — nothing in §3–§5 needs editing.
```