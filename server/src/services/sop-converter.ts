import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companySops } from "@paperclipai/db";
import type { SOPConversionResult, SOPStepAnalysis } from "@paperclipai/shared";
import { analyzeSopSteps, enrichToolAvailability } from "./sop-step-analyzer.js";
import { sopService } from "./sops.js";
import { companySkillService } from "./company-skills.js";
import { toolRequirementsService } from "./tool-requirements.js";
import { lookupTool } from "./tool-catalog.js";

interface ConversionMetadata {
  mode: "auto" | "review";
  startedAt: string;
  completedAt?: string;
  status: "analyzing" | "draft_ready" | "approved" | "rejected";
  stepAnalysis: SOPStepAnalysis[];
  draftSkillMarkdown?: string;
  automationScore?: number;
  rejectionFeedback?: string;
  agentId?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function generateSkillMarkdown(
  sop: { id: string; name: string; description: string | null; category: string | null },
  analysis: SOPStepAnalysis[],
  automationScore: number,
): string {
  const requiredTools = [...new Set(analysis.filter((s) => s.toolRequired).map((s) => s.toolRequired!))];
  const approvalGates = analysis.filter((s) => s.requiresApproval);
  const humanActions = analysis.filter((s) => !s.automatable);

  const toolList = requiredTools.length > 0
    ? requiredTools.join(", ")
    : "no external integrations detected";

  const lines: string[] = [
    "---",
    `name: sop-${slugify(sop.name)}`,
    `description: >`,
    `  Agent-executable procedure for "${sop.name}".`,
    `  Use this skill whenever you need to perform the ${sop.name} process,`,
    `  follow the ${sop.category ?? "standard"} operating procedure, or handle tasks`,
    `  related to ${sop.description ?? sop.name}. Make sure to use this skill even if`,
    `  the user describes the task differently — if it matches this procedure, use it.`,
    "---",
    "",
    `# ${sop.name}`,
    "",
    `> Converted from SOP \`${sop.id}\` on ${new Date().toISOString().split("T")[0]}`,
    `> Automation level: ${automationScore}% | Required integrations: ${toolList}`,
    "",
  ];

  // Prerequisites
  if (requiredTools.length > 0) {
    lines.push("## Prerequisites", "");
    for (const tool of requiredTools) {
      const stepsWithTool = analysis.filter((s) => s.toolRequired === tool);
      const isAvailable = stepsWithTool.some((s) => s.toolAvailable);
      const catalogEntry = lookupTool(tool);
      if (isAvailable) {
        lines.push(`- **${catalogEntry?.name ?? tool}** — installed and accessible`);
      } else if (catalogEntry?.installCommand) {
        lines.push(`- **${catalogEntry.name}** — not installed (install: \`${catalogEntry.installCommand}\`)`);
      } else {
        lines.push(`- **${catalogEntry?.name ?? tool}** — MCP server or CLI tool needed`);
      }
    }
    lines.push("");
  }

  // Process steps
  lines.push("## Process", "");

  for (const step of analysis) {
    lines.push(`### Step ${step.stepNumber}: ${step.humanAction}`, "");

    if (!step.automatable) {
      lines.push(`**Human action required:** ${step.fallback ?? "This step cannot be automated."}`, "");
      lines.push(`Original instruction: ${step.humanAction}`, "");
    } else if (step.requiresApproval) {
      lines.push("**Approval gate:** Pause and request human approval before proceeding.", "");
      lines.push(step.agentAction.replace(/^\[APPROVAL REQUIRED\]\s*/, ""), "");
    } else {
      lines.push(step.agentAction, "");
    }
  }

  // Error handling
  lines.push(
    "## Error Handling",
    "",
    "- If a required tool is unavailable, log the failure and notify the operator.",
    "- If a step fails, do not proceed to the next step. Report the error with context.",
    "- If an approval gate is rejected, pause the workflow and await further instructions.",
    "",
  );

  // Metadata footer
  lines.push(
    "## Metadata",
    "",
    `- **Source SOP ID:** ${sop.id}`,
    `- **Generated:** ${new Date().toISOString()}`,
    `- **Automation level:** ${automationScore}%`,
    `- **Required integrations:** ${requiredTools.length > 0 ? requiredTools.join(", ") : "none"}`,
    `- **Human actions required:** ${humanActions.length}`,
    `- **Approval gates:** ${approvalGates.length}`,
    "",
  );

  return lines.join("\n");
}

function generateEvalScaffolding(
  sopName: string,
  analysis: SOPStepAnalysis[],
): object {
  const evals = analysis
    .filter((s) => s.automatable)
    .slice(0, 5) // limit to 5 most relevant evals
    .map((step, i) => ({
      id: i + 1,
      prompt: `Perform step ${step.stepNumber} of the ${sopName} process: ${step.humanAction}`,
      expected_output: step.agentAction,
      files: [],
      expectations: [],
    }));

  return {
    skill_name: `sop-${slugify(sopName)}`,
    evals,
  };
}

export function sopConverterService(db: Db) {
  const sops = sopService(db);
  const skills = companySkillService(db);
  const toolReqs = toolRequirementsService(db);

  return {
    async startConversion(
      sopId: string,
      companyId: string,
      opts: { mode: "auto" | "review"; agentId?: string },
    ): Promise<SOPConversionResult> {
      const sop = await sops.getById(sopId);
      if (!sop) throw new Error("SOP not found");
      if (sop.companyId !== companyId) throw new Error("Company mismatch");
      if (sop.status !== "draft" && sop.status !== "active") {
        throw new Error(`Cannot convert SOP with status "${sop.status}". Must be "draft" or "active".`);
      }

      // Transition to converting
      await sops.update(sopId, { status: "converting" });

      // Analyze steps and enrich with tool availability
      const rawSteps = analyzeSopSteps(sop.markdownBody);
      const availableToolIds = await toolReqs.getAvailableToolIds();
      const stepAnalysis = enrichToolAvailability(rawSteps, availableToolIds);
      const automatableCount = stepAnalysis.filter((s) => s.automatable).length;
      const automationScore = stepAnalysis.length > 0
        ? Math.round((automatableCount / stepAnalysis.length) * 100)
        : 0;

      // Generate SKILL.md
      const draftSkillMarkdown = generateSkillMarkdown(sop, stepAnalysis, automationScore);

      if (opts.mode === "auto") {
        // Create skill immediately
        const skill = await skills.createLocalSkill(companyId, {
          name: `${sop.name} (Skill)`,
          slug: `sop-${slugify(sop.name)}`,
          description: sop.description ?? `Agent-executable version of the "${sop.name}" SOP`,
          markdown: draftSkillMarkdown,
        });

        // Update SOP with link and converted status
        const conversionMeta: ConversionMetadata = {
          mode: "auto",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: "approved",
          stepAnalysis,
          draftSkillMarkdown,
          automationScore,
          agentId: opts.agentId,
        };

        const existingMeta = (sop.metadata as Record<string, unknown>) ?? {};
        await sops.update(sopId, {
          status: "converted",
        });

        // Update metadata and generatedSkillId via direct DB update
        // since sopService.update doesn't expose these fields
        await db
          .update(companySops)
          .set({
            generatedSkillId: skill.id,
            metadata: { ...existingMeta, conversion: conversionMeta },
            updatedAt: new Date(),
          })
          .where(eq(companySops.id, sopId));

        return {
          sopId,
          status: "approved",
          stepAnalysis,
          draftSkillMarkdown,
          automationScore,
          generatedSkillId: skill.id,
        };
      }

      // Review mode: store draft for later approval
      const conversionMeta: ConversionMetadata = {
        mode: "review",
        startedAt: new Date().toISOString(),
        status: "draft_ready",
        stepAnalysis,
        draftSkillMarkdown,
        automationScore,
        agentId: opts.agentId,
      };

      const existingMeta = (sop.metadata as Record<string, unknown>) ?? {};
      await db
        .update(companySops)
        .set({
          metadata: { ...existingMeta, conversion: conversionMeta },
          updatedAt: new Date(),
        })
        .where(eq(companySops.id, sopId));

      return {
        sopId,
        status: "draft_ready",
        stepAnalysis,
        draftSkillMarkdown,
        automationScore,
        generatedSkillId: null,
      };
    },

    async getConversionStatus(sopId: string): Promise<SOPConversionResult | null> {
      const sop = await sops.getById(sopId);
      if (!sop) return null;

      const meta = sop.metadata as Record<string, unknown> | null;
      const conversion = meta?.conversion as ConversionMetadata | undefined;
      if (!conversion) return null;

      return {
        sopId,
        status: conversion.status,
        stepAnalysis: conversion.stepAnalysis ?? [],
        draftSkillMarkdown: conversion.draftSkillMarkdown ?? null,
        automationScore: conversion.automationScore ?? 0,
        generatedSkillId: sop.generatedSkillId,
      };
    },

    async approveConversion(
      sopId: string,
      companyId: string,
    ): Promise<{ skillId: string }> {
      const sop = await sops.getById(sopId);
      if (!sop) throw new Error("SOP not found");
      if (sop.companyId !== companyId) throw new Error("Company mismatch");
      if (sop.status !== "converting") {
        throw new Error(`SOP status is "${sop.status}", expected "converting"`);
      }

      const meta = sop.metadata as Record<string, unknown> | null;
      const conversion = meta?.conversion as ConversionMetadata | undefined;
      if (!conversion || conversion.status !== "draft_ready") {
        throw new Error("No draft ready for approval. Run conversion first.");
      }

      if (!conversion.draftSkillMarkdown) {
        throw new Error("Draft skill markdown is missing from conversion metadata.");
      }

      // Create the skill
      const skill = await skills.createLocalSkill(companyId, {
        name: `${sop.name} (Skill)`,
        slug: `sop-${slugify(sop.name)}`,
        description: sop.description ?? `Agent-executable version of the "${sop.name}" SOP`,
        markdown: conversion.draftSkillMarkdown,
      });

      // Update SOP
      const updatedConversion: ConversionMetadata = {
        ...conversion,
        status: "approved",
        completedAt: new Date().toISOString(),
      };

      const existingMeta = (sop.metadata as Record<string, unknown>) ?? {};
      await db
        .update(companySops)
        .set({
          status: "converted",
          generatedSkillId: skill.id,
          metadata: { ...existingMeta, conversion: updatedConversion },
          updatedAt: new Date(),
        })
        .where(eq(companySops.id, sopId));

      return { skillId: skill.id };
    },

    async rejectConversion(sopId: string, feedback: string): Promise<void> {
      const sop = await sops.getById(sopId);
      if (!sop) throw new Error("SOP not found");
      if (sop.status !== "converting") {
        throw new Error(`SOP status is "${sop.status}", expected "converting"`);
      }

      const meta = sop.metadata as Record<string, unknown> | null;
      const conversion = meta?.conversion as ConversionMetadata | undefined;
      if (!conversion || conversion.status !== "draft_ready") {
        throw new Error("No draft ready to reject.");
      }

      const updatedConversion: ConversionMetadata = {
        ...conversion,
        status: "rejected",
        rejectionFeedback: feedback,
        completedAt: new Date().toISOString(),
      };

      const existingMeta = (sop.metadata as Record<string, unknown>) ?? {};
      await db
        .update(companySops)
        .set({
          status: "active", // revert
          metadata: { ...existingMeta, conversion: updatedConversion },
          updatedAt: new Date(),
        })
        .where(eq(companySops.id, sopId));
    },

    generateEvalScaffolding,
  };
}
