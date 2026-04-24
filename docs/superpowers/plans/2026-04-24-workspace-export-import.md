# Paperclip Workspace Export/Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable full-fidelity export of a Paperclip instance to a Git-friendly directory, one-click backup to GitHub, and one-command restore on a new machine.

**Architecture:** Three phases, each independently shippable:
- **Phase 1:** Extend existing `company-portability.ts` to include pipelines, SOPs, and knowledge collections (plug into the existing `exportBundle`/`importBundle` monolith with new manifest sections)
- **Phase 2:** Add `workspace-portability.ts` orchestrator that iterates all companies + adds runtime logs (activity, cost, heartbeat) + `workspace-git.ts` git CLI wrapper + `workspace` CLI commands (`init`, `sync`, `clone`, `pull`, `status`)
- **Phase 3:** Settings UI page with one-click backup button, dashboard indicator, setup wizard

**Tech Stack:** TypeScript, Drizzle ORM, Express 5, React 19 + TanStack Query, Zod, Commander.js CLI, node `child_process.execFile` for git

---

## File Structure (all phases)

| Action | File | Phase | Responsibility |
|--------|------|-------|----------------|
| Modify | `packages/shared/src/types/company-portability.ts` | 1 | Add new manifest entry types for pipelines, SOPs, knowledge |
| Modify | `server/src/services/company-portability.ts` | 1 | Add inline export/import logic for pipelines, SOPs, knowledge |
| Modify | `cli/src/commands/client/company.ts` | 1 | Add `--include-pipelines`, `--include-sops`, `--include-knowledge` flags |
| Modify | `packages/shared/src/config-schema.ts` | 2 | Add `workspace: { gitRemote?: string }` to config |
| Create | `server/src/services/workspace-git.ts` | 2 | Git CLI wrapper: init, add, commit, push, pull, clone, status |
| Create | `server/src/services/workspace-portability.ts` | 2 | Orchestrator: iterate companies, add runtime log exporters |
| Create | `server/src/services/workspace-runtime-logs.ts` | 2 | Export activity/cost/heartbeat logs as ndjson.gz + import |
| Create | `server/src/routes/workspace.ts` | 2 | `POST /api/workspace/{export,import,sync,clone,pull}` + `GET /status` |
| Modify | `server/src/routes/local-extensions.ts` | 2 | Export new route module |
| Modify | `server/src/local-extensions.ts` | 2 | Register new routes |
| Modify | `server/src/services/local-extensions.ts` | 2 | Export new service modules |
| Create | `cli/src/commands/client/workspace.ts` | 2 | CLI: `workspace init/sync/clone/pull/status` |
| Modify | `cli/src/local-extensions.ts` | 2 | Register new CLI commands |
| Create | `ui/src/api/workspace.ts` | 3 | UI API client for workspace routes |
| Create | `ui/src/pages/settings/WorkspaceSettings.tsx` | 3 | Settings page with status, sync button, setup wizard |
| Modify | `ui/src/components/Sidebar.tsx` | 3 | Add "Workspace" link under settings |
| Modify | `ui/src/pages/Dashboard.tsx` or header | 3 | Add "Last backup: ..." indicator |

---

# PHASE 1 — Extend Company Portability

Phase 1 ships an improved `company export/import` that includes the 3 custom features. After Phase 1, `paperclipai company export <id>` produces a bundle with pipelines/SOPs/knowledge sections, and `company import` restores them.

## Phase 1 Context (for subagents)

The existing code at `server/src/services/company-portability.ts` has a factory `companyPortabilityService(db)` returning `{ exportBundle, previewExport, previewImport, importBundle }`. The bundle structure produced is described in the exploration report — key points:

- `exportBundle` builds a `files: Record<string, CompanyPortabilityFileEntry>` in memory and constructs a `manifest: CompanyPortabilityManifest` JSON object
- Manifest includes arrays: `agents`, `projects`, `issues`, `skills` — we add `pipelines`, `sops`, `knowledgeCollections`
- A `.paperclip.yaml` at the root carries "extensions" metadata
- `importBundle` parses files back into a manifest, applies collision strategy (`rename` | `skip` | `replace`), creates/updates DB rows

The `include` flag on `CompanyPortabilityExport` currently controls which sections export. We add three new include flags: `pipelines`, `sops`, `knowledgeCollections`.

---

### Task 1: Pipelines — manifest types, export, import

**Files:**
- Modify: `packages/shared/src/types/company-portability.ts` (add manifest types)
- Modify: `server/src/services/company-portability.ts` (add inline export + import logic)
- Modify: `cli/src/commands/client/company.ts` (add `--include-pipelines` flag)

- [ ] **Step 1: Read the existing types and service to locate extension points**

Read these files fully before editing:
- `packages/shared/src/types/company-portability.ts` — find the `CompanyPortabilityManifest` interface and the `CompanyPortabilityInclude` interface
- `server/src/services/company-portability.ts` — find `exportBundle` (around line 2721), `importBundle` (around line 3322), and `classifyPortableFileKind` (around line 128)

- [ ] **Step 2: Add pipeline manifest types**

In `packages/shared/src/types/company-portability.ts`, add at the end of the file (but before any terminating export block):

```typescript
export interface CompanyPortabilityPipelineStageEntry {
  title: string;
  description: string | null;
  stageOrder: number;
  parallelGroup: string | null;
  loopConfig: { sourceStageId: string; fieldPath: string } | null;
  assigneeAgentSlug: string | null;  // references agent by slug, resolved on import
  requiredCapability: string | null;
  priority: string;
  requiresApproval: boolean;
  timeoutMinutes: number | null;
  suggestedSkillKey: string | null;  // references skill by key, resolved on import
  stageConfig: Record<string, unknown> | null;
}

export interface CompanyPortabilityPipelineManifestEntry {
  slug: string;
  title: string;
  description: string | null;
  projectSlug: string | null;
  goalSlug: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  stages: CompanyPortabilityPipelineStageEntry[];
}
```

Then update `CompanyPortabilityInclude` interface to add:
```typescript
  pipelines: boolean;
```

And `CompanyPortabilityManifest` interface to add:
```typescript
  pipelines: CompanyPortabilityPipelineManifestEntry[];
```

- [ ] **Step 3: Add pipeline export logic in `exportBundle`**

In `server/src/services/company-portability.ts`, import the schema:
```typescript
import { pipelineTemplates, pipelineStages } from "@paperclipai/db";
```

Find the section in `exportBundle` after the `issues` export (near the tasks/routines block). Add a new section:

```typescript
// ── Pipelines ──────────────────────────────────────────────────────
const pipelineManifestEntries: CompanyPortabilityPipelineManifestEntry[] = [];
if (include.pipelines) {
  const pipelines = await db
    .select()
    .from(pipelineTemplates)
    .where(eq(pipelineTemplates.companyId, companyId));

  for (const pipeline of pipelines) {
    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineTemplateId, pipeline.id))
      .orderBy(pipelineStages.stageOrder);

    const slug = uniqueSlug(
      pipeline.title,
      new Set(pipelineManifestEntries.map((p) => p.slug)),
    );
    const projectSlug = pipeline.projectId ? projectIdToSlug.get(pipeline.projectId) ?? null : null;
    const goalSlug = pipeline.goalId ? goalIdToSlug.get(pipeline.goalId) ?? null : null;

    const stageEntries: CompanyPortabilityPipelineStageEntry[] = stages.map((s) => ({
      title: s.title,
      description: s.description,
      stageOrder: s.stageOrder,
      parallelGroup: s.parallelGroup,
      loopConfig: s.loopConfig,
      assigneeAgentSlug: s.assigneeAgentId ? agentIdToSlug.get(s.assigneeAgentId) ?? null : null,
      requiredCapability: s.requiredCapability,
      priority: s.priority,
      requiresApproval: s.requiresApproval,
      timeoutMinutes: s.timeoutMinutes,
      suggestedSkillKey: s.suggestedSkillId ? skillIdToKey.get(s.suggestedSkillId) ?? null : null,
      stageConfig: s.stageConfig,
    }));

    const pipelineEntry: CompanyPortabilityPipelineManifestEntry = {
      slug,
      title: pipeline.title,
      description: pipeline.description,
      projectSlug,
      goalSlug,
      status: pipeline.status,
      metadata: pipeline.metadata,
      stages: stageEntries,
    };

    pipelineManifestEntries.push(pipelineEntry);

    // Write pipeline file
    files[`pipelines/${slug}/PIPELINE.md`] = {
      path: `pipelines/${slug}/PIPELINE.md`,
      kind: "pipeline",
      bytes: Buffer.from(buildMarkdown({
        name: pipeline.title,
        description: pipeline.description ?? "",
        status: pipeline.status,
        projectSlug,
        goalSlug,
        stages: stageEntries,
      }, pipeline.description ?? ""), "utf-8"),
    };
  }
}
```

