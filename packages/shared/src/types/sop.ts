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
