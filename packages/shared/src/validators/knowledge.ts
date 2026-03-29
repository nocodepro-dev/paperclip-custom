import { z } from "zod";

export const knowledgeCollectionSourceTypeSchema = z.enum(["local_path", "github", "url"]);
export const knowledgeCollectionStatusSchema = z.enum(["active", "stale", "unreachable"]);
export const knowledgeEntryKindSchema = z.enum([
  "document",
  "design_system",
  "schema",
  "screenshot",
  "flow",
  "brief",
  "sop",
  "asset",
  "other",
]);

export const knowledgeCollectionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  sourceType: knowledgeCollectionSourceTypeSchema,
  sourcePath: z.string().min(1),
  autoDiscover: z.boolean(),
  lastScannedAt: z.coerce.date().nullable(),
  entryCount: z.number().int().nonnegative(),
  totalBytes: z.number().nonnegative(),
  status: knowledgeCollectionStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const knowledgeEntrySchema = z.object({
  id: z.string().uuid(),
  collectionId: z.string().uuid(),
  companyId: z.string().uuid(),
  relativePath: z.string().min(1),
  name: z.string().min(1),
  kind: knowledgeEntryKindSchema,
  contentType: z.string().min(1),
  byteSize: z.number().nonnegative(),
  sha256: z.string().nullable(),
  summary: z.string().nullable(),
  lastVerifiedAt: z.coerce.date().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createKnowledgeCollectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  sourceType: knowledgeCollectionSourceTypeSchema.optional().default("local_path"),
  sourcePath: z.string().min(1),
  projectId: z.string().uuid().nullable().optional(),
  autoDiscover: z.boolean().optional().default(true),
});

export const updateKnowledgeCollectionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  autoDiscover: z.boolean().optional(),
  status: knowledgeCollectionStatusSchema.optional(),
});

export const updateKnowledgeEntrySchema = z.object({
  name: z.string().min(1).optional(),
  kind: knowledgeEntryKindSchema.optional(),
  summary: z.string().nullable().optional(),
});

export type CreateKnowledgeCollection = z.infer<typeof createKnowledgeCollectionSchema>;
export type UpdateKnowledgeCollection = z.infer<typeof updateKnowledgeCollectionSchema>;
export type UpdateKnowledgeEntry = z.infer<typeof updateKnowledgeEntrySchema>;
