import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { wrapUntrusted } from "./guardrails";

/**
 * Retrieval over permitted documents.
 *
 * Two hard constraints:
 *   - Chunks from documents whose rights do not permit text retention have no
 *     stored content; only their metadata is returned.
 *   - Retrieved text is wrapped as untrusted data before it reaches the model.
 */

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  pageFrom: number | null;
  pageTo: number | null;
  publishedAt: Date | null;
  rightsStatus: string;
  content: string | null;
  similarity: number;
};

export async function embed(text: string): Promise<number[] | null> {
  const env = serverEnv();
  if (env.LLM_PROVIDER === "none" || !env.LLM_API_KEY || !env.LLM_EMBEDDING_MODEL) return null;

  if (env.LLM_PROVIDER === "openai") {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({ model: env.LLM_EMBEDDING_MODEL, input: text }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data[0]?.embedding ?? null;
  }

  if (env.LLM_PROVIDER === "anthropic") {
    // Anthropic has no first-party embedding endpoint; use a separate embedding
    // provider or fall back to lexical search below.
    return null;
  }
  return null;
}

/** Vector search when embeddings are configured, lexical fallback when not. */
export async function search(
  query: string,
  opts: { issuerId?: string; limit?: number } = {},
): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 8;
  const vector = await embed(query);

  if (vector) {
    const literal = `[${vector.join(",")}]`;
    const rows = await db.execute<Record<string, unknown>>(sql`
      select
        c.id::text          as chunk_id,
        d.id::text          as document_id,
        d.title             as document_title,
        d.document_type     as document_type,
        c.page_from, c.page_to, d.published_at, d.rights_status,
        case when d.rights_status = 'full_text' then c.content else null end as content,
        1 - (c.embedding <=> ${literal}::vector) as similarity
      from document_chunks c
      join documents d on d.id = c.document_id
      where c.embedding is not null
        ${opts.issuerId ? sql`and d.issuer_id = ${opts.issuerId}::uuid` : sql``}
        and d.rights_status <> 'restricted'
      order by c.embedding <=> ${literal}::vector
      limit ${limit}
    `);
    return (rows as unknown as Record<string, unknown>[]).map(toChunk);
  }

  // Lexical fallback — trigram similarity on stored content.
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      c.id::text      as chunk_id,
      d.id::text      as document_id,
      d.title         as document_title,
      d.document_type as document_type,
      c.page_from, c.page_to, d.published_at, d.rights_status,
      case when d.rights_status = 'full_text' then c.content else null end as content,
      similarity(coalesce(c.content, d.title), ${query}) as similarity
    from document_chunks c
    join documents d on d.id = c.document_id
    where d.rights_status <> 'restricted'
      ${opts.issuerId ? sql`and d.issuer_id = ${opts.issuerId}::uuid` : sql``}
      and similarity(coalesce(c.content, d.title), ${query}) > 0.05
    order by similarity desc
    limit ${limit}
  `);
  return (rows as unknown as Record<string, unknown>[]).map(toChunk);
}

function toChunk(r: Record<string, unknown>): RetrievedChunk {
  return {
    chunkId: String(r.chunk_id),
    documentId: String(r.document_id),
    documentTitle: String(r.document_title),
    documentType: String(r.document_type),
    pageFrom: r.page_from === null ? null : Number(r.page_from),
    pageTo: r.page_to === null ? null : Number(r.page_to),
    publishedAt: r.published_at ? new Date(String(r.published_at)) : null,
    rightsStatus: String(r.rights_status),
    content: r.content === null || r.content === undefined ? null : String(r.content),
    similarity: Number(r.similarity ?? 0),
  };
}

/** Render retrieved chunks for the prompt, wrapped as untrusted data. */
export function renderForPrompt(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "<retrieved>No matching documents.</retrieved>";
  return chunks
    .map((c) => {
      const header = `${c.documentTitle} (${c.documentType}${
        c.pageFrom ? `, p.${c.pageFrom}${c.pageTo && c.pageTo !== c.pageFrom ? `–${c.pageTo}` : ""}` : ""
      }) [ev:${c.chunkId}]`;
      const body =
        c.content ??
        "[Text not stored — this source's rights permit metadata only. Cite the document, not its text.]";
      return wrapUntrusted(`${header}\n${body}`, c.documentId);
    })
    .join("\n\n");
}
