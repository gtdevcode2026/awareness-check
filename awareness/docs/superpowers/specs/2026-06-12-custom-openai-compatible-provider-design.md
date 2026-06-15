# Spec — Custom OpenAI-Compatible AI Provider

## Goal

Add a third AI provider, **Custom (OpenAI-compatible)**, alongside the existing Claude and OpenAI options. It lets a user point the app at any endpoint that speaks the OpenAI `/v1/chat/completions` contract — Ollama, OpenRouter, LM Studio, vLLM, LiteLLM, Groq, Together, etc. — by supplying a base URL, a model name, and an optional API key. It must drive every AI feature the existing OpenAI provider already drives.

## Approved decisions (from brainstorming)

- **Provider shape:** a new third provider, `custom`, in the `#ai-provider` select. Claude and OpenAI are untouched.
- **Scope:** wired into every call site OpenAI already covers — article summaries, `callTemplateSlotsAI`, the bank-page ensemble, taglines, and `regenerateSelection`.
- **Auth/headers:** simple. Base URL + model + optional API key. The key (when present) is sent as `Authorization: Bearer <key>`. A blank key means **no auth header** (Ollama).
- **Approach A (helper-based threading):** thread the new provider through the existing branches using two small pure helpers, rather than centralizing all call sites (Approach B) or building a provider registry (Approach C). This keeps the diff small in the high-risk `ai_summarizer.js`, per the repo's "prefer small test-backed fixes over further refactors" rule.

## Config model

`js/ai_summarizer.js` `config` defaults and the `configure()` `ALLOWED` whitelist gain three keys:

- `customBaseUrl` (string, default `''`)
- `customModel` (string, default `''`)
- `customKey` (string, default `''`)

Two new pure helpers in the IIFE:

- `isOpenAICompatible(provider)` → `provider === 'openai' || provider === 'custom'`.
- `resolveOpenAITarget(config)` → `{ url, key, model }`:
  - `openai` → `{ url: 'https://api.openai.com/v1/chat/completions', key: config.openaiKey, model: config.openaiModel }`
  - `custom` → `{ url: normalizeChatCompletionsUrl(config.customBaseUrl), key: config.customKey, model: config.customModel }`
- `hasUsableTarget(config)` → for `openai`, truthy `openaiKey`; for `custom`, truthy `customBaseUrl` (key optional).

### Base-URL normalization (`normalizeChatCompletionsUrl`)

Accept any of these and resolve to a full chat-completions endpoint:

| Input | Resolved |
| --- | --- |
| `http://localhost:11434` | `http://localhost:11434/v1/chat/completions` |
| `http://localhost:11434/` | `http://localhost:11434/v1/chat/completions` |
| `https://openrouter.ai/api/v1` | `https://openrouter.ai/api/v1/chat/completions` |
| `https://host/v1/chat/completions` | unchanged |

Rule: strip a trailing `/`; if it already ends in `/chat/completions`, leave it; else if it ends in `/v1`, append `/chat/completions`; else append `/v1/chat/completions`.

## Request building

- `openAIChatCompletionsBody(systemPrompt, userPrompt, maxTokens, temperature, model)` gains an explicit `model` parameter, defaulting to `config.openaiModel` for back-compat. Each call site passes the resolved `model`.
- The `Authorization: Bearer` header is built conditionally: included only when the resolved `key` is non-empty. This is the one behavioral change that lets keyless Ollama work.
- JSON mode (`response_format: { type: 'json_object' }`) is left as-is. It is harmless for compatible servers; if a specific target rejects it we can guard it later, but that is out of scope for v1.

## Call-site wiring

Every existing `else if (config.provider === 'openai' && config.openaiKey)` branch becomes `else if (isOpenAICompatible(config.provider) && hasUsableTarget(config))`, using `resolveOpenAITarget(config)` for `url` / `key` / `model`. Known sites in `js/ai_summarizer.js`:

- `callOpenAI` (~L117) — central helper.
- `callTemplateSlotsAI` openai branch (~L741).
- Summarize path openai branch (~L2911).
- The `useAI` / has-AI predicates (~L2809, ~L2853, ~L2747).
- The `regenerateSelection` path (it maps `provider`/`apiKey` into config — extend so `provider === 'custom'` routes `customKey`/`customBaseUrl`/`customModel`).
- Bank-page ensemble (`js/ai/bank_page_ensemble.js` / `js/ai/prompt_builders.js`) if it independently checks the provider; route it through the same helpers.

