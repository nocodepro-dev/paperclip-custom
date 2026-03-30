/**
 * Tool Catalog — static mapping from SOP-detected bare tool IDs to real-world
 * MCP server packages and plugin name patterns.
 *
 * The SOP step analyzer detects tools as bare strings like "github" or "gmail".
 * This catalog maps those to known MCP server packages so Phase 3 (EQUIP) can
 * report what's installed vs missing and provide install commands.
 *
 * @see sop-step-analyzer.ts TOOL_PATTERNS for the source of bare tool IDs
 */

import type { ToolType } from "@paperclipai/shared";

export interface CatalogEntry {
  /** Bare tool ID — must match TOOL_PATTERNS[].tool in sop-step-analyzer.ts */
  toolId: string;
  /** Human-readable name */
  name: string;
  /** Tool type */
  type: ToolType;
  /** NPM package name for the MCP server (null if no known package) */
  suggestedPackage: string | null;
  /** Shell command to install the MCP server */
  installCommand: string | null;
  /** Regex patterns for matching against registered plugin tool names */
  pluginMatchPatterns: RegExp[];
  /** Hints for required configuration (env vars, OAuth, etc.) */
  configHints: string[];
}

/**
 * The complete catalog of tools detectable by the SOP step analyzer.
 * Each entry maps a bare tool ID to its real-world MCP server package.
 */
