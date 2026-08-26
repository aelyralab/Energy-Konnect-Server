/**
 * PDF text extraction via poppler's pdftotext.
 *
 * Two renderings are produced per PDF:
 *   - "flow"   (pdftotext default) — reading-order heuristics; correct prose
 *              order across a two-column magazine layout.
 *   - "layout" (pdftotext -layout)  — preserves visual columns; the only
 *              rendering in which tabular data stays aligned, but it
 *              interleaves marginal pull-quotes into body text.
 *
 * Neither is good enough alone, which is why lib/structure.js sends both.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";

const CANDIDATES = [
  config.pdftotextBin,
  "pdftotext",
  "C:/Program Files/Git/mingw64/bin/pdftotext.exe",
  "C:/Program Files/Git/usr/bin/pdftotext.exe",
  "C:/Program Files (x86)/Git/mingw64/bin/pdftotext.exe",
  "/mingw64/bin/pdftotext.exe",
  "/usr/bin/pdftotext",
].filter(Boolean);

let resolved = null;

/**
 * `-v` prints the banner and then exits **99** on Xpdf's pdftotext (poppler's
 * exits 0). Probing by exit code would reject a perfectly good binary, so the
 * test is whether the banner appeared at all.
 */
function probe(candidate) {
  try {
    const out = execFileSync(candidate, ["-v"], { stdio: "pipe", encoding: "utf8" });
    return /pdftotext/i.test(out ?? "");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    return /pdftotext/i.test(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

export function pdftotextBin() {
  if (resolved) return resolved;
  for (const candidate of CANDIDATES) {
    if (probe(candidate)) {
      resolved = candidate;
      return resolved;
    }
  }
  throw new Error(
    `pdftotext not found. Install poppler-utils, or set PDFTOTEXT_BIN to its full path.\nTried:\n  ${CANDIDATES.join("\n  ")}`,
  );
}

function run(args) {
  return execFileSync(pdftotextBin(), args, {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    encoding: "utf8",
  });
}

/**
 * pdftotext emits a form feed at the end of every page, so one invocation
 * yields every page — far cheaper than 50 per-page invocations.
 * @returns {string[]} one entry per page, 0-indexed (page N is `[N - 1]`)
 */
function extract(pdfPath, extraArgs) {
  const text = run(["-enc", "UTF-8", "-nopgbrk", ...extraArgs, pdfPath, "-"]);
  return text.split("\f");
}

export function extractBoth(pdfPath) {
  // -nopgbrk suppresses the form feed, so split on it only when present.
  const flowRaw = run(["-enc", "UTF-8", pdfPath, "-"]).split("\f");
  const layoutRaw = run(["-enc", "UTF-8", "-layout", pdfPath, "-"]).split("\f");

  // The trailing form feed leaves an empty final element — drop it, but only
  // if it really is empty (a PDF whose last page has no text layer would
  // otherwise lose a real, blank page from the count).
  const trim = (pages) => (pages.at(-1)?.trim() === "" ? pages.slice(0, -1) : pages);
  const flow = trim(flowRaw);
  const layout = trim(layoutRaw);

  if (flow.length !== layout.length) {
    throw new Error(
      `Page count mismatch for ${path.basename(pdfPath)}: flow=${flow.length} layout=${layout.length}`,
    );
  }
  return { flow, layout, pageCount: flow.length };
}

export { extract };

/** True when the PDF has no usable text layer and would need OCR. */
export function needsOcr(pages) {
  const chars = pages.join("").replace(/\s/g, "").length;
  return chars / Math.max(pages.length, 1) < 100;
}

export function listPdfs(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listPdfs(full));
    else if (entry.name.toLowerCase().endsWith(".pdf")) found.push(full);
  }
  return found.sort();
}
