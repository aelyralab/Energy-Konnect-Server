/**
 * Stage 4 — validate.
 *
 * Checks every structured payload against the *real* schemas the API enforces,
 * imported directly from src/utils/blockSchemas.js. Nothing here is a copy, so
 * the two cannot drift: if a block type or a field constraint changes in the
 * server, this stage starts failing on the next run.
 *
 * Runs offline. A payload that fails here would have been a 400 from the API,
 * found one HTTP round-trip and one half-created article later.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "../config.js";
import { blocksArraySchema } from "../../src/utils/blockSchemas.js";

/**
 * versionContentSchema minus categoryId and coverMediaId, which are uuids this
 * stage cannot know — they are resolved against the live taxonomy in stage 5,
 * where the full schema is applied before the POST.
 */
const metadataSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(400).optional(),
  summary: z.string().trim().max(2000).optional(),
  authorName: z.string().trim().min(1).max(200),
});

/** Blocks that pass the schema but are not worth publishing. */
function qualityWarnings(payload) {
  const warnings = [];
  const { blocks } = payload;

  if (!blocks.length) warnings.push("no blocks");
  const words = blocks
    .flatMap((block) => [
      block.content.text,
      block.content.expression,
      ...(block.content.items ?? []),
    ])
    .filter((value) => typeof value === "string")
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  if (blocks.length && words < 60) warnings.push(`only ${words} words of text`);

  if (!payload.categoryName) warnings.push("no category chosen");
  if (!payload.summary) warnings.push("no summary");
  if (payload.authorName === "Energy Konnect Editorial") warnings.push("no byline found");

  // A chunk boundary that the model re-emitted across shows up as adjacent
  // identical paragraphs.
  for (let i = 1; i < blocks.length; i += 1) {
    if (
      blocks[i].blockType === "paragraph" &&
      blocks[i - 1].blockType === "paragraph" &&
      blocks[i].content.text === blocks[i - 1].content.text
    ) {
      warnings.push(`duplicated paragraph at block ${i} (chunk overlap?)`);
      break;
    }
  }

  return warnings;
}

export function validatePayload(payload) {
  const errors = [];

  const metadata = metadataSchema.safeParse(payload);
  if (!metadata.success) {
    errors.push(
      ...metadata.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }

  const blocks = blocksArraySchema.safeParse(payload.blocks);
  if (!blocks.success) {
    errors.push(...blocks.error.issues.map((i) => `blocks.${i.path.join(".")}: ${i.message}`));
  }

  return { errors, warnings: qualityWarnings(payload) };
}

export default async function validateCommand({ only }) {
  const root = path.join(paths.manifestDir, "..", "structured");
  if (!fs.existsSync(root)) {
    console.error("Nothing structured yet — run `node ingest/run.js structure` first.");
    process.exitCode = 1;
    return;
  }

  let checked = 0;
  let failed = 0;
  let flagged = 0;

  for (const issueKey of fs.readdirSync(root)) {
    if (only && !issueKey.includes(only.toLowerCase())) continue;
    for (const file of fs.readdirSync(path.join(root, issueKey)).sort()) {
      const full = path.join(root, issueKey, file);
      const payload = JSON.parse(fs.readFileSync(full, "utf8"));
      const { errors, warnings } = validatePayload(payload);
      checked += 1;

      if (errors.length) {
        failed += 1;
        console.error(`  !! ${issueKey}/${file} "${payload.title.slice(0, 50)}"`);
        for (const error of errors) console.error(`       ERROR ${error}`);
      } else if (warnings.length || payload.notes?.length) {
        flagged += 1;
        console.log(`  ~~ ${issueKey}/${file} "${payload.title.slice(0, 50)}"`);
        for (const warning of [...warnings, ...(payload.notes ?? [])]) {
          console.log(`       - ${warning}`);
        }
      }
    }
  }

  console.log(
    `\n  ${checked} payloads: ${checked - failed - flagged} clean, ${flagged} flagged, ${failed} invalid`,
  );
  if (failed) {
    console.log(
      "  Invalid payloads would be rejected by the API. Re-run `structure --force --only <key>`.",
    );
    process.exitCode = 1;
  }
}
