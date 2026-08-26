export function serializeReviewAction(action) {
  return {
    id: action.id,
    action: action.action,
    reason: action.reason,
    versionNumber: action.version?.versionNumber ?? null,
    actor: action.actor
      ? { id: action.actor.id, name: action.actor.name, role: action.actor.role }
      : null,
    createdAt: action.createdAt,
  };
}
