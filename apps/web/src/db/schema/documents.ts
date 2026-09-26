import { relations } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { provenance, rowMeta, vector } from "./_shared";
import { issuers } from "./issuers";
import { sources } from "./sources";

/* ===========================================================================
   Documents and their retrievable chunks. Rights status is stored per document
   because news publishers differ — metadata-only is the default, full text is
   opt-in per source.
   =========================================================================== */

export const documents = pgTable(
  "documents",
  {
    ...rowMeta,
    ...provenance,

    sourceIdRef: text("source_id_ref").references(() => sources.sourceId),
    issuerId: uuid("issuer_id").references(() => issuers.id),

    /** annual_report | quarterly_report | psi | agm_notice | dividend_notice |
     *  regulatory_order | circular | press_release | news_article | prospectus */
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    storageKey: text("storage_key"),
    contentHash: text("content_hash"),
    contentType: text("content_type"),
    language: text("language"), // en | bn | mixed
    pageCount: integer("page_count"),

    periodEnd: date("period_end"),

    /** full_text | metadata_only | restricted — enforced at retrieval time. */
    rightsStatus: text("rights_status").notNull().default("metadata_only"),

    /** text_layer | table_extraction | ocr | mixed | failed */
    extractionMethod: text("extraction_method"),
    extractionState: text("extraction_state").notNull().default("pending"),
    extractionError: text("extraction_error"),
  },
  (t) => [
    index("documents_issuer_idx").on(t.issuerId, t.publishedAt),
    index("documents_type_idx").on(t.documentType),
    index("documents_state_idx").on(t.extractionState),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    ...rowMeta,
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    /** Null when rights do not permit storing text — metadata still retrievable. */
    content: text("content"),
    pageFrom: integer("page_from"),
    pageTo: integer("page_to"),
    section: text("section"),
    tokenCount: integer("token_count"),
    embedding: vector("embedding", { dim: 1536 }),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_chunks_doc_idx").on(t.documentId, t.chunkIndex),
    // HNSW index for cosine similarity retrieval.
    index("document_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/* ===========================================================================
   Evidence records. Every claim in a report resolves to one of these — either
   a document reference or a stored computation. This is what makes "no score
   without its evidence" enforceable.
   =========================================================================== */

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    ...rowMeta,
    /** document | computation | market_observation | external_link */
    kind: text("kind").notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    chunkId: uuid("chunk_id").references(() => documentChunks.id),
    /** For computations: the table + row that holds the number. */
    computationRef: jsonb("computation_ref").$type<{
      table: string;
      rowId: string;
      formulaVersion?: string;
    }>(),
    summary: text("summary").notNull(),
    pageRef: text("page_ref"),
    asOf: timestamp("as_of", { withTimezone: true }),
    sourceAuthority: text("source_authority"),
  },
  (t) => [index("evidence_kind_idx").on(t.kind), index("evidence_doc_idx").on(t.documentId)],
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  issuer: one(issuers, { fields: [documents.issuerId], references: [issuers.id] }),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, { fields: [documentChunks.documentId], references: [documents.id] }),
}));
