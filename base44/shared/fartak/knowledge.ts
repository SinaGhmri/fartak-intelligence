// Lightweight retrieval over the KnowledgeEntry entity.
// pgvector is not available on this platform, so retrieval is keyword-scored
// over chunked KB entries. The KB is small and curated, so this is the
// documented equivalent of RAG here; swap for vector search later if needed.

export async function retrieveKnowledge(base44, query, maxEntries = 8) {
  const entries = await base44.asServiceRole.entities.KnowledgeEntry.list("-created_date", 100);
  if (!entries || entries.length === 0) return "";

  const q = (query || "").toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);

  const scored = entries.map((e) => {
    const text = (
      (e.title || "") +
      " " +
      (e.content || "") +
      " " +
      (e.tags || []).join(" ")
    ).toLowerCase();
    let score = 0;
    if (terms.length) {
      for (const term of terms) {
        if (text.includes(term)) score += 1;
      }
    } else {
      score = 1; // no query → return a representative slice
    }
    return { e, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const withScore = q ? scored.filter((s) => s.score > 0) : scored;
  const chosen = (withScore.length ? withScore : scored).slice(0, maxEntries);

  return chosen
    .map((s) => {
      const tag = s.e.is_placeholder
        ? " (PLACEHOLDER — no verified content yet; do not present as a real company fact)"
        : "";
      return `[${(s.e.category || "").toUpperCase()}] ${s.e.title}${tag}\n${s.e.content || ""}`;
    })
    .join("\n\n");
}

export async function listByCategory(base44, category, limit = 20) {
  const entries = await base44.asServiceRole.entities.KnowledgeEntry.filter(
    { category },
    "-created_date",
    limit
  );
  return entries || [];
}

export async function getByRefId(base44, refId) {
  const entries = await base44.asServiceRole.entities.KnowledgeEntry.filter(
    { ref_id: refId },
    "-created_date",
    1
  );
  return entries && entries[0] ? entries[0] : null;
}