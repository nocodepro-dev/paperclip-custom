# SOP-to-Skill Converter

The SOP Converter transforms human standard operating procedures into agent-executable skills. It analyzes each step, detects which tools are needed, scores automation feasibility, and generates a skill definition your agents can run.

## The three phases

### 1. Capture

Upload a human SOP — a markdown document describing a process step by step. The SOP can include screenshots, templates, and example files.

### 2. Convert

The converter analyzes each step: what tool is needed, whether it can be automated, whether it requires human approval, and what to do if automation isn't possible. It generates a draft SKILL.md file.

### 3. Equip

After the skill is approved, the system checks whether the required tools (MCP servers, plugins) are installed and provides guidance for any that are missing.

## Uploading an SOP

### From the UI

1. Navigate to **Company > SOPs** in the sidebar.
2. Click **New SOP**.
3. Enter a **name**, optional **category** and **description**.
4. Paste the SOP content as **markdown** in the text area.
5. Click **Create SOP**.

### From the CLI (supports directories with screenshots)

```sh
# Single markdown file
pnpm paperclipai sop upload ./onboarding-process.md \
  --company-id <id> --name "Customer Onboarding"

# Directory with markdown + screenshots
pnpm paperclipai sop upload ./sops/onboarding/ \
  --company-id <id> --name "Customer Onboarding" --category "Sales"
```

When uploading a directory, the scanner finds the markdown file and associates any images (`.png`, `.jpg`, `.gif`) as assets. It infers step numbers from filenames like `step_1.png`, `step_2_screenshot.png`.

## SOP lifecycle

SOPs move through these statuses:

- **draft** — just uploaded, not yet ready for conversion
- **active** — reviewed and ready to convert
- **converting** — conversion in progress
- **converted** — skill has been generated
- **archived** — no longer in use

Activate a draft SOP by clicking **Activate** on the detail page (or updating the status via CLI).

## Starting a conversion

On an active SOP's detail page, click **Convert to Skill** and choose a mode:

- **Review** (recommended) — generates a draft skill for your approval before creating it
- **Auto** — generates and creates the skill immediately without a review step

The converter parses the SOP markdown into individual steps, then analyzes each one.

## Understanding the step analysis

The **Conversion** tab shows a detailed breakdown:

| Column | Meaning |
|--------|---------|
| **Human Action** | What the person does in this step |
| **Tool** | Which tool or service is needed (e.g. Google Sheets, GitHub, Slack) |
| **Auto** | Whether this step can be automated |
| **Tool Avail** | Whether the required tool/plugin is installed |
| **Approval** | Whether this step needs human sign-off |

The **Automation Score** at the top shows what percentage of steps can be fully automated. A score of 80%+ means the SOP is a good candidate for conversion.

### Tool detection

The analyzer recognizes 40+ tools including Google Workspace, GitHub, Jira, Linear, Notion, Salesforce, Stripe, Slack, AWS, Docker, and more. It matches keywords and patterns in each step's description.

### Non-automatable steps

Some actions can't be automated: drag-and-drop interactions, visual inspections, phone calls, in-person meetings, handwritten signatures. These are flagged with a fallback description explaining what the agent should do instead (e.g. "notify the operator to complete this step manually").

## Reviewing a draft skill

In **Review** mode, the converter shows a preview of the generated SKILL.md. Review it for:

- Are the automated steps accurate?
- Are the approval gates in the right places?
- Are the fallback instructions clear for non-automatable steps?
- Does the skill have the right prerequisites listed?

Then either:

- **Approve** — creates the skill in your company's skill library and links it back to the SOP
- **Reject** — provide feedback explaining what needs to change. The SOP returns to `active` status so you can re-run the conversion.

## After approval

Once approved:

1. A new **skill** appears in your company's skill library (Company > Skills).
2. The SOP status changes to `converted` with a link to the generated skill.
3. Agents with the skill equipped can execute the procedure.

## Tips for writing SOPs that convert well

- **Use numbered steps or headings** — the parser detects both `## Step 1: ...` headings and `1. ...` numbered lists.
- **Be specific about tools** — "Update the Google Sheet" converts better than "Update the spreadsheet".
- **Separate decision points** — put approval-required actions in their own steps so the converter can gate them properly.
- **Include error handling** — mention what to do if a step fails. The converter turns these into skill error-handling sections.
- **Keep steps atomic** — one action per step. "Send the email and update the CRM" should be two steps.