Note: `projectIdToSlug`, `agentIdToSlug`, `goalIdToSlug`, `skillIdToKey` maps must already exist in `exportBundle` — find them near the top of the function and reuse them. If a map doesn't exist for goals, you may need to build it: `const goalIdToSlug = new Map(goals.map(g => [g.id, slugify(g.title)]))`.

- [ ] **Step 4: Add pipeline to the manifest output**

Near the end of `exportBundle` where the manifest object is constructed (around line 3280), add:
```typescript
pipelines: pipelineManifestEntries,
```

- [ ] **Step 5: Add `"pipeline"` to `classifyPortableFileKind`**

Find the function `classifyPortableFileKind` (around line 128) and add:
```typescript
if (normalized.startsWith("pipelines/")) return "pipeline";
```

- [ ] **Step 6: Add pipeline import logic in `importBundle`**

In `importBundle`, after the existing entity collision planning (around the `agentPlans`/`projectPlans` section), add:

```typescript
// ── Pipelines collision planning ───────────────────────────────────
const pipelinePlans: Array<{
  action: "create" | "skip" | "update";
  slug: string;
  manifestEntry: CompanyPortabilityPipelineManifestEntry;
  existingId: string | null;
}> = [];

if (manifest.pipelines && include.pipelines !== false) {
  const existingPipelines = await db
    .select()
    .from(pipelineTemplates)
    .where(eq(pipelineTemplates.companyId, targetCompanyId));
  const existingPipelineByTitle = new Map(
    existingPipelines.map((p) => [p.title.toLowerCase(), p]),
  );

  for (const manifestPipeline of manifest.pipelines) {
    const existing = existingPipelineByTitle.get(manifestPipeline.title.toLowerCase()) ?? null;
    if (!existing) {
      pipelinePlans.push({ action: "create", slug: manifestPipeline.slug, manifestEntry: manifestPipeline, existingId: null });
    } else if (collisionStrategy === "skip") {
      pipelinePlans.push({ action: "skip", slug: manifestPipeline.slug, manifestEntry: manifestPipeline, existingId: existing.id });
    } else if (collisionStrategy === "replace") {
      pipelinePlans.push({ action: "update", slug: manifestPipeline.slug, manifestEntry: manifestPipeline, existingId: existing.id });
    } else {
      // rename strategy
      const newTitle = uniqueNameBySlug(manifestPipeline.title, new Set(existingPipelines.map((p) => p.title)));
      pipelinePlans.push({ action: "create", slug: manifestPipeline.slug, manifestEntry: { ...manifestPipeline, title: newTitle }, existingId: null });
    }
  }
}
```

- [ ] **Step 7: Execute pipeline imports**

After the existing entity import execution, add:

```typescript
// ── Execute pipeline imports ───────────────────────────────────────
for (const plan of pipelinePlans) {
  if (plan.action === "skip") continue;

  const entry = plan.manifestEntry;
  const projectId = entry.projectSlug ? projectSlugToId.get(entry.projectSlug) ?? null : null;
  const goalId = entry.goalSlug ? goalSlugToId.get(entry.goalSlug) ?? null : null;

  let pipelineId: string;
  if (plan.action === "update" && plan.existingId) {
    pipelineId = plan.existingId;
    await db
      .update(pipelineTemplates)
      .set({
        title: entry.title,
        description: entry.description,
        projectId,
        goalId,
        status: entry.status,
        metadata: entry.metadata,
        updatedAt: new Date(),
      })
      .where(eq(pipelineTemplates.id, pipelineId));
    // Delete existing stages; we'll re-create them
    await db.delete(pipelineStages).where(eq(pipelineStages.pipelineTemplateId, pipelineId));
  } else {
    const [created] = await db
      .insert(pipelineTemplates)
      .values({
        companyId: targetCompanyId,
        title: entry.title,
        description: entry.description,
        projectId,
        goalId,
        status: entry.status,
        metadata: entry.metadata,
      })
      .returning();
    pipelineId = created.id;
  }

  // Create stages
  for (const stage of entry.stages) {
    const assigneeAgentId = stage.assigneeAgentSlug ? agentSlugToId.get(stage.assigneeAgentSlug) ?? null : null;
    const suggestedSkillId = stage.suggestedSkillKey ? skillKeyToId.get(stage.suggestedSkillKey) ?? null : null;
    await db.insert(pipelineStages).values({
      companyId: targetCompanyId,
      pipelineTemplateId: pipelineId,
      title: stage.title,
      description: stage.description,
      stageOrder: stage.stageOrder,
      parallelGroup: stage.parallelGroup,
      loopConfig: stage.loopConfig,
      assigneeAgentId,
      requiredCapability: stage.requiredCapability,
      priority: stage.priority,
      requiresApproval: stage.requiresApproval,
      timeoutMinutes: stage.timeoutMinutes,
      suggestedSkillId,
      stageConfig: stage.stageConfig,
    });
  }
}
```

Note: `agentSlugToId`, `projectSlugToId`, `goalSlugToId`, `skillKeyToId` maps must be built during import. If they don't exist for goals/skills, build them with the same pattern as agents: after inserting/resolving agents, build `agentSlugToId: Map<string, string>`.

- [ ] **Step 8: Add CLI flag**

In `cli/src/commands/client/company.ts`, find the export command's options. Add:
```typescript
.option("--include-pipelines", "Include pipelines in the export", true)
.option("--no-include-pipelines", "Exclude pipelines from the export")
```

Wire the flag into the `include: { pipelines: opts.includePipelines ?? true, ... }` object passed to the service.

Mirror the same flags on the `import` command.

- [ ] **Step 9: Run typecheck**

Run: `cd d:/paperclip && pnpm typecheck`

Fix any errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(portability): add pipelines to company export/import"
```

---

### Task 2: SOPs — manifest types, export with assets, import

**Files:**
- Modify: `packages/shared/src/types/company-portability.ts`
- Modify: `server/src/services/company-portability.ts`
- Modify: `cli/src/commands/client/company.ts`

- [ ] **Step 1: Read existing SOP schema and service**

Read:
- `packages/db/src/schema/sops.ts` — schema for `companySops` and `sopAssets`
- `server/src/services/sops.ts` — how SOPs and assets are created/read
- `server/src/services/company-portability.ts` — find `bufferToPortableBinaryFile` (around line 1264) for reference

- [ ] **Step 2: Add SOP manifest types**

In `packages/shared/src/types/company-portability.ts`, add:

```typescript
export interface CompanyPortabilitySopAssetEntry {
  relativePath: string;       // e.g. "assets/step_1.png"
  name: string;
  kind: string;
  contentType: string;
  stepNumber: number | null;
}

