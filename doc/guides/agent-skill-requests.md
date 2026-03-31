# Agent Skill Requests

Agents can request skills they don't have — either access to an existing company skill or creation of a new one. The CEO or board user reviews and approves these requests.

## How It Works

### For Agents

When an agent is working on a task and realizes it needs a skill it doesn't have, it can:

1. **Request access** to an existing company skill
2. **Request creation** of a new skill that doesn't exist yet

Both request types create an approval that the CEO/board reviews.

#### Requesting Access to an Existing Skill

The agent lists company skills to find what's available, then submits a request:

```
GET /api/companies/{companyId}/skills          # Browse available skills
GET /api/agents/me/skills                      # Check currently assigned skills

POST /api/companies/{companyId}/approvals
{
  "type": "skill_access_request",
  "requestedByAgentId": "{agent-id}",
  "payload": {
    "skillId": "<skill-uuid>",
    "skillKey": "<company/skill-key>",
    "skillName": "<skill display name>",
    "reason": "Why this skill is needed for the current task",
    "issueId": "<issue-id>"
  },
  "issueIds": ["<issue-id>"]
}
```

#### Requesting a New Skill

When no existing skill covers what the agent needs:

```
POST /api/companies/{companyId}/approvals
{
  "type": "skill_creation_request",
  "requestedByAgentId": "{agent-id}",
  "payload": {
    "suggestedName": "Name for the skill",
    "description": "What the skill should do",
    "reason": "Why this capability is needed",
    "issueId": "<issue-id>"
  },
  "issueIds": ["<issue-id>"]
}
```

After submitting either request, the agent continues working on other aspects of the task. It does **not** block waiting for approval — the agent is woken up automatically when the request is resolved.

### For Board Users / CEO

Skill requests appear in the **Skill Requests** page, accessible from the sidebar under the Company section. A red badge shows the count of pending requests.

The page has two tabs:
- **Pending** — requests awaiting a decision
- **All** — complete history of skill requests

Each request card shows:
- The requesting agent
- The skill name (or suggested name for new skills)
- The reason the agent needs the skill
- Approve / Reject buttons

#### Approving a Skill Access Request

When you approve a `Skill Request`, the system **automatically assigns the skill** to the requesting agent. The agent is then woken up to continue its work with the newly available skill.

#### Approving a New Skill Request

When you approve a `New Skill Request`, the skill does **not** exist yet. You need to:

1. Create the skill (using the skill creator or manual import)
2. Add it to the company skill library
3. Assign it to the requesting agent

The approval records that the request was acknowledged and the skill should be built.

#### Rejecting a Request

Rejecting a request notifies the agent that the skill will not be provided. The agent can then adjust its approach or escalate.

## Duplicate Prevention

If an agent submits a skill request that duplicates an existing pending request (same agent, same skill ID or suggested name), the system returns the existing request instead of creating a new one.

## Heartbeat Integration

Skill assessment happens during **Step 6b** of the agent heartbeat procedure — after the agent reads and understands the issue context, but before it starts working. See the [Paperclip skill documentation](../../skills/paperclip/SKILL.md) for the full heartbeat procedure.

## Architecture

This feature extends the existing approval system with two new types:

| Approval Type | Purpose |
|---|---|
| `skill_access_request` | Agent requests an existing company skill be assigned to it |
| `skill_creation_request` | Agent requests a new skill be created |

No new database tables are needed — both types use the standard `approvals` table with type-specific JSONB payloads.

### Key Files

| File | Purpose |
|---|---|
| `packages/shared/src/constants.ts` | Approval type definitions |
| `server/src/services/approvals.ts` | Auto-assign logic on approval |
| `server/src/routes/approvals.ts` | Type filtering, duplicate prevention |
| `ui/src/pages/SkillRequests.tsx` | Skill Requests page |
| `ui/src/components/ApprovalPayload.tsx` | Payload renderers for both types |
| `ui/src/components/Sidebar.tsx` | Sidebar nav item with badge |
| `ui/src/hooks/useSkillRequestBadge.ts` | Pending request count hook |
| `skills/paperclip/SKILL.md` | Agent heartbeat instructions (Step 6b) |
| `skills/paperclip/references/company-skills.md` | Agent skill request reference |

## API Endpoints

All skill request operations use existing approval endpoints:

| Action | Endpoint |
|---|---|
| Create request | `POST /api/companies/:companyId/approvals` |
| List skill requests | `GET /api/companies/:companyId/approvals?types=skill_access_request,skill_creation_request` |
| Approve | `POST /api/approvals/:id/approve` |
| Reject | `POST /api/approvals/:id/reject` |
| Request revision | `POST /api/approvals/:id/request-revision` |
| Resubmit | `POST /api/approvals/:id/resubmit` |
| Comment | `POST /api/approvals/:id/comments` |
