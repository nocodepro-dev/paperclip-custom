import { z } from "zod";
import { SOP_STATUSES, SOP_SOURCE_TYPES, SOP_ASSET_KINDS } from "../constants.js";

export const createSopSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  sourceType: z.enum(SOP_SOURCE_TYPES).optional().default("upload"),
  sourcePath: z.string().nullable().optional(),
  markdownBody: z.string().min(1),
  hasScreenshots: z.boolean().optional().default(false),
  screenshotCount: z.number().int().nonnegative().optional().default(0),
});
export type CreateSop = z.infer<typeof createSopSchema>;

export const updateSopSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: z.enum(SOP_STATUSES).optional(),
  markdownBody: z.string().min(1).optional(),
});
export type UpdateSop = z.infer<typeof updateSopSchema>;

export const sopAssetKindSchema = z.enum(SOP_ASSET_KINDS);
