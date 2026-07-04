import {
  createMapping,
  type ExternalObjectMapping,
  type ExternalObjectRef,
  type IntegrationInstallation,
  type IntegrationPermission,
  type OpenRoadObjectRef,
  type ProviderFixture
} from "./adapter.js";
import type { RequestComment, RequestItem, RequestStatus } from "../domain/openroad.js";
import type { RequestOwner } from "../domain/openroad.js";

export const linearRequiredInstallationPermissions: IntegrationPermission[] = [
  "read:external",
  "read:openroad",
  "write:openroad"
];

export type LinearTeam = {
  id: string;
  key: string;
  name: string;
};

export type LinearIssueState = {
  id?: string;
  name: string;
  type?: string;
};

export type LinearIssue = {
  assignee?: string;
  body: string;
  creator?: string;
  id: string;
  identifier: string;
  labels: string[];
  priority?: number;
  project?: string;
  state: LinearIssueState;
  team: LinearTeam;
  title: string;
  updatedAt?: string;
  url: string;
};

export type LinearInstallationInput = {
  accountId: string;
  accountName: string;
  createdAt?: string;
  id: string;
  permissions?: IntegrationPermission[];
  status?: IntegrationInstallation["status"];
  workspaceId: string;
};

export type LinearIssueRequestOptions = {
  existingRequestIds?: string[];
  now?: string;
  requestId?: string;
};

export type LinearInstallationCapabilities = {
  canImportIssues: boolean;
  canReceiveWebhooks: boolean;
  canWriteBackToLinear: boolean;
};

export function createLinearInstallation(input: LinearInstallationInput): IntegrationInstallation {
  const permissions = normalizePermissions(
    input.permissions ?? linearRequiredInstallationPermissions
  );

  assertHasPermission(permissions, "read:external");
  assertHasPermission(permissions, "read:openroad");
  assertHasPermission(permissions, "write:openroad");

  return {
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: requireText(input.id, "Linear installation id"),
    permissions,
    provider: "linear",
    providerAccountId: requireText(input.accountId, "Linear account id"),
    providerAccountName: requireText(input.accountName, "Linear account name"),
    status: input.status ?? "active",
    workspaceId: requireText(input.workspaceId, "OpenRoad workspace id")
  };
}

export function getLinearInstallationCapabilities(
  installation: IntegrationInstallation
): LinearInstallationCapabilities {
  return {
    canImportIssues:
      installation.provider === "linear" &&
      installation.permissions.includes("read:external") &&
      installation.permissions.includes("write:openroad"),
    canReceiveWebhooks: installation.permissions.includes("webhook:receive"),
    canWriteBackToLinear: installation.permissions.includes("write:external")
  };
}

export function parseLinearIssuePayload(value: unknown): LinearIssue {
  if (!isRecord(value)) {
    throw new Error("Linear issue payload must be an object.");
  }

  const team = parseLinearTeam(value.team);
  const identifier = requireText(getString(value.identifier), "Linear issue identifier");
  const title = requireText(getString(value.title), "Linear issue title");
  const id = requireText(getString(value.id), "Linear issue id");
  const state = parseLinearState(value.state);
  const url = normalizeExternalUrl(getString(value.url), `https://linear.app/issue/${identifier}`);

  return {
    assignee: parsePersonName(value.assignee),
    body: getString(value.description) ?? getString(value.body) ?? "",
    creator: parsePersonName(value.creator),
    id,
    identifier,
    labels: parseLinearLabels(value.labels),
    priority: getOptionalNumber(value.priority),
    project: parseNamedObject(value.project),
    state,
    team,
    title,
    updatedAt: getString(value.updatedAt) ?? getString(value.updated_at),
    url
  };
}

export function createLinearIssueExternalRef(issue: LinearIssue): ExternalObjectRef {
  return {
    id: issue.id,
    key: issue.identifier,
    provider: "linear",
    type: "issue",
    url: issue.url
  };
}

export function createOpenRoadRequestFromLinearIssue(
  issue: LinearIssue,
  options: LinearIssueRequestOptions = {}
): RequestItem {
  const now = options.now ?? new Date().toISOString();

  return {
    age: "imported now",
    archived: false,
    comments: [createLinearSyncComment(issue, now)],
    description: createLinearIssueDescription(issue),
    hasCurrentUserVote: false,
    publicVoterKeys: [],
    id:
      options.requestId ??
      createLinearRequestId(issue, new Set(options.existingRequestIds ?? [])),
    mergedSources: [],
    owner: mapLinearAssigneeToRequestOwner(issue),
    requester: issue.creator ?? issue.team.name,
    source: "Linear",
    status: mapLinearIssueToRequestStatus(issue),
    tags: createLinearIssueTags(issue),
    title: issue.title,
    visibility: "Private",
    votes: 0
  };
}

export function syncOpenRoadRequestFromLinearIssue(
  request: RequestItem,
  issue: LinearIssue,
  now = new Date().toISOString()
): RequestItem {
  return {
    ...request,
    comments: upsertLinearSyncComment(request.comments, issue, now),
    description: createLinearIssueDescription(issue),
    owner: mapLinearAssigneeToRequestOwner(issue),
    status: mapLinearIssueToRequestStatus(issue),
    tags: mergeTags(request.tags, createLinearIssueTags(issue)),
    title: issue.title
  };
}

export function createLinearIssueMapping(
  installation: IntegrationInstallation,
  issue: LinearIssue,
  openRoad: OpenRoadObjectRef,
  connectedAt: string
): ExternalObjectMapping {
  return createMapping(installation, createLinearIssueExternalRef(issue), openRoad, connectedAt);
}

