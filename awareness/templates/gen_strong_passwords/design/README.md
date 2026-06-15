# gen_strong_passwords / design

Design assets for the **gen_strong_passwords** template (status: testing).

Drop here:
- AI-generated or pulled imagery used by this template
- Reference HTML / PNG / SVG mocks the pipeline ingested
- Any visual component snippets specific to this template

`images/strong_passwords_hero.jpg` is the gold/black/white hero illustration (also
bundled at `assets/strong_passwords_hero.jpg`, referenced by the build via
`assetSrc('strong_passwords_hero.jpg')`). It is embedded as a data URI in
`assets/template_assets.js` (via `npm run build:template-assets`) so the image
survives standalone-HTML download, `file://`, and `.eml`/email export.

Folder kept under version control via this README (zip strips empty folders).
