/**
 * DOCX reading, for the DOCX ingest track.
 *
 * A .docx is a zip of XML. Two things here justify the file:
 *
 * 1. **The zip reader.** `ingest/` deliberately carries no npm dependencies of
 *    its own, and Node has no built-in zip. The central directory format is
 *    small and stable, and the payloads are `deflate` or `store`, both of which
 *    `node:zlib` already handles — so reading one is ~50 lines rather than a
 *    dependency.
 *
 * 2. **The walker.** This is the whole reason the DOCX track exists.
 *    `pdftotext` gives lines of text and nothing else, so the PDF track had to
 *    pay a model to guess which lines were headings, which were list items, and
 *    where the tables were. Word already knows: `w:pStyle` says `Heading2`,
 *    `w:numPr` says list item, `w:tbl` says table, `w:drawing` says image. The
 *    walker reads those answers instead of inferring them.
 *
 * Everything here is deterministic and offline.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { imageSize } from "image-size";

// ---------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * Reads a zip archive into a Map of entry name -> Buffer.
 *
 * Parses the central directory rather than scanning local headers forward:
 * local headers may carry a zero compressed-size with the real value deferred
 * to a trailing data descriptor, which cannot be read without already knowing
 * where the entry ends. The central directory always has the true sizes.
 *
 * @param {string} filePath
 * @returns {Map<string, Buffer>}
 */
export function readZip(filePath) {
  const buffer = fs.readFileSync(filePath);

  // The end-of-central-directory record is last, but a trailing comment of up
  // to 64KB may follow it, so scan backwards for the signature.
  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0 && index > buffer.length - 65558; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${path.basename(filePath)} is not a zip archive`);

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);

  const files = new Map();
  for (let n = 0; n < entryCount; n += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt central directory at byte ${cursor}`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    // The local header's own name/extra lengths differ from the central copy's
    // (Word writes extra fields in one and not the other), so re-read them.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    if (!name.endsWith("/")) {
      files.set(name, method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data));
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body] ?? match;
  });
}

/**
 * A minimal pull parser. WordprocessingML is machine-generated, well-formed,
 * and free of CDATA, DTDs and processing instructions beyond the leading
 * declaration — so a tag/text tokenizer is sufficient and avoids a dependency.
 *
 * @param {string} xml
 * @param {(event: object) => void} onEvent
 */
export function parseXml(xml, onEvent) {
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) break;

    if (open > cursor) {
      const text = xml.slice(cursor, open);
      if (text) onEvent({ type: "text", text: decodeEntities(text) });
    }

    const close = xml.indexOf(">", open);
    if (close < 0) break;
    const raw = xml.slice(open + 1, close);
    cursor = close + 1;

    if (raw[0] === "?" || raw[0] === "!") continue;

    if (raw[0] === "/") {
      onEvent({ type: "close", name: raw.slice(1).trim() });
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameEnd = body.search(/\s/);
    const name = nameEnd < 0 ? body : body.slice(0, nameEnd);

    const attrs = {};
    if (nameEnd >= 0) {
      const attrPattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
      let match = attrPattern.exec(body);
      while (match !== null) {
        attrs[match[1]] = decodeEntities(match[2]);
        match = attrPattern.exec(body);
      }
    }

    onEvent({ type: "open", name, attrs, selfClosing });
    if (selfClosing) onEvent({ type: "close", name });
  }
}

// ---------------------------------------------------------------------------
// numbering
// ---------------------------------------------------------------------------

/**
 * Maps `numId` -> "ordered" | "unordered", by following numbering.xml's
 * indirection: `w:num[@w:numId]` -> `w:abstractNumId` -> the level-0
 * `w:numFmt` of that abstract definition.
 */
export function readNumbering(files) {
  const xml = files.get("word/numbering.xml");
  if (!xml) return new Map();
  const text = xml.toString("utf8");

  const formatByAbstract = new Map();
  for (const [, abstractId, body] of text.matchAll(
    /<w:abstractNum[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
  )) {
    // Level 0 only: nested levels alternate bullet/number for visual variety,
    // and the block schema has one `style` for the whole list anyway.
    const level = /<w:lvl[^>]*w:ilvl="0"[^>]*>([\s\S]*?)<\/w:lvl>/.exec(body);
    const format = /<w:numFmt[^>]*w:val="([^"]+)"/.exec(level?.[1] ?? body)?.[1] ?? "bullet";
    const style = format === "bullet" || format === "none" ? "unordered" : "ordered";
    formatByAbstract.set(abstractId, style);
  }

  const styleByNum = new Map();
  for (const [, numId, body] of text.matchAll(
    /<w:num[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g,
  )) {
    const abstractId = /<w:abstractNumId[^>]*w:val="(\d+)"/.exec(body)?.[1];
    styleByNum.set(numId, formatByAbstract.get(abstractId) ?? "unordered");
  }
  return styleByNum;
}