export function createLinearIssueFixture(
  issue: LinearIssue,
  installation: IntegrationInstallation,
  requestId: string
): ProviderFixture {
  return {
    external: createLinearIssueExternalRef(issue),
    fields: {
      identifier: issue.identifier,
      labels: issue.labels,
      state: issue.state.name,
      title: issue.title
    },
    installation,
    openRoad: {
      id: requestId,
      type: "request",
      workspaceId: installation.workspaceId
    }
  };
}

export function mapLinearIssueToRequestStatus(issue: LinearIssue): RequestStatus {
  const stateType = issue.state.type?.toLowerCase();
  const stateName = issue.state.name.toLowerCase();
  const labels = issue.labels.map((label) => label.toLowerCase());

  if (stateType === "completed" || ["done", "complete", "completed", "shipped"].includes(stateName)) {
    return "Shipping soon";
  }

  if (
    stateType === "triage" ||
    stateType === "canceled" ||
    ["triage", "canceled", "cancelled", "duplicate", "invalid"].includes(stateName) ||
    labels.some((label) => ["question", "discussion", "needs decision", "needs-decision"].includes(label))
  ) {
    return "Needs decision";
  }

  if (
    stateType === "backlog" ||
    stateType === "started" ||
    stateType === "unstarted" ||
    issue.assignee ||
    issue.project
  ) {
    return "Planned";
  }

  return "New";
}

function parseLinearTeam(value: unknown): LinearTeam {
  if (!isRecord(value)) {
    throw new Error("Linear issue team payload must be an object.");
  }

  return {
    id: requireText(getString(value.id), "Linear team id"),
    key: requireText(getString(value.key), "Linear team key"),
    name: requireText(getString(value.name) ?? getString(value.displayName), "Linear team name")
  };
}

function parseLinearState(value: unknown): LinearIssueState {
  if (!isRecord(value)) {
    throw new Error("Linear issue state payload must be an object.");
  }

  return {
    id: getString(value.id),
    name: requireText(getString(value.name), "Linear issue state name"),
    type: getString(value.type)
  };
}

function parseLinearLabels(value: unknown) {
  const source = isRecord(value) && Array.isArray(value.nodes) ? value.nodes : value;
  if (!Array.isArray(source)) return [];

  return source
    .map((label) => (typeof label === "string" ? label.trim() : parseNamedObject(label)))
    .filter((label): label is string => Boolean(label))
    .slice(0, 20);
}

function parsePersonName(value: unknown) {
  if (!isRecord(value)) return undefined;
  return getString(value.displayName) ?? getString(value.name) ?? getString(value.email);
}

function parseNamedObject(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (!isRecord(value)) return undefined;
  return getString(value.name) ?? getString(value.title);
}

function createLinearIssueDescription(issue: LinearIssue) {
  const body = issue.body.trim() || "No Linear issue description was provided.";
  return [
    `Imported from Linear issue ${issue.identifier}.`,
    `Team: ${issue.team.name} (${issue.team.key})`,
    `State: ${issue.state.name}`,
    ...(issue.assignee ? [`Assignee: ${issue.assignee}`] : []),
    `Source: ${issue.url}`,
    "",
    body
  ].join("\n");
}

function createLinearIssueTags(issue: LinearIssue) {
  return mergeTags(
    [
      "linear",
      `team:${issue.team.key}`,
      `linear:state:${issue.state.name}`,
      ...(issue.assignee ? [`linear:assignee:${issue.assignee}`] : []),
      ...(issue.project ? [`linear:project:${issue.project}`] : [])
    ],
    issue.labels.map((label) => `linear:${label}`)
  ).slice(0, 12);
}

function mapLinearAssigneeToRequestOwner(issue: LinearIssue): RequestOwner {
  if (!issue.assignee) return "Unassigned";
  return "Maintainer";
}

function createLinearSyncComment(issue: LinearIssue, now: string): RequestComment {
  return {
    age: `synced ${now}`,
    author: "Linear",
    body: `Linked to Linear issue ${issue.identifier}: ${issue.url}`,
    id: createLinearSyncCommentId(issue),
    visibility: "Internal"
  };
}

function upsertLinearSyncComment(
  comments: RequestComment[],
  issue: LinearIssue,
  now: string
) {
  const comment = createLinearSyncComment(issue, now);
  const nextComments = comments.filter((item) => item.id !== comment.id);
  return [comment, ...nextComments];
}

function createLinearSyncCommentId(issue: LinearIssue) {
  return `linear-sync-${normalizeIdentifier(issue.id)}`;
}

function createLinearRequestId(issue: LinearIssue, existingIds: Set<string>) {
  const base = normalizeIdentifier(`linear-${issue.identifier}`);
  if (!existingIds.has(base)) return base;

  const withIssueId = `${base}-${normalizeIdentifier(issue.id).slice(0, 16)}`;
  if (!existingIds.has(withIssueId)) return withIssueId;

  let index = 2;
  while (existingIds.has(`${withIssueId}-${index}`)) index += 1;
  return `${withIssueId}-${index}`;
}

function mergeTags(first: string[], second: string[]) {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const tag of [...first, ...second]) {
    const normalized = tag.trim().slice(0, 80);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    tags.push(normalized);
  }

  return tags;
}

function normalizePermissions(permissions: IntegrationPermission[]) {
  return [...new Set(permissions)];
}

function assertHasPermission(
  permissions: IntegrationPermission[],
  permission: IntegrationPermission
) {
  if (!permissions.includes(permission)) {
    throw new Error(`Linear installation must include ${permission} permission.`);
  }
}

function getString(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeExternalUrl(value: string | undefined, fallback: string) {
  if (!value) return fallback;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return fallback;
  }
}

function getOptionalNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requireText(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function normalizeIdentifier(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:@-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);

  return normalized || "linear-object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
