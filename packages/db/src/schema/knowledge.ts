import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const knowledgeCollections = pgTable(
  "knowledge_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").references(() => projects.id),
    name: text("name").notNull(),
    description: text("description"),
    sourceType: text("source_type").notNull().default("local_path"),
    sourcePath: text("source_path").notNull(),
    autoDiscover: boolean("auto_discover").notNull().default(true),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    entryCount: integer("entry_count").notNull().default(0),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySourcePathUniqueIdx: uniqueIndex("knowledge_collections_company_source_path_idx").on(
      table.companyId,
      table.sourcePath,
    ),
    companyProjectIdx: index("knowledge_collections_company_project_idx").on(
      table.companyId,
      table.projectId,
    ),
  }),
);

export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    relativePath: text("relative_path").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("other"),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    summary: text("summary"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    collectionRelativePathUniqueIdx: uniqueIndex("knowledge_entries_collection_path_idx").on(
      table.collectionId,
      table.relativePath,
    ),
    companyKindIdx: index("knowledge_entries_company_kind_idx").on(table.companyId, table.kind),
    collectionIdx: index("knowledge_entries_collection_idx").on(table.collectionId),
  }),
);
