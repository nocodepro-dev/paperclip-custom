# Upstream Sync Guide

This document describes how to keep your Paperclip fork in sync with the official upstream repository.

## Remote Setup

```bash
# Your fork
git remote -v
# origin    git@github.com:<your-org>/paperclip.git (fetch/push)
# upstream  https://github.com/paperclipai/paperclip.git (fetch/push)

# If upstream is not configured yet:
git remote add upstream https://github.com/paperclipai/paperclip.git
```

## Sync Procedure

```bash
# 1. Fetch upstream changes
git fetch upstream

# 2. Merge into your branch
git merge upstream/master

# 3. Resolve any conflicts (see below)

# 4. Verify everything builds
pnpm -r typecheck
pnpm test:run
pnpm build
```

## Expected Merge Conflicts

Custom features (Knowledge Base, SOPs, Pipelines, Tool Registry) are consolidated into `local-extensions.ts` files. Each barrel/registration file has **one added line** that may conflict if upstream also modifies that file.

### Conflict Files and Resolution

| File | Custom Line | Resolution |
|------|------------|------------|
| `server/src/app.ts` | `import { registerLocalRoutes }` + `registerLocalRoutes(api, db)` | Re-add the import and the call after upstream's route mounts |
| `server/src/routes/index.ts` | `export * from "./local-extensions.js"` | Re-add at end of file |
| `server/src/services/index.ts` | `export * from "./local-extensions.js"` | Re-add at end of file |
| `cli/src/index.ts` | `import { registerLocalCommands }` + `registerLocalCommands(program)` | Re-add import and call |
| `packages/shared/src/types/index.ts` | `export * from "./local-extensions.js"` | Re-add at end of file |
| `packages/shared/src/validators/index.ts` | `export * from "./local-extensions.js"` | Re-add at end of file |
| `packages/shared/src/constants.ts` | `export * from "./constants-local.js"` | Re-add at end of file |
| `packages/shared/src/index.ts` | `export * from "./local-extensions.js"` | Re-add in the validators export section |
| `packages/db/src/schema/index.ts` | `export * from "./local-extensions.js"` | Re-add at end of file |

### Special Case: `ISSUE_ORIGIN_KINDS`

In `packages/shared/src/constants.ts`, the value `"pipeline_stage"` was added inline to the `ISSUE_ORIGIN_KINDS` array. This cannot be extracted and will conflict if upstream modifies the same array. Resolution: ensure `"pipeline_stage"` remains in the array after merge.

### Special Case: `packages/shared/src/api.ts`

One SOP API path (`sops: ...`) was added inline. This is a single line and trivial to re-add.

## Migration Conflicts

Custom migrations use numbers 0046, 0047, 0048. If upstream adds migrations with the same numbers:

1. The `.sql` files won't collide (Drizzle uses random codenames like `0046_ordinary_talisman`)
2. `packages/db/src/migrations/meta/_journal.json` will conflict — both sides append entries to the same JSON array
3. Resolution: combine both sets of entries in `_journal.json`, keeping entries in order
4. Run `pnpm db:generate` after merge to verify schema consistency

## Files That Never Conflict

All custom feature files live in their own paths that upstream doesn't touch:

- `server/src/local-extensions.ts`
- `server/src/routes/local-extensions.ts`, `knowledge.ts`, `sops.ts`, `pipelines.ts`, `tools.ts`
- `server/src/services/local-extensions.ts`, `knowledge.ts`, `sops.ts`, `sop-converter.ts`, `sop-step-analyzer.ts`, `pipelines.ts`, `tool-catalog.ts`, `tool-requirements.ts`
- `packages/shared/src/local-extensions.ts`, `constants-local.ts`
- `packages/shared/src/types/local-extensions.ts`, `knowledge.ts`, `sop.ts`, `pipeline.ts`, `tool-registry.ts`
- `packages/shared/src/validators/local-extensions.ts`, `knowledge.ts`, `sops.ts`, `pipeline.ts`, `tools.ts`
- `packages/db/src/schema/local-extensions.ts`, `knowledge.ts`, `sops.ts`, `pipelines.ts`
- `cli/src/local-extensions.ts`
- `cli/src/commands/client/knowledge.ts`, `sop.ts`, `pipeline.ts`, `skill-equip.ts`

## Adding New Custom Features

When adding a new custom feature, follow this pattern:

1. Create your feature files (schema, types, validators, routes, services, CLI commands)
2. Add exports to the relevant `local-extensions.ts` files
3. Do **not** edit the upstream barrel files — the `local-extensions.ts` re-exports handle wiring
