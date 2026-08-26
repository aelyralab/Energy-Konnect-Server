/**
 * Stage 3's model call — page text in, content blocks out.
 *
 * This is the only step that cannot be done deterministically. The magazine is
 * a two-column print layout: pdftotext's reading-order pass gets prose order
 * right but destroys tables, and its -layout pass keeps tables aligned but
 * interleaves marginal pull-quotes into the middle of body paragraphs. Both
 * renderings are sent, and the model reconciles them into the ten block types
 * the API accepts.
 *
 * Output is constrained by a strict tool schema, so `input` is guaranteed to
 * match the shape below. That is *not* the same as matching the server's zod
 * schemas, which is why stage 4 re-validates everything against the real
 * src/utils/blockSchemas.js before anything is sent to the API.
 */
import Anthropic from "@anthropic-ai/sdk";
import config from "../config.js";

/**
 * Media blocks (`image`, `figure`) are deliberately excluded: both require a
 * `mediaId` pointing at an already-uploaded asset, and figure extraction is a
 * separate pass. The model is told to describe figures it sees in a `callout`
 * instead, so the placement survives for the image pass to use later.
 */
const BLOCK_SCHEMA = {
  type: "object",
  properties: {
    blockType: {
      type: "string",
      enum: ["heading", "paragraph", "quote", "callout", "table", "list", "formula", "reference"],
    },
    content: {
      type: "object",
      properties: {
        level: { type: "integer", enum: [2, 3, 4] },
        text: { type: "string" },
        attribution: { type: "string" },
        title: { type: "string" },
        caption: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
        style: { type: "string", enum: ["ordered", "unordered"] },
        items: { type: "array", items: { type: "string" } },
        expression: { type: "string" },
        note: { type: "string" },
        references: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, url: { type: "string" } },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  required: ["blockType", "content"],
  additionalProperties: false,
};

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    summary: { type: "string" },
    authorName: { type: "string" },
    categoryName: { type: "string" },
    blocks: { type: "array", items: BLOCK_SCHEMA },
    notes: { type: "string" },
  },
  required: ["blocks"],
  additionalProperties: false,
};

const SYSTEM = `You convert pages of the Energy Konnect magazine (an Indian power-sector publication) into structured content blocks for a CMS.

You are given two renderings of the same pages, produced by pdftotext:
- READING ORDER: correct prose sequence across the two-column layout, but tables are flattened into unusable runs of words.
- VISUAL LAYOUT: columns and tables preserved in place, but marginal pull-quotes, bylines and captions are interleaved into the middle of body paragraphs.

Use READING ORDER for prose. Use VISUAL LAYOUT for anything tabular, and to tell which text is a pull-quote rather than body copy.

Rules:
- Reproduce the article's text faithfully. Do not summarise, rewrite, shorten, or improve it. Do not invent content. Fixing an obvious OCR-style artefact ("ﬁ" for "fi", a word split across a line break) is expected; changing the author's wording is not.
- Drop running furniture: the masthead, "ENERGY KONNECT, JUNE 2020", the section label repeated at the top of each page, and page numbers.
- A short passage set in the margin in VISUAL LAYOUT, repeating or emphasising a sentence from the body, is a pull-quote: emit it as a "quote" block at the point it appears, and do not duplicate it inside the surrounding paragraph.
- Emit a "table" block for real tabular data. Every row must have exactly as many cells as there are columns; pad short rows with empty strings rather than dropping them.
- Numbered or bulleted runs become a "list" block, not a series of paragraphs.
- Footnotes, citations and "Source:" lines become a "reference" block, with one entry per source. Put them at the end.
- Figures, charts and photographs cannot be represented yet. Where one appears, emit a "callout" block whose title is "Figure" and whose text is the figure's caption (or a one-line description of what it shows). It marks the spot for a later image pass.
- Headings inside the article use level 2, sub-headings level 3. Never emit level 1 — the article title is not a block.
- Do not emit empty blocks. Every text field must be non-empty.

On the FIRST chunk of an article, also return:
- title: the article's real headline as printed on the page. A title is supplied from the table of contents, but it is often truncated or mis-wrapped — prefer what the page itself shows.
- authorName: the credited byline if one is printed. If none is printed, use "Energy Konnect Editorial".
- summary: 2-3 sentences, your own words, describing what the article covers.
- categoryName: exactly one value from the supplied category list, whichever fits best.
- subtitle: only if the page prints a genuine standfirst or deck. Omit otherwise.

On LATER chunks, return blocks only, and continue mid-thought from where the previous chunk ended — do not re-emit its closing blocks and do not repeat the article title.

Use "notes" to flag anything a human should look at: an unreadable page, a table you could not reconstruct, text that appears to belong to a different article.`;

let client = null;
function getClient() {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set — stage 3 needs it. See ingest/README.md.");
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 4 });
  }
  return client;
}

/** The reference block's wire shape is `{ items: [...] }`; the tool calls it `references` to avoid colliding with the list block's `items`. */
function normalizeBlock(block) {
  if (block.blockType !== "reference") return block;
  const { references, ...rest } = block.content;
  return { blockType: "reference", content: { ...rest, items: references ?? [] } };
}

/**
 * @param {object} params
 * @param {{flow: string, layout: string}[]} params.pages  one entry per page in this chunk
 * @param {boolean} params.isFirst      whether to ask for article-level metadata
 * @param {string[]} params.categories  allowed category names
 * @param {object[]} params.tail        the previous chunk's last blocks, for continuity
 */
export async function structureChunk({ pages, isFirst, tocTitle, categories, tail, pageRange }) {
  const rendered = pages
    .map(
      (page, index) =>
        `### PAGE ${pageRange.start + index}\n\n--- READING ORDER ---\n${page.flow}\n\n--- VISUAL LAYOUT ---\n${config.sendLayout ? page.layout : "(omitted)"}`,
    )
    .join("\n\n");

  const preamble = isFirst
    ? `This is the FIRST chunk of an article. The table of contents lists it as: "${tocTitle}".\nAllowed categories: ${categories.join(", ")}.`
    : `This is a LATER chunk of the article "${tocTitle}". The previous chunk ended with these blocks:\n${JSON.stringify(tail, null, 2)}\n\nContinue from there. Do not repeat them.`;

  const response = await getClient().messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: config.effort },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "emit_article" },
    tools: [
      {
        name: "emit_article",
        description: "Return the structured content blocks for this chunk of the article.",
        strict: true,
        input_schema: RESULT_SCHEMA,
      },
    ],
    messages: [{ role: "user", content: `${preamble}\n\n${rendered}` }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`model declined this chunk (${response.stop_details?.category ?? "unknown"})`);
  }

  const call = response.content.find((block) => block.type === "tool_use");
  if (!call) throw new Error(`no tool call in response (stop_reason: ${response.stop_reason})`);

  const result = call.input;
  return {
    ...result,
    blocks: (result.blocks ?? []).map(normalizeBlock),
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

export { RESULT_SCHEMA, SYSTEM };