/** relationship id -> media filename, e.g. "rId7" -> "image3.png". */
export function readImageRels(files) {
  const xml = files.get("word/_rels/document.xml.rels");
  if (!xml) return new Map();
  const rels = new Map();
  for (const [, id, target] of xml
    .toString("utf8")
    .matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    if (target.includes("media/")) rels.set(id, path.basename(target));
  }
  return rels;
}

// ---------------------------------------------------------------------------
// the walker
// ---------------------------------------------------------------------------

const HEADING_STYLE = /^Heading(\d)$/;
const TOC_STYLE = /^TOC\d?$/;

/**
 * Walks `word/document.xml`'s body in document order and returns one element
 * per top-level `w:p` / `w:tbl`.
 *
 * Element shapes:
 *   { index, kind: "heading",   level, style, text, images: [] }
 *   { index, kind: "listItem",  numId, listStyle, style, text, images: [] }
 *   { index, kind: "paragraph", style, text, images: [] }
 *   { index, kind: "toc",       style, text, images: [] }
 *   { index, kind: "table",     rows: [[...]], text, images: [] }
 *
 * `images` are media filenames in the order they appear inside that element, so
 * an image's position in the prose survives into the block sequence.
 *
 * @returns {{elements: object[], imageRefs: Map<string, number>}}
 */
export function walkDocument(files) {
  const raw = files.get("word/document.xml");
  if (!raw) throw new Error("word/document.xml is missing — not a Word document");

  const numbering = readNumbering(files);
  const rels = readImageRels(files);

  const xml = raw.toString("utf8");
  const bodyStart = xml.indexOf("<w:body");
  const body = xml.slice(bodyStart < 0 ? 0 : bodyStart);

  const elements = [];
  const imageRefs = new Map();

  // Depth tracking: only a `w:p`/`w:tbl` at body level starts a new element. A
  // `w:p` nested inside a table cell, or inside a `w:txbxContent` text box,
  // belongs to whichever element is already open.
  let depth = 0;
  let current = null;
  let openDepth = 0;

  // Table accumulation. `w:tbl` can nest; only the outermost one is emitted.
  let table = null;
  let row = null;
  let cell = null;
  let tableDepth = 0;

  // Every floating picture and text box in this corpus is written as an
  // `mc:AlternateContent` pair: an `mc:Choice` holding a DrawingML `a:blip`,
  // and an `mc:Fallback` holding the VML `v:imagedata` equivalent of the same
  // thing. Reading both counts every image twice and, where the shape is a text
  // box, repeats its prose ("Billing complaint RedressalBilling complaint
  // Redressal"). Only the Choice branch is read; the Fallback is skipped whole.
  let fallbackDepth = 0;

  parseXml(body, (event) => {
    // Consume the whole Fallback subtree without touching `depth`, so the
    // element nesting either side of it stays balanced. A self-closing tag
    // arrives as open+close, which nets to zero here.
    if (fallbackDepth > 0) {
      if (event.type === "open") fallbackDepth += 1;
      else if (event.type === "close") fallbackDepth -= 1;
      return;
    }
    if (event.type === "open" && event.name === "mc:Fallback" && !event.selfClosing) {
      fallbackDepth = 1;
      return;
    }

    if (event.type === "text") {
      // Text counts only inside a `w:t`. `w:instrText` (field codes) and the
      // whitespace between tags must not leak into the prose.
      if (cell?.inText) cell.text += event.text;
      else if (current?.inText) current.text += event.text;
      return;
    }

    if (event.type === "open") {
      depth += 1;

      switch (event.name) {
        case "w:tbl":
          tableDepth += 1;
          if (tableDepth === 1) {
            table = { index: elements.length, kind: "table", rows: [], text: "", images: [] };
          }
          return;

        case "w:tr":
          if (tableDepth === 1) row = [];
          return;

        case "w:tc":
          if (tableDepth === 1) cell = { text: "", inText: false };
          return;

        case "w:p":
          if (tableDepth > 0) return; // cell paragraphs feed the open cell
          if (current) return; // a text-box paragraph inside an open one
          current = { index: elements.length, kind: "paragraph", style: "", text: "", images: [] };
          openDepth = depth;
          return;

        case "w:pStyle":
          if (current && !current.style) current.style = event.attrs["w:val"] ?? "";
          return;

        case "w:numId":
          if (current && current.numId === undefined) current.numId = event.attrs["w:val"] ?? null;
          return;

        case "w:t":
          if (cell) cell.inText = true;
          else if (current) current.inText = true;
          return;

        case "a:blip":
        case "v:imagedata": {
          const id = event.attrs["r:embed"] ?? event.attrs["r:id"] ?? event.attrs["r:link"];
          const name = id ? rels.get(id) : null;
          if (!name) return;
          imageRefs.set(name, (imageRefs.get(name) ?? 0) + 1);
          if (current) current.images.push(name);
          else if (table) table.images.push(name);
          return;
        }

        default:
          return;
      }
    }

    // close
    switch (event.name) {
      case "w:t":
        if (cell) cell.inText = false;
        else if (current) current.inText = false;
        break;

      case "w:tc":
        if (tableDepth === 1 && row) {
          row.push(cell?.text.replace(/\s+/g, " ").trim() ?? "");
          cell = null;
        }
        break;

      case "w:tr":
        if (tableDepth === 1 && row) {
          table.rows.push(row);
          row = null;
        }
        break;

      case "w:tbl":
        if (tableDepth === 1 && table) {
          table.text = table.rows.map((cells) => cells.join(" | ")).join("\n");
          elements.push(table);
          table = null;
        }
        tableDepth = Math.max(0, tableDepth - 1);
        break;

      case "w:p":
        if (current && depth === openDepth) {
          elements.push(finishParagraph(current, numbering));
          current = null;
        }
        break;

      default:
        break;
    }

    depth -= 1;
  });

  return { elements, imageRefs };
}

