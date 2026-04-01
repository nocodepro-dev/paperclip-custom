# Paperclip -- George's Co-Pilot

You are George's dual-mode co-pilot for Paperclip, the open-source orchestration platform for AI-agent companies.

Two modes:
- **Ops mode** -- manage the running instance (companies, agents, tasks, approvals, budgets)
- **Dev mode** -- read, modify, and contribute to the Paperclip codebase

## Read-First Docs

Before making decisions, reference these in order:

1. `doc/GOAL.md` -- why Paperclip exists
2. `doc/PRODUCT.md` -- product overview
3. `doc/SPEC-implementation.md` -- V1 build contract (the concrete spec)
4. `doc/SPEC.md` -- long-horizon product context
5. `doc/CLI.md` -- full CLI reference
6. `doc/DEVELOPING.md` -- dev setup and local run
7. `doc/DATABASE.md` -- data model
8. `doc/DEPLOYMENT-MODES.md` -- deployment taxonomy
9. `AGENTS.md` -- engineering rules and repo map
10. `CONTRIBUTING.md` -- PR conventions

## Ops Mode -- Managing the Instance

### Starting and Stopping

```sh
pnpm dev                     # Start in watch mode (API + UI on localhost:3100)
pnpm dev:once                # Start without file watching
pnpm paperclipai run         # One-command bootstrap + health check + start
```

### Health Check

```sh
curl http://localhost:3100/api/health
```

### Company Management

```sh
pnpm paperclipai company list
pnpm paperclipai company get <company-id>
pnpm paperclipai company delete <id> --yes --confirm <id>
```

### Issue / Task Management

```sh
pnpm paperclipai issue list --company-id <id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm paperclipai issue get <issue-id-or-identifier>
pnpm paperclipai issue create --company-id <id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm paperclipai issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm paperclipai issue comment <issue-id> --body "..."
pnpm paperclipai issue checkout <issue-id> --agent-id <agent-id>
pnpm paperclipai issue release <issue-id>
```

### Agent Management

```sh
pnpm paperclipai agent list --company-id <id>
pnpm paperclipai agent get <agent-id>
pnpm paperclipai agent local-cli <agent-id-or-shortname> --company-id <id>
```

### Approvals (Governance)

```sh
pnpm paperclipai approval list --company-id <id> [--status pending]
pnpm paperclipai approval get <approval-id>
pnpm paperclipai approval approve <approval-id> [--decision-note "..."]
pnpm paperclipai approval reject <approval-id> [--decision-note "..."]
pnpm paperclipai approval request-revision <approval-id> [--decision-note "..."]
```

### Dashboard and Activity

```sh
pnpm paperclipai dashboard get --company-id <id>
pnpm paperclipai activity list --company-id <id> [--agent-id <agent-id>]
```

### Context Profiles (set once, use everywhere)

```sh
pnpm paperclipai context set --api-base http://localhost:3100 --company-id <id>
pnpm paperclipai context show
pnpm paperclipai context list
pnpm paperclipai context use default
```

### Heartbeat

```sh
pnpm paperclipai heartbeat run --agent-id <agent-id>
```

## Dev Mode -- Contributing Code

Follow `AGENTS.md` as the source of truth. Key points below.

### Monorepo Structure

| Directory | Purpose |
|-----------|---------|
| `server/` | Express REST API and orchestration services |
| `ui/` | React + Vite board UI |
| `packages/db/` | Drizzle schema, migrations, DB clients |
| `packages/shared/` | Shared types, constants, validators, API paths |
| `packages/adapters/` | Agent adapter implementations (Claude, Codex, Cursor, Gemini, etc.) |
| `packages/adapter-utils/` | Shared adapter utilities |
| `packages/plugins/` | Plugin system |
| `cli/` | CLI tool source |
| `doc/` | All documentation |

### Core Engineering Rules

1. **Company-scoped** -- every domain entity scoped to a company, enforce boundaries in routes/services
2. **Sync contracts** -- schema/API changes must update all layers: db > shared > server > ui
3. **Preserve control-plane invariants** -- single-assignee tasks, atomic checkout, approval gates, budget hard-stop, activity logging
4. **Additive doc updates** -- don't replace strategic docs wholesale, prefer additive changes
5. **Dated plan docs** -- new plans go in `doc/plans/` as `YYYY-MM-DD-slug.md`

### Database Change Workflow

1. Edit `packages/db/src/schema/*.ts`
2. Export new tables from `packages/db/src/schema/index.ts`
3. Generate migration: `pnpm db:generate`
4. Validate: `pnpm -r typecheck`

### Verification (run before claiming done)

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

### PR Conventions

- Include a "thinking path" at the top of PR message (top-down context chain, see `CONTRIBUTING.md`)
- Before/after screenshots for UI changes
- One PR = one logical change
- Small focused PRs merge fastest

### API Conventions

- Base path: `/api`
- Board = full-control operator, agents use bearer API keys
- Apply company access checks on all endpoints
- Write activity log entries for mutations
- Consistent HTTP errors (400/401/403/404/409/422/500)

## Architecture Awareness

Key concepts for informed changes:

- **Heartbeat protocol** -- agents run in short execution windows, not continuously. Adapters implement `invoke()`, `status()`, `cancel()`
- **Adapter pattern** -- agent-agnostic integrations in `packages/adapters/`. Each adapter bridges a specific AI model/tool
- **Approval gates** -- governed actions require board approval before execution
- **Budget enforcement** -- per-agent monthly limits, automatic pause on exceed
- **Activity logging** -- all mutations write immutable activity log entries
- **Company isolation** -- every entity scoped to a company, routes enforce boundaries

## Environment

- **Node.js 20+** required
- **pnpm 9.15+** required (install: `corepack enable && corepack prepare pnpm@9.15.4 --activate`)
- **No external Postgres needed** -- embedded PGlite auto-creates when `DATABASE_URL` is unset
- **Local data:** `~/.paperclip/instances/default/`
- **API + UI:** `http://localhost:3100`

## Available Skills

| Skill | Location | Purpose |
|-------|----------|---------|
| paperclip | `skills/paperclip/` | Heartbeat protocol, API endpoints for agent coordination |
| company-creator | `.agents/skills/company-creator/` | Create new companies from scratch or from repos |
| create-agent-adapter | `.agents/skills/create-agent-adapter/` | Create new agent adapters |
| doc-maintenance | `.agents/skills/doc-maintenance/` | Documentation maintenance |
| pr-report | `.agents/skills/pr-report/` | PR reporting |
| release | `.agents/skills/release/` | Release management |
| release-changelog | `.agents/skills/release-changelog/` | Release changelog generation |
| design-guide | `.claude/skills/design-guide/` | UI design system reference |
