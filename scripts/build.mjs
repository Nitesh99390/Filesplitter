#!/usr/bin/env node
/**
 * Production build for File Splitter & Merger.
 *
 *   src/index.html  -> index.html   (minified, cache-busted asset URLs)
 *   src/style.css   -> style.css    (clean-css, level 2)
 *   src/app.js      -> app.js       (terser -> javascript-obfuscator)
 *
 * The output is written to the repository root so the site can be served
 * as-is by GitHub Pages, Cloudflare Pages or Render without a build step.
 * Run `npm run build` after editing anything in src/.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { minify as minifyJs } from "terser";
import CleanCSS from "clean-css";
import { minify as minifyHtml } from "html-minifier-terser";
import JavaScriptObfuscator from "javascript-obfuscator";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");
const OUT = resolve(ROOT, process.env.OUT_DIR || ".");

const read = (p) => readFile(p, "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 10);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
const gz = (s) => `${(gzipSync(Buffer.from(s)).length / 1024).toFixed(1)} KB gz`;
const report = (label, before, after) => {
  const pct = Math.round((1 - Buffer.byteLength(after) / Buffer.byteLength(before)) * 100);
  const delta = pct >= 0 ? `${pct}% smaller` : `${-pct}% larger (obfuscation)`;
  console.log(`  ${label.padEnd(10)} ${kb(before).padStart(9)} -> ${kb(after).padStart(9)}  [${gz(after)}]  ${delta}`);
};

/* ------------------------------------------------------------------ JS */
async function buildJs(source) {
  // 1. Safe compression + mangling. `ecma: 2020` matches the source level;
  //    `passes: 2` squeezes a little more without any unsafe transforms.
  const terserOut = await minifyJs(source, {
    ecma: 2020,
    module: false,
    toplevel: true,
    compress: {
      passes: 2,
      pure_getters: "strict",
      drop_debugger: true,
      // console.error is kept so genuine runtime failures stay diagnosable.
      pure_funcs: ["console.log", "console.debug", "console.info"]
    },
    mangle: { toplevel: true },
    format: { comments: false, ascii_only: false }
  });
  if (terserOut.error) throw terserOut.error;

  // 2. Obfuscation. Settings are deliberately moderate: base64 string-array
  //    with rotation/shuffling and identifier renaming. Debug-protection,
  //    self-defending and control-flow-flattening are OFF on purpose - they
  //    hurt performance on low-end phones and can break DevTools, which is
  //    bad for a memory-sensitive File-API app. This is readability
  //    protection against casual visitors, not DRM.
  const obf = JavaScriptObfuscator.obfuscate(terserOut.code, {
    target: "browser",
    compact: true,
    simplify: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.9,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayIndexShift: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersType: "function",
    stringArrayWrappersChainedCalls: true,
    // splitStrings / numbersToExpressions roughly double the bundle for
    // little extra protection, so they stay off to keep first load fast.
    splitStrings: false,
    transformObjectKeys: true,
    numbersToExpressions: false,
    unicodeEscapeSequence: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    selfDefending: false,
    disableConsoleOutput: false,
    log: false,
    seed: 20261020,          // reproducible output for identical input
    sourceMap: false
  });
  return obf.getObfuscatedCode();
}

/* ----------------------------------------------------------------- CSS */
function buildCss(source) {
  const out = new CleanCSS({
    level: {
      1: { specialComments: 0 },
      2: { restructureRules: true, mergeSemantically: true }
    },
    compatibility: "*"
  }).minify(source);
  if (out.errors.length) throw new Error(out.errors.join("\n"));
  for (const w of out.warnings) console.warn("  [clean-css]", w);
  return out.styles;
}

/* ---------------------------------------------------------------- HTML */
async function buildHtml(source, { cssHash, jsHash }) {
  const withBust = source
    .replace(/href="style\.css"/, `href="style.css?v=${cssHash}"`)
    .replace(/src="app\.js"/, `src="app.js?v=${jsHash}" defer`);
  return minifyHtml(withBust, {
    collapseWhitespace: true,
    conservativeCollapse: false,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    removeEmptyAttributes: true,
    useShortDoctype: true,
    collapseBooleanAttributes: true,
    sortAttributes: true,
    sortClassName: true,
    minifyCSS: true,
    minifyJS: true,
    decodeEntities: true,
    keepClosingSlash: false
  });
}

/* ---------------------------------------------------------------- main */
async function main() {
  console.log(`\nBuilding File Splitter & Merger\n  src: ${SRC}\n  out: ${OUT}\n`);
  await mkdir(OUT, { recursive: true });

  const [htmlSrc, cssSrc, jsSrc] = await Promise.all([
    read(resolve(SRC, "index.html")),
    read(resolve(SRC, "style.css")),
    read(resolve(SRC, "app.js"))
  ]);

  const [css, js] = await Promise.all([buildCss(cssSrc), buildJs(jsSrc)]);
  const html = await buildHtml(htmlSrc, { cssHash: hash(css), jsHash: hash(js) });

  await Promise.all([
    writeFile(resolve(OUT, "style.css"), css),
    writeFile(resolve(OUT, "app.js"), js),
    writeFile(resolve(OUT, "index.html"), html)
  ]);

  report("index.html", htmlSrc, html);
  report("style.css", cssSrc, css);
  report("app.js", jsSrc, js);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("\nBuild failed:", err);
  process.exit(1);
});
