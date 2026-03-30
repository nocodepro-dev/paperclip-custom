import type { SOPStepAnalysis } from "@paperclipai/shared";

// ---- Tool detection patterns ----

interface ToolPattern {
  pattern: RegExp;
  tool: string;
  name: string;
}

const TOOL_PATTERNS: ToolPattern[] = [
  { pattern: /google\s*drive|gdrive|shared\s*drive/i, tool: "google_drive", name: "Google Drive" },
  { pattern: /google\s*docs?/i, tool: "google_docs", name: "Google Docs" },
  { pattern: /google\s*sheets?/i, tool: "google_sheets", name: "Google Sheets" },
  { pattern: /gmail|send\s+(an?\s+)?email|compose\s+(an?\s+)?email/i, tool: "gmail", name: "Gmail" },
  { pattern: /slack|post\s+(to|in)\s+#/i, tool: "slack", name: "Slack" },
  { pattern: /github|pull\s*request|merge\s*request|git\s+push|git\s+commit/i, tool: "github", name: "GitHub" },
  { pattern: /jira|jira\s+ticket/i, tool: "jira", name: "Jira" },
  { pattern: /linear\s+(issue|ticket|task)/i, tool: "linear", name: "Linear" },
  { pattern: /notion/i, tool: "notion", name: "Notion" },
  { pattern: /salesforce|sfdc/i, tool: "salesforce", name: "Salesforce" },
  { pattern: /stripe|payment|invoice\s+payment/i, tool: "stripe", name: "Stripe" },
  { pattern: /hubspot/i, tool: "hubspot", name: "HubSpot" },
  { pattern: /vercel|deploy\s+to\s+vercel/i, tool: "vercel", name: "Vercel" },
  { pattern: /netlify/i, tool: "netlify", name: "Netlify" },
  { pattern: /aws|s3\s+bucket|lambda/i, tool: "aws", name: "AWS" },
  { pattern: /docker|container/i, tool: "docker", name: "Docker" },
  { pattern: /figma/i, tool: "figma", name: "Figma" },
  { pattern: /trello/i, tool: "trello", name: "Trello" },
  { pattern: /asana/i, tool: "asana", name: "Asana" },
  { pattern: /airtable/i, tool: "airtable", name: "Airtable" },
  { pattern: /zapier/i, tool: "zapier", name: "Zapier" },
  { pattern: /twilio|send\s+sms/i, tool: "twilio", name: "Twilio" },
  { pattern: /sendgrid/i, tool: "sendgrid", name: "SendGrid" },
  { pattern: /intercom/i, tool: "intercom", name: "Intercom" },
  { pattern: /zendesk/i, tool: "zendesk", name: "Zendesk" },
  { pattern: /shopify/i, tool: "shopify", name: "Shopify" },
  { pattern: /quickbooks|qbo/i, tool: "quickbooks", name: "QuickBooks" },
  { pattern: /xero/i, tool: "xero", name: "Xero" },
];

const NON_AUTOMATABLE_PATTERNS = [
  /right[- ]click/i,
  /drag\s+(and|&)\s+drop/i,
  /visually\s+(verify|inspect|confirm|check|review)/i,
  /call\s+(the|a)\s+(client|customer|team|manager)/i,
  /phone\s+(call|the)/i,
  /attend\s+(a\s+)?meeting/i,
  /in[- ]person/i,
  /physically\s/i,
  /hand[- ]deliver/i,
  /print\s+(and|&)\s+(sign|mail)/i,
  /sign\s+(the|a)\s+(document|contract|paper)/i,
  /wet\s+signature/i,
];

const APPROVAL_PATTERNS = [
  /\bapprov(e|al)\b/i,
  /sign[- ]?off/i,
  /review\s+(and|&)\s+(approv|confirm|sign)/i,
  /manager\s+review/i,
  /supervisor\s+approv/i,
  /get\s+(approval|sign[- ]?off)/i,
  /board\s+approval/i,
  /\bconfirm\s+before\s+send/i,
  /\bverify\s+before\s+(proceed|continu)/i,
];

// ---- Step parsing ----

export interface ParsedStep {
  heading: string;
  body: string;
  listItems: string[];
}

/**
 * Parse SOP markdown into discrete steps.
 * Tries heading-based splitting first, falls back to numbered list items.
 */
export function parseSopSteps(markdown: string): ParsedStep[] {
  // Try heading-based: ## Step N, ### Step N, ## N., # N.
  const headingPattern = /^(#{1,3})\s+(?:step\s+)?(\d+)[.:)—\-\s]/gim;
  const headingMatches: { index: number; text: string }[] = [];
  let match;
  while ((match = headingPattern.exec(markdown)) !== null) {
    headingMatches.push({ index: match.index, text: match[0].trim() });
  }

  if (headingMatches.length >= 2) {
    return splitByHeadings(markdown, headingMatches);
  }

  // Try any heading pattern: ## anything
  const anyHeading = /^(#{1,3})\s+(.+)$/gim;
  const allHeadings: { index: number; text: string }[] = [];
  while ((match = anyHeading.exec(markdown)) !== null) {
    const text = match[2].trim();
    // Skip common non-step headings
    if (/^(source|prerequisites?|error|metadata|references?|table\s+of\s+contents)/i.test(text)) continue;
    allHeadings.push({ index: match.index, text: match[0].trim() });
  }

  if (allHeadings.length >= 2) {
    return splitByHeadings(markdown, allHeadings);
  }

  // Fall back: numbered list items at top level
  const numberedItems = /^\d+[.)]\s+(.+)/gm;
  const items: ParsedStep[] = [];
  while ((match = numberedItems.exec(markdown)) !== null) {
    items.push({
      heading: match[1].trim(),
      body: match[1].trim(),
      listItems: [match[1].trim()],
    });
  }

  if (items.length >= 2) return items;

  // Last resort: treat entire content as one step
  const trimmed = markdown.trim();
  if (trimmed.length > 0) {
    return [{
      heading: trimmed.split("\n")[0].replace(/^#+\s*/, "").trim() || "Process",
      body: trimmed,
      listItems: [],
    }];
  }

  return [];
}

function splitByHeadings(markdown: string, headings: { index: number; text: string }[]): ParsedStep[] {
  const steps: ParsedStep[] = [];

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i].text.length;
    const end = i + 1 < headings.length ? headings[i + 1].index : markdown.length;
    const body = markdown.slice(start, end).trim();
    const listItems = extractListItems(body);

    steps.push({
      heading: headings[i].text.replace(/^#+\s*/, "").trim(),
      body,
      listItems,
    });
  }

  return steps;
}

function extractListItems(body: string): string[] {
  const items: string[] = [];
  const pattern = /^[-*]\s+(.+)$|^\d+[.)]\s+(.+)$/gm;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    items.push((match[1] || match[2]).trim());
  }
  return items;
}

