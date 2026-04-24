# Paperclip Workspace Export/Import to GitHub

## Context

Today, a NocodePro Paperclip install stores nearly all operational state in an embedded PostgreSQL database at `~/.paperclip/instances/default/db/` (on this machine: `C:\Users\HP\.paperclip\instances\default\db\`). If George reinstalls Paperclip on a new machine, he keeps the software but **loses everything inside**: pipelines, SOPs, knowledge collection metadata, agents, tasks, budgets, etc.

The existing `company export/import` feature (`server/src/services/company-portability.ts`, ~3,687 lines) is a good foundation but has two critical gaps:

1. **Custom features missing.** It does NOT export Pipelines, SOPs, Knowledge Collections, Agent Skill Requests — exactly the features NocodePro relies on.
2. **Scope is per-company.** There's no way to export the whole instance with one command.

Separately, `packages/db/src/backup.ts` can produce a full SQL dump, but that's a binary blob — not Git-friendly, not reviewable, not portable across Postgres versions.

**Goal:** Add a **Workspace Export/Import** feature that snapshots the entire Paperclip instance into a Git-friendly directory, pushes it to GitHub with one click, and lets the user clone + restore on a new machine with one command. Matches NocodePro's filesystem-first, zero-lock-in philosophy.

## Design

### Output format: hybrid Git-friendly directory

```
paperclip-workspace/
├── MANIFEST.json              # schema_version, instance_id, exported_at, paperclip_version
├── README.md                  # human-readable summary of the workspace
├── .env.template              # scrubbed secret keys (user fills in on import)
├── instance/
│   ├── config.json            # runtime-config.ts config (sanitized)
│   └── plugin-state.json
├── companies/
│   └── {company-slug}/
│       ├── company.json
│       ├── agents/{agent-slug}.json
│       ├── projects/{project-slug}.json
│       ├── tasks/{identifier}.json                # e.g. PAP-39.json — full issue + comments
│       ├── skills/{skill-key}/SKILL.md + assets
│       ├── routines/{routine-slug}.json
│       ├── approvals/{approval-id}.json
│       ├── budgets.json
│       ├── pipelines/
│       │   ├── {pipeline-slug}.json               # template + stages (editable in PR)
│       │   └── runs/{run-id}.json                 # run history
│       ├── sops/
│       │   └── {sop-slug}/
│       │       ├── sop.json                       # metadata + status
│       │       ├── content.md                     # the actual SOP markdown
│       │       └── assets/step_N.png              # screenshots
│       └── knowledge/
│           └── {collection-slug}.json             # metadata + source paths (files stay on disk)
└── runtime/
    ├── activity-log.ndjson.gz                     # compressed instance-wide activity log
    ├── cost-events.ndjson.gz                      # cost events
    └── heartbeat-runs.ndjson.gz                   # heartbeat run history
```

**Why hybrid:**
- **JSON/markdown for configs** (companies, agents, pipelines, SOPs, knowledge metadata) — diffable, editable, reviewable in GitHub PRs
- **ndjson.gz for bulky append-only logs** (activity, costs, heartbeats) — avoids bloating Git diffs, but still tracked
- **Binary assets inline** (SOP screenshots) — stored next to the JSON that references them

### Secrets handling

- All secret fields (API keys, auth tokens, agent credentials, encrypted env values) are stripped on export and written as empty entries in `.env.template`.
- Reuses the existing scrubbing logic from `company-portability.ts`.
- On import, the CLI prompts the user to fill in `.env.template` or accept placeholder values.

### Knowledge Collections caveat

Knowledge collections reference files at absolute paths (e.g., `D:\nocodepro-me\projects\...\references`). On a new machine those paths may not exist.

On export, the collection JSON includes:
```json
{
  "name": "Modliflex References",
  "sourcePath": "D:\\nocodepro-me\\projects\\MODLIFLEX-APP-COPILOT\\references",
  "sourcePathPortable": "nocodepro-me/projects/MODLIFLEX-APP-COPILOT/references"
}
```

On import, the CLI detects unresolvable paths and prompts the user to re-map (one prompt per collection). Re-maps are stored in the instance's local config so subsequent sync/pull doesn't re-prompt.

### GitHub integration (one-click push/pull)

Uses the standard `git` CLI — no GitHub-specific API dependency, works with any Git remote.

**One-time setup (once per instance):**
```
paperclipai workspace init <git-url>
  # Creates the workspace directory at ~/.paperclip/workspace/
  # Runs `git init` + `git remote add origin <url>`
  # Saves the link in the instance config
```

**Push (backup):**
```
paperclipai workspace sync
  # 1. Runs full export to ~/.paperclip/workspace/
  # 2. git add -A && git commit -m "Workspace snapshot YYYY-MM-DD HH:MM"
  # 3. git push origin main
  # UI equivalent: a "Backup to GitHub" button on the dashboard
```

**Clone + restore on a new machine:**
```
paperclipai workspace clone <git-url>
  # 1. git clone <git-url> ~/.paperclip/workspace/
  # 2. Runs import (see below)
  # 3. Prompts for secrets and any unresolvable knowledge paths
```

**Pull + re-sync (syncing between machines):**
```
paperclipai workspace pull
  # 1. git pull
  # 2. Applies any changes to the live DB (collision strategy: prompt per conflict)
```

### UI surface

Add a `/settings/workspace` page in the dashboard with:
- **Workspace status** (linked repo, last sync, pending changes count)
- **Sync to GitHub button** (runs the export + git push flow)
- **Setup wizard** (first-time: prompts for Git URL, creates the remote)

On the Dashboard header or sidebar, a small indicator: "Last backup: 2 hours ago".

### Import collision strategies

When importing on a machine that already has data:
- `clone` command fails if the local instance has ANY data (safest default)
- `--merge` flag: uses the same rename/skip/replace options as the existing company import
- `--replace` flag: drops all existing tables and reloads from the workspace (requires explicit `--confirm`)

### Implementation layers

| Layer | What gets added |
|-------|-----------------|
| Service | New `workspace-portability.ts` that orchestrates: calls existing `company-portability.ts` for companies + adds custom-feature exporters (pipelines, SOPs, knowledge, runtime logs) |
| Service | New per-feature exporters: `exportPipelinesForCompany`, `exportSopsForCompany`, `exportKnowledgeCollectionsForCompany` |
| Service | New per-feature importers (same shape) |
| Routes | `POST /api/workspace/export`, `POST /api/workspace/import`, `POST /api/workspace/sync` |
| CLI | New `workspace` command group with subcommands `init`, `sync`, `clone`, `pull`, `status` |
| UI | `/settings/workspace` page with status and one-click sync button |
| Config | `instance-config.json` gets a `workspace.gitRemote` field |

## Critical Files

### Existing files to reuse
- `server/src/services/company-portability.ts` — reuse for companies/agents/projects/tasks/skills
- `packages/db/src/backup.ts` — reference for secret scrubbing patterns
- `cli/src/commands/client/company.ts` — reference for CLI import/export patterns

### New files to create
- `server/src/services/workspace-portability.ts` — orchestrator
- `server/src/services/workspace-exporters/pipelines.ts`
- `server/src/services/workspace-exporters/sops.ts`
- `server/src/services/workspace-exporters/knowledge.ts`
- `server/src/services/workspace-exporters/runtime-logs.ts`
- `server/src/services/workspace-importers/` — mirror structure
- `server/src/services/workspace-git.ts` — git CLI wrapper (init, commit, push, pull, clone)
- `server/src/routes/workspace.ts` — REST endpoints
- `cli/src/commands/client/workspace.ts` — CLI commands
- `ui/src/pages/settings/Workspace.tsx` — settings page with sync button
- `ui/src/api/workspace.ts` — UI API client

### Files to modify
- `server/src/local-extensions.ts` — register new routes
- `server/src/routes/local-extensions.ts` — export new route module
- `server/src/services/local-extensions.ts` — export new service module
- `cli/src/local-extensions.ts` — register new CLI command
- `packages/shared/src/types/local-extensions.ts` — export new types
- `packages/shared/src/validators/local-extensions.ts` — export new validators
- `ui/src/components/Sidebar.tsx` — add settings link

## Verification

1. **Round-trip test on same machine:**
   - Create a test company with a pipeline, an SOP with screenshots, and a knowledge collection
   - Run `paperclipai workspace export ./test-export`
   - Drop all DB tables
   - Run `paperclipai workspace import ./test-export`
   - Verify the company, pipeline, SOP (with screenshots), and knowledge collection are restored

2. **GitHub round-trip:**
   - `paperclipai workspace init https://github.com/nocodepro-dev/paperclip-workspace-test.git`
   - `paperclipai workspace sync`
   - Verify GitHub repo has the expected directory structure
   - On a second machine (or a fresh instance), `paperclipai workspace clone <url>`
   - Verify all data is restored

3. **Secrets scrubbing:**
   - Grep the exported directory for `sk-`, `ghp_`, `api_key`, etc. — should return zero matches
   - Verify `.env.template` lists all expected keys with empty values

4. **Knowledge path re-mapping:**
   - Export a workspace on a machine where a knowledge collection references `D:\nocodepro-me\...`
   - Import on a machine where that path doesn't exist
   - Verify the CLI prompts for the new path and stores the mapping

5. **Collision handling:**
   - Import into an instance that has an existing company with the same slug
   - Verify the default behavior (fail) and each flag (`--merge`, `--replace --confirm`)

6. **UI one-click sync:**
   - From the dashboard, click "Backup to GitHub"
   - Verify the commit appears in the linked repo within 30 seconds
   - Verify the UI shows "Last backup: just now"

## Phased rollout

Because this is a big feature, ship in 3 phases:

| Phase | Scope | Ship criteria |
|-------|-------|---------------|
| 1 | CLI-only export/import for custom features (pipelines, SOPs, knowledge) added to existing company export | Can manually copy workspace to new machine |
| 2 | Workspace-level (all companies + runtime logs) + Git integration | Can push to GitHub and clone back |
| 3 | UI one-click sync + dashboard indicator | Non-technical users can back up with one click |

Each phase is independently useful — Phase 1 alone already closes the biggest gap you care about (losing pipelines/SOPs on migration).
