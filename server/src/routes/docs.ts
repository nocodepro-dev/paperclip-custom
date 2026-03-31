import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface GuideEntry {
  slug: string;
  filename: string;
  title: string;
}

const GUIDES: GuideEntry[] = [
  { slug: "knowledge-base", filename: "knowledge-base.md", title: "Knowledge Base" },
  { slug: "pipelines", filename: "pipelines.md", title: "Pipelines" },
  { slug: "sop-converter", filename: "sop-converter.md", title: "SOP-to-Skill Converter" },
];

function resolveGuidesDir(): string {
  // From server/src/routes/ → ../../doc/guides (monorepo dev)
  // From server/dist/routes/ → ../../../doc/guides (built)
  const candidates = [
    path.resolve(__dirname, "../../../doc/guides"),
    path.resolve(__dirname, "../../doc/guides"),
  ];
  return candidates[0]!;
}

export function docsRoutes() {
  const router = Router();
  const guidesDir = resolveGuidesDir();

  router.get("/docs", (_req, res) => {
    res.json(GUIDES.map(({ slug, title }) => ({ slug, title })));
  });

  router.get("/docs/:slug", async (req, res) => {
    const guide = GUIDES.find((g) => g.slug === req.params.slug);
    if (!guide) {
      res.status(404).json({ error: "Guide not found" });
      return;
    }
    try {
      const filePath = path.join(guidesDir, guide.filename);
      const body = await readFile(filePath, "utf-8");
      res.json({ slug: guide.slug, title: guide.title, body });
    } catch {
      res.status(404).json({ error: "Guide file not found on disk" });
    }
  });

  return router;
}
