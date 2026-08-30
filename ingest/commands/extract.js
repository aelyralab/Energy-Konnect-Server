/**
 * Stage 1 — extract.
 *
 * PDF in, plain text out. Deterministic, free, and re-runnable: nothing here
 * calls a model or the API, so it is safe to run repeatedly while tuning the
 * later stages.
 *
 * Writes out/raw/<issueKey>/{flow,layout}/page-NNN.txt plus a _meta.json.
 *
 * Pages are written *verbatim*. Running furniture is detected here and recorded
 * in _meta.json, but it is stripped later, in memory, at structure time — the
 * masthead ("ENERGY KONNECT / Volume II Issue 20") and the printed folios are
 * furniture by every statistical measure, and they are also exactly the signals
 * segmentation reads. Stripping on disk blinds stage 2 to the issue's own
 * volume number.
 */
import fs from "node:fs";
import path from "node:path";
import config, { paths } from "../config.js";
import { extractBoth, listPdfs, needsOcr } from "../lib/pdftext.js";
import { detectFurniture } from "../lib/clean.js";

/**
 * A stable, filesystem-safe key for an issue, derived from its source path.
 *
 * Extension-agnostic on purpose: the DOCX track keeps its sources in a tree
 * that mirrors this one's volume folders, so `Volume 1/V1 foo.docx` and
 * `Volume 1/V1 foo.pdf` produce the same key — and therefore share one
 * manifest, one ledger entry and one structured/ directory.
 */
export function issueKeyFor(sourcePath) {
  const volume = path.basename(path.dirname(sourcePath));
  const file = path.basename(sourcePath, path.extname(sourcePath));
  return `${volume}--${file}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const pad = (n) => String(n).padStart(3, "0");

export default async function extract({ only }) {
  const pdfs = listPdfs(config.papersDir).filter(
    (pdf) => !only || issueKeyFor(pdf).includes(only.toLowerCase()),
  );

  if (!pdfs.length) {
    console.error(`No PDFs matched under ${config.papersDir}`);
    process.exitCode = 1;
    return;
  }

  for (const pdfPath of pdfs) {
    const issueKey = issueKeyFor(pdfPath);
    const dir = paths.raw(issueKey);
    fs.mkdirSync(path.join(dir, "flow"), { recursive: true });
    fs.mkdirSync(path.join(dir, "layout"), { recursive: true });

    const { flow, layout, pageCount } = extractBoth(pdfPath);

    if (needsOcr(flow)) {
      console.warn(`  !! ${issueKey}: no usable text layer — this issue needs OCR, skipping`);
      continue;
    }

    flow.forEach((page, index) => {
      fs.writeFileSync(path.join(dir, "flow", `page-${pad(index + 1)}.txt`), page, "utf8");
    });
    layout.forEach((page, index) => {
      fs.writeFileSync(path.join(dir, "layout", `page-${pad(index + 1)}.txt`), page, "utf8");
    });

    // Detected once here, over the whole issue, and reused by stage 3.
    const furniture = detectFurniture(flow);

    const meta = {
      issueKey,
      sourcePath: pdfPath,
      fileName: path.basename(pdfPath),
      volumeFolder: path.basename(path.dirname(pdfPath)),
      fileSize: fs.statSync(pdfPath).size,
      pageCount,
      furniture: [...furniture],
      extractedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify(meta, null, 2), "utf8");

    const words = flow.join(" ").split(/\s+/).filter(Boolean).length;
    console.log(
      `  ok ${issueKey}  ${pageCount} pages  ~${words.toLocaleString()} words  ${furniture.size} furniture lines identified`,
    );
  }
}
