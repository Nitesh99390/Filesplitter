# ✂️ File Splitter & Merger

A **100% client-side**, **mobile-first** web app to split large files into smaller parts and merge them back — entirely inside your browser.
No upload. No server. No database. Your files never leave your device.

🔗 **Live demo (GitHub Pages):** `https://nitesh99390.github.io/Filesplitter/`

![Dark Neo-Glassmorphism UI](https://img.shields.io/badge/UI-Neo--Glassmorphism-7c6cff?style=flat-square)
![No backend](https://img.shields.io/badge/backend-none-2ee6a6?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/JavaScript-vanilla-27d3ff?style=flat-square)

---

## ✨ Features

### 🔪 Split File
- **Two split methods**
  - **By Chunk Size** — presets (5 / 10 / 25 / 50 / 100 / 500 MB) or any custom size in **KB / MB / GB**.
  - **By Number of Equal Parts** — e.g. 2, 5, 10 … up to 10,000 equal parts.
- **Works with every file format** — TXT, EPUB, ZIP, MP4, APK, PDF, ISO, anything.
- **Text-aware splitting** — for TXT / Markdown / CSV / JSON etc. an optional
  **“Split cleanly at line breaks”** checkbox makes each part end at a newline so words are never cut in half.
- **Live summary** — see the total number of parts, the size of each part and the size of the last part before you split.
- Parts are named `originalfilename.ext.part001`, `.part002`, … and each downloaded part gets a **green ✓ Downloaded** badge.
- **Download All** button downloads parts one after another.

### 🧩 Merge Parts
- Select / drop multiple `.part001`, `.part002`, … files **in any order** — they are **sorted automatically** by part number.
- Detects parts from different files and warns about **missing part numbers**.
- Combines everything with `new Blob(chunks)` and downloads the **original file name**.

### 🧹 Extra polish
- **Clear / Reset** buttons revoke all active ObjectURLs and reset state.
- Drag & drop **and** a mobile-friendly file picker; shows file name, exact size (MB/GB + bytes) and MIME type.
- Toast notifications, progress bars, keyboard & screen-reader friendly, safe-area aware, respects `prefers-reduced-motion`.

---

## 🧠 Memory management (the important bit)

Mobile browsers have limited RAM, so the app **never reads the whole file into an `ArrayBuffer`**.

```
File (on disk)
  └─ Blob.slice(start, end)   ← just a pointer/range, zero bytes copied
        └─ URL.createObjectURL(slice)   ← created only when you click "Download Part X"
              └─ <a download> click
                    └─ URL.revokeObjectURL(url)   ← freed a few seconds later
```

1. On **Prepare Parts** only *metadata* is computed: `[{ start, end, name }]`.
2. Clicking **Download Part X** calls `file.slice(start, end)`, wraps it in an ObjectURL, triggers the download and then **revokes** the URL to free memory.
3. In **line-break mode**, only a tiny window (64 KB, growing up to 8 MB if needed) around each boundary is read to find the nearest `\n`.
4. **Merge** uses `new Blob([part1, part2, …])`, which the browser streams from disk — the parts are not copied into JavaScript memory.

Result: multi-GB files can be split on a phone without crashing the tab.

---

## 🛠 Tech stack

| Layer      | Choice                                         |
|------------|------------------------------------------------|
| Markup     | Semantic HTML5                                 |
| Styling    | Hand-written responsive CSS (dark glassmorphism, no framework) |
| Logic      | Vanilla JavaScript (ES2020), HTML5 File API, `Blob.slice()`, ObjectURLs |
| Backend    | **None** — static files only                   |
| Build      | terser + javascript-obfuscator · clean-css · html-minifier-terser |
| Tests      | Playwright (Chromium) end-to-end                |

```
.
├── index.html / style.css / app.js   # PRODUCTION bundle (generated — do not edit)
├── src/
│   ├── index.html                    # readable source: tabs, drop zones, panels
│   ├── style.css                     # mobile-first neo-glassmorphism dark theme
│   └── app.js                        # all application logic (+ host check)
├── scripts/
│   ├── build.mjs                     # src/ → minified / obfuscated root files
│   └── serve.mjs                     # tiny static server (dev + tests)
├── tests/e2e.spec.mjs                # Playwright: split → merge → byte-identical
├── playwright.config.mjs
└── ci/github-ci.yml                  # GitHub Actions workflow (build, drift check, e2e)
```

---

## 🏗 Development & build

The files at the repository root are **generated**. Edit only `src/`, then rebuild:

```bash
npm ci               # once
npm run dev          # serve the readable src/ at http://localhost:8080
npm run build        # src/ → index.html, style.css, app.js (root)
npm run serve        # serve the production bundle at http://localhost:8080
npm test             # build + Playwright e2e suite (16 tests)
```

What the build does:

| File         | Steps                                                                                                   |
|--------------|---------------------------------------------------------------------------------------------------------|
| `index.html` | html-minifier-terser: whitespace/comments stripped, attributes sorted, `?v=<hash>` cache-busting on assets, `defer` on the script |
| `style.css`  | clean-css level 2 (rule restructuring / semantic merging)                                               |
| `app.js`     | terser (safe compress + mangle, ES2020) → javascript-obfuscator (base64 string array, rotation/shuffle, hex identifiers, object-key transform). Debug-protection / self-defending / control-flow-flattening are intentionally **off** — they hurt low-end phones and DevTools and give little extra value. The build is deterministic (fixed seed), so CI can verify the committed bundle matches `src/`. |

> The obfuscation is readability protection against casual visitors, not DRM — anything that runs in a browser can ultimately be reverse-engineered.

### 🛡 Host check

`src/app.js` contains an allow-list of hosting environments. On any other hostname the UI still renders but the
*Prepare Parts*, *Download* and *Merge* actions are disabled and a notice is shown.

| Allowed                       | Why                     |
|-------------------------------|-------------------------|
| `*.pages.dev`                 | Cloudflare Pages        |
| `*.onrender.com`              | Render                  |
| `*.github.io`                 | GitHub Pages            |
| `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`, `file://` | local development |

To add your own domain, append it to `ALLOWED_HOSTS` in `src/app.js` (exact hostname or `*.example.com`) and run `npm run build`.

---

## 🧪 Tests

`tests/e2e.spec.mjs` runs against the **built** bundle and fails on any `console.error`, uncaught exception or failed request:

- split by chunk size → download every part → merge in reverse order → SHA-256 identical to the original
- split by equal part count (remainder spread, sizes differ by ≤ 1 byte) → merge → identical
- text file in line-break mode → every part ends with `\n`, each part is whole lines → merge → identical
- *Download All* downloads every pending part
- merge validation: parts of different files are blocked, missing part numbers are warned, non-part files skipped
- reset clears state
- host check: allowed hosts (`*.pages.dev`, `*.onrender.com`, `*.github.io`, `localhost`, `127.0.0.1`) run normally; `pages.dev` (bare), `notgithub.io`, `fakeonrender.com`, arbitrary domains are locked gracefully

---

## 🌐 Deploy

No server-side build step is required — the production bundle is committed.

**GitHub Pages**
1. Push to `main`.
2. **Settings → Pages → Deploy from a branch** → `main` / `/ (root)`.
3. Live at `https://<username>.github.io/Filesplitter/`.

**Cloudflare Pages / Render (static site)** — connect the repo, leave the build command empty, publish directory `/`.

**CI** — a ready-made GitHub Actions workflow lives at `ci/github-ci.yml`. It builds, verifies the committed bundle is in sync with `src/` (`git diff --exit-code`), and runs the e2e suite on every push and PR. To enable it:

```bash
mkdir -p .github/workflows && git mv ci/github-ci.yml .github/workflows/ci.yml
```

(It is shipped outside `.github/workflows/` because the automation token used to open this PR is not allowed to create workflow files.)

---

## 📱 Browser support

Any modern browser with the File API: Chrome / Edge / Firefox / Safari (incl. iOS Safari and Android Chrome).
Very large single downloads are subject to the browser's own limits (e.g. some mobile browsers cap a single Blob download around 2 GB); splitting into smaller chunks works around that.

---

## 🔒 Privacy

Everything happens in your browser. There is no network request for your data, no analytics, no cookies.
Works offline once the page is loaded.

---

## 📄 License

MIT — do whatever you like, attribution appreciated.
