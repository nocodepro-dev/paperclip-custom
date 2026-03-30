# Plan: Pipelines as a First-Class Concept in Paperclip

## Context

Paperclip currently has no concept of sequential task dependencies or assembly-line workflows. Agents get tasks individually, execute them, and report back — but there's no way to define "Stage A finishes → Stage B starts with A's output."

This matters because real AI-agent companies run **production pipelines** — not just isolated tasks. George's film production company example (from the Fluttercube n8n-builder project) has 9 stages where a script flows through writer → director → DP → prompt engineer → video generator → QA, each agent adding their layer.

**Goal:** Add pipelines so an orchestrator agent (or a human) can define a reusable sequence of stages, launch runs against it, and have stages auto-advance through the assembly line — creating issues, passing outputs forward, and waking agents as each stage completes.

**Key design decision:** Pipeline stages create issues. This reuses all existing infrastructure (heartbeats, work products, approvals, activity logging) instead of building a parallel execution system.

---

## Phase 1: Schema + Shared Types

### 1.1 Add constants

**File:** `packages/shared/src/constants.ts`

```typescript
// Add pipeline status constants
export const PIPELINE_TEMPLATE_STATUSES = ["active", "archived"] as const;
export type PipelineTemplateStatus = (typeof PIPELINE_TEMPLATE_STATUSES)[number];

export const PIPELINE_RUN_STATUSES = ["pending", "running", "paused", "completed", "failed", "cancelled"] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export const PIPELINE_STAGE_RUN_STATUSES = ["pending", "waiting_approval", "running", "completed", "failed", "skipped", "cancelled"] as const;
export type PipelineStageRunStatus = (typeof PIPELINE_STAGE_RUN_STATUSES)[number];

// Extend existing ISSUE_ORIGIN_KINDS (line 125) to include "pipeline_stage"
export const ISSUE_ORIGIN_KINDS = ["manual", "routine_execution", "pipeline_stage"] as const;
```

### 1.2 Create schema tables

Four new schema files following the `routines.ts` pattern:

**File:** `packages/db/src/schema/pipelines.ts` (all four tables in one file, matching how routines.ts has routines + routineTriggers + routineRuns)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `pipeline_templates` | Reusable pipeline definition | companyId, projectId?, goalId?, title, description, status, createdByAgentId |
| `pipeline_stages` | Ordered stage definitions | companyId, pipelineTemplateId, title, description, stageOrder (int), parallelGroup? (text), loopConfig? (jsonb), assigneeAgentId?, requiredCapability?, requiresApproval, timeoutMinutes? |
| `pipeline_runs` | Execution instances | companyId, pipelineTemplateId, status, parentIssueId?, launchedByAgentId?, inputPayload (jsonb), outputSummary (jsonb), currentStageOrder |
| `pipeline_stage_runs` | Per-stage execution records | companyId, pipelineRunId, pipelineStageId, issueId (FK → issues), status, loopIndex?, inputContext (jsonb), outputContext (jsonb), resolvedAgentId |

**Parallel stages:** Stages sharing a `parallelGroup` value at the same `stageOrder` run concurrently. Pipeline advances only when ALL stages in the group complete.

**Loops:** Stages with `loopConfig` repeat per-item from a prior stage's output (e.g., per-shot in film production). V1: `loopConfig = { sourceStageId, fieldPath }` referencing a JSON array from a prior stage's outputContext.

### 1.3 Export from schema index

**File:** `packages/db/src/schema/index.ts` — add exports for all four tables

### 1.4 Generate migration

```sh
pnpm db:generate
```

### 1.5 Create shared types

**New file:** `packages/shared/src/types/pipeline.ts`

Interfaces: `PipelineTemplate`, `PipelineStage`, `PipelineRun`, `PipelineStageRun`, `PipelineTemplateDetail` (includes stages + recent runs), `PipelineRunDetail` (includes stage run statuses)

### 1.6 Create validators

**New file:** `packages/shared/src/validators/pipeline.ts`

Zod schemas: `createPipelineTemplateSchema`, `updatePipelineTemplateSchema`, `createPipelineStageSchema`, `updatePipelineStageSchema`, `launchPipelineRunSchema`

### 1.7 Wire up exports

- `packages/shared/src/types/index.ts` — export pipeline types
- `packages/shared/src/validators/index.ts` — export pipeline validators
- `packages/shared/src/index.ts` — re-export (matching existing pattern)

