import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { documentChunks, documents, events, evidenceRecords, scoreSnapshots } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

/**
 * Resolve an evidence reference to its source.
 *
 * The id may be an evidence record, a document chunk, an event or a score
 * snapshot — the chat cites whatever the tool returned, and this endpoint makes
 * every citation clickable.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [record] = await db.select().from(evidenceRecords).where(eq(evidenceRecords.id, id)).limit(1);
  if (record) return ok({ kind: "evidence_record", record }, await buildMeta({ asOf: record.asOf }));

  const [chunk] = await db
    .select({
      chunkId: documentChunks.id,
      pageFrom: documentChunks.pageFrom,
      pageTo: documentChunks.pageTo,
      content: documentChunks.content,
      documentId: documents.id,
      title: documents.title,
      documentType: documents.documentType,
      url: documents.url,
      publishedAt: documents.publishedAt,
      rightsStatus: documents.rightsStatus,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(eq(documentChunks.id, id))
    .limit(1);
  if (chunk) {
    return ok(
      {
        kind: "document_chunk",
        ...chunk,
        content: chunk.rightsStatus === "full_text" ? chunk.content : null,
        contentWithheldReason:
          chunk.rightsStatus === "full_text" ? null : "This source's rights permit metadata only.",
      },
      await buildMeta({ asOf: chunk.publishedAt }),
    );
  }

  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (event) return ok({ kind: "event", event }, await buildMeta({ asOf: event.publishedAt }));

  const [snapshot] = await db.select().from(scoreSnapshots).where(eq(scoreSnapshots.id, id)).limit(1);
  if (snapshot) {
    return ok(
      { kind: "score_snapshot", snapshot },
      await buildMeta({ asOf: snapshot.asOf, modelVersion: snapshot.modelVersion }),
    );
  }

  return fail("NOT_FOUND", "No evidence record, document chunk, event or snapshot with that id.");
}
