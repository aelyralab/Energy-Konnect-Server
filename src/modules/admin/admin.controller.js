import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import {
  serializeOwnerArticleSummary,
  serializeOwnerArticleDetail,
} from "../../utils/serializers/articleOwner.serializer.js";
import { serializeReviewAction } from "../../utils/serializers/reviewAction.serializer.js";
import * as adminService from "./admin.service.js";

/** The owner-detail shape plus who actually owns it — admin, unlike a
 * publisher viewing their own list, needs to see that. */
function serializeAdminArticleSummary(article) {
  return { ...serializeOwnerArticleSummary(article), publisher: article.publisher };
}

function serializeVersionSummary(version) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    title: version.title,
    createdAt: version.createdAt,
    submittedAt: version.submittedAt,
    approvedAt: version.approvedAt,
    rejectedAt: version.rejectedAt,
  };
}

/** GET /api/admin/reviews */
export const listReviewQueue = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await adminService.listReviewQueue(req.query);
  return sendPaginated(
    res,
    items.map((article) => ({
      ...serializeAdminArticleSummary(article),
      submittedAt: article.pendingVersion?.submittedAt ?? null,
      pendingVersionNumber: article.pendingVersion?.versionNumber ?? null,
    })),
    { page, limit, total },
  );
});

/** GET /api/admin/articles */
export const listArticles = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await adminService.listArticles(req.query);
  return sendPaginated(res, items.map(serializeAdminArticleSummary), { page, limit, total });
});

/** GET /api/admin/articles/:id */
export const getArticle = asyncHandler(async (req, res) => {
  const article = await adminService.getArticle(req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/admin/articles?publish=true|false */
export const createArticle = asyncHandler(async (req, res) => {
  const article = await adminService.createArticle(req.user.id, req.body, {
    publish: req.query.publish ?? false,
  });
  return sendCreated(res, serializeOwnerArticleDetail(article));
});

/** PUT /api/admin/articles/:id */
export const updateArticle = asyncHandler(async (req, res) => {
  const article = await adminService.updateArticle(req.user.id, req.params.id, req.body);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/admin/articles/:id/approve */
export const approve = asyncHandler(async (req, res) => {
  const article = await adminService.approve(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/admin/articles/:id/reject */
export const reject = asyncHandler(async (req, res) => {
  const article = await adminService.reject(req.user.id, req.params.id, req.body.reason);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/admin/articles/:id/publish */
export const publish = asyncHandler(async (req, res) => {
  const article = await adminService.publishDirect(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** PUT /api/admin/articles/:id/published-content (edit-and-republish, §31) */
export const editPublished = asyncHandler(async (req, res) => {
  const article = await adminService.editPublished(req.user.id, req.params.id, req.body);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/admin/articles/:id/unpublish */
export const unpublish = asyncHandler(async (req, res) => {
  const article = await adminService.unpublish(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/admin/articles/:id/archive */
export const archive = asyncHandler(async (req, res) => {
  const article = await adminService.archive(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** DELETE /api/admin/articles/:id */
export const remove = asyncHandler(async (req, res) => {
  await adminService.remove(req.user.id, req.params.id);
  return sendNoContent(res);
});

/** GET /api/admin/articles/:id/versions */
export const listVersions = asyncHandler(async (req, res) => {
  const versions = await adminService.listVersions(req.params.id);
  return sendData(res, versions.map(serializeVersionSummary));
});

/** GET /api/admin/articles/:id/versions/:versionId */
export const getVersion = asyncHandler(async (req, res) => {
  const version = await adminService.getVersion(req.params.id, req.params.versionId);
  return sendData(res, {
    ...serializeVersionSummary(version),
    subtitle: version.subtitle,
    summary: version.summary,
    author: { name: version.authorName, bio: version.authorBio },
    categoryId: version.categoryId,
    blocks: version.blocks.map((block) => ({
      id: block.id,
      type: block.blockType,
      order: block.blockOrder,
      data: block.content,
    })),
  });
});

/** GET /api/admin/articles/:id/history */
export const getHistory = asyncHandler(async (req, res) => {
  const actions = await adminService.history(req.params.id);
  return sendData(res, actions.map(serializeReviewAction));
});