function finishParagraph(element, numbering) {
  const text = element.text
    .replace(/[\t\r\n]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();

  const heading = HEADING_STYLE.exec(element.style);
  const kind = heading
    ? "heading"
    : TOC_STYLE.test(element.style)
      ? "toc"
      : element.numId
        ? "listItem"
        : "paragraph";

  const finished = {
    index: element.index,
    kind,
    style: element.style,
    text,
    images: element.images,
  };
  if (heading) finished.level = Number(heading[1]);
  if (kind === "listItem") {
    finished.numId = element.numId;
    finished.listStyle = numbering.get(element.numId) ?? "unordered";
  }
  return finished;
}

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

const MIME_BY_EXTENSION = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Inventories `word/media/*`, measuring each with `image-size` — the same
 * library the media service uses to record width/height, so a dimension read
 * here matches what the upload will store.
 *
 * `usable` is false for page furniture (hairlines, spacers) and for anything
 * the API would refuse: the EMF/WMF vector rules Word emits, and files over the
 * media service's 10MB image cap.
 */
export function inventoryMedia(files, { minBytes, minEdge, maxBytes = 10 * 1024 * 1024 }) {
  const media = [];
  for (const [name, buffer] of files) {
    if (!name.startsWith("word/media/")) continue;
    const fileName = path.basename(name);
    const mimeType = MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? null;

    let width = null;
    let height = null;
    if (mimeType) {
      try {
        const measured = imageSize(buffer);
        width = measured.width ?? null;
        height = measured.height ?? null;
      } catch {
        // A dimension we cannot read is not fatal — byte size still filters.
      }
    }

    const reasons = [];
    if (!mimeType) reasons.push(`unsupported type ${path.extname(fileName) || "(none)"}`);
    if (buffer.length < minBytes) reasons.push(`${buffer.length} bytes`);
    if (buffer.length > maxBytes) {
      reasons.push(`${(buffer.length / 1048576).toFixed(1)}MB exceeds the API cap`);
    }
    if (width !== null && height !== null && (width < minEdge || height < minEdge)) {
      reasons.push(`${width}x${height}`);
    }

    media.push({
      fileName,
      mimeType,
      bytes: buffer.length,
      width,
      height,
      usable: reasons.length === 0,
      skipReason: reasons.join(", ") || null,
      buffer,
    });
  }
  return media.sort((a, b) => a.fileName.localeCompare(b.fileName, "en", { numeric: true }));
}

/** Every .docx under a directory tree, sorted. Mirrors lib/pdftext.js's listPdfs. */
export function listDocx(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // "~$..." is Word's lock file for an open document, not a document.
      else if (entry.name.toLowerCase().endsWith(".docx") && !entry.name.startsWith("~$")) {
        found.push(full);
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return found.sort();
}
