/* ═══════════════════════════════════════════════════════════
   ui/translation.js — newsletter HTML translation pipeline
   Extracted from ui_controller.js. Exposes App.UITranslation with:
     - translateWorkspaceFromEnglish(opts)
     - translateHtmlAIFirst(html, lang, provider, key)
     - autoTranslateNewsletter()
     - GLOSSARY_LOCK / GLOSSARY_LOCK_TERM_LIST
   Depends on App.UI._state and App.UI._internals (loaded by ui_controller.js).
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const UI = window.App && window.App.UI;
  if (!UI || !UI._state || !UI._internals) {
    console.error('[ui/translation] App.UI._state and _internals are unavailable; check script load order.');
    return;
  }
  const TranslationMetrics = window.App && window.App.TranslationMetrics;
  const state = UI._state;
  const {
    getLanguageLabel, getLanguageVariant,
    setLanguageTranslating, setTranslateProgress,
    clearTranslationPipelineState, setTranslationPipelineState,
    recordTranslationFailure, renderTranslationFailureState,
    translationSignature,
    makeVariant, normalizeVariant, isVariantUntranslated,
    fetchWithTranslationRetry, describeTranslationHttpError,
    persistWorkspace, renderPreviewForLanguage, refreshLanguageControls,
    flagUnsavedChanges,
    NEWSLETTER_LANGUAGES,
    aiSettingsUsable
  } = UI._internals;
  const Utils = (window.App && window.App.Utils) || {};
  const log = Utils.log || (() => {});
  const showToast = Utils.showToast || (() => {});

  const GLOSSARY_LOCK = {
    en: {
      phishing: 'phishing',
      smishing: 'smishing',
      vishing: 'vishing',
      'multi-factor authentication': 'multi-factor authentication',
      mfa: 'MFA'
    }
  };
  const GLOSSARY_LOCK_TERM_LIST = [...new Set(Object.values(GLOSSARY_LOCK.en).map((t) => String(t || '').trim()).filter(Boolean))];

  // Per-language formality register, injected into the prompt per run so the model
  // is told exactly which register to hold (instead of inferring it).
  const _REGISTER_BY_LANG = {
    es: 'the formal "usted" register (never "tú" or "vos")',
    de: 'the formal "Sie" register (never "du")',
    fr: 'the formal "vous" register (never "tu")',
    it: 'the formal "Lei" register (never "tu")',
    pt: 'a respectful professional register using "você"',
    nl: 'the formal "u" register (never "je"/"jij")',
    ja: 'the polite ですます register (never plain だ-form)',
    ko: 'the formal-polite 합니다체 register (never 반말)',
    zh: 'the formal "您" register (never "你")',
    ru: 'the formal "Вы" register (never "ты")',
    pl: 'the formal "Pan/Pani/Państwo" register',
    ar: 'formal Modern Standard Arabic, no dialect',
    hi: 'the respectful "आप" register (never "तुम"/"तू")',
    vi: 'a respectful corporate register ("Quý vị" or "Anh/Chị")',
    tr: 'the formal "siz" register'
  };
  function registerForLang(targetLang) {
    const base = String(targetLang || '').toLowerCase().split(/[-_]/)[0];
    return _REGISTER_BY_LANG[base] || 'the formal business register a native HR or compliance team would use in internal employee communications';
  }

  function protectTokens(html) {
    const protectedTokens = [];
    let out = html;
    const patterns = [
      /https?:\/\/[^\s"'<>]+/g,
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      /\b[A-Z]{2,}-\d{3,}\b/g
    ];
    patterns.forEach(re => {
      out = out.replace(re, token => {
        const key = `__LOCK_${protectedTokens.length}__`;
        protectedTokens.push({ key, token });
        return key;
      });
    });
    return { html: out, protectedTokens };
  }

  function restoreTokens(html, protectedTokens = []) {
    let out = html;
    protectedTokens.forEach(t => { out = out.replaceAll(t.key, t.token); });
    return out;
  }

  // Keep glossary terms spelled consistently, but PRESERVE the leading-letter case the model
  // chose, so we never override correct target-language orthography — German and Dutch capitalise
  // these loanword nouns ("Phishing"), and the old unconditional lowercasing was forcing them back
  // to lowercase. Nothing is hardcoded per language: we respect the translator's casing and only
  // normalise the canonical spelling.
  function applyGlossaryLock(html) {
    let out = html;
    Object.values(GLOSSARY_LOCK.en).forEach(term => {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      out = out.replace(re, (m) => {
        const leadUpper = m[0] !== m[0].toLowerCase() && m[0] === m[0].toUpperCase();
        return leadUpper ? term.charAt(0).toUpperCase() + term.slice(1) : term;
      });
    });
    return out;
  }

  function qaCheckTranslatedHtml(sourceHtml, translatedHtml) {
    const checks = [];
    const srcLinks = (sourceHtml.match(/https?:\/\/[^\s"'<>]+/g) || []).length;
    const outLinks = (translatedHtml.match(/https?:\/\/[^\s"'<>]+/g) || []).length;
    checks.push({ id: 'link-count', ok: Math.abs(srcLinks - outLinks) <= 1, severity: 'critical', detail: `${outLinks}/${srcLinks} links preserved` });
    const srcTags = (sourceHtml.match(/<[^>]+>/g) || []).length;
    const outTags = (translatedHtml.match(/<[^>]+>/g) || []).length;
    checks.push({ id: 'html-shape', ok: Math.abs(srcTags - outTags) < 40, severity: 'advisory', detail: `${outTags}/${srcTags} tags` });
    const srcCta = /report|click|verify|urgent/i.test(sourceHtml);
    const outCta = /report|click|verify|urgent|reporte|clic|verif|urgente|rapport|klicken/i.test(translatedHtml);
    checks.push({ id: 'cta-presence', ok: !srcCta || outCta, severity: 'advisory', detail: 'CTA hint terms check' });
    return checks;
  }

  async function translateHtmlWithAI(html, targetLang, provider, apiKey) {
    // Custom (OpenAI-compatible) endpoints read their base URL/model from the
    // shared DOM inputs and only need a key when the server requires one.
    const customBaseUrl = provider === 'custom' ? (document.getElementById('ai-base-url')?.value?.trim() || '') : '';
    const customModel = provider === 'custom' ? (document.getElementById('ai-model')?.value?.trim() || '') : '';
    if (!apiKey && !(provider === 'custom' && customBaseUrl)) throw new Error('AI API key is required for AI translation.');
    const targetLanguageName = getLanguageLabel(targetLang);
    const register = registerForLang(targetLang);
    const glossary = GLOSSARY_LOCK_TERM_LIST.join(', ');
    const container = document.createElement('div');
    container.innerHTML = html;

    // Designed phrases — the hero headline and the "Pause → Don't engage → Report" action strip —
    // are marked [data-nl-unit] so the translator renders each as ONE whole-phrase AI call (below),
    // instead of splitting it into word-by-word fragments. The model then has full context to make
    // it grammatical, keep a CTA series parallel, use the formal-imperative form ("Report" → an
    // imperative, not the noun "notifications"), case nouns per target orthography, and keep the
    // inline gold styling. Fully dynamic — nothing is hardcoded. Their inner text nodes are
    // excluded from the per-fragment walk so they are not also translated piecemeal.
    const unitEls = Array.from(container.querySelectorAll('[data-nl-unit]'))
      .filter((el) => el.textContent && el.textContent.trim());
    const unitSet = new Set(unitEls);

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentTag = node.parentElement?.tagName;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (parentTag === 'STYLE' || parentTag === 'SCRIPT') return NodeFilter.FILTER_REJECT;
        const unitOwner = node.parentElement && node.parentElement.closest('[data-nl-unit]');
        if (unitOwner && unitSet.has(unitOwner)) return NodeFilter.FILTER_REJECT;
        // Never translate an explicitly-locked proper noun: company / brand / product /
        // publication / article-source (site) names are wrapped in [data-nl-keep] by the
        // templates, so they stay verbatim across locales while the label around them
        // ("Source:", "Read more —") still translates. translate="no" (HTML standard) too.
        if (node.parentElement && node.parentElement.closest('[data-nl-keep], [translate="no" i]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) nodes.push(current);
    if (!nodes.length && !unitEls.length) return html;

    const isBadTranslationOutput = (output, source) => {
      const out = String(output || '').trim();
      if (!out) return true;
      const badPatterns = [
        /i'?m sorry/i,
        /please provide/i,
        /need the text/i,
        /want translated/i,
        /cannot translate/i
      ];
      if (badPatterns.some(re => re.test(out))) return true;
      // Reject a verbose dump (the model returned an explanation instead of a translation),
      // but allow SHORT headings/labels to expand naturally in wordier target languages — a
      // real translation of a short string still won't exceed ~120 chars. Without this floor,
      // a 6-char heading like "Report" whose French rendering is 24 chars (>3×) was wrongly
      // rejected and shipped in English.
      if (source.trim().length < 140 && out.length > Math.max(120, source.trim().length * 3)) return true;
      return false;
    };

    const translateOne = async (text, ctx = '') => {
      const originalFull = String(text || '').slice(0, 1200);
      const split = TranslationMetrics.splitDecorativeLead(originalFull);
      let proseSource = originalFull;
      let deco = '';
      if (split.deco && TranslationMetrics.hasTranslatableLetters(split.rest)) {
        deco = split.deco;
        proseSource = split.rest.trimStart();
      }
      if (!TranslationMetrics.hasTranslatableLetters(proseSource)) return originalFull;
      if (typeof window !== 'undefined' && window.__AWARENESS_E2E_SEG_TRANSLATE === '1') {
        return `⟨e2e⟩${originalFull}`;
      }
      if (typeof window !== 'undefined' && window.__AWARENESS_E2E_SEG_TRANSLATE === 'echo') {
        return originalFull;
      }
      const sourceLanguageName = 'English';
      const targetLocale = targetLang;
      const topicType = '';
      const strictPrompt = (mode = 'normal') =>
        `You are an expert Corporate Communications Translator specializing in Plain-Language Cybersecurity Awareness. Your output is read by general, non-technical employees — HR, Finance, Sales, Marketing, Operations — who have no IT background. Translate AND normalize ${sourceLanguageName} into ${targetLanguageName}: the result must read as clearly and naturally as a friendly company memo, while preserving every security instruction exactly.

TASK: Translate the text inside <source> from ${sourceLanguageName} into ${targetLanguageName}. Use fluent ${targetLanguageName} appropriate for native readers in locale ${targetLocale}.
${topicType ? `Topic type: ${topicType}.\n` : ''}
SOURCE-OF-TRUTH CONTRACT:
- The text inside <source> is the authoritative version. Produce a faithful, plain-language rendering. Do not improve, summarize, or editorialize beyond the plain-language rules.
- If a fragment cannot be translated faithfully (ambiguous, proper noun, or already in target), return it unchanged rather than guessing.
- Treat every call as independent. Do not assume continuity with any previous translation.

AUDIENCE & TONE:
- Write as if explaining to a smart, non-technical colleague over coffee: warm, direct, calm — never robotic, never alarmist.
- Don't bombard with IT jargon; smooth out dense concepts so the security message + business risk are obvious to a layperson.
- PLAIN LANGUAGE MUST NOT REDUCE URGENCY: simplify the words, not the seriousness.

JARGON RULES — convey MEANING, never literal calques:
  Software/code: package/library/dependency → "software component/code file" (never a parcel); release/build/artifact → "software update/new version"; repo → "shared code storage area"; CI/CD pipeline → "automated process that builds and publishes our software"; supply chain attack → "criminals tamper with software tools companies rely on".
  Credentials: "rotate" a key → update/renew/change (never spin); credentials → "login details"; least privilege → "only the access you need"; MFA/2FA → keep acronym, gloss as "a second verification step".
  Threats: phishing → "a fake email designed to trick you" (keep "phishing" in parens first use); ransomware → "harmful software that locks your files and demands payment"; malware → "harmful software"; exfiltrate → "secretly copy and steal"; threat actor → "criminal/attacker"; social engineering → "psychological tricks to manipulate people"; lateral movement → "spreading through the network after breaking in"; data breach → the native security term (es "filtración de datos", de "Datenleck", fr "fuite de données", pt "vazamento de dados"); cryptojacking → "criminals secretly hijacking your device to mine cryptocurrency"; smishing → "a scam text message (smishing)"; vishing → "a scam phone call (vishing)"; typosquatting → "fake look-alike web addresses".
  NICHE/TECHNICAL TERMS: for ANY specialized term a non-technical employee may not recognise (cryptojacking, typosquatting, smishing, vishing, zero-day, etc.) add a SHORT plain-language gloss in the target language on first use — never leave a bare over-technical term that office staff in any locale (incl. zh-CN) could fail to understand.
  Infra: endpoint → "device"; VPN → "a secure connection that protects your internet traffic"; SOC → "our security team" (keep "SOC").
  CTAs: "scan" a QR → "point your phone camera at" (never a virus scan); "report" button → imperative "notify us" (never a noun); freeze → stop/pause; patch → "apply the security update"; remediate → fix/address.
  LENGTH-AWARE: short fragment → concise established term; expand only if room. Keep acronyms (MFA, 2FA, OTP, SSO, VPN, URL, SOC, IT, HR, CEO, CISO).

SECURITY IMPERATIVE STYLE (CRITICAL):
- Action labels/buttons/short headlines → imperative command verbs, formal 2nd person (never a noun, infinitive, or polite request).
- Each fragment translated alone → treat any short standalone action word as a command.
- Keep CTA series PARALLEL (Pause → Don't engage → Report all same imperative form). Same for checklist/Do-Don't/step labels.

HEADLINES & SLOGANS — TRANSCREATE, DON'T CALQUE (CRITICAL):
- Mastheads/hero headlines/section titles/slogans → render as a native security/comms team would; keep meaning + punch, transcreate wording.
- Adapt idioms/metaphors/wordplay to local equivalent (no literal "fish" for Phish; first line of defense → natural local expression).
- Use target-language headline capitalisation/punctuation — NOT English Title Case (most languages: sentence case; German still caps nouns).
- Keep short and impactful — a headline stays a headline.
- NATURAL, NOT STIFF (especially ko, ja, zh-CN): short CTAs, taglines and slogans must read the way a native security/comms team would actually phrase them — idiomatic and smooth, not a stiff word-for-word calque. Prioritise how naturally it lands while keeping the one formal register and the exact meaning.

FORMALITY & PER-LANGUAGE REGISTER:
ONE consistent formal register (internal HR/compliance comms). Never switch mid-text.
- de: formal "Sie", keep German-IT English terms, dates DD.MM.YYYY. nl: "u". it: "Lei". fr: "vous". es: "usted" (default es-419). pt-BR: "você". uk: "Ви", «» guillemets. zh-CN: Mainland terms, Chinese punctuation. ko: 합니다체, -습니다/-십시오. ja: ですます. ru: "Вы". Any other: default formal.
- IMPERATIVES use the FORMAL command form, NEVER the informal tu/du/jij/tú form: it (Lei) → "Verifichi / Stia attento / Segnali" (not "Verifica / Fai attenzione / Segnala"); es (usted) → "Verifique / Notifique"; de → "Melden Sie / Klicken Sie nicht"; fr (vous) → "Vérifiez / Signalez"; pt-BR → "Verifique / Comunique"; nl (u) → "Meld het / Klik niet". Apply this to every checklist bullet and next-step too, not only buttons. This is a HARD rule that holds EVEN IF the English source sounds casual or uses a bare infinitive. it (Lei) — use ONLY: "Verifichi" (never "Verifica"), "Stia attento/attenta" or "Presti attenzione" (never "Fai attenzione"), "Segnali" (never "Segnala"), "Non clicchi" (never "Non cliccare"), "Controlli" (never "Controlla"); mixing any tu-form into a Lei document is a defect.

CAPITALISATION — apply target-language orthography EVERYWHERE (not just headlines):
- German capitalises ALL nouns, including English loanword nouns used as nouns: Phishing, Smishing, Vishing, Malware, Ransomware, Social Engineering — and as the first element of a compound: Phishing-Kit, Phishing-Angriff. Never write "phishing" lowercase in German.
- Dutch capitalises loanword nouns standing alone and as the first element of a compound: Phishing, Phishingtactieken, Phishing-oplichting. Keep it consistent within the document.

PRESERVATION RULES — HIGHEST PRIORITY, COPY VERBATIM:
- Protected-token sentinels __LOCK_0__ / __WORD_0__ / __DATE_0__ (any __UPPERCASE_<n>__) → reproduce EXACTLY, char-for-char incl. underscores. Single most important rule.
- Placeholders ({{TOKEN}}, \${VAR}, %s, %d, [name], <tag>), HTML tags, inline CSS, data-attributes → keep exactly; don't add/remove/move.
- URLs, emails, company/organization names, brand/product names, news publication & media-outlet names, website & domain names, the article SOURCE/byline name (e.g. the name after "Source:" or "Read more —"), listed acronyms, numbers, dates, currency, units → keep values VERBATIM. NEVER translate, localize, or transliterate a proper name (e.g. "The Hacker News", "BleepingComputer", "Microsoft" stay exactly as written). Adapt only number/date FORMAT.

STYLE & TYPOGRAPHY: natural idiomatic target language; apply target typographic rules (quotes, punctuation spacing, separators).

OUTPUT RULES:
- Return ONLY the translation of <source>. No preamble, explanation, quotes, code fences, markdown.
- Never ask for clarification; pick most likely corporate-security meaning.
- No line breaks in source → single line, no list markers. Line breaks in source → preserve positions.
- Already in target / proper noun / code → return unchanged.

LENGTH AWARENESS:
Fixed-width email layout — keep ~same length as source. Expanding languages (de, ru, ko) prefer shorter natural form. Hard limit: output ≤ 3× source byte length or the validator rejects + triggers a retry.

SEVERITY & SELF-CHECK BEFORE OUTPUT (silent):
1. Non-technical employee understands risk + action + urgency.
2. No physical-world words for digital concepts.
3. Every CTA/button/headline = FORMAL imperative verb (it: Verifichi/Stia attento — never tu-forms like Verifica/Fai attenzione); CTA series parallel; short CTAs/taglines read naturally, not stiffly.
4. ONE formality register throughout.
5. Every __LOCK_n__, placeholder, URL, HTML tag verbatim.
6. Target typography + natural headline caps; transcreated headlines; no English idioms; no duplicated greeting; output only translation, ≤3× length.
If any answer is no, fix before outputting.

<source>${proseSource}</source>
${mode === 'retry' ? 'This is a retry attempt — the first response was rejected by the validator. Keep language plain, hold urgency, preserve every sentinel/HTML tag verbatim, stay within 3× length. Return best-effort only.\n' : ''}
Now translate the content inside <source> into ${targetLanguageName} following all rules above. Output only the faithful, plain-language ${targetLanguageName} translation — nothing else.`;

      const finalizeSeg = (raw) => TranslationMetrics.normalizeTranslatedTextSegment(raw, proseSource);

      if (provider === 'openai' || provider === 'custom') {
        // openai keeps its exact endpoint/model/auth; custom resolves the target
        // from AISummarizer (always loaded before this file in the real app).
        const oaTarget = provider === 'custom'
          ? App.AISummarizer.resolveOpenAITarget({ provider, customKey: apiKey, customBaseUrl, customModel })
          : { url: 'https://api.openai.com/v1/chat/completions', key: apiKey, model: 'gpt-4o-mini' };
        const oaHeaders = oaTarget.key
          ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${oaTarget.key}` }
          : { 'Content-Type': 'application/json' };
        const resp = await fetchWithTranslationRetry(oaTarget.url, {
          method: 'POST',
          headers: oaHeaders,
          body: JSON.stringify({
            model: oaTarget.model,
            temperature: 0.3,
            messages: [
              { role: 'system', content: 'You are a native-fluent security communications writer. You rewrite text so it reads as if a native speaker wrote it naturally for the workplace — never a literal translation, and always the same meaning as the source. Output only the rewritten text — no preamble, no explanation, no apology.' },
              { role: 'user', content: strictPrompt() }
            ]
          })
        });
        if (!resp.ok) throw new Error(await describeTranslationHttpError(resp, 'openai'));
        const data = await resp.json();
        let out = (data?.choices?.[0]?.message?.content || '').trim() || proseSource;
        if (isBadTranslationOutput(out, proseSource)) {
          const retry = await fetchWithTranslationRetry(oaTarget.url, {
            method: 'POST',
            headers: oaHeaders,
            body: JSON.stringify({
              model: oaTarget.model,
              temperature: 0.0,
              messages: [
                { role: 'system', content: 'You are a native-fluent security communications writer. The previous response was rejected. Return only the rewritten text — natural and native-sounding, same meaning as the source, no commentary, no apology.' },
                { role: 'user', content: strictPrompt('retry') }
              ]
            })
          });
          if (retry.ok) {
            const retryData = await retry.json();
            const retryOut = (retryData?.choices?.[0]?.message?.content || '').trim();
            if (!isBadTranslationOutput(retryOut, proseSource)) out = retryOut;
          }
        }
        if (isBadTranslationOutput(out, proseSource)) throw new Error('Invalid model translation output');
        const core = finalizeSeg(out);
        return deco ? deco + core.trimStart() : core;
      }

      const claudeModels = ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-3-5-sonnet-latest'];
      let lastMessage = 'unknown error';
      for (const model of claudeModels) {
        const resp = await fetchWithTranslationRetry('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model,
            max_tokens: 900,
            temperature: 0.3,
            system: 'You are a native-fluent security communications writer. You rewrite text so it reads as if a native speaker wrote it naturally for the workplace — never a literal translation, and always the same meaning as the source. Output only the rewritten text — no preamble, no explanation, no apology.',
            messages: [{ role: 'user', content: strictPrompt() }]
          })
        });
        if (resp.ok) {
          const data = await resp.json();
          let out = (data?.content?.[0]?.text || '').trim() || proseSource;
          if (isBadTranslationOutput(out, proseSource)) {
            const retryResp = await fetchWithTranslationRetry('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
              },
              body: JSON.stringify({
                model,
                max_tokens: 900,
                temperature: 0.0,
                system: 'You are a native-fluent security communications writer. The previous response was rejected. Return only the rewritten text — natural and native-sounding, same meaning as the source, no commentary, no apology.',
                messages: [{ role: 'user', content: strictPrompt('retry') }]
              })
            });
            if (retryResp.ok) {
              const retryData = await retryResp.json();
              const retryOut = (retryData?.content?.[0]?.text || '').trim();
              if (!isBadTranslationOutput(retryOut, proseSource)) out = retryOut;
            }
          }
          if (isBadTranslationOutput(out, proseSource)) throw new Error('Invalid model translation output');
          const core = finalizeSeg(out);
          return deco ? deco + core.trimStart() : core;
        }
        let errMsg = `HTTP ${resp.status}`;
        try {
          const errData = await resp.json();
          errMsg = errData?.error?.message || errData?.message || errMsg;
        } catch (e) {}
        if (resp.status === 429) {
          errMsg = /insufficient|quota|credit|billing/i.test(errMsg)
            ? 'quota exhausted (insufficient_quota) — add credits for this Claude key, or switch provider'
            : 'rate limit (429) — too many requests; wait a minute and retry, or switch provider';
        }
        lastMessage = `${model}: ${errMsg}`;
        if (!/invalid model|model.*not found|unknown model/i.test(errMsg)) {
          break;
        }
      }
      throw new Error(`Claude translate failed (${lastMessage})`);
    };

    // Per-fragment role hint — gives the model the context this pipeline otherwise
    // lacks (heading vs bullet vs button vs body), which is the single biggest
    // quality lever short of full-section translation. Best-effort: any failure
    // returns '' and the prompt is byte-identical to before.
    const describeRole = (node) => {
      try {
        const el = node.parentElement;
        if (!el) return '';
        if (el.closest('a')) return 'a clickable link or button label — keep it short and action-oriented';
        if (el.closest('li')) return 'one bullet point in a list';
        if (el.closest('h1,h2,h3,h4,h5,h6')) return 'a section heading — concise, not a full sentence';
        const style = (el.getAttribute && el.getAttribute('style')) || '';
        const txt = String(node.nodeValue || '').trim();
        if (/font-weight\s*:\s*(?:700|800|900|bold)/i.test(style) && txt.length <= 60 && !/[.!?]$/.test(txt)) {
          return 'a short heading or label — concise, not a full sentence';
        }
        return '';
      } catch (e) { return ''; }
    };

    // Faster processing: parallel workers with bounded concurrency.
    let lastErr = null;
    const workItems = nodes
      .map((node, index) => ({ node, index, original: node.nodeValue }))
      .filter(item => item.original && item.original.trim()
        && TranslationMetrics.hasTranslatableLetters(item.original)
        && TranslationMetrics.countsTowardCoverageProgress(item.original));
    if (!workItems.length && !unitEls.length) return html;
    const concurrency = provider === 'openai' ? 3 : 4;

    // Translate one work item, recording the outcome on the item itself so later
    // passes can find and re-attempt the ones that stayed English.
    const attempt = async (item) => {
      try {
        const translated = await translateOne(item.original, describeRole(item.node));
        item.node.nodeValue = translated;
        item.result = { attempted: true, translatable: true, failed: false,
          changed: TranslationMetrics.hasMeaningfulTextChange(item.original, translated) };
      } catch (e) {
        lastErr = e;
        item.node.nodeValue = item.original;
        item.result = { attempted: true, translatable: true, failed: true, changed: false };
      }
    };

    // First pass: bounded-concurrency workers.
    let cursor = 0;
    async function worker() {
      while (cursor < workItems.length) { await attempt(workItems[cursor++]); }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, workItems.length) }, () => worker()));

    // No-English-survivors passes. A fragment is left in English when its provider call
    // errored (rate limit / transient) or the validator rejected the output. Such survivors
    // would otherwise ship untranslated — only a coverage ratio stood in the way, so a doc
    // with a minority of failures shipped with English blocks (footers, headings). Re-attempt
    // every survivor SEQUENTIALLY (the burst has passed; gentler on the rate limit) for two
    // more rounds. A survivor = a fragment that failed, or whose MULTI-WORD text is still
    // identical to the English source (a lone unchanged token can be a correctly-kept proper
    // noun and must not be force-retranslated forever).
    const isMultiWord = (s) => /\S\s+\S/.test(String(s).trim());
    const isSurvivor = (item) => item.result.failed
      || (isMultiWord(item.original)
          && !TranslationMetrics.hasMeaningfulTextChange(item.original, item.node.nodeValue));
    for (let pass = 0; pass < 2; pass++) {
      const survivors = workItems.filter(isSurvivor);
      if (!survivors.length) break;
      for (const item of survivors) { await attempt(item); }
    }

    // Whole-phrase units (hero headline, action strip). Translate each as ONE fragment so the
    // model has full context — reusing translateOne (same validator + retry path). There are only
    // a few per document, so run sequentially with one re-attempt if the first stays English.
    const unitResults = [];
    for (const el of unitEls) {
      const original = el.innerHTML;
      const r = { attempted: true, translatable: true, failed: false, changed: false };
      for (let pass = 0; pass < 2; pass++) {
        try {
          const translated = await translateOne(original, '');
          el.innerHTML = translated;
          r.changed = TranslationMetrics.hasMeaningfulTextChange(original, el.innerHTML);
          r.failed = false;
          if (r.changed) break;
        } catch (e) { lastErr = e; el.innerHTML = original; r.failed = true; }
      }
      unitResults.push(r);
    }

    const results = [...workItems.map(item => item.result), ...unitResults];
    const coverage = TranslationMetrics.coverageFromResults(results);
    if (coverage.attempted > 0 && coverage.succeeded === 0) {
      recordTranslationFailure({
        kind: 'coverage',
        gate: 'segment-coverage',
        languageId: state.translationPendingLang?.id || null,
        languageLabel: state.translationPendingLang?.label || null,
        coverage,
        lastProviderMessage: lastErr?.message || '',
        message: '[gate:coverage] No substantive segments translated.'
      });
      throw new Error(`[gate:coverage] No text segments were translated (${coverage.attempted} attempted, ${coverage.unchanged} unchanged). Last provider error: ${TranslationMetrics.sanitizeProviderMessage(lastErr?.message || 'unknown error')}`);
    }
    if (coverage.attempted > 0 && coverage.ratio < 0.5) {
      recordTranslationFailure({
        kind: 'coverage',
        gate: 'segment-coverage',
        languageId: state.translationPendingLang?.id || null,
        languageLabel: state.translationPendingLang?.label || null,
        coverage,
        lastProviderMessage: lastErr?.message || '',
        message: '[gate:coverage] Low coverage across substantive segments.'
      });
      throw new Error(`[gate:coverage] Low translation coverage: ${coverage.succeeded}/${coverage.attempted} segments translated.`);
    }
    return container.innerHTML;
  }

  async function translateHtmlAIFirst(html, targetLang, provider, aiKey) {
    const locked = protectTokens(html);
    const source = locked.html;
    const aiOut = await translateHtmlWithAI(source, targetLang, provider, aiKey);
    return restoreTokens(applyGlossaryLock(aiOut), locked.protectedTokens);
  }

  async function translateWorkspaceFromEnglish({
    overwrite = true,
    progressLabel = '',
    progressCompletedBase = 0,
    progressTotal = null
  } = {}) {
    if (!state.newsletterWorkspace?.variants?.en) throw new Error('Generate newsletter first.');
    const provider = document.getElementById('ai-provider')?.value || 'claude';
    const aiKey = document.getElementById('ai-key')?.value?.trim() || '';
    if (!aiSettingsUsable()) throw new Error('Add AI API key for translation.');

    const sourceVariant = normalizeVariant(state.newsletterWorkspace.variants.en);
    const targets = NEWSLETTER_LANGUAGES.filter(l => l.id !== 'en' && (overwrite || isVariantUntranslated(l.id)));
    const translationSteps = targets.length;
    const totalBar = progressTotal != null ? progressTotal : Math.max(1, translationSteps);
    let done = progressCompletedBase;
    setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: preparing`, 'Translation in progress');
    let firstTranslatedLang = null;
    try {
      for (const lang of targets) {
        state.translationPendingLang = { id: lang.id, label: lang.label };
        const signature = translationSignature(lang.id, sourceVariant.html, sourceVariant.css || '');
        if (state.translationCache[signature]) {
          state.newsletterWorkspace.variants[lang.id] = normalizeVariant(state.translationCache[signature]);
          done += 1;
          if (!firstTranslatedLang) firstTranslatedLang = lang.id;
          setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: ${lang.label} (cached)`, 'Translation in progress');
          continue;
        }
        if (progressLabel) {
          const fetchEl = document.getElementById('fetch-st');
          if (fetchEl) fetchEl.textContent = `${progressLabel}: ${lang.label}`;
        }
        setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: ${lang.label}`, 'Translation in progress');
        const translatedHtml = await translateHtmlAIFirst(sourceVariant.html, lang.id, provider, aiKey);
        if (!TranslationMetrics.hasMeaningfulTextChangeAllowingLockedTerms(sourceVariant.html, translatedHtml, GLOSSARY_LOCK_TERM_LIST)) {
          recordTranslationFailure({
            kind: 'docUnchanged',
            gate: 'docUnchanged',
            languageId: lang.id,
            languageLabel: lang.label,
            message: '[gate:docUnchanged] Visible text unchanged after glossary-invariant stripping.'
          });
          throw new Error(`[gate:docUnchanged] ${lang.label} translation returned unchanged visible text (after ignoring glossary-invariant terms).`);
        }
        const checks = qaCheckTranslatedHtml(sourceVariant.html, translatedHtml);
        const failed = checks.filter(c => !c.ok && c.severity === 'critical');
        if (failed.length) {
          recordTranslationFailure({
            kind: 'qa',
            gate: 'qa',
            languageId: lang.id,
            languageLabel: lang.label,
            message: `[gate:qa] Critical QA: ${failed.map(f => f.id).join(', ')}`
          });
          throw new Error(`[gate:qa] ${lang.label} QA checks failed: ${failed.map(f => f.id).join(', ')}`);
        }
        state.newsletterWorkspace.variants[lang.id] = makeVariant(translatedHtml, sourceVariant.css, {
          translatedFrom: 'en',
          provider,
          translatedAt: new Date().toISOString()
        });
        state.translationCache[signature] = state.newsletterWorkspace.variants[lang.id];
        if (!firstTranslatedLang) firstTranslatedLang = lang.id;
        done += 1;
        setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: ${lang.label}`, 'Translation in progress');
      }
      persistWorkspace();
      return firstTranslatedLang;
    } finally {
      setTranslateProgress(false);
    }
  }

  async function autoTranslateNewsletter() {
    if (!state.newsletterWorkspace?.variants?.en) return showToast('Generate newsletter first, then translate.', true);
    const confirmOverwrite = confirm('Auto-translate all non-English variants from the current English version? Existing non-English text will be overwritten.');
    if (!confirmOverwrite) return;
    try {
      const firstTranslatedLang = await translateWorkspaceFromEnglish({ overwrite: true, progressLabel: 'Translating' });
      // Instantly showcase a translated version in preview.
      const current = state.currentPreviewLanguage || 'en';
      const targetPreviewLang = current !== 'en' ? current : (firstTranslatedLang || 'en');
      state.currentPreviewLanguage = targetPreviewLang;
      if (state.newsletterWorkspace) state.newsletterWorkspace.currentLanguage = targetPreviewLang;
      persistWorkspace();
      renderPreviewForLanguage(targetPreviewLang);
      showToast(`Translations ready. Showing ${getLanguageLabel(targetPreviewLang)} preview.`);
    } catch (e) {
      showToast(`Translation failed: ${e.message}`, true);
      if (!state.translationLastFailure) {
        recordTranslationFailure({
          message: e.message,
          kind: TranslationMetrics.classifyTranslationFailureKind(e.message)
        });
      }
      renderTranslationFailureState(e.message);
    }
  }
  window.App.UITranslation = {
    GLOSSARY_LOCK, GLOSSARY_LOCK_TERM_LIST,
    protectTokens, restoreTokens, applyGlossaryLock, qaCheckTranslatedHtml,
    translateHtmlWithAI, translateHtmlAIFirst,
    translateWorkspace: translateWorkspaceFromEnglish,
    autoTranslateNewsletter
  };
})();
