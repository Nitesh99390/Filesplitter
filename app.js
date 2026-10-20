/* =========================================================
   File Splitter & Merger — app.js
   100% client-side. Uses HTML5 File API + Blob.slice().
   The source file is NEVER fully read into memory: every part
   is a lazy Blob "view" (pointer + offsets) and is only materialised
   as an ObjectURL at download time, then revoked right after.
   ========================================================= */
(() => {
  "use strict";

  /* ---------------- Constants ---------------- */
  const KB = 1024;
  const MB = 1024 * KB;
  const GB = 1024 * MB;
  const UNIT = { KB, MB, GB };
  const PART_RE = /\.part(\d+)$/i;
  const TEXT_EXT = new Set([
    "txt", "md", "markdown", "csv", "tsv", "json", "log", "xml", "html", "htm",
    "srt", "vtt", "yaml", "yml", "ini", "cfg", "conf", "js", "ts", "css", "py",
    "java", "c", "cpp", "h", "sh", "sql", "rtf", "tex", "nfo"
  ]);
  const MAX_PARTS_WARN = 1000;
  const MAX_PARTS_HARD = 10000;
  const LB_WINDOW = 64 * KB;       // initial lookback window for "\n"
  const LB_MAX_WINDOW = 8 * MB;    // give up after this
  const REVOKE_DELAY = 4000;       // ms to wait before revoking ObjectURL

  /* ---------------- DOM helpers ---------------- */
  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove("hidden");
  const hide = (el) => el.classList.add("hidden");

  const els = {
    tabs: document.querySelector(".tabs"),
    tabBtns: document.querySelectorAll(".tab"),
    panels: { split: $("panel-split"), merge: $("panel-merge") },

    // split
    splitDrop: $("split-dropzone"),
    splitInput: $("split-file-input"),
    splitPick: $("split-pick-btn"),
    splitCard: $("split-file-card"),
    splitIcon: $("split-file-icon"),
    splitName: $("split-file-name"),
    splitSize: $("split-file-size"),
    splitType: $("split-file-type"),
    splitRemove: $("split-remove-file"),
    splitOptions: $("split-options"),
    modeRadios: document.querySelectorAll('input[name="split-mode"]'),
    modeSize: $("mode-size"),
    modeCount: $("mode-count"),
    sizePresets: $("size-presets"),
    countPresets: $("count-presets"),
    customSize: $("custom-size"),
    customUnit: $("custom-unit"),
    customCount: $("custom-count"),
    lbWrap: $("linebreak-wrap"),
    lbCheck: $("linebreak-check"),
    sumParts: $("sum-parts"),
    sumSize: $("sum-size"),
    sumLast: $("sum-last"),
    splitWarn: $("split-warning"),
    splitBtn: $("split-btn"),
    splitReset: $("split-reset-btn"),
    splitProgress: $("split-progress"),
    splitProgressLabel: $("split-progress-label"),
    splitProgressFill: $("split-progress-fill"),
    partsSection: $("parts-section"),
    partsBadge: $("parts-count-badge"),
    partsList: $("parts-list"),
    partsProgressFill: $("parts-progress-fill"),
    partsProgressText: $("parts-progress-text"),
    downloadAll: $("download-all-btn"),

    // merge
    mergeDrop: $("merge-dropzone"),
    mergeInput: $("merge-file-input"),
    mergePick: $("merge-pick-btn"),
    mergeSection: $("merge-section"),
    mergeBadge: $("merge-count-badge"),
    mergeList: $("merge-list"),
    mergeOutName: $("merge-output-name"),
    mergeTotal: $("merge-total-size"),
    mergeWarn: $("merge-warning"),
    mergeBtn: $("merge-btn"),
    mergeReset: $("merge-reset-btn"),
    mergeAddMore: $("merge-add-more"),

    toast: $("toast")
  };

  /* ---------------- State ---------------- */
  const state = {
    file: null,          // File selected for splitting
    isText: false,
    mode: "size",        // "size" | "count"
    parts: [],           // [{ index, start, end, name, downloaded }]
    activeUrls: new Set(),
    revokeTimers: new Set(),
    busy: false,
    mergeFiles: []       // sorted File[] for merge
  };

  /* ---------------- Utilities ---------------- */
  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(2)} KB`;
    if (bytes < GB) return `${(bytes / MB).toFixed(2)} MB`;
    return `${(bytes / GB).toFixed(3)} GB`;
  }

  function pad(n, width = 3) {
    return String(n).padStart(width, "0");
  }

  function extOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }

  function detectIsText(file) {
    if (file.type && file.type.startsWith("text/")) return true;
    const t = file.type || "";
    if (/json|xml|javascript|csv|yaml/i.test(t)) return true;
    return TEXT_EXT.has(extOf(file.name));
  }

  function fileIcon(file) {
    const e = extOf(file.name);
    const t = file.type || "";
    if (t.startsWith("video/") || ["mp4", "mkv", "avi", "mov", "webm"].includes(e)) return "🎬";
    if (t.startsWith("audio/") || ["mp3", "wav", "flac", "m4a", "ogg"].includes(e)) return "🎵";
    if (t.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "🖼️";
    if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(e)) return "🗜️";
    if (["apk", "exe", "msi", "dmg", "deb", "rpm", "iso"].includes(e)) return "📦";
    if (["epub", "mobi", "pdf", "azw3"].includes(e)) return "📚";
    if (detectIsText(file)) return "📝";
    return "📄";
  }

  function typeLabel(file) {
    if (file.type) return file.type;
    const e = extOf(file.name);
    return e ? `.${e.toUpperCase()} file` : "Unknown type";
  }

  let toastTimer = null;
  function toast(msg, kind = "") {
    els.toast.textContent = msg;
    els.toast.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- ObjectURL memory management ---------------- */
  function trackedDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    state.activeUrls.add(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser time to start the download before revoking.
    const t = setTimeout(() => {
      URL.revokeObjectURL(url);
      state.activeUrls.delete(url);
      state.revokeTimers.delete(t);
    }, REVOKE_DELAY);
    state.revokeTimers.add(t);
    return url;
  }

  function revokeAllUrls() {
    for (const t of state.revokeTimers) clearTimeout(t);
    state.revokeTimers.clear();
    for (const url of state.activeUrls) {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }
    state.activeUrls.clear();
  }

  /* ---------------- Tabs ---------------- */
  function switchTab(name) {
    els.tabs.dataset.active = name;
    els.tabBtns.forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    Object.entries(els.panels).forEach(([k, p]) => {
      p.classList.toggle("active", k === name);
      p.hidden = k !== name;
    });
  }
  els.tabBtns.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  /* ---------------- Dropzone wiring ---------------- */
  function wireDropzone(zone, input, pickBtn, onFiles) {
    const open = () => input.click();
    zone.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // button handles itself
      open();
    });
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    pickBtn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    input.addEventListener("change", () => {
      if (input.files && input.files.length) onFiles(Array.from(input.files));
      input.value = ""; // allow re-selecting the same file
    });
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); })
    );
    ["dragleave", "dragend"].forEach((ev) =>
      zone.addEventListener(ev, () => zone.classList.remove("dragover"))
    );
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFiles(files);
    });
  }

  // Prevent the browser from navigating away when a file is dropped outside a zone.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  /* =========================================================
     SPLIT
     ========================================================= */
  function onSplitFile(files) {
    const file = files[0];
    if (!file) return;
    resetSplit(false);
    state.file = file;
    state.isText = detectIsText(file);

    els.splitIcon.textContent = fileIcon(file);
    els.splitName.textContent = file.name;
    els.splitName.title = file.name;
    els.splitSize.textContent = `${formatSize(file.size)} (${file.size.toLocaleString()} bytes)`;
    els.splitType.textContent = typeLabel(file);

    show(els.splitCard);
    show(els.splitOptions);
    hide(els.splitDrop);
    if (state.isText) show(els.lbWrap); else { hide(els.lbWrap); els.lbCheck.checked = false; }
    updateSummary();
  }

  function getChunkSizeBytes() {
    const v = parseFloat(els.customSize.value);
    const unit = UNIT[els.customUnit.value] || MB;
    if (!Number.isFinite(v) || v <= 0) return 0;
    return Math.max(1, Math.floor(v * unit));
  }

  function getPartCount() {
    const n = parseInt(els.customCount.value, 10);
    if (!Number.isFinite(n) || n < 2) return 0;
    return Math.min(n, MAX_PARTS_HARD);
  }

  /** Compute the plan (boundaries) without touching file content. */
  function computePlan() {
    const file = state.file;
    if (!file) return null;
    const size = file.size;
    if (size === 0) return { error: "This file is empty (0 bytes) — nothing to split." };

    let boundaries = []; // array of end offsets
    if (state.mode === "size") {
      const chunk = getChunkSizeBytes();
      if (!chunk) return { error: "Enter a valid chunk size." };
      const n = Math.ceil(size / chunk);
      if (n > MAX_PARTS_HARD) return { error: `That would create ${n.toLocaleString()} parts. Maximum is ${MAX_PARTS_HARD.toLocaleString()} — choose a bigger chunk size.` };
      for (let i = 1; i <= n; i++) boundaries.push(Math.min(i * chunk, size));
    } else {
      const n = getPartCount();
      if (!n) return { error: "Enter at least 2 parts." };
      if (n > size) return { error: `Cannot split a ${size}-byte file into ${n} parts.` };
      const base = Math.floor(size / n);
      const rem = size % n;
      let pos = 0;
      for (let i = 0; i < n; i++) {
        pos += base + (i < rem ? 1 : 0);
        boundaries.push(pos);
      }
    }
    return { boundaries };
  }

  function updateSummary() {
    const plan = computePlan();
    if (!plan) return;
    if (plan.error) {
      els.sumParts.textContent = "—";
      els.sumSize.textContent = "—";
      els.sumLast.textContent = "—";
      els.splitWarn.textContent = plan.error;
      els.splitWarn.classList.add("danger");
      show(els.splitWarn);
      els.splitBtn.disabled = true;
      return;
    }
    const b = plan.boundaries;
    const n = b.length;
    const first = b[0];
    const last = b[n - 1] - (n > 1 ? b[n - 2] : 0);
    els.sumParts.textContent = n.toLocaleString();
    els.sumSize.textContent = formatSize(first);
    els.sumLast.textContent = formatSize(last);
    els.splitBtn.disabled = false;

    let warn = "";
    if (n === 1) warn = "Chunk size is larger than the file — only 1 part would be created.";
    else if (n > MAX_PARTS_WARN) warn = `${n.toLocaleString()} parts is a lot — downloading them all may take a while.`;
    if (els.lbCheck.checked && state.isText) {
      warn += (warn ? " " : "") + "Line-break mode: part sizes will be adjusted slightly so each part ends at a newline.";
    }
    els.splitWarn.classList.remove("danger");
    if (warn) { els.splitWarn.textContent = warn; show(els.splitWarn); } else hide(els.splitWarn);
  }

  /** Mode radio */
  els.modeRadios.forEach((r) =>
    r.addEventListener("change", () => {
      state.mode = r.value;
      els.modeSize.classList.toggle("hidden", state.mode !== "size");
      els.modeCount.classList.toggle("hidden", state.mode !== "count");
      updateSummary();
    })
  );

  /** Size presets */
  els.sizePresets.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    els.sizePresets.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    els.customSize.value = chip.dataset.mb;
    els.customUnit.value = "MB";
    updateSummary();
  });
  els.countPresets.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    els.countPresets.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    els.customCount.value = chip.dataset.n;
    updateSummary();
  });

  function syncChips() {
    // highlight matching preset chip (if any) when custom value changes
    const mbVal = els.customUnit.value === "MB" ? els.customSize.value : null;
    els.sizePresets.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.mb === mbVal));
    els.countPresets.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.n === els.customCount.value));
  }
  ["input", "change"].forEach((ev) => {
    els.customSize.addEventListener(ev, () => { syncChips(); updateSummary(); });
    els.customUnit.addEventListener(ev, () => { syncChips(); updateSummary(); });
    els.customCount.addEventListener(ev, () => { syncChips(); updateSummary(); });
  });
  els.lbCheck.addEventListener("change", updateSummary);

  /**
   * Find the byte offset right after the last "\n" at or before `pos`.
   * Reads only a small window from the file using Blob.slice().
   * Returns `pos` unchanged if no newline is found within LB_MAX_WINDOW.
   */
  async function snapToLineBreak(file, pos, minPos) {
    if (pos >= file.size) return file.size;
    let win = LB_WINDOW;
    while (win <= LB_MAX_WINDOW) {
      const start = Math.max(minPos, pos - win);
      const buf = new Uint8Array(await file.slice(start, pos).arrayBuffer());
      const idx = buf.lastIndexOf(0x0a);
      if (idx !== -1) return start + idx + 1; // include the newline in this part
      if (start === minPos) break;
      win *= 4;
    }
    return pos; // fall back to a hard cut
  }

  async function prepareParts() {
    if (state.busy || !state.file) return;
    const plan = computePlan();
    if (!plan || plan.error) return;

    state.busy = true;
    els.splitBtn.disabled = true;
    revokeAllUrls();
    state.parts = [];

    let boundaries = plan.boundaries;
    const file = state.file;

    if (els.lbCheck.checked && state.isText && boundaries.length > 1) {
      show(els.splitProgress);
      els.splitProgressFill.style.width = "0%";
      const snapped = [];
      let prev = 0;
      try {
        for (let i = 0; i < boundaries.length - 1; i++) {
          // Keep each boundary strictly after the previous one.
          let b = Math.max(boundaries[i], prev + 1);
          b = await snapToLineBreak(file, b, prev + 1);
          if (b <= prev) b = Math.min(boundaries[i], file.size);
          if (b >= file.size) break;
          snapped.push(b);
          prev = b;
          const pct = Math.round(((i + 1) / (boundaries.length - 1)) * 100);
          els.splitProgressFill.style.width = `${pct}%`;
          els.splitProgressLabel.textContent = `Scanning for line breaks… ${pct}%`;
        }
      } catch (err) {
        console.error(err);
        toast("Could not read file for line-break detection. Using exact sizes.", "error");
        snapped.length = 0;
        snapped.push(...boundaries.slice(0, -1));
      }
      snapped.push(file.size);
      boundaries = snapped;
      hide(els.splitProgress);
    }

    const width = Math.max(3, String(boundaries.length).length);
    let start = 0;
    boundaries.forEach((end, i) => {
      state.parts.push({
        index: i + 1,
        start,
        end,
        name: `${file.name}.part${pad(i + 1, width)}`,
        downloaded: false
      });
      start = end;
    });

    renderParts();
    state.busy = false;
    els.splitBtn.disabled = false;
    const cnt = state.parts.length;
    toast(`${cnt} ${cnt === 1 ? "part" : "parts"} ready — tap to download.`, "success");
    els.partsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderParts() {
    els.partsList.innerHTML = "";
    els.partsBadge.textContent = state.parts.length;
    const frag = document.createDocumentFragment();
    state.parts.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "part-item" + (p.downloaded ? " done" : "");
      li.dataset.index = p.index;
      li.style.animationDelay = `${Math.min(i, 20) * 25}ms`;
      li.innerHTML = `
        <div class="part-index">${pad(p.index, 2)}</div>
        <div class="part-info">
          <p class="part-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</p>
          <p class="part-size">${formatSize(p.end - p.start)}<span class="part-range"> · bytes ${p.start.toLocaleString()}–${(p.end - 1).toLocaleString()}</span></p>
        </div>
        <div class="part-actions">
          ${p.downloaded
            ? `<span class="done-badge"><span class="tick">✓</span>Downloaded</span>
               <button type="button" class="icon-btn" data-action="redownload" title="Download again" aria-label="Download again">↻</button>`
            : `<button type="button" class="btn btn-primary" data-action="download">⬇ Download Part ${p.index}</button>`}
        </div>`;
      frag.appendChild(li);
    });
    els.partsList.appendChild(frag);
    show(els.partsSection);
    updatePartsProgress();
  }

  function updatePartsProgress() {
    const total = state.parts.length;
    const done = state.parts.filter((p) => p.downloaded).length;
    els.partsProgressText.textContent = `${done} / ${total} downloaded`;
    els.partsProgressFill.style.width = total ? `${(done / total) * 100}%` : "0%";
    els.partsProgressFill.classList.toggle("success", total > 0 && done === total);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** Download a single part: slice lazily → ObjectURL → click → revoke. */
  function downloadPart(part) {
    if (!state.file) return;
    // Blob.slice() creates a lightweight view; nothing is read into RAM here.
    const chunk = state.file.slice(part.start, part.end, "application/octet-stream");
    trackedDownload(chunk, part.name);
    part.downloaded = true;
    const li = els.partsList.querySelector(`[data-index="${part.index}"]`);
    if (li) {
      li.classList.add("done");
      li.querySelector(".part-actions").innerHTML = `
        <span class="done-badge"><span class="tick">✓</span>Downloaded</span>
        <button type="button" class="icon-btn" data-action="redownload" title="Download again" aria-label="Download again">↻</button>`;
    }
    updatePartsProgress();
  }

  els.partsList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const li = btn.closest(".part-item");
    const part = state.parts.find((p) => p.index === Number(li.dataset.index));
    if (part) downloadPart(part);
  });

  els.downloadAll.addEventListener("click", async () => {
    if (state.busy || !state.parts.length) return;
    const pending = state.parts.filter((p) => !p.downloaded);
    if (!pending.length) { toast("All parts already downloaded ✓", "success"); return; }
    state.busy = true;
    els.downloadAll.disabled = true;
    toast(`Downloading ${pending.length} parts… your browser may ask to allow multiple downloads.`);
    for (const p of pending) {
      downloadPart(p);
      await sleep(900); // avoid browsers dropping rapid-fire downloads
    }
    state.busy = false;
    els.downloadAll.disabled = false;
    toast("All parts downloaded ✓", "success");
  });

  els.splitBtn.addEventListener("click", prepareParts);

  function resetSplit(resetInputs = true) {
    revokeAllUrls();
    state.file = null;
    state.isText = false;
    state.parts = [];
    state.busy = false;
    els.partsList.innerHTML = "";
    hide(els.partsSection);
    hide(els.splitCard);
    hide(els.splitOptions);
    hide(els.splitProgress);
    hide(els.splitWarn);
    show(els.splitDrop);
    els.splitBtn.disabled = false;
    els.downloadAll.disabled = false;
    if (resetInputs) {
      els.lbCheck.checked = false;
      els.splitInput.value = "";
    }
  }
  els.splitReset.addEventListener("click", () => { resetSplit(); toast("Reset — memory cleared."); });
  els.splitRemove.addEventListener("click", () => resetSplit());

  wireDropzone(els.splitDrop, els.splitInput, els.splitPick, onSplitFile);

  /* =========================================================
     MERGE
     ========================================================= */
  function parsePart(file) {
    const m = file.name.match(PART_RE);
    if (!m) return null;
    return { file, num: parseInt(m[1], 10), base: file.name.slice(0, m.index) };
  }

  function onMergeFiles(files) {
    const parsed = [];
    const rejected = [];
    files.forEach((f) => {
      const p = parsePart(f);
      if (p) parsed.push(p); else rejected.push(f.name);
    });
    if (rejected.length) {
      toast(`Skipped ${rejected.length} file(s) without a .partNNN suffix.`, "error");
    }
    if (!parsed.length && !state.mergeFiles.length) return;

    // Merge with existing selection; replace duplicates by (base, num).
    const map = new Map(state.mergeFiles.map((p) => [`${p.base}::${p.num}`, p]));
    parsed.forEach((p) => map.set(`${p.base}::${p.num}`, p));
    state.mergeFiles = Array.from(map.values()).sort((a, b) =>
      a.base === b.base ? a.num - b.num : a.base.localeCompare(b.base)
    );
    renderMerge();
  }

  function mergeValidation() {
    const list = state.mergeFiles;
    if (!list.length) return { ok: false, msg: "" };
    const bases = new Set(list.map((p) => p.base));
    if (bases.size > 1) {
      return { ok: false, danger: true, msg: `Parts belong to ${bases.size} different files (${[...bases].map((b) => `"${b}"`).join(", ")}). Select parts of one file only.` };
    }
    const nums = list.map((p) => p.num);
    const min = Math.min(...nums), max = Math.max(...nums);
    const missing = [];
    for (let i = min; i <= max; i++) if (!nums.includes(i)) missing.push(i);
    if (min !== 1) missing.unshift(...Array.from({ length: min - 1 }, (_, i) => i + 1));
    if (missing.length) {
      const shown = missing.slice(0, 8).map((n) => `part${pad(n)}`).join(", ");
      return { ok: true, msg: `Possibly missing: ${shown}${missing.length > 8 ? ` +${missing.length - 8} more` : ""}. You can still merge, but the output may be incomplete.` };
    }
    return { ok: true, msg: "" };
  }

  function renderMerge() {
    const list = state.mergeFiles;
    if (!list.length) { resetMerge(); return; }
    show(els.mergeSection);
    hide(els.mergeDrop);
    els.mergeBadge.textContent = list.length;
    els.mergeOutName.textContent = list[0].base;
    els.mergeOutName.title = list[0].base;
    const total = list.reduce((s, p) => s + p.file.size, 0);
    els.mergeTotal.textContent = formatSize(total);

    els.mergeList.innerHTML = "";
    const frag = document.createDocumentFragment();
    list.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "part-item";
      li.style.animationDelay = `${Math.min(i, 20) * 25}ms`;
      li.innerHTML = `
        <div class="part-index">${pad(p.num, 2)}</div>
        <div class="part-info">
          <p class="part-name" title="${escapeHtml(p.file.name)}">${escapeHtml(p.file.name)}</p>
          <p class="part-size">${formatSize(p.file.size)}</p>
        </div>
        <div class="part-actions">
          <button type="button" class="icon-btn" data-remove="${i}" title="Remove" aria-label="Remove">✕</button>
        </div>`;
      frag.appendChild(li);
    });
    els.mergeList.appendChild(frag);

    const v = mergeValidation();
    els.mergeWarn.classList.toggle("danger", !!v.danger);
    if (v.msg) { els.mergeWarn.textContent = v.msg; show(els.mergeWarn); } else hide(els.mergeWarn);
    els.mergeBtn.disabled = !v.ok;
  }

  els.mergeList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    state.mergeFiles.splice(Number(btn.dataset.remove), 1);
    renderMerge();
  });

  function doMerge() {
    const v = mergeValidation();
    if (!v.ok || !state.mergeFiles.length) return;
    const ordered = state.mergeFiles.map((p) => p.file);
    // new Blob([File, File, ...]) concatenates lazily — the browser streams
    // from disk when the download starts; the parts are not copied into JS memory.
    const merged = new Blob(ordered, { type: "application/octet-stream" });
    const name = state.mergeFiles[0].base || "merged_file";
    trackedDownload(merged, name);
    toast(`Merged ${ordered.length} parts → ${name} (${formatSize(merged.size)})`, "success");
  }
  els.mergeBtn.addEventListener("click", doMerge);

  function resetMerge() {
    revokeAllUrls();
    state.mergeFiles = [];
    els.mergeList.innerHTML = "";
    hide(els.mergeSection);
    hide(els.mergeWarn);
    show(els.mergeDrop);
    els.mergeBtn.disabled = false;
    els.mergeInput.value = "";
  }
  els.mergeReset.addEventListener("click", () => { resetMerge(); toast("Reset — memory cleared."); });
  els.mergeAddMore.addEventListener("click", () => els.mergeInput.click());

  wireDropzone(els.mergeDrop, els.mergeInput, els.mergePick, onMergeFiles);

  /* ---------------- Cleanup on leave ---------------- */
  window.addEventListener("pagehide", revokeAllUrls);

  /* ---------------- Feature detection ---------------- */
  if (!(window.File && window.Blob && Blob.prototype.slice && window.URL && URL.createObjectURL)) {
    toast("Your browser does not support the File API needed for this app.", "error");
    els.splitBtn.disabled = true;
    els.mergeBtn.disabled = true;
  }

  switchTab("split");
})();
