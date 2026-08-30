import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import * as magazinesService from "./magazines.service.js";

function serializeMagazine(magazine) {
  return {
    id: magazine.id,
    slug: magazine.slug,
    volume: magazine.volumeNumber,
    issue: magazine.issueNumber,
    title: magazine.title,
    period: magazine.period,
    theme: magazine.theme,
    description: magazine.description,
    status: magazine.status,
    coverImage: magazine.cover?.url ?? null,
    pdfUrl: magazine.pdf?.url ?? null,
    editorial: {
      title: magazine.editorialTitle,
      author: magazine.editorialAuthor,
      authorImage: magazine.editorialAuthorImage?.url ?? null,
      summary: magazine.editorialSummary,
      // Plain JSONB, not a table — no persisted id, unlike an article's
      // ArticleContentBlock rows. Synthesize one from array position so the
      // shape still matches the shared ApiBlock type the block editor uses.
      body: (magazine.editorialBody ?? []).map((block, index) => ({
        id: String(index),
        order: index,
        type: block.blockType,
        data: block.content,
      })),
    },
    // The list query only loads `_count` (no `articles` include, to avoid
    // fetching every join row just to call `.length`); the detail query
    // loads both, so `_count` is preferred but `articles.length` still
    // covers any caller that only has the array.
    articleCount: magazine._count?.articles ?? magazine.articles?.length ?? 0,
    articles: (magazine.articles ?? []).map((entry) => ({
      articleId: entry.articleId,
      slug: entry.article.slug,
      title: entry.article.title,
      status: entry.article.status,
      sectionLabel: entry.sectionLabel,
      displayOrder: entry.displayOrder,
    })),
    publishedAt: magazine.publishedAt,
    createdAt: magazine.createdAt,
    updatedAt: magazine.updatedAt,
  };
}

/** GET /api/admin/magazines */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await magazinesService.listAll(req.query);
  return sendPaginated(res, items.map(serializeMagazine), { page, limit, total });
});

/** GET /api/admin/magazines/:id */
export const getOne = asyncHandler(async (req, res) => {
  const magazine = await magazinesService.getById(req.params.id);
  return sendData(res, serializeMagazine(magazine));
});

/** POST /api/admin/magazines */
export const create = asyncHandler(async (req, res) => {
  const magazine = await magazinesService.create(req.body);
  return sendCreated(res, serializeMagazine(magazine));
});

/** PUT /api/admin/magazines/:id */
export const update = asyncHandler(async (req, res) => {
  const magazine = await magazinesService.update(req.params.id, req.body);
  return sendData(res, serializeMagazine(magazine));
});

/** DELETE /api/admin/magazines/:id */
export const remove = asyncHandler(async (req, res) => {
  await magazinesService.remove(req.params.id);
  return sendNoContent(res);
});

/** POST /api/admin/magazines/:id/articles */
export const attachArticle = asyncHandler(async (req, res) => {
  const magazine = await magazinesService.attachArticle(req.params.id, req.body);
  return sendCreated(res, serializeMagazine(magazine));
});

/** PATCH /api/admin/magazines/:id/articles/reorder */
export const reorderArticles = asyncHandler(async (req, res) => {
  const magazine = await magazinesService.reorderArticles(req.params.id, req.body.articles);
  return sendData(res, serializeMagazine(magazine));
});

/** DELETE /api/admin/magazines/:id/articles/:articleId */
export const detachArticle = asyncHandler(async (req, res) => {
  await magazinesService.detachArticle(req.params.id, req.params.articleId);
  return sendNoContent(res);
});

/** POST /api/admin/magazines/:id/publish */
export const publish = asyncHandler(async (req, res) => {
  const magazine = await magazinesService.publish(req.params.id);
  return sendData(res, serializeMagazine(magazine));
});

/** POST /api/admin/magazines/:id/archive */
export const archive = asyncHandler(async (req, res) => {
  const magazine = await magazinesService.archive(req.params.id);
  return sendData(res, serializeMagazine(magazine));
});
