// Lightweight retrieval over the KnowledgeEntry table.
// Keyword-scored retrieval — deliberately simple and portable (no pgvector
// dependency). Swap for vector search later without touching the agent.

import { listKnowledge, listKnowledgeByCategory, getKnowledgeByRefId, toKnowledgeCard } from "./storage";

export type KnowledgeRecord = Awaited<ReturnType<typeof listKnowledge>>[number];

export async function retrieveKnowledge(query: string, maxEntries = 8): Promise<string> {
  const entries = await listKnowledge(100);
  if (!entries.length) return "";

  const q = (query || "").toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);

  const scored = entries.map((e) => {
    const text = `${e.title} ${e.content} ${(e.tags || []).join(" ")}`.toLowerCase();
    let score = 0;
    if (terms.length) {
      for (const term of terms) if (text.includes(term)) score += 1;
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
      const tag = s.e.isPlaceholder
        ? " (PLACEHOLDER — no verified content yet; do not present as a real company fact)"
        : "";
      return `[${(s.e.category || "").toUpperCase()}] ${s.e.title}${tag}\n${s.e.content || ""}`;
    })
    .join("\n\n");
}

export async function listByCategory(category: string, limit = 20) {
  const entries = await listKnowledgeByCategory(category, limit);
  return entries;
}

export async function getByRefId(refId: string) {
  return getKnowledgeByRefId(refId);
}

export { toKnowledgeCard };