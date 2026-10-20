/**
 * End-to-end tests for the PRODUCTION build (index.html / style.css / app.js
 * at the repo root). Run `npm run build` first - `npm test` does this for you.
 *
 * Every test attaches a console watchdog: any `console.error`, uncaught
 * exception or failed network request fails the test.
 */
import { test, expect } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/* ------------------------------------------------------------ helpers */
function watchConsole(page) {
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  return problems;
}

async function readDownload(download) {
  const path = await download.path();
  return { name: download.suggestedFilename(), data: await readFile(path) };
}

/** Click a button that triggers exactly one download and return it. */
async function clickForDownload(page, locator) {
  const [dl] = await Promise.all([page.waitForEvent("download"), locator.click()]);
  return readDownload(dl);
}

/** Split `file` with the UI, download all parts, return [{name,data}] sorted. */
async function splitAndDownloadAll(page, file, configure) {
  await page.locator("#split-file-input").setInputFiles(file);
  await expect(page.locator("#split-file-card")).toBeVisible();
  await expect(page.locator("#split-file-name")).toHaveText(file.name);
  if (configure) await configure(page);

  await page.locator("#split-btn").click();
  const items = page.locator("#parts-list .part-item");
  await expect(items.first()).toBeVisible();
  const count = await items.count();

  const parts = [];
  for (let i = 0; i < count; i++) {
    const btn = items.nth(i).locator('[data-action="download"]');
    parts.push(await clickForDownload(page, btn));
    await expect(items.nth(i)).toHaveClass(/done/);
    await expect(items.nth(i).locator(".done-badge")).toBeVisible();
  }
  await expect(page.locator("#parts-progress-text")).toHaveText(`${count} / ${count} downloaded`);
  return parts;
}

/** Feed parts (as in-memory files) to the merge tab and download the result. */
async function mergeParts(page, parts, { shuffle = true } = {}) {
  const order = shuffle ? [...parts].reverse() : parts;
  await page.locator('[data-tab="merge"]').click();
  await page.locator("#merge-file-input").setInputFiles(
    order.map((p) => ({ name: p.name, mimeType: "application/octet-stream", buffer: p.data }))
  );
  await expect(page.locator("#merge-section")).toBeVisible();
  await expect(page.locator("#merge-count-badge")).toHaveText(String(parts.length));

  // Sorted automatically by part number regardless of selection order.
  const names = await page.locator("#merge-list .part-name").allTextContents();
  expect(names).toEqual([...parts].map((p) => p.name).sort());

  return clickForDownload(page, page.locator("#merge-btn"));
}

