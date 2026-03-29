# Knowledge Base, SOPs & Skill Pipeline

**Date:** 2026-03-29
**Status:** Design spec (expanded from knowledge-only to full SOP pipeline)
**Author:** George + Claude

---

## Context

Paperclip companies manage AI agents that need domain knowledge to do their jobs — PRDs, design systems, database schemas, brand guidelines, flow documentation, screenshots. Today, there's no structured way to give agents access to this knowledge. Agents get instructions (AGENTS.md) and skills, but not the reference material that informs decisions.

George's projects already have well-organized `references/` directories containing this knowledge:
- **Global** (`D:\nocodepro-me\references\`) — brand style guide, design system, SOPs, branding assets
- **Project-level** (`projects/prd-n8n-backend/references/`) — PRD, MVP scope, database schema, project design system, workflow flows with screenshots
- **Project-level** (`projects/MODLIFLEX-APP-COPILOT/references/`) — product brief, database schema, design system, email templates, UI flow documentation

Content types include: markdown docs, JSON (database schemas up to 3.8MB, design system exports), HTML (interactive design system pages), CSS, PNG screenshots, JPG logos.

### Design Principles

1. **Filesystem-first** — references stay where they are on disk. Paperclip indexes them, doesn't own them.
2. **Non-destructive overlay** — removing Paperclip leaves your project structure untouched. Zero lock-in.
3. **Hybrid context delivery** — agents receive a lightweight manifest (names + summaries), pull full docs on demand. No 3MB JSON files auto-injected into context.
4. **Two scope levels** — company-wide knowledge (brand, SOPs) + project-level knowledge (PRDs, schemas).
5. **Brownfield-friendly** — scan existing project folders, index what's there, start working immediately.

---

## Data Model

### `knowledge_collections` table

A named set of references, scoped to a company or project. Points to a filesystem directory.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | gen_random_uuid() | Primary key |
| `companyId` | uuid FK → companies | no | | Company scope |
| `projectId` | uuid FK → projects | yes | null | If set: project-scoped. If null: company-wide |
| `name` | text | no | | Display name, e.g., "Design System", "PRD" |
| `description` | text | yes | null | What this collection contains |
| `sourceType` | text (enum) | no | 'local_path' | `local_path`, `github`, `url` |
| `sourcePath` | text | no | | Absolute path or URL to the reference directory |
| `autoDiscover` | boolean | no | true | Auto-index new files on rescan |
| `lastScannedAt` | timestamp | yes | null | Last successful scan timestamp |
| `entryCount` | integer | no | 0 | Cached count of entries |
| `totalBytes` | bigint | no | 0 | Cached total size of all entries |
| `status` | text (enum) | no | 'active' | `active`, `stale`, `unreachable` |
| `createdAt` | timestamp | no | now() | |
| `updatedAt` | timestamp | no | now() | |

**Indexes:**
- Unique: `(companyId, sourcePath)` — prevent duplicate scans of same directory
- Index: `(companyId, projectId)` — list collections for a project

### `knowledge_entries` table

Individual indexed files within a collection. Stores **metadata only** — content is read from the filesystem at request time.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | gen_random_uuid() | Primary key |
| `collectionId` | uuid FK → knowledge_collections | no | | Parent collection |
| `companyId` | uuid FK → companies | no | | Denormalized for direct queries |
| `relativePath` | text | no | | Path relative to collection sourcePath |
| `name` | text | no | | Display name (derived from filename or manual) |
| `kind` | text (enum) | no | 'other' | `document`, `design_system`, `schema`, `screenshot`, `flow`, `brief`, `sop`, `asset`, `other` |
| `contentType` | text | no | | MIME type: `text/markdown`, `application/json`, `image/png`, etc. |
| `byteSize` | bigint | no | | File size in bytes |
| `sha256` | text | yes | null | Content hash for change detection |
| `summary` | text | yes | null | One-line summary for the manifest |
| `lastVerifiedAt` | timestamp | yes | null | Last time file existence was confirmed |
| `metadata` | jsonb | yes | null | Extensible: extracted frontmatter, title, etc. |
| `createdAt` | timestamp | no | now() | |
| `updatedAt` | timestamp | no | now() | |

**Indexes:**
- Unique: `(collectionId, relativePath)` — one entry per file per collection
- Index: `(companyId, kind)` — filter by type across company
- Index: `(collectionId)` — list entries for a collection

---

## Agent-Facing API

### Manifest Injection (Heartbeat Context)

When the heartbeat builds `contextSnapshot`, it includes a knowledge manifest:

```typescript
interface KnowledgeManifest {
  companyCollections: KnowledgeCollectionManifest[];
  projectCollections: KnowledgeCollectionManifest[];
}

interface KnowledgeCollectionManifest {
  id: string;
  name: string;
  description: string | null;
  entries: KnowledgeEntryManifest[];
}

interface KnowledgeEntryManifest {
  id: string;
  name: string;
  kind: string;
  relativePath: string;
  summary: string | null;
  contentType: string;
  byteSize: number;
}
```

Added to context as `contextSnapshot.paperclipKnowledge`.

The manifest is lightweight — names, summaries, sizes. No file content. Agents know what's available and can make informed decisions about what to retrieve.

### Content Retrieval

```
GET /api/knowledge/entries/:entryId/content
```

- Resolves the full path: `collection.sourcePath + entry.relativePath`
- Reads file from filesystem
- Sets appropriate `Content-Type`, `Content-Length` headers
- For text files: returns raw content
- For images: returns binary with correct MIME type
- For large files (>1MB): supports `Range` headers for partial reads
- Returns 404 if file no longer exists on disk (marks entry as stale)

### Search

```
GET /api/companies/:companyId/knowledge/search?q=<query>&projectId=<optional>&kind=<optional>
```

- Searches across entry `name`, `summary`, `relativePath`
- Filterable by `projectId` (include company-wide + project-specific) and `kind`
- Returns matching entries with collection context
- Phase 1: substring/ILIKE matching. Phase 2: full-text search. Phase 3: embeddings/RAG.

### Skill Extension

The `paperclipai/paperclip/paperclip` skill gains a "Knowledge Base" section:

```markdown
## Knowledge Base

Your context includes a `paperclipKnowledge` manifest listing available reference documents.
Before starting work, review the manifest to identify relevant knowledge:
- Design systems → check before any UI work
- PRDs/briefs → check before any feature work
- Database schemas → check before any data model work

To retrieve a document:
  GET {PAPERCLIP_API_BASE}/api/knowledge/entries/{entryId}/content
  Authorization: Bearer {PAPERCLIP_API_KEY}
```

---

## Operator-Facing API

### REST Endpoints

```
POST   /api/companies/:companyId/knowledge/collections
       Body: { name, description?, sourceType, sourcePath, projectId?, autoDiscover? }
       → Creates collection + runs initial scan

GET    /api/companies/:companyId/knowledge/collections
       Query: projectId? (filter by project, null = company-wide only)
       → List collections with entry counts

GET    /api/knowledge/collections/:id
       → Collection detail + paginated entries

POST   /api/knowledge/collections/:id/rescan
       → Re-walk the filesystem, detect new/changed/deleted files
       → Returns { added: N, changed: N, removed: N }

PATCH  /api/knowledge/collections/:id
       Body: { name?, description?, autoDiscover?, status? }
       → Update collection metadata

DELETE /api/knowledge/collections/:id
       → Removes index only. Files on disk untouched.

GET    /api/knowledge/entries/:id
       → Entry metadata

GET    /api/knowledge/entries/:id/content
       → Serve file content from filesystem

PATCH  /api/knowledge/entries/:id
       Body: { name?, kind?, summary? }
       → Update entry metadata (manual overrides)

GET    /api/companies/:companyId/knowledge/search
       Query: q, projectId?, kind?
       → Search entries
```

### CLI Commands

```sh
# Scan a directory and create a collection
pnpm paperclipai knowledge scan <path> \
  --company-id <id> \
  [--project-id <id>] \
  --name "Project References" \
  [--description "..."]

# List collections
pnpm paperclipai knowledge list \
  --company-id <id> \
  [--project-id <id>]

# List entries in a collection
pnpm paperclipai knowledge entries <collection-id> \
  [--kind document|schema|design_system|...]

# View entry content
pnpm paperclipai knowledge read <entry-id>

# Rescan a collection for changes
pnpm paperclipai knowledge rescan <collection-id>

# Search across knowledge
pnpm paperclipai knowledge search "design system" \
  --company-id <id> \
  [--project-id <id>]

# Remove a collection index (files untouched)
pnpm paperclipai knowledge remove <collection-id> [--yes]
```

---

## Scanning & Indexing Service

### Initial Scan (`POST .../collections`)

1. Validate `sourcePath` exists and is readable
2. Walk directory recursively (same exclusion filters as agent-instructions: skip `.git`, `node_modules`, `__pycache__`, etc.)
3. For each file:
   - Compute `relativePath` from collection root
   - Detect `contentType` from extension
   - Infer `kind` from path patterns and content type:
     - `*/design-system/*` or `*design-system*` → `design_system`
     - `*schema*`, `*database*` → `schema`
     - `*.png`, `*.jpg`, `*.gif` → `screenshot`
     - `*prd*`, `*PRD*` → `document`
     - `*brief*` → `brief`
     - `*flow*` → `flow`
     - `*sop*` → `sop`
     - Default → `other` for binary, `document` for text
   - Read file stats: size, mtime
   - Optionally compute SHA256 (for text files under 10MB)
   - For markdown files: extract first paragraph as `summary`
   - For JSON files: extract top-level keys as summary hint
4. Insert entries in batch
5. Update collection: `entryCount`, `totalBytes`, `lastScannedAt`

### Rescan (`POST .../rescan`)

1. Walk directory again
2. Compare against existing entries:
   - **New files** → insert entries
   - **Changed files** (different size or SHA256) → update entry, set `lastVerifiedAt`
   - **Deleted files** → soft-remove (mark entry status, keep metadata for audit)
   - **Unchanged** → update `lastVerifiedAt`
3. Return delta: `{ added, changed, removed, unchanged }`

### Auto-summary Generation

For text files, generate a brief summary:
- **Markdown**: first non-empty paragraph, truncated to 200 chars
- **JSON**: `"JSON file with N top-level keys: key1, key2, key3..."` + file size
- **HTML**: extract `<title>` or first `<h1>`
- **CSS**: `"CSS stylesheet, N lines, N rules"`
- **Images**: `"PNG image, WxH pixels, N KB"` (if we can read dimensions)

Summaries can be manually overridden via `PATCH /api/knowledge/entries/:id`.

---

## Heartbeat Integration

### Context Building (`server/src/services/heartbeat.ts`)

In `enrichWakeContextSnapshot()`, after workspace resolution:

```typescript
// Build knowledge manifest for agent context
const knowledgeManifest = await knowledgeService.buildManifestForAgent(
  companyId,
  projectId // from the task's project, if any
);
contextSnapshot.paperclipKnowledge = knowledgeManifest;
```

The manifest includes:
- All company-wide collections (where `projectId IS NULL`)
- Project-specific collections (where `projectId` matches the task's project)
- Each collection's entries with: id, name, kind, relativePath, summary, contentType, byteSize

### Manifest Size Budget

To prevent context bloat:
- Max 200 entries in the manifest (prioritize by kind: documents > schemas > design_systems > others)
- If exceeded, include a `truncated: true` flag and `totalAvailable` count
- Agent can use the search API to find entries not in the manifest

---

## Minimal UI

### Company Page — Knowledge Tab

Read-only panel showing:
- List of collections with: name, source path, entry count, total size, last scanned, status badge
- Expand collection to see entries: name, kind badge, size, summary
- Click entry to preview:
  - Markdown → rendered HTML
  - JSON → syntax-highlighted (truncated at 50KB with "show full" option)
  - Images → displayed inline
  - HTML → rendered in iframe
  - Other → download link

### Project Page — Knowledge Section

Same as above, filtered to project-specific collections + company-wide collections.

### No editing in UI (phase 1)

- No create/delete/edit in UI — use CLI for management
- UI is purely for visibility: what knowledge is available, what agents can access

---

## Brownfield Onboarding Example

Converting the n8n backend project:

```sh
# 1. Company already exists or create one
pnpm paperclipai company list

# 2. Scan global references (company-wide)
pnpm paperclipai knowledge scan "D:/nocodepro-me/references" \
  --company-id <company-id> \
  --name "NoCodePro Global References"

# 3. Scan project references
pnpm paperclipai knowledge scan "D:/nocodepro-me/projects/prd-n8n-backend/references" \
  --company-id <company-id> \
  --project-id <project-id> \
  --name "n8n Backend References"

# 4. Verify what was indexed
pnpm paperclipai knowledge list --company-id <company-id>
pnpm paperclipai knowledge entries <collection-id>

# 5. Agents now see the manifest and can pull docs on demand
```

**If you stop using Paperclip:** Delete the instance. Your `references/` folders are untouched. Open in VS Code, use Claude Code CLI, continue working.

---

## Implementation Scope

### Knowledge Base Phases (Deprioritized)

The knowledge base feature described above is deprioritized — per-project `references/` + `CLAUDE.md` handles the immediate need. The knowledge base becomes relevant when:
- Non-Claude adapters are used (they don't read `CLAUDE.md`)
- Cross-project knowledge sharing is needed
- Paperclip UI visibility into references is desired

Keeping the design on file for future implementation.

---

---

# Part 2: SOP-to-Skill Pipeline

## Context

George's companies have business processes (SOPs) that are currently human-executed: issuing invoices, deploying apps, onboarding clients, reviewing content. The vision is to **convert human SOPs into agent-executable skills** — complete with the tools needed to actually perform the steps.

This bridges the gap between "here's how a human does it" and "here's how an agent does it autonomously."

### The Pipeline

```
Stage 1: CAPTURE           Stage 2: CONVERT            Stage 3: EQUIP
──────────────────         ─────────────────           ──────────────
Human SOP                  Agent SOP (SKILL.md)        Skill + Tools
(markdown + screenshots)   (executable steps)          (ready to run)
```

### Design Principles

1. **SOPs are first-class entities** — not just documents, they're the source material for agent capabilities
2. **Conversion is AI-assisted** — an agent (or the operator) transforms human steps into tool-based steps
3. **Tools are declared, not assumed** — skills explicitly state what tools they need
4. **Gaps are visible** — if a step can't be automated, it's flagged as a human action or approval gate
5. **Incremental automation** — start with partial automation, add tool access over time

---

## Data Model

### `company_sops` table

Human SOPs uploaded to a company. Source material for skill generation.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | gen_random_uuid() | Primary key |
| `companyId` | uuid FK → companies | no | | Company scope |
| `name` | text | no | | Display name, e.g., "Invoice Issuance" |
| `description` | text | yes | null | Brief description of the process |
| `category` | text | yes | null | Category: finance, deployment, onboarding, content, etc. |
| `sourceType` | text (enum) | no | 'upload' | `upload`, `replaydoc_export`, `local_path` |
| `sourcePath` | text | yes | null | Filesystem path if local_path source |
| `markdownBody` | text | no | | The SOP content in markdown |
| `hasScreenshots` | boolean | no | false | Whether screenshots are included |
| `screenshotCount` | integer | no | 0 | Number of associated screenshots |
| `status` | text (enum) | no | 'draft' | `draft`, `active`, `converting`, `converted`, `archived` |
| `generatedSkillId` | uuid FK → company_skills | yes | null | Link to the skill generated from this SOP |
| `metadata` | jsonb | yes | null | Extensible: step count, detected tools, etc. |
| `createdAt` | timestamp | no | now() | |
| `updatedAt` | timestamp | no | now() | |

**Indexes:**
- Index: `(companyId, category)` — list by category
- Index: `(companyId, status)` — filter by status

### `sop_assets` table

Screenshots and other files associated with SOPs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | gen_random_uuid() | Primary key |
| `sopId` | uuid FK → company_sops | no | | Parent SOP |
| `companyId` | uuid FK → companies | no | | Denormalized |
| `assetId` | uuid FK → assets | yes | null | Link to storage asset (if uploaded) |
| `localPath` | text | yes | null | Filesystem path (if local) |
| `relativePath` | text | no | | Path relative to SOP root (e.g., `screenshots/step_1.png`) |
| `kind` | text (enum) | no | 'screenshot' | `screenshot`, `template`, `example`, `reference` |
| `stepNumber` | integer | yes | null | Which SOP step this illustrates |
| `createdAt` | timestamp | no | now() | |

---

## Stage 1: CAPTURE — Upload Human SOPs

### CLI Commands

```sh
# Upload a single markdown file
pnpm paperclipai sop upload ./how-to-issue-invoice.md \
  --company-id <id> \
  --name "Invoice Issuance" \
  [--category finance]

# Upload a folder (markdown + screenshots, e.g., ReplayDoc export)
pnpm paperclipai sop upload ./flows/invoice-process/ \
  --company-id <id> \
  --name "Invoice Issuance" \
  [--category finance]

# Upload from a ReplayDoc export specifically
pnpm paperclipai sop upload ./flows/invoice-process/ \
  --company-id <id> \
  --source-type replaydoc_export \
  --name "Invoice Issuance"

# List SOPs
pnpm paperclipai sop list --company-id <id> [--category finance] [--status active]

# View SOP content
pnpm paperclipai sop get <sop-id>

# Remove SOP
pnpm paperclipai sop remove <sop-id> [--yes]
```

### REST API

```
POST   /api/companies/:companyId/sops              — upload SOP (markdown body or multipart with files)
GET    /api/companies/:companyId/sops               — list SOPs
GET    /api/sops/:id                                — get SOP detail + assets
PATCH  /api/sops/:id                                — update SOP metadata
DELETE /api/sops/:id                                — delete SOP + assets
GET    /api/sops/:id/assets                         — list SOP assets
GET    /api/sops/:id/assets/:assetId/content        — serve asset content
```

### Upload Processing

When an SOP folder is uploaded:

1. Find the markdown file (`.md` in root, or the largest `.md` file)
2. Scan for image files (`.png`, `.jpg`, `.gif`, `.webp`)
3. Parse markdown to extract steps (numbered lists, headers)
4. Match screenshots to steps by filename convention (e.g., `step_1.png` → step 1)
5. Store markdown in `company_sops.markdownBody`
6. Store screenshots as `sop_assets` (either in Paperclip storage or as local path references)
7. Extract metadata: step count, detected tool references (mentions of "Google", "Gmail", "Slack", etc.)

---

## Stage 2: CONVERT — Transform to Agent SOP

### Conversion Service

The conversion is AI-assisted: an agent (or the operator's Claude session) analyzes the human SOP and generates a SKILL.md.

```sh
# Trigger conversion
pnpm paperclipai sop convert <sop-id> [--auto] [--review]
```

**`--auto` mode:** Paperclip dispatches an agent to do the conversion. The agent:
1. Reads the human SOP
2. Identifies each step's tool requirements
3. Checks what tools are available in the company's environment
4. Generates a draft SKILL.md
5. Creates the skill in the company's skill library (status: `draft`)
6. Links `company_sops.generatedSkillId` to the new skill

**`--review` mode (default):** Same as auto, but the draft is presented to the operator for review before finalizing.

### Conversion Analysis

The conversion agent performs this analysis for each SOP step:

```typescript
interface SOPStepAnalysis {
  stepNumber: number;
  humanAction: string;          // Original step text
  toolRequired: string | null;  // e.g., "google-drive", "gmail", "github"
  agentAction: string;          // Transformed step for agent
  automatable: boolean;         // Can an agent do this?
  requiresApproval: boolean;    // Should a human approve before execution?
  toolAvailable: boolean;       // Is the required tool installed?
  fallback: string | null;      // What to do if tool unavailable
}
```

**Example analysis:**

| Step | Human Action | Tool Required | Agent Action | Automatable? |
|------|-------------|---------------|--------------|-------------|
| 1 | Open Google Doc template | google-drive | `gdrive copy --template-id <id>` | ✅ if MCP installed |
| 2 | Fill in client, hours, rate | google-docs | `gdocs update --fields {...}` | ✅ if MCP installed |
| 3 | Export as PDF | google-drive | `gdrive export --format pdf` | ✅ if MCP installed |
| 4 | Open Gmail, compose email | gmail | `gmail compose --to <client>` | ✅ if MCP installed |
| 5 | Attach PDF, review, send | gmail | **[APPROVAL GATE]** then `gmail send` | ⚠️ needs approval |

### Generated SKILL.md Structure

```yaml
---
name: invoice-issuance
description: >
  Use when an invoice needs to be issued to a client.
  Handles template copying, data entry, PDF export, and email delivery.
  Requires: google-drive MCP, gmail MCP.
metadata:
  sourceSOPId: "sop-abc-123"
  generatedAt: "2026-03-29T10:00:00Z"
  requiredIntegrations:
    - id: google-drive
      name: Google Drive
      type: mcp_server
      status: installed | missing
    - id: gmail
      name: Gmail
      type: mcp_server
      status: installed | missing
  approvalGates:
    - before: step-5
      reason: "Review invoice PDF before sending to client"
  automationLevel: partial | full
  humanActionsRequired: 0 | N
---

# Invoice Issuance

## Source
This skill was generated from SOP "Invoice Issuance" (sop-abc-123).
Original human process converted to agent-executable steps.

## Prerequisites
- Google Drive MCP server configured with access to invoice template folder
- Gmail MCP server configured with send permissions
- Client details available in task context (name, email, project, hours, rate)

## Process

### Step 1: Copy Invoice Template
Use Google Drive to copy the invoice template...

### Step 2: Fill In Details
Use Google Docs API to update the following fields...

### Step 3: Export PDF
Export the completed document as PDF...

### Step 4: Compose Email
Create a draft email using Gmail...

### Step 5: [APPROVAL REQUIRED] Send Invoice
**Wait for board approval before sending.**
Present the draft email with PDF attachment for review.
Once approved, send via Gmail...

## Error Handling
- If Google Drive is unavailable: notify operator, pause task
- If client email bounces: create follow-up issue
- If template is missing: alert with template ID needed
```

### REST API for Conversion

```
POST   /api/sops/:id/convert                       — start conversion
       Body: { mode: "auto" | "review", agentId?: string }
       → Returns conversion job ID

GET    /api/sops/:id/conversion                     — get conversion status/result
       → Returns: analysis + draft SKILL.md + gaps report

POST   /api/sops/:id/conversion/approve             — approve draft skill
       → Finalizes the skill in company library

POST   /api/sops/:id/conversion/reject              — reject draft, provide feedback
       Body: { feedback: string }
       → Agent revises based on feedback
```

---

## Stage 3: EQUIP — Ensure Tools Are Available

### Tool Registry

Each Paperclip instance maintains awareness of available tools:

```typescript
interface ToolRegistryEntry {
  id: string;              // e.g., "google-drive"
  name: string;            // "Google Drive"
  type: "mcp_server" | "cli_tool" | "paperclip_api" | "script";
  status: "installed" | "available" | "unavailable";
  installCommand?: string; // How to install if missing
  configRequired?: boolean;// Does it need API keys, etc.?
  configuredFor?: string[];// Which companies have it configured
}
```

### Equip Command

```sh
# Check what a skill needs
pnpm paperclipai skill check <skill-id>

> Skill "invoice-issuance" requirements:
>   ✅ Paperclip API — available
>   ❌ Google Drive MCP — not installed
>      Install: npx mcp-install google-drive
>   ❌ Gmail MCP — not installed
>      Install: npx mcp-install gmail
>   ⚠️ Approval gate configured for step 5

# Install missing tools
pnpm paperclipai skill equip <skill-id>

> Installing Google Drive MCP server... done
> Installing Gmail MCP server... done
> Configure Google Drive API key? [enter key or skip]
> Configure Gmail OAuth? [open browser for auth]
> ✅ All tools ready. Skill "invoice-issuance" is fully equipped.
```

### REST API

```
GET    /api/skills/:id/requirements                 — list tool requirements + status
POST   /api/skills/:id/equip                        — install/configure missing tools
GET    /api/companies/:companyId/tools               — list available tools
POST   /api/companies/:companyId/tools               — register a tool
```

---

## Onboarding Integration

### Company Creator Enhancement

When creating a company from an existing project, the company-creator skill can:

1. **Detect SOP-like content** in `references/flows/`, `references/sops/`, or similar directories
2. **Offer to import:** "Found 16 flow documents in references/flows/. Import as SOPs?"
3. **Batch convert:** Generate skills from all imported SOPs
4. **Assign to agents:** Suggest which agents should get which skills based on role

### New Hire (Agent) Onboarding

When a new agent is created:

```sh
pnpm paperclipai agent create --company-id <id> --name "Finance Agent" --role "accountant"

> Agent "Finance Agent" created.
>
> Company has 3 SOPs in category "finance":
>   - Invoice Issuance (converted to skill ✅)
>   - Expense Reporting (not yet converted)
>   - Budget Review (not yet converted)
>
> Assign "Invoice Issuance" skill to this agent? [Y/n]
> Convert remaining SOPs to skills? [Y/n]
```

---

## Implementation Scope

### Phase 1: SOP Capture + Manual Skill Creation
- `company_sops` + `sop_assets` tables + migration
- SOP upload service (markdown + screenshots)
- SOP REST API routes
- SOP CLI commands: `sop upload`, `sop list`, `sop get`, `sop remove`
- ReplayDoc export format detection
- Shared types + validators

### Phase 2: AI-Assisted Conversion
- Conversion service (dispatches agent or inline analysis)
- SOP step analysis (identify tools, automation level, gaps)
- SKILL.md generation from SOP
- Conversion API routes
- CLI: `sop convert`, `sop conversion` status
- Link SOPs to generated skills (`generatedSkillId`)

### Phase 3: Tool Equipping
- Tool registry (what's available in the instance)
- Skill requirements checker
- MCP server installation integration
- CLI: `skill check`, `skill equip`
- Tool configuration flow (API keys, OAuth)

### Phase 4: Onboarding Integration
- Company-creator detects SOP content during project import
- Batch SOP import + conversion
- Agent creation suggests relevant skills from SOPs
- SOP management UI (minimal: list, view, conversion status)

---

## Files to Create/Modify

### New Files (Phase 1)
- `packages/db/src/schema/sops.ts` — Drizzle schema for `company_sops` + `sop_assets`
- `packages/shared/src/types/sop.ts` — TypeScript types
- `packages/shared/src/api-paths/sops.ts` — API path constants
- `packages/shared/src/validators/sops.ts` — Zod validators
- `server/src/services/sops.ts` — SOP service (upload, parse, manage)
- `server/src/routes/sops.ts` — Express routes
- `cli/src/commands/sop.ts` — CLI commands

### New Files (Phase 2)
- `server/src/services/sop-converter.ts` — Conversion analysis + SKILL.md generation
- `server/src/services/sop-step-analyzer.ts` — Per-step tool detection

### New Files (Phase 3)
- `server/src/services/tool-registry.ts` — Available tools tracking
- `server/src/routes/tools.ts` — Tool management routes
- `cli/src/commands/skill-equip.ts` — Equip CLI

### Modified Files
- `packages/db/src/schema/index.ts` — export new tables
- `packages/shared/src/types/index.ts` — export new types
- `server/src/routes/index.ts` — register SOP + tool routes
- `cli/src/index.ts` — register SOP + equip commands
- `.agents/skills/company-creator/SKILL.md` — SOP detection during company creation

---

## Verification

### Phase 1 Verification
1. **Upload test**: `sop upload` with markdown file → SOP created with correct content
2. **Folder upload test**: `sop upload` with ReplayDoc export folder → SOP + screenshots indexed
3. **API test**: `GET /api/sops/:id` returns SOP with assets
4. **List test**: `sop list --category finance` returns filtered results
5. **Typecheck**: `pnpm -r typecheck` passes
6. **Tests**: `pnpm test:run` passes
7. **Build**: `pnpm build` passes

### Phase 2 Verification
8. **Convert test**: `sop convert <id>` generates a valid SKILL.md
9. **Analysis test**: Conversion correctly identifies tool requirements per step
10. **Approval gate test**: Steps requiring human action generate approval gates
11. **Link test**: `company_sops.generatedSkillId` correctly links to created skill

### Phase 3 Verification
12. **Check test**: `skill check <id>` reports installed vs missing tools
13. **Equip test**: `skill equip <id>` installs missing MCP servers
14. **Config test**: Tool configuration flow completes (API keys, OAuth)
