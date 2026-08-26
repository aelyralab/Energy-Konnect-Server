import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import * as issuesService from "./issues.service.js";

function serializeIssue(issue) {
  return {
    id: issue.id,
    slug: issue.slug,
    volume: issue.volumeNumber,
    issue: issue.issueNumber,
    title: issue.title,
    period: issue.period,
    theme: issue.theme,
    description: issue.description,
    status: issue.status,
    coverImage: issue.cover?.url ?? null,
    pdfUrl: issue.pdf?.url ?? null,
    articles: (issue.articles ?? []).map((entry) => ({
      articleId: entry.articleId,
      slug: entry.article.slug,
      title: entry.article.title,
      status: entry.article.status,
      sectionLabel: entry.sectionLabel,
      displayOrder: entry.displayOrder,
    })),
    publishedAt: issue.publishedAt,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

/** GET /api/admin/issues */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await issuesService.listAll(req.query);
  return sendPaginated(res, items.map(serializeIssue), { page, limit, total });
});

/** GET /api/admin/issues/:id */
export const getOne = asyncHandler(async (req, res) => {
  const issue = await issuesService.getById(req.params.id);
  return sendData(res, serializeIssue(issue));
});

/** POST /api/admin/issues */
export const create = asyncHandler(async (req, res) => {
  const issue = await issuesService.create(req.body);
  return sendCreated(res, serializeIssue(issue));
});

/** PUT /api/admin/issues/:id */
export const update = asyncHandler(async (req, res) => {
  const issue = await issuesService.update(req.params.id, req.body);
  return sendData(res, serializeIssue(issue));
});

/** DELETE /api/admin/issues/:id */
export const remove = asyncHandler(async (req, res) => {
  await issuesService.remove(req.params.id);
  return sendNoContent(res);
});

/** POST /api/admin/issues/:id/articles */
export const attachArticle = asyncHandler(async (req, res) => {
  const issue = await issuesService.attachArticle(req.params.id, req.body);
  return sendCreated(res, serializeIssue(issue));
});

/** PATCH /api/admin/issues/:id/articles/reorder */
export const reorderArticles = asyncHandler(async (req, res) => {
  const issue = await issuesService.reorderArticles(req.params.id, req.body.articles);
  return sendData(res, serializeIssue(issue));
});

/** DELETE /api/admin/issues/:id/articles/:articleId */
export const detachArticle = asyncHandler(async (req, res) => {
  await issuesService.detachArticle(req.params.id, req.params.articleId);
  return sendNoContent(res);
});

/** POST /api/admin/issues/:id/publish */
export const publish = asyncHandler(async (req, res) => {
  const issue = await issuesService.publish(req.params.id);
  return sendData(res, serializeIssue(issue));
});

/** POST /api/admin/issues/:id/archive */
export const archive = asyncHandler(async (req, res) => {
  const issue = await issuesService.archive(req.params.id);
  return sendData(res, serializeIssue(issue));
});
