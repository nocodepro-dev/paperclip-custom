import type { SopStatus, SopSourceType, SopAssetKind } from "../constants.js";

export interface CompanySop {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  category: string | null;
  sourceType: SopSourceType;
  sourcePath: string | null;
  markdownBody: string;
  hasScreenshots: boolean;
  screenshotCount: number;
  status: SopStatus;
  generatedSkillId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SopAsset {
  id: string;
  sopId: string;
  companyId: string;
  assetId: string | null;
  localPath: string | null;
  relativePath: string;
  kind: SopAssetKind;
  stepNumber: number | null;
  createdAt: string;
}

export interface CompanySopDetail extends CompanySop {
  assets: SopAsset[];
}

// ---- Phase 2: Conversion types ----

export interface SOPStepAnalysis {
  stepNumber: number;
  humanAction: string;
  toolRequired: string | null;
  agentAction: string;
  automatable: boolean;
  requiresApproval: boolean;
  toolAvailable: boolean;
  fallback: string | null;
}

export interface SOPConversionResult {
  sopId: string;
  status: "analyzing" | "draft_ready" | "approved" | "rejected";
  stepAnalysis: SOPStepAnalysis[];
  draftSkillMarkdown: string | null;
  automationScore: number;
  generatedSkillId: string | null;
}

export type SOPConversionMode = "auto" | "review";