---

## Phase 2: Template + Stage CRUD

### 2.1 Pipeline service (template CRUD only)

**New file:** `server/src/services/pipelines.ts`

Factory: `pipelineService(db: Db)` returning:
- `listTemplates(companyId)`, `getTemplate(templateId)`, `createTemplate()`, `updateTemplate()`, `deleteTemplate()`
- `listStages(templateId)`, `createStage()`, `updateStage()`, `deleteStage()`, `reorderStages()`

Follow the `routineService` pattern exactly — same error handling, same actor pattern, same activity logging.

### 2.2 Pipeline routes (template CRUD only)

**New file:** `server/src/routes/pipelines.ts`

```
GET    /companies/:companyId/pipelines
POST   /companies/:companyId/pipelines
GET    /companies/:companyId/pipelines/:pipelineId
PATCH  /companies/:companyId/pipelines/:pipelineId
DELETE /companies/:companyId/pipelines/:pipelineId

POST   /companies/:companyId/pipelines/:pipelineId/stages
PATCH  /companies/:companyId/pipelines/:pipelineId/stages/:stageId
DELETE /companies/:companyId/pipelines/:pipelineId/stages/:stageId
POST   /companies/:companyId/pipelines/:pipelineId/stages/reorder
```

### 2.3 Register service + routes

- `server/src/services/index.ts` — export `pipelineService`
- `server/src/routes/index.ts` — export `pipelineRoutes`
- `server/src/app.ts` — mount `pipelineRoutes(db)` after `routineRoutes`

### 2.4 CLI commands

**New file:** `cli/src/commands/client/pipeline.ts`

```
paperclip pipeline list
paperclip pipeline get <id>
paperclip pipeline create --title "..." [--project-id ...]
paperclip pipeline stage add <pipelineId> --title "..." --stage-order 1 [--assignee-agent-id ...]
paperclip pipeline stage remove <stageId>
```

Register in CLI index.

---

## Phase 3: Run Execution Engine (the core)

### 3.1 `launchRun(companyId, templateId, input, actor)`

1. Validate template exists and is active
2. Create `pipeline_run` with status `running`
3. Create `pipeline_stage_runs` for all stages in `pending` status
4. Call `advanceRun(runId)` to kick off the first stage(s)

### 3.2 `advanceRun(runId)` — the progression engine

This is the heart of the pipeline:

1. Find the lowest `stageOrder` with pending stage runs
2. For each stage at that order:
   - **Resolve agent:** explicit `assigneeAgentId` or match by `requiredCapability`
   - **Gather input context:** collect `outputContext` from all completed prior stages
   - **Create issue:** via `issueService.create()` with `originKind: "pipeline_stage"`, `originId: stageRunId`. Attach input context as issue description/documents
   - **Handle approvals:** if `requiresApproval`, create approval gate, set stage to `waiting_approval`
   - **Wake agent:** call `queueIssueAssignmentWakeup()`
3. If no pending stages remain → set run status to `completed`

### 3.3 `syncStageRunForIssue(issueId)` — the auto-advance hook

Called when any issue status changes (same pattern as `routinesSvc.syncRunStatusForIssue`):

