import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { companySkills } from "./company_skills.js";
import { goals } from "./goals.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const pipelineTemplates = pgTable(
  "pipeline_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("pipeline_templates_company_status_idx").on(table.companyId, table.status),
  }),
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    pipelineTemplateId: uuid("pipeline_template_id").notNull().references(() => pipelineTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    stageOrder: integer("stage_order").notNull(),
    parallelGroup: text("parallel_group"),
    loopConfig: jsonb("loop_config").$type<{ sourceStageId: string; fieldPath: string } | null>(),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    requiredCapability: text("required_capability"),
    priority: text("priority").notNull().default("medium"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    timeoutMinutes: integer("timeout_minutes"),
    suggestedSkillId: uuid("suggested_skill_id").references(() => companySkills.id, { onDelete: "set null" }),
    stageConfig: jsonb("stage_config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyTemplateOrderIdx: index("pipeline_stages_company_template_order_idx").on(
      table.companyId,
      table.pipelineTemplateId,
      table.stageOrder,
    ),
  }),
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    pipelineTemplateId: uuid("pipeline_template_id").notNull().references(() => pipelineTemplates.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("pending"),
    parentIssueId: uuid("parent_issue_id").references(() => issues.id, { onDelete: "set null" }),
    launchedByAgentId: uuid("launched_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    launchedByUserId: text("launched_by_user_id"),
    inputPayload: jsonb("input_payload").$type<Record<string, unknown>>(),
    outputSummary: jsonb("output_summary").$type<Record<string, unknown>>(),
    currentStageOrder: integer("current_stage_order"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("pipeline_runs_company_status_idx").on(table.companyId, table.status),
    companyTemplateIdx: index("pipeline_runs_company_template_idx").on(table.companyId, table.pipelineTemplateId),
  }),
);

export const pipelineStageRuns = pgTable(
  "pipeline_stage_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    pipelineRunId: uuid("pipeline_run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
    pipelineStageId: uuid("pipeline_stage_id").notNull().references(() => pipelineStages.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    loopIndex: integer("loop_index"),
    inputContext: jsonb("input_context").$type<Record<string, unknown>>(),
    outputContext: jsonb("output_context").$type<Record<string, unknown>>(),
    resolvedAgentId: uuid("resolved_agent_id").references(() => agents.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRunStageIdx: index("pipeline_stage_runs_company_run_stage_idx").on(
      table.companyId,
      table.pipelineRunId,
      table.pipelineStageId,
    ),
    issueIdx: index("pipeline_stage_runs_issue_idx").on(table.issueId),
  }),
);