/* -------------------------------------------------------------- tests */
test.describe("production bundle", () => {
  let problems;
  test.beforeEach(async ({ page }) => {
    problems = watchConsole(page);
    await page.goto("/");
    await expect(page.locator("#panel-split")).toBeVisible();
    await expect(page.locator("#host-notice")).toBeHidden();
  });
  test.afterEach(() => {
    expect(problems, "no console errors / failed requests").toEqual([]);
  });

  test("serves minified assets with cache-busted URLs", async ({ page }) => {
    const html = await page.content();
    expect(html).toMatch(/style\.css\?v=[0-9a-f]{10}/);
    expect(html).toMatch(/app\.js\?v=[0-9a-f]{10}/);
    expect(html).not.toContain("<!-- ");            // comments stripped
    const js = await (await page.request.get("/app.js")).text();
    expect(js.split("\n").length).toBeLessThan(5);    // single-line bundle
    expect(js).not.toContain("prepareParts");         // identifiers mangled
    expect(js).not.toContain("snapToLineBreak");
    expect(js).not.toContain("pages.dev");            // host list encoded
    const css = await (await page.request.get("/style.css")).text();
    expect(css).not.toContain("/*");
    expect(css.split("\n").length).toBeLessThan(5);
  });

  test("split binary by chunk size -> merge -> byte-identical", async ({ page }) => {
    const original = randomBytes(2.5 * 1024 * 1024 + 123); // 2.5 MB + odd tail
    const file = { name: "video.mp4", mimeType: "video/mp4", buffer: original };

    const parts = await splitAndDownloadAll(page, file, async (p) => {
      await p.locator("#custom-size").fill("1");
      await p.locator("#custom-unit").selectOption("MB");
      await expect(p.locator("#sum-parts")).toHaveText("3");
      await expect(p.locator("#sum-size")).toHaveText("1.00 MB");
    });

    expect(parts.map((p) => p.name)).toEqual(["video.mp4.part001", "video.mp4.part002", "video.mp4.part003"]);
    expect(parts[0].data.length).toBe(1024 * 1024);
    expect(parts[2].data.length).toBe(original.length - 2 * 1024 * 1024);
    expect(sha256(Buffer.concat(parts.map((p) => p.data)))).toBe(sha256(original));

    const merged = await mergeParts(page, parts);
    expect(merged.name).toBe("video.mp4");
    expect(merged.data.length).toBe(original.length);
    expect(sha256(merged.data)).toBe(sha256(original));
  });

  test("split by number of equal parts -> merge -> byte-identical", async ({ page }) => {
    const original = randomBytes(100_003); // not divisible by 5 - remainder spread
    const file = { name: "archive.zip", mimeType: "application/zip", buffer: original };

    const parts = await splitAndDownloadAll(page, file, async (p) => {
      await p.locator('input[name="split-mode"][value="count"]').check({ force: true });
      await p.locator('#count-presets .chip[data-n="5"]').click();
      await expect(p.locator("#sum-parts")).toHaveText("5");
    });

    expect(parts).toHaveLength(5);
    const sizes = parts.map((p) => p.data.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(original.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);

    const merged = await mergeParts(page, parts, { shuffle: false });
    expect(sha256(merged.data)).toBe(sha256(original));
  });

  test("text file: line-break mode keeps every part ending in \\n", async ({ page }) => {
    const lines = Array.from({ length: 4000 }, (_, i) => `line ${i} ${"x".repeat(20 + (i % 37))}`);
    const original = Buffer.from(lines.join("\n") + "\n", "utf8");
    const file = { name: "notes.txt", mimeType: "text/plain", buffer: original };

    const parts = await splitAndDownloadAll(page, file, async (p) => {
      await expect(p.locator("#linebreak-wrap")).toBeVisible(); // text detected
      await p.locator("#linebreak-wrap").click();               // input is visually hidden; click the label
      await expect(p.locator("#linebreak-check")).toBeChecked();
      await expect(p.locator("#split-warning")).toContainText("Line-break mode");
      await p.locator("#custom-size").fill("40");
      await p.locator("#custom-unit").selectOption("KB");
    });

    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.data[p.data.length - 1]).toBe(0x0a);
    const joined = Buffer.concat(parts.map((p) => p.data));
    expect(sha256(joined)).toBe(sha256(original));
    // Every part is a whole number of lines.
    for (const p of parts) expect(p.data.toString("utf8").split("\n").slice(0, -1).every((l) => l.startsWith("line "))).toBe(true);

    const merged = await mergeParts(page, parts);
    expect(sha256(merged.data)).toBe(sha256(original));
  });

  test("Download All fetches every pending part", async ({ page }) => {
    const original = randomBytes(300_000);
    await page.locator("#split-file-input").setInputFiles({ name: "a.bin", mimeType: "application/octet-stream", buffer: original });
    await page.locator("#custom-size").fill("100");
    await page.locator("#custom-unit").selectOption("KB");
    await page.locator("#split-btn").click();
    await expect(page.locator("#parts-list .part-item")).toHaveCount(3);

    const downloads = [];
    page.on("download", (d) => downloads.push(d));
    await page.locator("#download-all-btn").click();
    await expect(page.locator("#parts-progress-text")).toHaveText("3 / 3 downloaded", { timeout: 15_000 });
    expect(downloads).toHaveLength(3);
    const datas = await Promise.all(downloads.map(readDownload));
    expect(sha256(Buffer.concat(datas.map((d) => d.data)))).toBe(sha256(original));
  });

  test("merge validation: mixed files are blocked, gaps are warned", async ({ page }) => {
    await page.locator('[data-tab="merge"]').click();
    const mk = (name) => ({ name, mimeType: "application/octet-stream", buffer: Buffer.from("x") });

    await page.locator("#merge-file-input").setInputFiles([mk("a.bin.part001"), mk("b.bin.part002")]);
    await expect(page.locator("#merge-warning")).toHaveClass(/danger/);
    await expect(page.locator("#merge-btn")).toBeDisabled();

    await page.locator("#merge-reset-btn").click();
    await page.locator("#merge-file-input").setInputFiles([mk("a.bin.part001"), mk("a.bin.part003")]);
    await expect(page.locator("#merge-warning")).toContainText("part002");
    await expect(page.locator("#merge-btn")).toBeEnabled();

    // Non-part files are skipped with a toast, not an error.
    await page.locator("#merge-file-input").setInputFiles([mk("readme.txt")]);
    await expect(page.locator("#toast")).toContainText("Skipped 1 file");
  });

  test("reset clears state and returns to the drop zone", async ({ page }) => {
    await page.locator("#split-file-input").setInputFiles({ name: "r.bin", mimeType: "application/octet-stream", buffer: randomBytes(2048) });
    await page.locator("#custom-size").fill("1");
    await page.locator("#custom-unit").selectOption("KB");
    await page.locator("#split-btn").click();
    await expect(page.locator("#parts-section")).toBeVisible();
    await page.locator("#split-reset-btn").click();
    await expect(page.locator("#parts-section")).toBeHidden();
    await expect(page.locator("#split-dropzone")).toBeVisible();
    await expect(page.locator("#split-btn")).toBeEnabled();
  });
});

