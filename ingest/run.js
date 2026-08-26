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
};

function parseArgs(argv) {
  const options = { only: null, force: false, dry: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--only") options.only = argv[(index += 1)];
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry" || arg === "--dry-run") options.dry = true;
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
