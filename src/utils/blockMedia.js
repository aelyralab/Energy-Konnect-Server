/**
 * Image and figure blocks persist only a `mediaId` — the asset's URL lives in
 * MediaAsset, and blocks have no FK Prisma could join through (the payload is
 * opaque JSONB by design, §15). Without this, a client reading an article gets
 * an id it has no public endpoint to resolve, so in-body images cannot render.
 *
 * Resolves every referenced asset in one query and injects `url` alongside the
 * existing `mediaId`, leaving the stored shape untouched.
 */
import prisma from "../config/db.js";

export async function attachBlockMediaUrls(blocks, db = prisma) {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks ?? [];

  const ids = [...new Set(blocks.map((block) => block?.content?.mediaId).filter(Boolean))];
  if (ids.length === 0) return blocks;

  const assets = await db.mediaAsset.findMany({
    where: { id: { in: ids } },
    select: { id: true, url: true },
  });
  const urlById = new Map(assets.map((asset) => [asset.id, asset.url]));

  return blocks.map((block) =>
    block?.content?.mediaId
      ? { ...block, content: { ...block.content, url: urlById.get(block.content.mediaId) ?? null } }
      : block,
  );
}

/** Same resolution for the pending/published version pair the owner views return. */
export async function attachVersionMediaUrls(version, db = prisma) {
  if (!version?.blocks) return version;
  return { ...version, blocks: await attachBlockMediaUrls(version.blocks, db) };
}
