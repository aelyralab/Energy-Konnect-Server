/**
 * Where the corpus stands, per issue and in total. Read-only: touches no API,
 * spends nothing, and is safe to run at any point.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { load as openLedger } from "../lib/ledger.js";
import { planPath } from "./split.js";

const exists = (target) => fs.existsSync(target);
const count = (dir) =>
  exists(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0;

/** How many articles the PDF track has cut and planned for this issue. */
function splitCount(issueKey) {
  const file = planPath(issueKey);
  if (!exists(file)) return 0;
  return JSON.parse(fs.readFileSync(file, "utf8")).articles.length;
}

export default async function status() {
  const rawRoot = path.join(paths.manifestDir, "..", "raw");
  if (!exists(rawRoot)) {
    console.log("  nothing extracted yet — start with `node ingest/run.js extract`");
    return;
  }

  const ledger = openLedger();
  const rows = [];
  const totals = { pages: 0, planned: 0, structured: 0, split: 0, loaded: 0, review: 0 };

  for (const issueKey of fs.readdirSync(rawRoot).sort()) {
    const manifestFile = paths.manifest(issueKey);
    const manifest = exists(manifestFile)
      ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
      : null;
    const planned = manifest ? manifest.articles.filter((a) => !a.skip).length : 0;
    const structured = count(paths.structured(issueKey));
    const split = splitCount(issueKey);
    const loaded = Object.keys(ledger.issue(issueKey)?.articles ?? {}).length;

    totals.pages += manifest?.pageCount ?? 0;
    totals.planned += planned;
    totals.structured += structured;
    totals.split += split;
    totals.loaded += loaded;
    if (manifest?.confidence === "review") totals.review += 1;

    rows.push({
      issueKey,
      vol: manifest ? `${manifest.volumeNumber ?? "?"}.${manifest.issueNumber ?? "?"}` : "-",
      pages: manifest?.pageCount ?? "-",
      planned,
      structured,
      split,
      loaded,
      flag: !manifest ? "no manifest" : manifest.confidence === "review" ? "review" : "",
    });
  }

  const width = Math.max(...rows.map((row) => row.issueKey.length));
  console.log(
    `  ${"issue".padEnd(width)}  ${"vol.iss".padEnd(8)} ${"pages".padStart(5)} ${"plan".padStart(5)} ${"struct".padStart(6)} ${"split".padStart(5)} ${"loaded".padStart(6)}`,
  );
  for (const row of rows) {
    console.log(
      `  ${row.issueKey.padEnd(width)}  ${row.vol.padEnd(8)} ${String(row.pages).padStart(5)} ${String(row.planned).padStart(5)} ${String(row.structured).padStart(6)} ${String(row.split).padStart(5)} ${String(row.loaded).padStart(6)}  ${row.flag}`,
    );
  }

  console.log(
    `\n  ${rows.length} issues · ${totals.pages} pages · ${totals.planned} contents entries · ` +
      `${totals.structured} structured as blocks · ${totals.split} cut as PDFs · ${totals.loaded} loaded`,
  );
  if (totals.review) console.log(`  ${totals.review} manifest(s) still marked "review"`);
}