## UI

### `config.html`

- `#ai-provider` gains `<option value="custom">Custom (OpenAI-compatible)</option>`.
- Two new fields, shown only when `custom` is selected:
  - **Base URL** — `#ai-base-url`, placeholder `http://localhost:11434` — with a one-line hint about CORS (see below).
  - **Model** — `#ai-model`, placeholder `llama3.1` / `mistralai/mistral-7b-instruct`.
- The existing **AI API Key** field (`#ai-key`) is reused and its helper text notes it is optional for local servers.
- A small `change` handler on `#ai-provider` toggles visibility of the two custom-only fields.

### `js/ui_controller.js`

- `getAISettingsFromUI()` also reads `customBaseUrl` (`#ai-base-url`) and `customModel` (`#ai-model`).
- `applyAISettings()` restores `customBaseUrl`/`customModel` into the fields and toggles field visibility based on the saved provider. The key still restores from sessionStorage only.
- `saveAISettings()` persists `customBaseUrl` + `customModel` into the `awareness_ai_settings_v1` localStorage payload (non-secret). The key continues to go to `awareness_ai_key_session_v1` (sessionStorage) only.
- The ~7 scattered `App.AISummarizer.configure({...})` call sites (in `ui_controller.js`, `ui/translation.js`, `ui/generate_pipeline.js`, `editor.js`) add `customBaseUrl`, `customModel`, and `customKey: prov === 'custom' ? key : ''` to the object they pass.

## Empty-key guards

Two hard guards currently block all AI work when the key field is empty and must change to "key required **unless** custom provider with a base URL set":

- `js/ui_controller.js` ~L1080 (translation entry).
- `js/ui_controller.js` ~L2722 (`'Add an AI API key first.'`).

A shared predicate (`provider === 'custom' && baseUrl` counts as usable) keeps both consistent.

## CORS reality (no backend)

The app is static and browser-only, so the request goes directly from the browser to the target. The target must allow this origin:

- **OpenRouter / hosted gateways:** allow browser origins by default.
- **Ollama:** requires `OLLAMA_ORIGINS` to include the app origin, e.g. `OLLAMA_ORIGINS=http://127.0.0.1:4173 ollama serve` (or `*` for local dev).

Surfaced as a one-line hint under the Base URL field and documented in `docs/CONTEXT.md`. A blocked preflight or network error is caught by the existing try/catch and falls back to local content — no new error path needed.

## Testing

Deterministic only — no live network in unit/E2E.

- **Unit (`tests/unit/`):**
  - `resolveOpenAITarget` / `normalizeChatCompletionsUrl` — all base-URL variants in the table above; openai vs custom selection; key/no-key.
  - `hasUsableTarget` — openai needs key; custom needs base URL; custom with no key is usable.
  - `openAIChatCompletionsBody` — model param honored; back-compat default.
- **Auth header:** a test asserting the `Authorization` header is omitted when the resolved key is blank and present when set (route-mock or by inspecting the request init).
- **Integration (route-mocked):** a `custom` provider with no key issues a keyless POST to the normalized `/v1/chat/completions` URL and parses `choices[0].message.content`.

## Docs

- `docs/CONTEXT.md` — add `customBaseUrl` / `customModel` to the AI-settings localStorage payload description; note the key remains session-only; note the CORS requirement.
- `CLAUDE.md` — extend the AI-module note to mention the `custom` provider and the `resolveOpenAITarget` helper.

## Out of scope (v1, YAGNI)

- Custom/arbitrary headers (OpenRouter `HTTP-Referer` / `X-Title`, custom auth header names).
- Per-call model overrides or a "fetch available models" dropdown (model is free-text).
- Streaming responses.
- Multiple saved custom endpoints / endpoint profiles.
- Persisting the custom key to localStorage (stays session-only, same as today's keys).
- Gate-D AI-experiment readiness changes beyond making the readiness predicate treat custom+baseUrl as ready.
