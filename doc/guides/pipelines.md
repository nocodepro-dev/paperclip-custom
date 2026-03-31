# Pipelines

Pipelines orchestrate multi-agent workflows as a sequence of stages. Define who does what in which order, then launch runs that automatically advance as each stage completes.

## When to use pipelines

Use a pipeline when a task requires multiple agents working in sequence — for example:

- **Content production**: research > write draft > review > publish
- **Code delivery**: plan > implement > test > deploy
- **Customer onboarding**: create account > configure integrations > send welcome email

If the work is a single task for one agent, an issue is sufficient. Pipelines add value when coordination between agents matters.

## Creating a pipeline

### From the UI

1. Navigate to **Work > Pipelines** in the sidebar.
2. Click **New Pipeline**.
3. Enter a **title**, optional **description**, and optionally link to a **project**.
4. Click **Create Pipeline** — you'll land on the detail page to add stages.

### From the CLI

```sh
pnpm paperclipai pipeline create --company-id <id> --title "Content Pipeline"
```

## Adding stages

On the pipeline detail page, click **Add Stage** and provide:

- **Title** — what this stage does (e.g. "Research", "Draft Article")
- **Agent** (optional) — assign a specific agent, or leave blank for capability-based resolution
- **Skill** (optional) — suggest a company skill for this stage. When set, the agent receives the skill name and key in the issue description so it knows which skill to apply.
- **Requires Approval** — if checked, the stage's issue will require board approval before the agent can act
- **Timeout** (optional) — minutes before the stage is considered stuck

Stages execute in order. The stage order is determined by the sequence you add them.

### Capability-based resolution

If you don't assign a specific agent, the execution engine resolves one based on the stage's `requiredCapability` field. Set this via the CLI:

```sh
pnpm paperclipai pipeline stage add <pipelineId> \
  --title "Code Review" \
  --stage-order 2 \
  --required-capability "code_review"
```

The engine matches the capability against agent roles to find the best fit.

## Approval gates

Stages with **Requires Approval** enabled create issues that must be approved by the board before the assigned agent can execute. This is useful for:

- High-stakes actions (deploying to production, sending customer communications)
- Quality checkpoints (reviewing a draft before publishing)
- Budget-sensitive operations

The pipeline pauses at that stage until the approval is granted.

## Suggested skills

Each stage can optionally reference a **company skill**. When the execution engine creates an issue for that stage, it includes the skill name and key in the issue description, telling the agent which skill to use.

This is useful when:

- A stage requires a specific procedure (e.g. "Customer Onboarding Checklist" skill)
- You want agents to follow a converted SOP rather than improvising
- Different stages of the same pipeline need different skills

A stage can have any combination:

| Agent | Skill | Behavior |
|-------|-------|----------|
| None | None | Engine resolves agent by capability, agent picks approach |
| Set | None | Specific agent, picks their own approach |
| None | Set | Engine resolves agent, tells them to use the skill |
| Set | Set | Specific agent using a specific skill |

Set a suggested skill from the UI skill picker when adding a stage, or via the CLI:

```sh
pnpm paperclipai pipeline stage add <pipelineId> \
  --title "Onboard Customer" \
  --stage-order 1 \
  --suggested-skill-id <skillId>
```

## Launching a run

Click **Launch Run** on the pipeline detail page and optionally provide a **title** for the run. The execution engine:

1. Finds the first stage (lowest `stageOrder`).
2. Resolves an agent (explicit assignment or capability match).
3. Creates an issue with the stage's context and assigns it to the agent.
4. Marks the stage run as `running`.

### Auto-advance

When an agent completes a stage's issue (marks it as `done`), the pipeline engine automatically advances to the next stage. This happens via a hook in the issue status update path — no polling or manual intervention needed.

## Monitoring runs

The **Runs** tab on the pipeline detail page shows all runs with their status:

- **pending** — not yet started
- **running** — at least one stage is active
- **completed** — all stages finished successfully
- **failed** — a stage failed
- **paused** — manually paused by the operator
- **cancelled** — manually cancelled

Click a run to expand and see each stage run with its status, resolved agent, and linked issue.

You can **Pause**, **Resume**, or **Cancel** active runs directly from the UI.

## Parallel groups

Stages can run in parallel by sharing the same `parallelGroup` name. All stages in a parallel group launch simultaneously, and the pipeline waits for all of them to complete before advancing to the next order level.

Set parallel groups via the CLI:

```sh
pnpm paperclipai pipeline stage add <pipelineId> \
  --title "Frontend Tests" --stage-order 3 --parallel-group "testing"
pnpm paperclipai pipeline stage add <pipelineId> \
  --title "Backend Tests" --stage-order 3 --parallel-group "testing"
```

Both stages run at order 3 concurrently. Order 4 stages wait for both to finish.

## Context passing

Each stage receives aggregated context from all previously completed stages. When a stage's issue is completed, its output is stored and passed forward as input context to the next stage. This means later stages have full visibility into what earlier stages produced.
