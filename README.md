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

```
.
├── index.html   # structure: tabs, drop zones, split/merge panels
├── style.css    # mobile-first neo-glassmorphism dark theme
├── app.js       # all application logic
└── README.md
```

---

## 🚀 Run locally

It is a static site — just open `index.html` in a browser, or serve the folder:

```bash
# Python
python3 -m http.server 8080
# or Node
npx serve .
```

Then visit `http://localhost:8080`.

---

## 🌐 Deploy to GitHub Pages

1. Push this repository to GitHub (`main` branch).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and the `/ (root)` folder.
4. Save — your app will be live at `https://<username>.github.io/Filesplitter/`.

No build step is needed.

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
