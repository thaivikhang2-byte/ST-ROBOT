# AI reply formatting dependencies

These assets are served from the same site as ST-ROBOT; chat formulas do not require a third-party CDN.

- KaTeX 0.19.1: official `dist/katex.mjs` copied as `katex/katex.js`, plus official `katex.min.css`, fonts and MIT license.
- markdown-it 15.0.3: official bundled browser ESM `dist/browser/markdown-it.esm.min.mjs` copied as `markdown-it/markdown-it.js`, plus MIT license. The source-map URL was removed because that map is not served.

The `.js` extension is intentional: the existing frontend server serves JavaScript using that extension. Each package directory records the exact npm tarball, version and verified SHA-512 npm integrity in `PROVENANCE.json`. No package install scripts were run.

`AiMessageRenderer.js` disables raw Markdown HTML and remote images, validates link protocols, and uses KaTeX with `trust:false`, bounded expansion/size and safe text fallback. Code fences and inline code remain literal. Renderer tests use the real local libraries; browser tests use fixture AI replies and do not call a paid provider.