// ---- Step analysis ----

/**
 * Analyze a single parsed step for tool requirements,
 * automation feasibility, and approval gates.
 */
export function analyzeStep(step: ParsedStep, stepNumber: number): SOPStepAnalysis {
  const fullText = `${step.heading} ${step.body}`;

  // Detect tool requirement
  let toolRequired: string | null = null;
  for (const tp of TOOL_PATTERNS) {
    if (tp.pattern.test(fullText)) {
      toolRequired = tp.tool;
      break;
    }
  }

  // Check if non-automatable (UI-only, physical, etc.)
  let automatable = true;
  let fallback: string | null = null;
  for (const pattern of NON_AUTOMATABLE_PATTERNS) {
    if (pattern.test(fullText)) {
      automatable = false;
      const matched = fullText.match(pattern);
      fallback = `Requires human intervention: "${matched?.[0] ?? "manual action"}" detected. Flag for operator handling.`;
      break;
    }
  }

  // Check for approval gate
  let requiresApproval = false;
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(fullText)) {
      requiresApproval = true;
      break;
    }
  }

  // Generate agent action from human action
  const humanAction = step.heading || step.body.split("\n")[0].trim();
  const agentAction = generateAgentAction(humanAction, toolRequired, automatable, requiresApproval);

  return {
    stepNumber,
    humanAction,
    toolRequired,
    agentAction,
    automatable,
    requiresApproval,
    toolAvailable: false, // will be enriched later when tool registry exists
    fallback,
  };
}

/**
 * Full pipeline: parse markdown into steps, then analyze each.
 */
export function analyzeSopSteps(markdown: string): SOPStepAnalysis[] {
  const parsed = parseSopSteps(markdown);
  return parsed.map((step, i) => analyzeStep(step, i + 1));
}

// ---- Agent action generation ----

function generateAgentAction(
  humanAction: string,
  toolRequired: string | null,
  automatable: boolean,
  requiresApproval: boolean,
): string {
  if (!automatable) {
    return `[HUMAN ACTION] ${humanAction}`;
  }

  const toolLabel = toolRequired ? getToolName(toolRequired) : null;
  let action = humanAction;

  if (toolLabel) {
    action = `Use ${toolLabel} to: ${humanAction}`;
  }

  if (requiresApproval) {
    action = `[APPROVAL REQUIRED] ${action}`;
  }

  return action;
}

function getToolName(toolId: string): string {
  const entry = TOOL_PATTERNS.find((t) => t.tool === toolId);
  return entry?.name ?? toolId;
}