export interface CompanyPortabilitySopManifestEntry {
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  sourceType: string;
  status: string;
  markdown: string;           // the SOP content
  skillKey: string | null;    // if linked to a skill
  assets: CompanyPortabilitySopAssetEntry[];
  metadata: Record<string, unknown> | null;
}
```

Add to `CompanyPortabilityInclude`: `sops: boolean;`
Add to `CompanyPortabilityManifest`: `sops: CompanyPortabilitySopManifestEntry[];`

- [ ] **Step 3: Add SOP export logic**

In `server/src/services/company-portability.ts`, import:
```typescript
import { companySops, sopAssets } from "@paperclipai/db";
import { readFile } from "node:fs/promises";
```

After the pipelines export block, add:

```typescript
// ── SOPs ────────────────────────────────────────────────────────────
const sopManifestEntries: CompanyPortabilitySopManifestEntry[] = [];
if (include.sops) {
  const sops = await db
    .select()
    .from(companySops)
    .where(eq(companySops.companyId, companyId));

  for (const sop of sops) {
    const assets = await db
      .select()
      .from(sopAssets)
      .where(eq(sopAssets.sopId, sop.id));

    const slug = uniqueSlug(
      sop.title,
      new Set(sopManifestEntries.map((s) => s.slug)),
    );

    const assetEntries: CompanyPortabilitySopAssetEntry[] = [];
    for (const asset of assets) {
      const assetRelPath = `assets/${path.basename(asset.relativePath)}`;
      assetEntries.push({
        relativePath: assetRelPath,
        name: asset.name,
        kind: asset.kind,
        contentType: asset.contentType,
        stepNumber: asset.stepNumber ?? null,
      });

      // Read asset file and add to export bundle
      try {
        const buffer = await readFile(asset.absolutePath);
        files[`sops/${slug}/${assetRelPath}`] = {
          path: `sops/${slug}/${assetRelPath}`,
          kind: "sop-asset",
          bytes: buffer,
        };
      } catch {
        // Asset file missing — skip, will be noted in warnings
        warnings.push(`SOP "${sop.title}" asset "${asset.name}" file not found on disk`);
      }
    }

    sopManifestEntries.push({
      slug,
      title: sop.title,
      description: sop.description,
      category: sop.category,
      sourceType: sop.sourceType,
      status: sop.status,
      markdown: sop.markdown ?? "",
      skillKey: sop.skillId ? skillIdToKey.get(sop.skillId) ?? null : null,
      assets: assetEntries,
      metadata: sop.metadata,
    });

    // Write SOP markdown file
    files[`sops/${slug}/SOP.md`] = {
      path: `sops/${slug}/SOP.md`,
      kind: "sop",
      bytes: Buffer.from(sop.markdown ?? "", "utf-8"),
    };

    // Write SOP metadata JSON
    files[`sops/${slug}/sop.json`] = {
      path: `sops/${slug}/sop.json`,
      kind: "sop-meta",
      bytes: Buffer.from(JSON.stringify({
        title: sop.title,
        description: sop.description,
        category: sop.category,
        status: sop.status,
        sourceType: sop.sourceType,
        skillKey: sop.skillId ? skillIdToKey.get(sop.skillId) ?? null : null,
      }, null, 2), "utf-8"),
    };
  }
}
```

Note: The exact asset field names (`asset.absolutePath`, `asset.stepNumber`) depend on the SOP schema. Verify against `packages/db/src/schema/sops.ts` and adjust.

- [ ] **Step 4: Add SOP to manifest output and classifyPortableFileKind**

At the manifest build:
```typescript
sops: sopManifestEntries,
```

In `classifyPortableFileKind`:
```typescript
if (normalized.startsWith("sops/") && normalized.endsWith(".md")) return "sop";
if (normalized.startsWith("sops/") && normalized.includes("/assets/")) return "sop-asset";
if (normalized.startsWith("sops/") && normalized.endsWith(".json")) return "sop-meta";
```

- [ ] **Step 5: Add SOP import logic**

After the pipeline import execution block, add SOP import:

```typescript
// ── SOPs collision planning + execution ────────────────────────────
if (manifest.sops && include.sops !== false) {
  const existingSops = await db
    .select()
    .from(companySops)
    .where(eq(companySops.companyId, targetCompanyId));
  const existingByTitle = new Map(existingSops.map((s) => [s.title.toLowerCase(), s]));

  for (const manifestSop of manifest.sops) {
    let sopTitle = manifestSop.title;
    let action: "create" | "skip" | "update" = "create";
    let existingId: string | null = null;

    const existing = existingByTitle.get(sopTitle.toLowerCase());
    if (existing) {
      if (collisionStrategy === "skip") { action = "skip"; }
      else if (collisionStrategy === "replace") { action = "update"; existingId = existing.id; }
      else { sopTitle = uniqueNameBySlug(sopTitle, new Set(existingSops.map((s) => s.title))); }
    }

    if (action === "skip") continue;

    const skillId = manifestSop.skillKey ? skillKeyToId.get(manifestSop.skillKey) ?? null : null;

    let sopId: string;
    if (action === "update" && existingId) {
      sopId = existingId;
      await db
        .update(companySops)
        .set({
          title: sopTitle,
          description: manifestSop.description,
          category: manifestSop.category,
          status: manifestSop.status,
          markdown: manifestSop.markdown,
          skillId,
          metadata: manifestSop.metadata,
          updatedAt: new Date(),
        })
        .where(eq(companySops.id, sopId));
      await db.delete(sopAssets).where(eq(sopAssets.sopId, sopId));
    } else {
      const [created] = await db
        .insert(companySops)
        .values({
          companyId: targetCompanyId,
          title: sopTitle,
          description: manifestSop.description,
          category: manifestSop.category,
          sourceType: manifestSop.sourceType,
          status: manifestSop.status,
          markdown: manifestSop.markdown,
          skillId,
          metadata: manifestSop.metadata,
        })
        .returning();
      sopId = created.id;
    }

    // Import assets: write them to the instance storage dir
    for (const asset of manifestSop.assets) {
      const fileEntry = files[`sops/${manifestSop.slug}/${asset.relativePath}`];
      if (!fileEntry) continue;

      // Write asset to instance SOP storage dir
      const storageDir = getSopAssetStorageDir(sopId);
      await mkdir(storageDir, { recursive: true });
      const absolutePath = path.join(storageDir, path.basename(asset.relativePath));
      await writeFile(absolutePath, fileEntry.bytes);

      await db.insert(sopAssets).values({
        companyId: targetCompanyId,
        sopId,
        relativePath: asset.relativePath,
        absolutePath,
        name: asset.name,
        kind: asset.kind,
        contentType: asset.contentType,
        stepNumber: asset.stepNumber,
      });
    }
  }
}
```

Note: `getSopAssetStorageDir(sopId)` must resolve to the instance's SOP asset dir (typically `~/.paperclip/instances/<id>/data/sops/<sopId>/assets/`). Check existing SOP service for the helper — if it doesn't exist, create a small helper in this file:

```typescript
function getSopAssetStorageDir(sopId: string): string {
  const home = process.env.PAPERCLIP_HOME?.trim() || path.join(os.homedir(), ".paperclip");
  const instance = process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default";
  return path.join(home, "instances", instance, "data", "sops", sopId, "assets");
}
```

Import `mkdir, writeFile` from `node:fs/promises` and `os` from `node:os`.

- [ ] **Step 6: Add CLI flag + typecheck + commit**

```bash
# Add flags in cli/src/commands/client/company.ts mirroring pipelines
# Then:
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(portability): add SOPs (with screenshot assets) to company export/import"
```

---

### Task 3: Knowledge Collections — metadata-only export with path re-mapping

**Files:**
- Modify: `packages/shared/src/types/company-portability.ts`
- Modify: `server/src/services/company-portability.ts`
- Modify: `cli/src/commands/client/company.ts`

- [ ] **Step 1: Read knowledge schema**

Read `packages/db/src/schema/knowledge.ts` for `knowledgeCollections` and `knowledgeEntries` fields.

- [ ] **Step 2: Add manifest types**

In `packages/shared/src/types/company-portability.ts`:

```typescript
export interface CompanyPortabilityKnowledgeCollectionManifestEntry {
  slug: string;
  name: string;
  description: string | null;
  projectSlug: string | null;
  sourceType: string;         // "local_path" | "github" | "url"
  sourcePath: string;          // original absolute path (may not resolve on new machine)
  sourcePathPortable: string | null;  // best-effort portable hint (e.g. "nocodepro-me/projects/...")
  autoDiscover: boolean;
  status: string;
  // Entries are NOT exported (files live on disk, not in the bundle)
  // On import, we prompt for a new sourcePath if the original doesn't resolve
}
```

Add to `CompanyPortabilityInclude`: `knowledgeCollections: boolean;`
Add to `CompanyPortabilityManifest`: `knowledgeCollections: CompanyPortabilityKnowledgeCollectionManifestEntry[];`

- [ ] **Step 3: Add knowledge export logic**

In `server/src/services/company-portability.ts`:

```typescript
import { knowledgeCollections } from "@paperclipai/db";