/* --------------------------------------------------------- host check */
test.describe("host check", () => {
  // Route any hostname to the local server so we can test the allow-list
  // without DNS. The page's window.location.hostname is the spoofed host.
  async function openAs(page, host) {
    const problems = watchConsole(page);
    await page.route(`http://${host}/**`, (route) => {
      const u = new URL(route.request().url());
      route.continue({ url: `http://localhost:4173${u.pathname}${u.search}` });
    });
    await page.goto(`http://${host}/`);
    await expect(page.locator("#panel-split")).toBeVisible();
    return problems;
  }

  for (const host of ["my-app.pages.dev", "filesplitter.onrender.com", "nitesh99390.github.io", "localhost:4173", "127.0.0.1:4173"]) {
    test(`allows ${host}`, async ({ page }) => {
      const problems = await openAs(page, host);
      await expect(page.locator("#host-notice")).toBeHidden();
      await expect(page.locator("#toast")).not.toHaveClass(/error/);
      await page.locator("#split-file-input").setInputFiles({ name: "ok.bin", mimeType: "application/octet-stream", buffer: randomBytes(4096) });
      await expect(page.locator("#split-btn")).toBeEnabled();
      expect(problems).toEqual([]);
    });
  }

  for (const host of ["evil-mirror.example.com", "pages.dev", "notgithub.io", "fakeonrender.com"]) {
    test(`locks ${host}`, async ({ page }) => {
      const problems = await openAs(page, host);
      await expect(page.locator("#host-notice")).toBeVisible();
      await expect(page.locator("#host-notice")).toContainText("not authorised");
      await expect(page.locator("#split-btn")).toBeDisabled();
      await expect(page.locator("#merge-btn")).toBeDisabled();
      // Loading a file must not re-enable anything.
      await page.locator("#split-file-input").setInputFiles({ name: "x.bin", mimeType: "application/octet-stream", buffer: randomBytes(4096) });
      await expect(page.locator("#split-btn")).toBeDisabled();
      await page.locator("#split-reset-btn").click();
      await expect(page.locator("#split-btn")).toBeDisabled();
      expect(problems).toEqual([]); // lock is graceful - no console errors
    });
  }
});
