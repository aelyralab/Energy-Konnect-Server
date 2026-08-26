/** Shared shape for categories and topics — same columns, same public surface. */
export function serializeTaxonomyTerm(term) {
  return {
    id: term.id,
    name: term.name,
    slug: term.slug,
    description: term.description ?? null,
    isActive: term.isActive,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

/** Tags carry no description/isActive — a narrower shape, not a partial one. */
export function serializeTag(tag) {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    createdAt: tag.createdAt,
  };
}
