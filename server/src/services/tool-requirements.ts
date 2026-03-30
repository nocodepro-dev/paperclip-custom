/**
 * Tool Requirements Service — Phase 3 (EQUIP) of the SOP-to-skill pipeline.
 *
 * Checks what tools a converted skill needs and whether they're available
 * as installed plugins. Provides actionable install guidance for missing tools.
 *
 * Uses only `db` — reads the `plugins` table directly to discover installed
 * plugin tools (no runtime dispatcher dependency), and the company skills
 * table for skill data.
 */

import { ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { plugins } from "@paperclipai/db";
import type {
  ToolRegistryEntry,
  SkillToolRequirement,
  SkillRequirementsReport,
  ToolStatus,
} from "@paperclipai/shared";
import { TOOL_CATALOG, lookupTool, matchRegisteredTools } from "./tool-catalog.js";
import { companySkillService } from "./company-skills.js";

// ---- Helpers ----

/** Extract all namespaced tool names from installed plugins. */
async function getInstalledPluginToolNames(db: Db): Promise<string[]> {
  const rows = await db
    .select({ pluginKey: plugins.pluginKey, manifestJson: plugins.manifestJson })
    .from(plugins)
    .where(ne(plugins.status, "uninstalled"));

  const names: string[] = [];
  for (const row of rows) {
    const manifest = row.manifestJson;
    if (manifest?.tools) {
      for (const tool of manifest.tools) {
        names.push(`${row.pluginKey}:${tool.name}`);
      }
    }
  }
  return names;
}

/** Determine tool status based on plugin matches and catalog info. */
function resolveToolStatus(
  toolId: string,
  installedPluginToolNames: string[],
): { status: ToolStatus; pluginMatch: string | null } {
  const match = matchRegisteredTools(toolId, installedPluginToolNames);
  if (match) return { status: "installed", pluginMatch: match };

  const entry = lookupTool(toolId);
  if (entry?.installCommand) return { status: "available", pluginMatch: null };

  return { status: "unavailable", pluginMatch: null };
}

// ---- Extract tool requirements from skill data ----

interface ConversionMetadata {
  conversion?: {
    stepAnalysis?: Array<{
      stepNumber: number;
      toolRequired: string | null;
    }>;
  };
}

/**
 * Extract required tool IDs from a skill — either from conversion metadata
 * (if this skill was generated from an SOP) or by parsing the skill markdown.
 */
function extractToolRequirements(
  metadata: Record<string, unknown> | null,
  markdown: string | null,
): Map<string, number[]> {
  const toolSteps = new Map<string, number[]>();

  // Strategy 1: conversion metadata has step analysis
  const convMeta = metadata as ConversionMetadata | null;
  if (convMeta?.conversion?.stepAnalysis) {
    for (const step of convMeta.conversion.stepAnalysis) {
      if (step.toolRequired) {
        const existing = toolSteps.get(step.toolRequired) ?? [];
        existing.push(step.stepNumber);
        toolSteps.set(step.toolRequired, existing);
      }
    }
    if (toolSteps.size > 0) return toolSteps;
  }

  // Strategy 2: parse markdown prerequisites for bare tool IDs
  if (markdown) {
    for (const entry of TOOL_CATALOG) {
      for (const pattern of entry.pluginMatchPatterns) {
        if (pattern.test(markdown)) {
          toolSteps.set(entry.toolId, []);
          break;
        }
      }
    }
  }

  return toolSteps;
}

// ---- Service ----

export function toolRequirementsService(db: Db) {
  const skills = companySkillService(db);

  return {
    /**
     * Check a skill's tool requirements against available plugins.
     */
    async checkSkillRequirements(
      companyId: string,
      skillId: string,
    ): Promise<SkillRequirementsReport> {
      const skill = await skills.getById(skillId);
      if (!skill) throw new Error("Skill not found");
      if (skill.companyId !== companyId) throw new Error("Company mismatch");

      const installedTools = await getInstalledPluginToolNames(db);
      const toolSteps = extractToolRequirements(
        skill.metadata as Record<string, unknown> | null,
        skill.markdown ?? null,
      );

      const requirements: SkillToolRequirement[] = [];

      for (const [toolId, steps] of toolSteps) {
        const catalogEntry = lookupTool(toolId);
        const { status } = resolveToolStatus(toolId, installedTools);

        requirements.push({
          toolId,
          name: catalogEntry?.name ?? toolId,
          status,
          installCommand: catalogEntry?.installCommand ?? null,
          configHints: catalogEntry?.configHints ?? [],
          stepsUsing: steps,
        });
      }

      const satisfied = requirements.filter((r) => r.status === "installed").length;

      return {
        skillId,
        skillName: skill.name,
        requirements,
        satisfied,
        total: requirements.length,
        allSatisfied: satisfied === requirements.length,
      };
    },

    /**
     * List all known tools and their availability status for a company.
     */
    async listAvailableTools(_companyId: string): Promise<ToolRegistryEntry[]> {
      const installedTools = await getInstalledPluginToolNames(db);

      return TOOL_CATALOG.map((entry) => {
        const { status, pluginMatch } = resolveToolStatus(entry.toolId, installedTools);
        return {
          toolId: entry.toolId,
          name: entry.name,
          type: entry.type,
          status,
          installCommand: entry.installCommand,
          configRequired: entry.configHints.length > 0,
          configHints: entry.configHints,
          pluginMatch,
        };
      });
    },

    /**
     * Get a set of bare tool IDs that are currently available (installed as plugins).
     * Used to enrich SOP step analysis during conversion.
     */
    async getAvailableToolIds(): Promise<Set<string>> {
      const installedTools = await getInstalledPluginToolNames(db);
      const available = new Set<string>();

      for (const entry of TOOL_CATALOG) {
        const match = matchRegisteredTools(entry.toolId, installedTools);
        if (match) available.add(entry.toolId);
      }

      return available;
    },
  };
}
