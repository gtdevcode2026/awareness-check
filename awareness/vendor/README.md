# vendor/ — bundled third-party libraries

These libraries are committed/shipped **inside the project** so the app is fully
self-contained when it is zipped and unzipped onto a machine with no internet, or
one whose security policy blocks public CDNs (e.g. cdnjs). Every page loads them
**local-first**, and only falls back to the cdnjs CDN if the local file is missing.

| File            | Library   | Version | Used by                                   |
| --------------- | --------- | ------- | ----------------------------------------- |
| `jszip.min.js`  | JSZip     | 3.10.1  | "Download All" → builds the per-language ZIP |
| `qrcode.min.js` | qrcode.js | 1.0.0   | QR codes in poster / QR newsletter options   |

Each file is byte-identical to the cdnjs copy — verified against the same
Subresource Integrity (SRI) hashes that the `<script>` tags carry:

- JSZip  3.10.1 → `sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG`
- qrcode 1.0.0  → `sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU`

To update a library: download the matching minified build from cdnjs, confirm its
SRI hash equals the value above (or update the value everywhere it appears), and
replace the file here.
