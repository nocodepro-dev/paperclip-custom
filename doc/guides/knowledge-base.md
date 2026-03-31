# Knowledge Base

The Knowledge Base indexes directories on your filesystem so agents can discover and retrieve reference documents during task execution. Files stay on disk — Paperclip only stores metadata.

## Why use it

Agents work better when they have context. If your team maintains PRDs, design systems, database schemas, brand guidelines, or any other reference material, the Knowledge Base makes those files available to every agent in your company — without copy-pasting or manual uploads.

## Scanning a directory

### From the UI

1. Navigate to **Company > Knowledge** in the sidebar.
2. Click **Scan Directory**.
3. Enter the **directory path** on your machine (e.g. `/home/team/references`).
4. Give the collection a **name** and optionally assign it to a **project**.
5. Click **Scan & Index**. Paperclip walks the directory, catalogs each file, and extracts metadata.

### From the CLI

```sh
pnpm paperclipai knowledge scan /path/to/references --company-id <id> --name "Design References"
```

## Collections and entries

A **collection** is a scanned directory. Each file inside becomes an **entry** with:

- **Name** — the filename
- **Kind** — auto-detected category: `document`, `design_system`, `schema`, `screenshot`, `flow`, `brief`, `sop`, `asset`, or `other`
- **Content type** — MIME type (e.g. `text/markdown`, `image/png`, `application/json`)
- **Summary** — auto-generated preview (first paragraph for markdown, top keys for JSON, title for HTML)
- **Size** and **SHA256 hash** — used for change detection during rescans

The scanner excludes common build artifacts: `.git`, `node_modules`, `dist`, `build`, `__pycache__`, etc.

## How agents use knowledge

During each heartbeat, Paperclip injects a lightweight **knowledge manifest** into the agent's context. The manifest lists collection names, entry names, summaries, and sizes — but not the full file content.

When an agent identifies a relevant document, it retrieves the full content on demand via the REST API:

```
GET /api/knowledge/entries/:entryId/content
```

This keeps context lean while giving agents access to everything they need.

## Rescanning for changes

Files change over time. Use the **Rescan** button on a collection's detail page (or `pnpm paperclipai knowledge rescan <collectionId>` from the CLI) to detect changes.

The rescan compares file sizes and SHA256 hashes against what's stored, and reports a delta:

- **Added** — new files found
- **Changed** — existing files with different content
- **Removed** — files that no longer exist on disk
- **Unchanged** — files with identical content

Collections whose source directory is no longer accessible are automatically marked as `stale`.

## Best practices

- **Organize a `references/` folder** at the root of each project with subfolders like `design/`, `schemas/`, `prd/`, `screenshots/`.
- **Scope collections to projects** when files are project-specific. Company-wide references (brand guidelines, shared schemas) can be unscoped.
- **Keep files under 10 MB** for SHA256 hashing and summary generation. Larger files are indexed but won't have change detection.
- **Rescan after major updates** — or enable auto-discover for automatic detection (coming soon).
- **Use descriptive filenames** — agents see the filename in the manifest and use it to judge relevance.
