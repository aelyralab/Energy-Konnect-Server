/**
 * Comments survive their author's deactivation (context doc §24, rule 23) —
 * the row is never deleted, but a deactivated author's identity is hidden
 * from the response rather than shown alongside content they can no longer
 * speak for. The client renders `author: null` as "Deleted User".
 */
export function serializeComment(comment) {
  return {
    id: comment.id,
    articleId: comment.articleId,
    content: comment.content,
    author: comment.user.isActive ? { id: comment.user.id, name: comment.user.name } : null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}
