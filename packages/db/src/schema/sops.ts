import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySkills } from "./company_skills.js";
import { assets } from "./assets.js";

export const companySops = pgTable(
  "company_sops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    sourceType: text("source_type").notNull().default("upload"),
    sourcePath: text("source_path"),
    markdownBody: text("markdown_body").notNull(),
    hasScreenshots: boolean("has_screenshots").notNull().default(false),
    screenshotCount: integer("screenshot_count").notNull().default(0),
    status: text("status").notNull().default("draft"),
    generatedSkillId: uuid("generated_skill_id").references(() => companySkills.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCategoryIdx: index("company_sops_company_category_idx").on(
      table.companyId,
      table.category,
    ),
    companyStatusIdx: index("company_sops_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);

export const sopAssets = pgTable(
  "sop_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sopId: uuid("sop_id")
      .notNull()
      .references(() => companySops.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    assetId: uuid("asset_id").references(() => assets.id),
    localPath: text("local_path"),
    relativePath: text("relative_path").notNull(),
    kind: text("kind").notNull().default("screenshot"),
    stepNumber: integer("step_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sopIdx: index("sop_assets_sop_idx").on(table.sopId),
  }),
);
