import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { toolRequirementsService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function toolRoutes(db: Db) {
  const router = Router();
  const svc = toolRequirementsService(db);

  // ---- Company tools ----

  /**
   * GET /api/companies/:companyId/tools
   * List all known tools and their availability status for a company.
   */
  router.get("/companies/:companyId/tools", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      const tools = await svc.listAvailableTools(companyId);
      res.json(tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list tools";
      res.status(500).json({ error: message });
    }
  });

  // ---- Skill requirements ----

  /**
   * GET /api/skills/:skillId/requirements
   * Check a skill's tool requirements and their availability.
   */
  router.get("/skills/:skillId/requirements", async (req, res) => {
    const skillId = req.params.skillId as string;

    try {
      // Need to determine companyId from the skill first.
      // The service will throw if skill not found or company mismatch.
      // We pass companyId from query or let the service resolve it.
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) {
        res.status(400).json({ error: "companyId query parameter required" });
        return;
      }
      assertCompanyAccess(req, companyId);

      const report = await svc.checkSkillRequirements(companyId, skillId);
      res.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check requirements";
      if (message === "Skill not found" || message === "Company mismatch") {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/skills/:skillId/equip
   * Return an equip plan with install commands for missing tools.
   * Does NOT execute any installations.
   */
  router.post("/skills/:skillId/equip", async (req, res) => {
    const skillId = req.params.skillId as string;
    const companyId = req.body?.companyId as string | undefined;
    if (!companyId) {
      res.status(400).json({ error: "companyId required in request body" });
      return;
    }
    assertCompanyAccess(req, companyId);

    try {
      const report = await svc.checkSkillRequirements(companyId, skillId);

      const missingTools = report.requirements.filter(
        (r) => r.status !== "installed",
      );

      const equipPlan = {
        skillId: report.skillId,
        skillName: report.skillName,
        allSatisfied: report.allSatisfied,
        missing: missingTools.map((tool, i) => ({
          step: i + 1,
          toolId: tool.toolId,
          name: tool.name,
          installCommand: tool.installCommand,
          configHints: tool.configHints,
        })),
        summary: report.allSatisfied
          ? "All tools are installed. Skill is ready to run."
          : `${missingTools.length} tool(s) missing. Run the install commands above.`,
      };

      res.json(equipPlan);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate equip plan";
      if (message === "Skill not found" || message === "Company mismatch") {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  return router;
}