1. Look up `pipeline_stage_run` by `issueId`
2. If not found (issue isn't a pipeline stage), return early
3. If issue status = `done`:
   - Capture work products + documents from issue into `outputContext`
   - Mark stage run `completed`
   - Check if all stages at this `stageOrder` are complete (parallel group check)
   - If yes → call `advanceRun(runId)` to start next stage(s)
4. If issue status = `cancelled` or stays `blocked` → mark stage run `failed`, optionally fail the entire run

### 3.4 Hook into issue status updates

**File:** `server/src/routes/issues.ts` (line ~958, right after `routinesSvc.syncRunStatusForIssue`)

Add: `await pipelineSvc.syncStageRunForIssue(issue.id);`

This is the only modification to existing code. One line.

### 3.5 Run management endpoints

```
POST   /companies/:companyId/pipelines/:pipelineId/runs     — launch
GET    /companies/:companyId/pipeline-runs                   — list all
GET    /companies/:companyId/pipeline-runs/:runId            — detail
POST   /companies/:companyId/pipeline-runs/:runId/cancel     — cancel
POST   /companies/:companyId/pipeline-runs/:runId/pause      — pause
POST   /companies/:companyId/pipeline-runs/:runId/resume     — resume
```

### 3.6 Run management CLI

```
paperclip pipeline run launch <pipelineId> [--input '{"key":"value"}']
paperclip pipeline run list
paperclip pipeline run get <runId>
paperclip pipeline run cancel <runId>
```

---

## Phase 4: Advanced Features (can be deferred)

### 4.1 Loop support
Handle `loopConfig` in `advanceRun` — when a stage has loop config, iterate over the source array from a prior stage's `outputContext` and create N stage runs (one per item, with `loopIndex` 0,1,2...).

### 4.2 Approval gate integration
Hook approval resolution to call `pipelineSvc.advanceStageAfterApproval(stageRunId)` when a `pipeline_stage` approval is approved.

### 4.3 Output-to-input context passing
V1: serialize work product IDs + document revision IDs into `outputContext` JSON. Inject these references into the next stage's issue description. Later: richer context passing (file contents, structured data).

### 4.4 Timeout handling
Optional per-stage timeouts — a background job checks for running stages past their `timeoutMinutes` and fails them.

---

## File Inventory

### New files (9)
| File | Purpose |
|------|---------|
| `packages/db/src/schema/pipelines.ts` | 4 tables: templates, stages, runs, stage_runs |
| `packages/shared/src/types/pipeline.ts` | TypeScript interfaces |
| `packages/shared/src/validators/pipeline.ts` | Zod schemas |
| `server/src/services/pipelines.ts` | Business logic + execution engine |
| `server/src/routes/pipelines.ts` | REST API endpoints |
| `cli/src/commands/client/pipeline.ts` | CLI commands |
| `packages/db/src/migrations/XXXX_pipeline_tables.sql` | Generated migration |
| `packages/db/src/migrations/meta/XXXX_snapshot.json` | Generated snapshot |
| `doc/plans/2026-03-29-pipelines.md` | Plan doc (this plan, archived) |

### Modified files (8)
| File | Change |
|------|--------|
| `packages/shared/src/constants.ts` | Add pipeline status constants, extend `ISSUE_ORIGIN_KINDS` |
| `packages/db/src/schema/index.ts` | Export pipeline tables |
| `packages/shared/src/types/index.ts` | Export pipeline types |
| `packages/shared/src/validators/index.ts` | Export pipeline validators |
| `packages/shared/src/index.ts` | Re-export pipeline items |
| `server/src/services/index.ts` | Export `pipelineService` |
| `server/src/routes/index.ts` | Export `pipelineRoutes` |
| `server/src/app.ts` | Mount pipeline routes |
| `server/src/routes/issues.ts` | Add `syncStageRunForIssue` call (~1 line) |
| `cli/src/index.ts` (or command registration file) | Register pipeline commands |

---

## Verification

After implementation, run:
```sh
pnpm -r typecheck          # All packages compile
pnpm test:run              # Existing tests pass
pnpm build                 # Full build succeeds
```

Manual verification:
1. Create a pipeline template with 3 sequential stages via CLI
2. Assign each stage to a different agent
3. Launch a run
4. Verify: first stage creates an issue and wakes the agent
5. Complete the first stage's issue (mark done)
6. Verify: second stage auto-creates and wakes its agent
7. Complete all stages → verify run status becomes `completed`
8. Test parallel stages: create 2 stages at the same `stageOrder` with a shared `parallelGroup` → verify both start simultaneously, pipeline waits for both before advancing

---

## Example: Film Production Pipeline

```
Template: "AI Film Production"

Stage 1 (order=1): Script Writing      → agent: script_writer
Stage 2 (order=2): Direction            → agent: director
Stage 3 (order=3): DP Annotation        → agent: dp
Stage 4 (order=4): Element Extraction   → agent: element_extractor
Stage 5 (order=5, parallel="refs"): Character Refs    → agent: prompt_engineer
Stage 6 (order=5, parallel="refs"): Environment Refs  → agent: prompt_engineer
Stage 7 (order=5, parallel="refs"): Object Refs       → agent: prompt_engineer
Stage 8 (order=6, loop from stage 4): Per-Shot Production → agent: video_producer
Stage 9 (order=7): Assembly             → agent: editor
```

Launch: `paperclip pipeline run launch <templateId> --input '{"script_brief": "A 2-minute sci-fi short about..."}'`

The orchestrator doesn't need to manage each handoff — the pipeline definition handles it.
