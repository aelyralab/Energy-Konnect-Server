#!/usr/bin/env node
/**
 * Ingest CLI.
 *
 *   node ingest/run.js extract   [--only <substring>]
 *   node ingest/run.js segment   [--only <substring>] [--force]
 *   node ingest/run.js structure [--only <substring>] [--force] [--dry]
 *   node ingest/run.js validate  [--only <substring>]
 *   node ingest/run.js load      [--only <substring>] [--dry]
 *   node ingest/run.js status
 *
 *   node ingest/run.js split    [--only <substring>] [--force] [--dry]
 *   node ingest/run.js pdf-load [--only <substring>] [--dry] [--resync]
 *
 *   node ingest/run.js publish  [--only <substring>] [--dry]
 *
 *   node ingest/run.js docx-extract [--only <substring>] [--force]
 *   node ingest/run.js docx-blocks  [--only <substring>] [--force]
 *   node ingest/run.js docx-media   [--only <substring>] [--dry]
 *   node ingest/run.js docx-load    [--only <substring>] [--dry]
 *   node ingest/run.js resync      [--only <substring>] [--dry]
 *
 * Stages are independent and re-runnable. Run them in order the first time;
 * afterwards, re-run only the stage you changed.
 */
const COMMANDS = {
  extract: () => import("./commands/extract.js"),
  segment: () => import("./commands/segment.js"),
  structure: () => import("./commands/structure.js"),
  validate: () => import("./commands/validate.js"),
  load: () => import("./commands/load.js"),
  status: () => import("./commands/status.js"),

  // The PDF track. Same manifests, same issues, same ledger — but an article
  // keeps its printed layout instead of being rebuilt as blocks. See README.md.
  split: () => import("./commands/split.js"),
  "pdf-load": () => import("./commands/pdfLoad.js"),

  // Takes everything the ledger recorded from DRAFT to public. Either track.
  publish: () => import("./commands/publish.js"),

  // The DOCX track. Same manifests, same ledger, same validate/load — only the
  // source format and the structuring stage differ. See README.md.
  "docx-extract": () => import("./commands/docxExtract.js"),
  "docx-blocks": () => import("./commands/docxBlocks.js"),
  "docx-media": () => import("./commands/docxMedia.js"),
  "docx-load": () => import("./commands/docxLoad.js"),

  // Lands a fix on articles load already created. See commands/resync.js.
  resync: () => import("./commands/resync.js"),
};

function parseArgs(argv) {
  const options = { only: null, force: false, dry: false, resync: false, rescan: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--only") options.only = argv[(index += 1)];
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry" || arg === "--dry-run") options.dry = true;
    else if (arg === "--resync") options.resync = true;
    else if (arg === "--rescan") options.rescan = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

const [command, ...rest] = process.argv.slice(2);

if (!command || !COMMANDS[command]) {
  console.error(`Usage: node ingest/run.js <${Object.keys(COMMANDS).join("|")}> [options]`);
  process.exit(1);
}

try {
  const options = parseArgs(rest);
  const module = await COMMANDS[command]();
  console.log(`\n== ${command} ==`);
  await module.default(options);
} catch (error) {
  console.error(`\n${command} failed: ${error.message}`);
  if (process.env.INGEST_DEBUG) console.error(error);
  process.exit(1);
}