export const TOOL_CATALOG: CatalogEntry[] = [
  // ---- Google Workspace ----
  {
    toolId: "google_drive",
    name: "Google Drive",
    type: "mcp_server",
    suggestedPackage: "@modelcontextprotocol/server-google-drive",
    installCommand: "npx -y @modelcontextprotocol/server-google-drive",
    pluginMatchPatterns: [/google.?drive/i, /gdrive/i],
    configHints: ["GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required", "OAuth consent screen must be configured"],
  },
  {
    toolId: "google_docs",
    name: "Google Docs",
    type: "mcp_server",
    suggestedPackage: "@modelcontextprotocol/server-google-drive",
    installCommand: "npx -y @modelcontextprotocol/server-google-drive",
    pluginMatchPatterns: [/google.?docs/i],
    configHints: ["Shares MCP server with Google Drive"],
  },
  {
    toolId: "google_sheets",
    name: "Google Sheets",
    type: "mcp_server",
    suggestedPackage: "@modelcontextprotocol/server-google-drive",
    installCommand: "npx -y @modelcontextprotocol/server-google-drive",
    pluginMatchPatterns: [/google.?sheets/i],
    configHints: ["Shares MCP server with Google Drive"],
  },
  {
    toolId: "gmail",
    name: "Gmail",
    type: "mcp_server",
    suggestedPackage: "@anthropic/mcp-server-gmail",
    installCommand: "npx -y @anthropic/mcp-server-gmail",
    pluginMatchPatterns: [/gmail/i],
    configHints: ["GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET required"],
  },

  // ---- Dev / Code ----
  {
    toolId: "github",
    name: "GitHub",
    type: "mcp_server",
    suggestedPackage: "@modelcontextprotocol/server-github",
    installCommand: "npx -y @modelcontextprotocol/server-github",
    pluginMatchPatterns: [/github/i],
    configHints: ["GITHUB_TOKEN env var required"],
  },
  {
    toolId: "linear",
    name: "Linear",
    type: "mcp_server",
    suggestedPackage: "mcp-linear",
    installCommand: "npx -y mcp-linear",
    pluginMatchPatterns: [/linear/i],
    configHints: ["LINEAR_API_KEY env var required"],
  },
  {
    toolId: "jira",
    name: "Jira",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/jira/i],
    configHints: ["JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN required"],
  },

  // ---- Communication ----
  {
    toolId: "slack",
    name: "Slack",
    type: "mcp_server",
    suggestedPackage: "@modelcontextprotocol/server-slack",
    installCommand: "npx -y @modelcontextprotocol/server-slack",
    pluginMatchPatterns: [/slack/i],
    configHints: ["SLACK_BOT_TOKEN and SLACK_TEAM_ID required"],
  },

  // ---- Knowledge / Productivity ----
  {
    toolId: "notion",
    name: "Notion",
    type: "mcp_server",
    suggestedPackage: "@notionhq/mcp-server-notion",
    installCommand: "npx -y @notionhq/mcp-server-notion",
    pluginMatchPatterns: [/notion/i],
    configHints: ["NOTION_API_KEY required"],
  },
  {
    toolId: "trello",
    name: "Trello",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/trello/i],
    configHints: ["TRELLO_API_KEY and TRELLO_TOKEN required"],
  },
  {
    toolId: "asana",
    name: "Asana",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/asana/i],
    configHints: ["ASANA_ACCESS_TOKEN required"],
  },
  {
    toolId: "airtable",
    name: "Airtable",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/airtable/i],
    configHints: ["AIRTABLE_API_KEY required"],
  },

  // ---- CRM / Sales ----
  {
    toolId: "salesforce",
    name: "Salesforce",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/salesforce|sfdc/i],
    configHints: ["Salesforce OAuth credentials required"],
  },
  {
    toolId: "hubspot",
    name: "HubSpot",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/hubspot/i],
    configHints: ["HUBSPOT_ACCESS_TOKEN required"],
  },

  // ---- Payments / Finance ----
  {
    toolId: "stripe",
    name: "Stripe",
    type: "mcp_server",
    suggestedPackage: "@stripe/mcp-server-stripe",
    installCommand: "npx -y @stripe/mcp-server-stripe",
    pluginMatchPatterns: [/stripe/i],
    configHints: ["STRIPE_SECRET_KEY required"],
  },
  {
    toolId: "quickbooks",
    name: "QuickBooks",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/quickbooks|qbo/i],
    configHints: ["QuickBooks OAuth credentials required"],
  },
  {
    toolId: "xero",
    name: "Xero",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/xero/i],
    configHints: ["Xero OAuth credentials required"],
  },

  // ---- Deployment / Hosting ----
  {
    toolId: "vercel",
    name: "Vercel",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/vercel/i],
    configHints: ["VERCEL_TOKEN required"],
  },
  {
    toolId: "netlify",
    name: "Netlify",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/netlify/i],
    configHints: ["NETLIFY_AUTH_TOKEN required"],
  },
  {
    toolId: "aws",
    name: "AWS",
    type: "cli_tool",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/aws|s3|lambda/i],
    configHints: ["AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY required", "AWS CLI must be installed"],
  },
  {
    toolId: "docker",
    name: "Docker",
    type: "cli_tool",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/docker/i],
    configHints: ["Docker Desktop or Docker Engine must be installed"],
  },

  // ---- Design ----
  {
    toolId: "figma",
    name: "Figma",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/figma/i],
    configHints: ["FIGMA_ACCESS_TOKEN required"],
  },

  // ---- E-commerce ----
  {
    toolId: "shopify",
    name: "Shopify",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/shopify/i],
    configHints: ["SHOPIFY_ACCESS_TOKEN and SHOPIFY_STORE_URL required"],
  },

  // ---- Messaging / SMS ----
  {
    toolId: "twilio",
    name: "Twilio",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/twilio/i],
    configHints: ["TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required"],
  },
  {
    toolId: "sendgrid",
    name: "SendGrid",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/sendgrid/i],
    configHints: ["SENDGRID_API_KEY required"],
  },

  // ---- Support ----
  {
    toolId: "intercom",
    name: "Intercom",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/intercom/i],
    configHints: ["INTERCOM_ACCESS_TOKEN required"],
  },
  {
    toolId: "zendesk",
    name: "Zendesk",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/zendesk/i],
    configHints: ["ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN required"],
  },

  // ---- Automation ----
  {
    toolId: "zapier",
    name: "Zapier",
    type: "mcp_server",
    suggestedPackage: null,
    installCommand: null,
    pluginMatchPatterns: [/zapier/i],
    configHints: ["Zapier NLA API key required"],
  },
];

// ---- Indexed lookups ----

const byToolId = new Map(TOOL_CATALOG.map((e) => [e.toolId, e]));

/** Look up a catalog entry by bare tool ID. */
export function lookupTool(toolId: string): CatalogEntry | null {
  return byToolId.get(toolId) ?? null;
}

/**
 * Match a bare tool ID against a list of registered plugin tool names.
 * Returns the first matching namespaced tool name, or null.
 */
export function matchRegisteredTools(
  toolId: string,
  registeredNames: string[],
): string | null {
  const entry = byToolId.get(toolId);
  if (!entry) return null;

  for (const name of registeredNames) {
    for (const pattern of entry.pluginMatchPatterns) {
      if (pattern.test(name)) return name;
    }
  }
  return null;
}