// After SOP export block:
const knowledgeManifestEntries: CompanyPortabilityKnowledgeCollectionManifestEntry[] = [];
if (include.knowledgeCollections) {
  const collections = await db
    .select()
    .from(knowledgeCollections)
    .where(eq(knowledgeCollections.companyId, companyId));

  for (const collection of collections) {
    const slug = uniqueSlug(
      collection.name,
      new Set(knowledgeManifestEntries.map((k) => k.slug)),
    );
    const projectSlug = collection.projectId ? projectIdToSlug.get(collection.projectId) ?? null : null;

    // Build portable path hint: strip Windows drive letter, normalize slashes
    const portable = collection.sourcePath
      .replace(/^[A-Za-z]:[/\\]/, "")
      .replace(/\\/g, "/");

    const entry: CompanyPortabilityKnowledgeCollectionManifestEntry = {
      slug,
      name: collection.name,
      description: collection.description,
      projectSlug,
      sourceType: collection.sourceType,
      sourcePath: collection.sourcePath,
      sourcePathPortable: portable,
      autoDiscover: collection.autoDiscover,
      status: collection.status,
    };
    knowledgeManifestEntries.push(entry);

    // Write collection JSON for reviewability
    files[`knowledge/${slug}.json`] = {
      path: `knowledge/${slug}.json`,
      kind: "knowledge-collection",
      bytes: Buffer.from(JSON.stringify(entry, null, 2), "utf-8"),
    };
  }
}
```

At manifest build:
```typescript
knowledgeCollections: knowledgeManifestEntries,
```

Add to `classifyPortableFileKind`:
```typescript
if (normalized.startsWith("knowledge/")) return "knowledge-collection";
```

- [ ] **Step 4: Add knowledge import logic**

After SOP import block:

```typescript
if (manifest.knowledgeCollections && include.knowledgeCollections !== false) {
  const existingCollections = await db
    .select()
    .from(knowledgeCollections)
    .where(eq(knowledgeCollections.companyId, targetCompanyId));
  const existingByName = new Map(existingCollections.map((c) => [c.name.toLowerCase(), c]));

  for (const manifestCol of manifest.knowledgeCollections) {
    // Check if sourcePath resolves on this machine
    let resolvedPath = manifestCol.sourcePath;
    let pathWarning: string | null = null;
    try {
      const fs = await import("node:fs/promises");
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        pathWarning = `Path is not a directory: ${resolvedPath}`;
      }
    } catch {
      pathWarning = `Source path does not exist on this machine: ${resolvedPath}`;
    }

    if (pathWarning) {
      warnings.push(`Knowledge collection "${manifestCol.name}": ${pathWarning}. Collection will be created in "unreachable" status; rescan with a valid path to activate.`);
    }

    let colName = manifestCol.name;
    const existing = existingByName.get(colName.toLowerCase());
    if (existing) {
      if (collisionStrategy === "skip") continue;
      if (collisionStrategy === "rename") {
        colName = uniqueNameBySlug(colName, new Set(existingCollections.map((c) => c.name)));
      }
      // 'replace' falls through and creates new — knowledge collections cascade on company, not replaceable inline
    }

    const projectId = manifestCol.projectSlug ? projectSlugToId.get(manifestCol.projectSlug) ?? null : null;

    await db.insert(knowledgeCollections).values({
      companyId: targetCompanyId,
      projectId,
      name: colName,
      description: manifestCol.description,
      sourceType: manifestCol.sourceType,
      sourcePath: resolvedPath,
      autoDiscover: manifestCol.autoDiscover,
      status: pathWarning ? "unreachable" : manifestCol.status,
    });

    // NOTE: entries (indexed files) are not imported — user must run rescan on the new machine
    // after correcting the sourcePath if needed
  }
}
```

- [ ] **Step 5: Add CLI flag + typecheck + commit**

```bash
# Add --include-knowledge flags
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(portability): add knowledge collections to company export/import"
```

---

### Task 4: Phase 1 integration test

- [ ] **Step 1: Ensure dev server is running**

```bash
cd d:/paperclip && pnpm dev
```

- [ ] **Step 2: Create a test company with custom features**

Via API or UI, create:
- A company (or use the existing "default" company)
- A pipeline with 2-3 stages
- A SOP with screenshots (use the Modliflex references or create a small one)
- A knowledge collection pointing to a small directory

- [ ] **Step 3: Export the company**

```bash
pnpm paperclipai company export <companyId> --out ./test-export
```

Verify the exported directory contains:
- `pipelines/<slug>/PIPELINE.md`
- `sops/<slug>/SOP.md` and `sops/<slug>/sop.json` and `sops/<slug>/assets/*.png`
- `knowledge/<slug>.json`
- Top-level manifest includes `pipelines`, `sops`, `knowledgeCollections` arrays

- [ ] **Step 4: Delete the test company and re-import**

```bash
# Delete via API (or create a fresh throwaway company instead)
curl -X POST http://localhost:3100/api/companies/import -F "bundle=@./test-export.zip"
# Or via CLI:
pnpm paperclipai company import ./test-export
```

- [ ] **Step 5: Verify all data is restored**

- Pipelines exist with stages in correct order
- SOPs exist with markdown and screenshot assets readable from the UI
- Knowledge collection exists (may be marked `unreachable` if path doesn't resolve, which is expected)

- [ ] **Step 6: Commit any integration fixes**

```bash
git add -A
git commit -m "fix(portability): integration fixes for phase 1 round-trip"
```

---

# PHASE 2 — Workspace-level + Git Integration

Phase 2 builds the "export the entire instance" orchestrator and the Git CLI integration. After Phase 2, `paperclipai workspace sync` backs up everything to GitHub in one command.

---

### Task 5: Config schema — add workspace section

**Files:**
- Modify: `packages/shared/src/config-schema.ts`

- [ ] **Step 1: Add workspace schema**

In `packages/shared/src/config-schema.ts`, add a workspace schema near the existing `storage` / `secrets` sections:

```typescript
export const workspaceConfigSchema = z.object({
  gitRemote: z.string().optional(),              // e.g. "https://github.com/nocodepro-dev/paperclip-workspace.git"
  localPath: z.string().default("~/.paperclip/instances/default/workspace"),
  autoSync: z.boolean().default(false),          // if true, sync after every major change
  branch: z.string().default("main"),
}).default({
  localPath: "~/.paperclip/instances/default/workspace",
  autoSync: false,
  branch: "main",
});
```

Add to the root `paperclipConfigSchema`:
```typescript
workspace: workspaceConfigSchema,
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add workspace config schema"
```

---

### Task 6: Git CLI wrapper

**Files:**
- Create: `server/src/services/workspace-git.ts`

- [ ] **Step 1: Create the git wrapper**

Write `server/src/services/workspace-git.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

export async function gitRun(cwd: string, args: string[], timeoutMs = 120_000): Promise<GitResult> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,  // 10MB output buffer
  });
  return { stdout, stderr };
}

export async function ensureWorkspaceDir(workspaceDir: string): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
}

export async function isGitRepo(workspaceDir: string): Promise<boolean> {
  try {
    await gitRun(workspaceDir, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function initRepo(workspaceDir: string, remoteUrl: string, branch = "main"): Promise<void> {
  await ensureWorkspaceDir(workspaceDir);
  await gitRun(workspaceDir, ["init", "-b", branch]);
  await gitRun(workspaceDir, ["remote", "add", "origin", remoteUrl]);
}

export async function cloneRepo(remoteUrl: string, targetDir: string, branch = "main"): Promise<void> {
  const parent = path.dirname(targetDir);
  await mkdir(parent, { recursive: true });
  await gitRun(parent, ["clone", "-b", branch, remoteUrl, path.basename(targetDir)], 600_000);
}

export async function commitAll(workspaceDir: string, message: string): Promise<{ committed: boolean; sha: string | null }> {
  await gitRun(workspaceDir, ["add", "-A"]);
  const statusResult = await gitRun(workspaceDir, ["status", "--porcelain"]);
  if (!statusResult.stdout.trim()) {
    return { committed: false, sha: null };
  }
  await gitRun(workspaceDir, ["commit", "-m", message]);
  const shaResult = await gitRun(workspaceDir, ["rev-parse", "HEAD"]);
  return { committed: true, sha: shaResult.stdout.trim() };
}

export async function push(workspaceDir: string, branch = "main"): Promise<void> {
  await gitRun(workspaceDir, ["push", "-u", "origin", branch], 600_000);
}

export async function pull(workspaceDir: string, branch = "main"): Promise<void> {
  await gitRun(workspaceDir, ["pull", "origin", branch], 600_000);
}

export async function getStatus(workspaceDir: string): Promise<{
  hasRemote: boolean;
  remoteUrl: string | null;
  pendingChanges: number;
  lastCommit: { sha: string; message: string; date: string } | null;
}> {
  if (!(await isGitRepo(workspaceDir))) {
    return { hasRemote: false, remoteUrl: null, pendingChanges: 0, lastCommit: null };
  }

  let remoteUrl: string | null = null;
  try {
    const r = await gitRun(workspaceDir, ["remote", "get-url", "origin"]);
    remoteUrl = r.stdout.trim() || null;
  } catch {
    // no remote
  }

  const status = await gitRun(workspaceDir, ["status", "--porcelain"]);
  const pendingChanges = status.stdout.trim().split("\n").filter((l) => l.trim()).length;

  let lastCommit = null;
  try {
    const logResult = await gitRun(workspaceDir, ["log", "-1", "--format=%H%x00%s%x00%aI"]);
    const [sha, message, date] = logResult.stdout.trim().split("\x00");
    if (sha) lastCommit = { sha, message, date };
  } catch {
    // no commits
  }

  return { hasRemote: !!remoteUrl, remoteUrl, pendingChanges, lastCommit };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add git CLI wrapper for workspace operations"
```

---

### Task 7: Runtime log exporters

**Files:**
- Create: `server/src/services/workspace-runtime-logs.ts`

- [ ] **Step 1: Create runtime log exporter/importer**

Write `server/src/services/workspace-runtime-logs.ts`:

```typescript
import { createWriteStream, createReadStream } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { Db } from "@paperclipai/db";
import { activityLog, costEvents, heartbeatRuns } from "@paperclipai/db";
import { asc } from "drizzle-orm";

const BATCH_SIZE = 500;

async function exportTableToNdjsonGz<T>(
  db: Db,
  tableSelector: () => Promise<T[]>,
  outputPath: string,
): Promise<number> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const rows = await tableSelector();
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  const gz = createGzip();
  const out = createWriteStream(outputPath);
  await pipeline(Readable.from([ndjson]), gz, out);
  return rows.length;
}

export async function exportActivityLog(db: Db, workspaceDir: string): Promise<number> {
  return exportTableToNdjsonGz(
    db,
    () => db.select().from(activityLog).orderBy(asc(activityLog.createdAt)),
    path.join(workspaceDir, "runtime", "activity-log.ndjson.gz"),
  );
}

export async function exportCostEvents(db: Db, workspaceDir: string): Promise<number> {
  return exportTableToNdjsonGz(
    db,
    () => db.select().from(costEvents).orderBy(asc(costEvents.occurredAt)),
    path.join(workspaceDir, "runtime", "cost-events.ndjson.gz"),
  );
}

export async function exportHeartbeatRuns(db: Db, workspaceDir: string): Promise<number> {
  return exportTableToNdjsonGz(
    db,
    () => db.select().from(heartbeatRuns).orderBy(asc(heartbeatRuns.startedAt)),
    path.join(workspaceDir, "runtime", "heartbeat-runs.ndjson.gz"),
  );
}

async function readNdjsonGz(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    await stat(filePath);
  } catch {
    return [];
  }
  const chunks: Buffer[] = [];
  await pipeline(createReadStream(filePath), createGunzip(), async function* (source) {
    for await (const chunk of source) {
      chunks.push(chunk as Buffer);
    }
  });
  const text = Buffer.concat(chunks).toString("utf-8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export async function importRuntimeLogs(db: Db, workspaceDir: string): Promise<{
  activity: number;
  costs: number;
  heartbeats: number;
}> {
  const activityRows = await readNdjsonGz(path.join(workspaceDir, "runtime", "activity-log.ndjson.gz"));
  const costRows = await readNdjsonGz(path.join(workspaceDir, "runtime", "cost-events.ndjson.gz"));
  const hbRows = await readNdjsonGz(path.join(workspaceDir, "runtime", "heartbeat-runs.ndjson.gz"));

  // Insert in batches, ON CONFLICT DO NOTHING-style (idempotent import)
  for (let i = 0; i < activityRows.length; i += BATCH_SIZE) {
    await db.insert(activityLog).values(activityRows.slice(i, i + BATCH_SIZE) as any).onConflictDoNothing();
  }
  for (let i = 0; i < costRows.length; i += BATCH_SIZE) {
    await db.insert(costEvents).values(costRows.slice(i, i + BATCH_SIZE) as any).onConflictDoNothing();
  }
  for (let i = 0; i < hbRows.length; i += BATCH_SIZE) {
    await db.insert(heartbeatRuns).values(hbRows.slice(i, i + BATCH_SIZE) as any).onConflictDoNothing();
  }

  return { activity: activityRows.length, costs: costRows.length, heartbeats: hbRows.length };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add runtime log exporter/importer (activity/cost/heartbeat)"
```

---

### Task 8: Workspace portability orchestrator

**Files:**
- Create: `server/src/services/workspace-portability.ts`

- [ ] **Step 1: Create the orchestrator**

Write `server/src/services/workspace-portability.ts`:

```typescript
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { companyPortabilityService } from "./company-portability.js";
import {
  exportActivityLog,
  exportCostEvents,
  exportHeartbeatRuns,
  importRuntimeLogs,
} from "./workspace-runtime-logs.js";

const WORKSPACE_SCHEMA_VERSION = 1;

async function readRootPackageVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const url = new URL("../../../package.json", import.meta.url);
    const text = await readFile(url, "utf-8");
    return (JSON.parse(text).version as string) || "unknown";
  } catch {
    return "unknown";
  }
}

export interface WorkspaceExportResult {
  workspaceDir: string;
  companies: number;
  activityLogEntries: number;
  costEvents: number;
  heartbeatRuns: number;
  warnings: string[];
}

export interface WorkspaceImportResult {
  companies: number;
  activityLogEntries: number;
  costEvents: number;
  heartbeatRuns: number;
  warnings: string[];
}

export function resolveWorkspaceDir(configuredPath?: string): string {
  const home = process.env.PAPERCLIP_HOME?.trim() || path.join(os.homedir(), ".paperclip");
  const instance = process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default";
  if (configuredPath && configuredPath.trim()) {
    return configuredPath.startsWith("~")
      ? path.join(home, configuredPath.slice(1).replace(/^[/\\]/, ""))
      : configuredPath;
  }
  return path.join(home, "instances", instance, "workspace");
}

export function workspacePortabilityService(db: Db) {
  const companyPortability = companyPortabilityService(db);

  async function exportWorkspace(workspaceDir: string): Promise<WorkspaceExportResult> {
    await mkdir(workspaceDir, { recursive: true });
    // Clean existing companies/, runtime/ dirs — we rewrite everything
    await rm(path.join(workspaceDir, "companies"), { recursive: true, force: true });
    await rm(path.join(workspaceDir, "runtime"), { recursive: true, force: true });

    const warnings: string[] = [];
    const allCompanies = await db.select().from(companies);

    // Export each company via company-portability
    for (const company of allCompanies) {
      const exportResult = await companyPortability.exportBundle(company.id, {
        include: {
          company: true,
          agents: true,
          projects: true,
          issues: true,
          skills: true,
          pipelines: true,
          sops: true,
          knowledgeCollections: true,
        },
        mode: "board_full",
      });
      warnings.push(...exportResult.warnings);

      const companyDir = path.join(workspaceDir, "companies", exportResult.rootPath);
      await mkdir(companyDir, { recursive: true });
      for (const [relPath, entry] of Object.entries(exportResult.files)) {
        const fullPath = path.join(companyDir, relPath);
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, entry.bytes);
      }

      // Write the company manifest
      await writeFile(
        path.join(companyDir, "manifest.json"),
        JSON.stringify(exportResult.manifest, null, 2),
      );
    }

    // Export runtime logs
    const activityCount = await exportActivityLog(db, workspaceDir);
    const costCount = await exportCostEvents(db, workspaceDir);
    const hbCount = await exportHeartbeatRuns(db, workspaceDir);

    // Write top-level manifest
    const topManifest = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      instanceId: process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default",
      paperclipVersion: await readRootPackageVersion(),
      companies: allCompanies.map((c) => ({ id: c.id, name: c.name })),
      stats: {
        companies: allCompanies.length,
        activityLog: activityCount,
        costEvents: costCount,
        heartbeatRuns: hbCount,
      },
    };
    await writeFile(path.join(workspaceDir, "MANIFEST.json"), JSON.stringify(topManifest, null, 2));

    // Write README
    const readme = `# Paperclip Workspace

Exported: ${topManifest.exportedAt}
Instance: ${topManifest.instanceId}
Companies: ${allCompanies.length}
Activity log entries: ${activityCount}
Cost events: ${costCount}
Heartbeat runs: ${hbCount}

## Contents

- \`companies/\` — one directory per company with agents, projects, tasks, pipelines, SOPs, knowledge metadata
- \`runtime/\` — compressed activity logs, cost events, heartbeat runs
- \`MANIFEST.json\` — top-level manifest
- \`.env.template\` — scrubbed secrets (fill in on import)

## Restoring on a new machine

1. Install Paperclip on the new machine
2. Run: \`paperclipai workspace clone <git-url>\`
3. Fill in \`.env.template\` with your secrets
4. Re-map any knowledge collection paths that don't resolve
`;
    await writeFile(path.join(workspaceDir, "README.md"), readme);

    return {
      workspaceDir,
      companies: allCompanies.length,
      activityLogEntries: activityCount,
      costEvents: costCount,
      heartbeatRuns: hbCount,
      warnings,
    };
  }

  async function importWorkspace(workspaceDir: string, opts: { collisionStrategy?: "rename" | "skip" | "replace" } = {}): Promise<WorkspaceImportResult> {
    const strategy = opts.collisionStrategy ?? "rename";
    const warnings: string[] = [];

    // Read top-level manifest
    const manifestPath = path.join(workspaceDir, "MANIFEST.json");
    const manifestText = await (await import("node:fs/promises")).readFile(manifestPath, "utf-8");
    const topManifest = JSON.parse(manifestText);

    // Import each company
    const companiesDir = path.join(workspaceDir, "companies");
    const { readdir, readFile } = await import("node:fs/promises");
    const companyDirs = await readdir(companiesDir);
    let importedCompanies = 0;

    for (const companySlug of companyDirs) {
      const companyDir = path.join(companiesDir, companySlug);
      const manifestFile = path.join(companyDir, "manifest.json");
      const companyManifest = JSON.parse(await readFile(manifestFile, "utf-8"));

      // Read all files from company dir into the `files` record
      const files: Record<string, { path: string; kind: string; bytes: Buffer }> = {};
      async function walk(dir: string, rel: string = "") {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === "manifest.json") continue;
          const full = path.join(dir, e.name);
          const relPath = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            await walk(full, relPath);
          } else {
            files[relPath] = { path: relPath, kind: "", bytes: await readFile(full) };
          }
        }
      }
      await walk(companyDir);

      await companyPortability.importBundle({
        source: { type: "memory", manifest: companyManifest, files },
        target: { mode: "new_company" },
        collisionStrategy: strategy,
        include: {
          company: true,
          agents: true,
          projects: true,
          issues: true,
          skills: true,
          pipelines: true,
          sops: true,
          knowledgeCollections: true,
        },
      });
      importedCompanies++;
    }

    // Import runtime logs
    const logResult = await importRuntimeLogs(db, workspaceDir);

    return {
      companies: importedCompanies,
      activityLogEntries: logResult.activity,
      costEvents: logResult.costs,
      heartbeatRuns: logResult.heartbeats,
      warnings,
    };
  }

  return { exportWorkspace, importWorkspace };
}
```

Note: `companyPortability.importBundle` may not support a `memory` source type yet — check its signature. If not, write the files to a temp directory first and use `source: { type: "directory", path: tempDir }`.

- [ ] **Step 2: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add workspace portability orchestrator"
```

---

### Task 9: Workspace routes

**Files:**
- Create: `server/src/routes/workspace.ts`
- Modify: `server/src/routes/local-extensions.ts`
- Modify: `server/src/local-extensions.ts`
- Modify: `server/src/services/local-extensions.ts`

- [ ] **Step 1: Create workspace routes**

Write `server/src/routes/workspace.ts`:

```typescript
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { workspacePortabilityService, resolveWorkspaceDir } from "../services/workspace-portability.js";
import { getStatus, initRepo, commitAll, push, pull, cloneRepo, isGitRepo } from "../services/workspace-git.js";
import { assertBoardAccess } from "./authz.js";

export function workspaceRoutes(db: Db): Router {
  const router = Router();
  const svc = workspacePortabilityService(db);

  router.get("/workspace/status", async (req, res) => {
    assertBoardAccess(req);
    const workspaceDir = resolveWorkspaceDir();
    const status = await getStatus(workspaceDir);
    res.json({ workspaceDir, ...status });
  });

  router.post("/workspace/export", async (req, res) => {
    assertBoardAccess(req);
    const workspaceDir = resolveWorkspaceDir();
    try {
      const result = await svc.exportWorkspace(workspaceDir);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      res.status(500).json({ error: message });
    }
  });

  router.post("/workspace/import", async (req, res) => {
    assertBoardAccess(req);
    const workspaceDir = resolveWorkspaceDir();
    const collisionStrategy = req.body?.collisionStrategy ?? "rename";
    try {
      const result = await svc.importWorkspace(workspaceDir, { collisionStrategy });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      res.status(500).json({ error: message });
    }
  });

  router.post("/workspace/init", async (req, res) => {
    assertBoardAccess(req);
    const { remoteUrl, branch = "main" } = req.body ?? {};
    if (!remoteUrl || typeof remoteUrl !== "string") {
      res.status(400).json({ error: "remoteUrl is required" });
      return;
    }
    const workspaceDir = resolveWorkspaceDir();
    try {
      if (await isGitRepo(workspaceDir)) {
        res.status(409).json({ error: "Workspace is already initialized as a git repo" });
        return;
      }
      await initRepo(workspaceDir, remoteUrl, branch);
      res.json({ ok: true, workspaceDir, remoteUrl, branch });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Init failed" });
    }
  });

  router.post("/workspace/sync", async (req, res) => {
    assertBoardAccess(req);
    const workspaceDir = resolveWorkspaceDir();
    try {
      const exportResult = await svc.exportWorkspace(workspaceDir);
      const commit = await commitAll(workspaceDir, `Workspace snapshot ${new Date().toISOString()}`);
      if (commit.committed) {
        await push(workspaceDir);
      }
      res.json({ ok: true, exported: exportResult, committed: commit.committed, commitSha: commit.sha });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
    }
  });

  router.post("/workspace/pull", async (req, res) => {
    assertBoardAccess(req);
    const workspaceDir = resolveWorkspaceDir();
    try {
      await pull(workspaceDir);
      const importResult = await svc.importWorkspace(workspaceDir, { collisionStrategy: "skip" });
      res.json({ ok: true, imported: importResult });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Pull failed" });
    }
  });

  router.post("/workspace/clone", async (req, res) => {
    assertBoardAccess(req);
    const { remoteUrl, branch = "main" } = req.body ?? {};
    if (!remoteUrl) {
      res.status(400).json({ error: "remoteUrl is required" });
      return;
    }
    const workspaceDir = resolveWorkspaceDir();
    try {
      await cloneRepo(remoteUrl, workspaceDir, branch);
      const importResult = await svc.importWorkspace(workspaceDir, { collisionStrategy: "rename" });
      res.json({ ok: true, imported: importResult });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Clone failed" });
    }
  });

  return router;
}
```

Note: If `assertBoardAccess` doesn't exist in `authz.ts`, use the authorization pattern used by other sensitive routes (check for admin user or similar). Inspect `server/src/routes/authz.ts` to find the right helper.

- [ ] **Step 2: Register the routes**

In `server/src/routes/local-extensions.ts`, add:
```typescript
export { workspaceRoutes } from "./workspace.js";
```

In `server/src/local-extensions.ts`, import and register:
```typescript
import { workspaceRoutes } from "./routes/workspace.js";
// ... inside registerLocalRoutes:
api.use(workspaceRoutes(db));
```

In `server/src/services/local-extensions.ts`, add:
```typescript
export { workspacePortabilityService, resolveWorkspaceDir } from "./workspace-portability.js";
export * as workspaceGit from "./workspace-git.js";
export * as workspaceRuntimeLogs from "./workspace-runtime-logs.js";
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add workspace routes (export/import/init/sync/pull/clone/status)"
```

---

### Task 10: Workspace CLI commands

**Files:**
- Create: `cli/src/commands/client/workspace.ts`
- Modify: `cli/src/local-extensions.ts`

- [ ] **Step 1: Create CLI commands**

Write `cli/src/commands/client/workspace.ts`:

```typescript
import { Command } from "commander";
import pc from "picocolors";
import type { BaseClientOptions } from "./common.js";
import {
  addCommonClientOptions,
  handleCommandError,
  printOutput,
  resolveCommandContext,
} from "./common.js";

export function registerWorkspaceCommands(program: Command): void {
  const ws = program.command("workspace").description("Workspace export/import and Git sync operations");

  // workspace status
  addCommonClientOptions(
    ws.command("status")
      .description("Show workspace Git status and last sync info")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.get<any>("/api/workspace/status");
          if (ctx.json) { printOutput(result, { json: true }); return; }
          if (!result) { console.log(pc.dim("No workspace info available.")); return; }
          console.log(`Workspace dir: ${result.workspaceDir}`);
          console.log(`Has remote: ${result.hasRemote ? pc.green("yes") : pc.yellow("no")}`);
          if (result.remoteUrl) console.log(`Remote: ${result.remoteUrl}`);
          console.log(`Pending changes: ${result.pendingChanges}`);
          if (result.lastCommit) {
            console.log(`Last commit: ${result.lastCommit.sha.slice(0, 7)} — ${result.lastCommit.message}`);
            console.log(`  at ${result.lastCommit.date}`);
          } else {
            console.log(pc.dim("No commits yet."));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace init <git-url>
  addCommonClientOptions(
    ws.command("init")
      .description("Initialize the workspace directory and link it to a Git remote")
      .argument("<remoteUrl>", "Git remote URL (e.g. https://github.com/user/repo.git)")
      .option("--branch <branch>", "Branch name", "main")
      .action(async (remoteUrl: string, opts: BaseClientOptions & { branch: string }) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.post<any>("/api/workspace/init", { remoteUrl, branch: opts.branch });
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Workspace initialized at ${result.workspaceDir}`));
          console.log(`  Remote: ${result.remoteUrl}`);
          console.log(`  Branch: ${result.branch}`);
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace sync
  addCommonClientOptions(
    ws.command("sync")
      .description("Export, commit, and push the workspace to the configured Git remote")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          console.log(pc.dim("Exporting workspace..."));
          const result = await ctx.api.post<any>("/api/workspace/sync", {});
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Exported ${result.exported.companies} companies`));
          if (result.committed) {
            console.log(pc.green(`✓ Committed and pushed (sha: ${result.commitSha?.slice(0, 7)})`));
          } else {
            console.log(pc.dim("No changes to commit."));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace clone <git-url>
  addCommonClientOptions(
    ws.command("clone")
      .description("Clone a workspace from Git and import it into this Paperclip instance")
      .argument("<remoteUrl>", "Git remote URL to clone")
      .option("--branch <branch>", "Branch to clone", "main")
      .action(async (remoteUrl: string, opts: BaseClientOptions & { branch: string }) => {
        try {
          const ctx = resolveCommandContext(opts);
          console.log(pc.dim("Cloning workspace..."));
          const result = await ctx.api.post<any>("/api/workspace/clone", { remoteUrl, branch: opts.branch });
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Imported ${result.imported.companies} companies`));
          console.log(`  Activity entries: ${result.imported.activityLogEntries}`);
          console.log(`  Cost events: ${result.imported.costEvents}`);
          console.log(`  Heartbeat runs: ${result.imported.heartbeatRuns}`);
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace pull
  addCommonClientOptions(
    ws.command("pull")
      .description("Pull workspace changes from Git and apply to the DB")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.post<any>("/api/workspace/pull", {});
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Pull complete: ${result.imported.companies} companies applied`));
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );
}
```

- [ ] **Step 2: Register the commands**

In `cli/src/local-extensions.ts`:
```typescript
import { registerWorkspaceCommands } from "./commands/client/workspace.js";
// ... inside registerLocalCommands:
registerWorkspaceCommands(program);
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add CLI commands (status/init/sync/clone/pull)"
```

---

### Task 11: Phase 2 end-to-end Git round-trip test

- [ ] **Step 1: Create a test GitHub repo**

On GitHub, create an empty private repo: `nocodepro-dev/paperclip-workspace-test`. Don't initialize with README.

- [ ] **Step 2: Initialize workspace and sync**

```bash
cd d:/paperclip && pnpm dev  # start the server
# In a new terminal:
pnpm paperclipai workspace init https://github.com/nocodepro-dev/paperclip-workspace-test.git
pnpm paperclipai workspace sync
```

Verify on GitHub that the repo now contains:
- `MANIFEST.json`
- `README.md`
- `companies/<slug>/` directories with full structure
- `runtime/activity-log.ndjson.gz`, `runtime/cost-events.ndjson.gz`, `runtime/heartbeat-runs.ndjson.gz`

- [ ] **Step 3: Test clone on a fresh instance**

Create a second Paperclip instance (or use a VM / another machine):
```bash
PAPERCLIP_INSTANCE_ID=test-restore pnpm paperclipai workspace clone https://github.com/nocodepro-dev/paperclip-workspace-test.git
```

Verify the companies, pipelines, SOPs, and knowledge collections are restored.

- [ ] **Step 4: Commit any integration fixes**

```bash
git add -A
git commit -m "fix(workspace): phase 2 git round-trip integration fixes"
```

---

# PHASE 3 — UI One-click Sync

Phase 3 adds a Settings > Workspace page with setup wizard and sync button, plus a dashboard indicator.

---

### Task 12: UI API client

**Files:**
- Create: `ui/src/api/workspace.ts`

- [ ] **Step 1: Create the client**

Write `ui/src/api/workspace.ts`:

```typescript
import { api } from "./client";

export interface WorkspaceStatus {
  workspaceDir: string;
  hasRemote: boolean;
  remoteUrl: string | null;
  pendingChanges: number;
  lastCommit: { sha: string; message: string; date: string } | null;
}

export interface WorkspaceSyncResult {
  ok: boolean;
  exported: {
    companies: number;
    activityLogEntries: number;
    costEvents: number;
    heartbeatRuns: number;
  };
  committed: boolean;
  commitSha: string | null;
}

export const workspaceApi = {
  getStatus: () => api.get<WorkspaceStatus>("/workspace/status"),
  init: (remoteUrl: string, branch = "main") =>
    api.post<{ ok: boolean; workspaceDir: string; remoteUrl: string; branch: string }>(
      "/workspace/init",
      { remoteUrl, branch },
    ),
  sync: () => api.post<WorkspaceSyncResult>("/workspace/sync", {}),
  pull: () => api.post<{ ok: boolean; imported: any }>("/workspace/pull", {}),
  clone: (remoteUrl: string, branch = "main") =>
    api.post<{ ok: boolean; imported: any }>("/workspace/clone", { remoteUrl, branch }),
};
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/api/workspace.ts
git commit -m "feat(workspace): add UI API client"
```

---

### Task 13: Workspace Settings page

**Files:**
- Create: `ui/src/pages/settings/WorkspaceSettings.tsx`

- [ ] **Step 1: Create the page**

Write `ui/src/pages/settings/WorkspaceSettings.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, GitBranch, RefreshCw } from "lucide-react";
import { workspaceApi } from "@/api/workspace";
import { Button } from "@/components/ui/button";
import { useToast } from "@/context/ToastContext";
import { PageSkeleton } from "@/components/PageSkeleton";

export function WorkspaceSettings() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [showSetup, setShowSetup] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");

  const { data: status, isLoading } = useQuery({
    queryKey: ["workspace", "status"],
    queryFn: () => workspaceApi.getStatus(),
    refetchInterval: 30_000,
  });

  const initMutation = useMutation({
    mutationFn: () => workspaceApi.init(remoteUrl),
    onSuccess: () => {
      pushToast({ title: "Workspace linked", tone: "success" });
      setShowSetup(false);
      queryClient.invalidateQueries({ queryKey: ["workspace", "status"] });
    },
    onError: (err) => pushToast({ title: "Setup failed", body: String(err), tone: "error" }),
  });

  const syncMutation = useMutation({
    mutationFn: () => workspaceApi.sync(),
    onSuccess: (result) => {
      pushToast({
        title: result.committed ? "Backup complete" : "No changes",
        body: result.committed ? `Pushed ${result.exported.companies} companies` : "Everything up to date",
        tone: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["workspace", "status"] });
    },
    onError: (err) => pushToast({ title: "Sync failed", body: String(err), tone: "error" }),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-4 p-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Back up your entire Paperclip instance to GitHub. All companies, pipelines, SOPs,
          and knowledge collections are exported to a Git repository you control.
        </p>
      </div>

      {!status?.hasRemote && !showSetup && (
        <div className="border border-border rounded-lg p-4 bg-card">
          <h3 className="font-medium mb-2">Workspace not linked</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Link this Paperclip instance to a Git repository to enable one-click backups.
          </p>
          <Button onClick={() => setShowSetup(true)}>Setup Workspace Backup</Button>
        </div>
      )}

      {showSetup && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-3">
          <h3 className="font-medium">Link to Git repository</h3>
          <label className="block text-sm">
            <span className="text-muted-foreground">Git remote URL</span>
            <input
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/nocodepro-dev/paperclip-workspace.git"
              className="w-full mt-1 px-3 py-1.5 text-sm bg-transparent border border-border rounded-md"
            />
          </label>
          <div className="flex gap-2">
            <Button
              onClick={() => initMutation.mutate()}
              disabled={!remoteUrl || initMutation.isPending}
            >
              {initMutation.isPending ? "Linking..." : "Link"}
            </Button>
            <Button variant="ghost" onClick={() => setShowSetup(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {status?.hasRemote && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm truncate">{status.remoteUrl}</span>
          </div>

          {status.lastCommit ? (
            <div className="text-sm text-muted-foreground">
              Last backup: {new Date(status.lastCommit.date).toLocaleString()}
              <br />
              <span className="font-mono text-xs">{status.lastCommit.sha.slice(0, 7)}</span> — {status.lastCommit.message}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No backups yet.</div>
          )}

          {status.pendingChanges > 0 && (
            <div className="text-sm text-amber-600">
              {status.pendingChanges} pending {status.pendingChanges === 1 ? "change" : "changes"}
            </div>
          )}

          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="gap-2"
          >
            {syncMutation.isPending ? (
              <><RefreshCw className="h-4 w-4 animate-spin" /> Backing up...</>
            ) : (
              <><CloudUpload className="h-4 w-4" /> Backup to GitHub</>
            )}
          </Button>
        </div>
      )}

      <div className="border border-border rounded-lg p-4 bg-muted/20">
        <h3 className="text-sm font-medium mb-1">What's included</h3>
        <ul className="text-xs text-muted-foreground space-y-0.5">
          <li>• All companies, agents, projects, tasks, and skills</li>
          <li>• All pipelines with stages and run history</li>
          <li>• All SOPs with screenshot assets</li>
          <li>• Knowledge collection metadata (the indexed files stay on your disk)</li>
          <li>• Activity logs, cost events, heartbeat history</li>
        </ul>
      </div>

      <div className="text-xs text-muted-foreground">
        Workspace dir: <span className="font-mono">{status?.workspaceDir}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In the UI router (likely `ui/src/App.tsx` or `ui/src/main.tsx`), add a route:
```tsx
<Route path="/settings/workspace" element={<WorkspaceSettings />} />
```

Check existing settings routes for the pattern — there's likely already `/settings/*` routes for company and instance settings.

- [ ] **Step 3: Add sidebar link**

In `ui/src/components/Sidebar.tsx`, find the settings section and add:
```tsx
<SidebarLink to="/settings/workspace" icon={CloudUpload}>Workspace</SidebarLink>
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add Settings > Workspace page with one-click backup"
```

---

### Task 14: Dashboard indicator

**Files:**
- Modify: `ui/src/pages/Dashboard.tsx` (or header component where applicable)

- [ ] **Step 1: Read existing dashboard**

Read `ui/src/pages/Dashboard.tsx` to find where to add the indicator — likely in the header or top row.

- [ ] **Step 2: Add backup status indicator**

Add a small badge component that fetches workspace status and shows "Last backup: X ago":

```tsx
import { useQuery } from "@tanstack/react-query";
import { CloudCheck, CloudOff } from "lucide-react";
import { Link } from "@/lib/router";
import { workspaceApi } from "@/api/workspace";

export function WorkspaceBackupIndicator() {
  const { data: status } = useQuery({
    queryKey: ["workspace", "status"],
    queryFn: () => workspaceApi.getStatus(),
    refetchInterval: 60_000,
  });

  if (!status) return null;

  if (!status.hasRemote) {
    return (
      <Link to="/settings/workspace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <CloudOff className="h-3.5 w-3.5" />
        Backup not configured
      </Link>
    );
  }

  const lastBackup = status.lastCommit?.date;
  const relativeTime = lastBackup ? formatRelativeTime(new Date(lastBackup)) : "never";

  return (
    <Link to="/settings/workspace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
      <CloudCheck className="h-3.5 w-3.5 text-green-600" />
      Last backup: {relativeTime}
      {status.pendingChanges > 0 && (
        <span className="ml-1 text-amber-600">({status.pendingChanges} pending)</span>
      )}
    </Link>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
```

Mount it in the dashboard header (or app header component).

- [ ] **Step 2: Typecheck + commit**

```bash
cd d:/paperclip && pnpm typecheck
git add -A
git commit -m "feat(workspace): add dashboard backup status indicator"
```

---

### Task 15: Phase 3 end-to-end UI test

- [ ] **Step 1: Start dev server**

```bash
cd d:/paperclip && pnpm dev
```

- [ ] **Step 2: Test the UI flow**

Open the browser to `http://localhost:3100`:
1. Navigate to Settings > Workspace
2. If previously set up (from Phase 2), verify it shows the linked repo and last commit
3. Click "Backup to GitHub" and verify the toast shows success
4. Check GitHub that a new commit was pushed
5. Verify the dashboard header now shows "Last backup: just now"

For a fresh instance:
1. Navigate to Settings > Workspace
2. Click "Setup Workspace Backup"
3. Enter a Git URL
4. Click "Link"
5. Click "Backup to GitHub"
6. Verify success

- [ ] **Step 3: Commit any UI fixes**

```bash
git add -A
git commit -m "fix(workspace): phase 3 ui integration fixes"
```

---

# Final Verification

- [ ] **Full typecheck:** `cd d:/paperclip && pnpm typecheck`
- [ ] **Secrets scrub grep:** In an exported workspace, run `grep -r "sk-\|ghp_\|api_key" .` — should return nothing
- [ ] **Round-trip test:** Export workspace on machine A, push to GitHub, clone on machine B, verify all pipelines/SOPs/knowledge work
- [ ] **UI smoke test:** Dashboard indicator shows correct status, sync button works, setup wizard works
- [ ] **Commit any final fixes:** `git add -A && git commit -m "fix(workspace): final integration fixes"`
