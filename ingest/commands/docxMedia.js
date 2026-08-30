/**
 * DOCX stage 3 — docx-media.
 *
 * The one stage that resolves `image` blocks, and the only thing that writes
 * out/structured/<issueKey>/. Drafts carry `content.ref = "image12.jpeg"`;
 * blocksArraySchema demands `content.mediaId` be a uuid. This uploads each
 * referenced file through POST /api/media and swaps one for the other, so what
 * lands in structured/ is already schema-valid and commands/load.js — which is
 * unchanged — can consume it exactly as it consumes the PDF track's output.
 *
 * Only images actually referenced by a draft block are uploaded. The magazine's
 * hairline rules and spacer GIFs were already marked unusable at extract time,
 * and an image nobody references is not worth a row in the media library.
 *
 * Idempotent through the ledger, which is written after every single upload:
 * a crash on image 14 of 16 re-uploads nothing on the next run.
 */
import fs from "node:fs";
import path from "node:path";
import config, { paths } from "../config.js";
import { issueKeyFor } from "./extract.js";
import { listDocx } from "../lib/docx.js";
import * as api from "../lib/api.js";
import { load as openLedger } from "../lib/ledger.js";

/** Ledger key for one Word image, namespaced away from the issue's "pdf" entry. */
const mediaKey = (fileName) => `docx-image:${fileName}`;

function readDrafts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort()
    .map((name) => ({ name, payload: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) }));
}

/** Every distinct media filename an image block points at, in first-use order. */
function referencedImages(drafts) {
  const refs = [];
  for (const { payload } of drafts) {
    for (const block of payload.blocks) {
      if (block.blockType !== "image") continue;
      const ref = block.content?.ref;
      if (ref && !refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}

/**
 * A caption for an image, taken from the paragraph immediately after it — but
 * only when that paragraph is short enough to be a caption rather than prose.
 * Word carries no caption relationship, so this is the best available signal;
 * anything longer is left uncaptioned for an editor to fill in.
 */
const MAX_CAPTION = 160;

function captionFor(blocks, position) {
  const next = blocks[position + 1];
  if (next?.blockType !== "paragraph") return null;
  const text = next.content.text.trim();
  if (!text || text.length > MAX_CAPTION) return null;
  // A caption is a phrase in its own right, so it starts one. A paragraph
  // opening in lower case is the second half of the sentence the image was
  // anchored inside — captioning an image with "a complaint with the Grievance
  // Redressal Officer of the licensee and" is worse than leaving it bare.
  if (!/^[\p{Lu}\p{N}"“(]/u.test(text)) return null;
  if (/[.!?]$/.test(text) && text.split(/\s+/).length > 20) return null;
  return text;
}

export default async function docxMedia({ only, dry }) {
  const documents = listDocx(config.docxDir).filter(
    (file) => !only || issueKeyFor(file).includes(only.toLowerCase()),
  );

  if (!documents.length) {
    console.error(`No .docx matched under ${config.docxDir}`);
    process.exitCode = 1;
    return;
  }

  const ledger = openLedger();
  let authenticated = false;
  const problems = [];

  for (const source of documents) {
    const issueKey = issueKeyFor(source);
    const dir = paths.docx(issueKey);
    const drafts = readDrafts(path.join(dir, "draft"));

    if (!drafts.length) {
      console.log(`  -- ${issueKey}: no drafts, run docx-blocks first`);
      continue;
    }

    const incomplete = drafts.filter(
      ({ payload }) => !payload.categoryName?.trim() || !payload.authorName?.trim(),
    );
    if (incomplete.length) {
      for (const { name, payload } of incomplete) {
        problems.push(
          `${issueKey} ${name}: ${!payload.authorName?.trim() ? "authorName" : "categoryName"} is empty — load would reject it`,
        );
      }
      continue;
    }

    const refs = referencedImages(drafts);
    const mediaDir = path.join(dir, "media");
    const mediaIndex = new Map();

    for (const ref of refs) {
      const existing = ledger.media(issueKey, mediaKey(ref));
      if (existing) {
        mediaIndex.set(ref, existing);
        continue;
      }

      const filePath = path.join(mediaDir, ref);
      if (!fs.existsSync(filePath)) {
        problems.push(
          `${issueKey}: ${ref} is referenced but missing from media/ — re-run docx-extract`,
        );
        continue;
      }

      if (dry) {
        console.log(`  DRY upload ${ref} (${fs.statSync(filePath).size.toLocaleString()} bytes)`);
        mediaIndex.set(ref, `dry-run-${ref}`);
        continue;
      }

      if (!authenticated) {
        const user = await api.login();
        console.log(`  authenticated as ${user.email} (${user.role})`);
        authenticated = true;
      }

      const mimeType = ref.toLowerCase().endsWith(".png")
        ? "image/png"
        : ref.toLowerCase().endsWith(".gif")
          ? "image/gif"
          : ref.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";

      const asset = await api.uploadMedia(filePath, mimeType);
      ledger.recordMedia(issueKey, mediaKey(ref), asset.id);
      mediaIndex.set(ref, asset.id);
      console.log(`  ok uploaded ${ref} -> ${asset.id}`);
    }

    const outDir = paths.structured(issueKey);
    if (!dry) {
      fs.mkdirSync(outDir, { recursive: true });

      // Re-segmenting an issue changes how many payloads it has — the
      // amendment-bill issue went from one whole-issue payload to nine
      // per-article ones. structured/ is written by name, so the old files
      // would survive alongside the new and load would create an article from
      // each, silently duplicating the issue.
      const wanted = new Set(drafts.map(({ name }) => name));
      for (const name of fs.readdirSync(outDir)) {
        if (/^\d+\.json$/.test(name) && !wanted.has(name)) {
          fs.rmSync(path.join(outDir, name));
          console.log(`  -- ${issueKey}: dropped stale structured/${name}`);
        }
      }
    }

    for (const { name, payload } of drafts) {
      let dropped = 0;
      const blocks = payload.blocks
        .map((block, position) => {
          if (block.blockType !== "image") return block;
          const mediaId = mediaIndex.get(block.content.ref);
          if (!mediaId) {
            dropped += 1;
            return null;
          }
          const caption = block.content.caption ?? captionFor(payload.blocks, position);
          return {
            blockType: "image",
            content: {
              mediaId,
              ...(caption ? { caption, altText: caption.slice(0, 300) } : {}),
            },
          };
        })
        .filter(Boolean);

      const resolved = {
        ...payload,
        blocks,
        notes: [
          ...(payload.notes ?? []).filter((note) => !note.includes("before docx-media")),
          dropped ? `${dropped} image block(s) dropped — media could not be resolved` : null,
        ].filter(Boolean),
        resolvedAt: new Date().toISOString(),
      };

      if (dry) {
        console.log(`  DRY write structured/${issueKey}/${name} — ${blocks.length} blocks`);
        continue;
      }
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(resolved, null, 2), "utf8");
    }

    console.log(
      `  ${issueKey}: ${drafts.length} payload(s), ${refs.length} image(s) -> ${path.relative(config.here, outDir)}`,
    );
  }

  if (problems.length) {
    console.log(`\n  ${problems.length} problem(s):`);
    for (const problem of problems) console.log(`    - ${problem}`);
    process.exitCode = 1;
  }
}
