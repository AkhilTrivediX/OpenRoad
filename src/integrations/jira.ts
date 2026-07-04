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

export const jiraRequiredInstallationPermissions: IntegrationPermission[] = [
  "read:external",
  "read:openroad",
  "write:openroad"
];

export type JiraProject = {
  id: string;
  key: string;
  name: string;
};

export type JiraStatusCategory = {
  key?: string;
  name?: string;
};

export type JiraIssueStatus = {
  category?: JiraStatusCategory;
  id?: string;
  name: string;
};

export type JiraIssue = {
  assignee?: string;
  body: string;
  cloudId?: string;
  id: string;
  issueType?: string;
  key: string;
  labels: string[];
  priority?: string;
  project: JiraProject;
  reporter?: string;
  self?: string;
  status: JiraIssueStatus;
  title: string;
  updatedAt?: string;
  url: string;
};

export type JiraInstallationInput = {
  accountId: string;
  accountName: string;
  createdAt?: string;
  id: string;
  permissions?: IntegrationPermission[];
  status?: IntegrationInstallation["status"];
  workspaceId: string;
};

export type JiraIssueRequestOptions = {
  existingRequestIds?: string[];
  now?: string;
  requestId?: string;
};

export type JiraInstallationCapabilities = {
  canImportIssues: boolean;
  canReceiveWebhooks: boolean;
  canWriteBackToJira: boolean;
};

export function createJiraInstallation(input: JiraInstallationInput): IntegrationInstallation {
  const permissions = normalizePermissions(input.permissions ?? jiraRequiredInstallationPermissions);
  const accountId = requireText(input.accountId, "Jira account id");

  assertHasPermission(permissions, "read:external");
  assertHasPermission(permissions, "read:openroad");
  assertHasPermission(permissions, "write:openroad");

  return {
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: createJiraInstallationId(input.id, accountId),
    permissions,
    provider: "jira",
    providerAccountId: accountId,
    providerAccountName: requireText(input.accountName, "Jira account name"),
    status: input.status ?? "active",
    workspaceId: requireText(input.workspaceId, "OpenRoad workspace id")
  };
}

export function getJiraInstallationCapabilities(
  installation: IntegrationInstallation
): JiraInstallationCapabilities {
  return {
    canImportIssues:
      installation.provider === "jira" &&
      installation.permissions.includes("read:external") &&
      installation.permissions.includes("write:openroad"),
    canReceiveWebhooks: installation.permissions.includes("webhook:receive"),
    canWriteBackToJira: installation.permissions.includes("write:external")
  };
}

export function parseJiraIssuePayload(value: unknown): JiraIssue {
  if (!isRecord(value)) {
    throw new Error("Jira issue payload must be an object.");
  }

  const fields = isRecord(value.fields) ? value.fields : {};
  const id = requireText(getString(value.id), "Jira issue id");
  const key = requireText(getString(value.key), "Jira issue key");
  const title = requireText(getString(fields.summary) ?? getString(value.summary), "Jira issue summary");
  const project = parseJiraProject(fields.project ?? value.project);
  const status = parseJiraStatus(fields.status ?? value.status);
  const url = normalizeExternalUrl(
    getString(value.browseUrl) ?? getString(value.url) ?? getString(value.self),
    `jira:${key}`
  );

  return {
    assignee: parseJiraPerson(fields.assignee ?? value.assignee),
    body: parseJiraDescription(fields.description ?? value.description),
    cloudId: getJiraCloudId(value),
    id,
    issueType: parseNamedObject(fields.issuetype ?? fields.issueType ?? value.issueType),
    key,
    labels: parseJiraLabels(fields.labels ?? value.labels),
    priority: parseNamedObject(fields.priority ?? value.priority),
    project,
    reporter: parseJiraPerson(fields.reporter ?? value.reporter),
    self: getString(value.self),
    status,
    title,
    updatedAt: getString(fields.updated) ?? getString(value.updated),
    url
  };
}

export function createJiraIssueExternalRef(issue: JiraIssue): ExternalObjectRef {
  return {
    id: issue.cloudId ? `${issue.cloudId}:${issue.id}` : issue.id,
    key: issue.key,
    provider: "jira",
    type: "issue",
    url: issue.url
  };
}

export function scopeJiraIssueToCloudId(issue: JiraIssue, cloudId: string): JiraIssue {
  return {
    ...issue,
    cloudId: requireText(issue.cloudId ?? cloudId, "Jira cloud id")
  };
}

export function createOpenRoadRequestFromJiraIssue(
  issue: JiraIssue,
  options: JiraIssueRequestOptions = {}
): RequestItem {
  const now = options.now ?? new Date().toISOString();

  return {
    age: "imported now",
    archived: false,
    comments: [createJiraSyncComment(issue, now)],
    description: createJiraIssueDescription(issue),
    hasCurrentUserVote: false,
    publicVoterKeys: [],
    id: options.requestId ?? createJiraRequestId(issue, new Set(options.existingRequestIds ?? [])),
    mergedSources: [],
    owner: mapJiraAssigneeToRequestOwner(issue),
    requester: issue.reporter ?? issue.project.name,
    source: "Jira",
    status: mapJiraIssueToRequestStatus(issue),
    tags: createJiraIssueTags(issue),
    title: issue.title,
    visibility: "Private",
    votes: 0
  };
}

export function syncOpenRoadRequestFromJiraIssue(
  request: RequestItem,
  issue: JiraIssue,
  now = new Date().toISOString()
): RequestItem {
  return {
    ...request,
    comments: upsertJiraSyncComment(request.comments, issue, now),
    description: createJiraIssueDescription(issue),
    owner: mapJiraAssigneeToRequestOwner(issue),
    status: mapJiraIssueToRequestStatus(issue),
    tags: mergeTags(request.tags, createJiraIssueTags(issue)),
    title: issue.title
  };
}

export function createJiraIssueMapping(
  installation: IntegrationInstallation,
  issue: JiraIssue,
  openRoad: OpenRoadObjectRef,
  connectedAt: string
): ExternalObjectMapping {
  return createMapping(installation, createJiraIssueExternalRef(issue), openRoad, connectedAt);
}

export function createJiraIssueFixture(
  issue: JiraIssue,
  installation: IntegrationInstallation,
  requestId: string
): ProviderFixture {
  return {
    external: createJiraIssueExternalRef(issue),
    fields: {
      cloudId: issue.cloudId,
      issueType: issue.issueType,
      key: issue.key,
      labels: issue.labels,
      project: issue.project.key,
      status: issue.status.name,
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

export function mapJiraIssueToRequestStatus(issue: JiraIssue): RequestStatus {
  const categoryKey = issue.status.category?.key?.toLowerCase();
  const categoryName = issue.status.category?.name?.toLowerCase();
  const statusName = issue.status.name.toLowerCase();
  const labels = issue.labels.map((label) => label.toLowerCase());

  if (
    categoryKey === "done" ||
    categoryName === "done" ||
    ["done", "closed", "resolved", "shipped"].includes(statusName)
  ) {
    return "Shipping soon";
  }

  if (
    ["triage", "needs decision", "needs-decision", "blocked", "waiting for customer"].includes(
      statusName
    ) ||
    labels.some((label) =>
      ["question", "discussion", "needs decision", "needs-decision", "blocked"].includes(label)
    )
  ) {
    return "Needs decision";
  }

  if (
    categoryKey === "indeterminate" ||
    categoryName === "in progress" ||
    ["in progress", "selected for development", "ready", "planned"].includes(statusName) ||
    Boolean(issue.assignee)
  ) {
    return "Planned";
  }

  return "New";
}

function parseJiraProject(value: unknown): JiraProject {
  if (!isRecord(value)) {
    throw new Error("Jira issue project payload must be an object.");
  }

  return {
    id: requireText(getString(value.id), "Jira project id"),
    key: requireText(getString(value.key), "Jira project key"),
    name: requireText(getString(value.name), "Jira project name")
  };
}

function parseJiraStatus(value: unknown): JiraIssueStatus {
  if (!isRecord(value)) {
    throw new Error("Jira issue status payload must be an object.");
  }

  return {
    category: parseJiraStatusCategory(value.statusCategory),
    id: getString(value.id),
    name: requireText(getString(value.name), "Jira issue status name")
  };
}

function parseJiraStatusCategory(value: unknown) {
  if (!isRecord(value)) return undefined;

  return {
    key: getString(value.key),
    name: getString(value.name)
  };
}

function getJiraCloudId(value: Record<string, unknown>) {
  return (
    getString(value.cloudId) ??
    getString(value.cloudID) ??
    getString(value.providerAccountId) ??
    getString(value.accountId) ??
    getString(value.siteId) ??
    parseCloudIdFromUrl(getString(value.self))
  );
}

function parseCloudIdFromUrl(value: string | undefined) {
  if (!value) return undefined;

  const match = value.match(/\/ex\/jira\/([^/]+)\//);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function parseJiraDescription(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  return flattenAtlassianDocument(value);
}

function flattenAtlassianDocument(value: unknown) {
  const parts: string[] = [];
  collectAdfText(value, parts);
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectAdfText(value: unknown, parts: string[]) {
  if (typeof value === "string" || typeof value === "number") {
    parts.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectAdfText(item, parts));
    return;
  }

  if (!isRecord(value)) return;

  if (typeof value.text === "string") {
    parts.push(value.text);
  }

  if (value.type === "hardBreak") {
    parts.push("\n");
  }

  const isBlock = typeof value.type === "string" && isAdfBlockType(value.type);
  if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith("\n")) {
    parts.push("\n");
  }

  if (Array.isArray(value.content)) {
    value.content.forEach((item) => collectAdfText(item, parts));
  }

  if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith("\n")) {
    parts.push("\n");
  }
}

function isAdfBlockType(type: string) {
  return [
    "blockquote",
    "bulletList",
    "codeBlock",
    "heading",
    "listItem",
    "orderedList",
    "panel",
    "paragraph",
    "rule"
  ].includes(type);
}

function parseJiraLabels(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((label) => getString(label))
    .filter((label): label is string => Boolean(label))
    .slice(0, 20);
}

function parseJiraPerson(value: unknown) {
  if (!isRecord(value)) return undefined;
  return getString(value.displayName) ?? getString(value.name) ?? getString(value.emailAddress);
}

function parseNamedObject(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (!isRecord(value)) return undefined;
  return getString(value.name) ?? getString(value.value);
}

function createJiraIssueDescription(issue: JiraIssue) {
  const body = issue.body.trim() || "No Jira issue description was provided.";
  return [
    `Imported from Jira issue ${issue.key}.`,
    `Project: ${issue.project.name} (${issue.project.key})`,
    `Status: ${issue.status.name}`,
    ...(issue.issueType ? [`Type: ${issue.issueType}`] : []),
    ...(issue.priority ? [`Priority: ${issue.priority}`] : []),
    ...(issue.assignee ? [`Assignee: ${issue.assignee}`] : []),
    `Source: ${issue.url}`,
    "",
    body
  ].join("\n");
}

function createJiraIssueTags(issue: JiraIssue) {
  return mergeTags(
    [
      "jira",
      `project:${issue.project.key}`,
      `jira:status:${issue.status.name}`,
      ...(issue.issueType ? [`jira:type:${issue.issueType}`] : []),
      ...(issue.priority ? [`jira:priority:${issue.priority}`] : []),
      ...(issue.assignee ? [`jira:assignee:${issue.assignee}`] : [])
    ],
    issue.labels.map((label) => `jira:${label}`)
  ).slice(0, 12);
}

function mapJiraAssigneeToRequestOwner(issue: JiraIssue): RequestOwner {
  if (!issue.assignee) return "Unassigned";
  return "Maintainer";
}

function createJiraSyncComment(issue: JiraIssue, now: string): RequestComment {
  return {
    age: `synced ${now}`,
    author: "Jira",
    body: `Linked to Jira issue ${issue.key}: ${issue.url}`,
    id: createJiraSyncCommentId(issue),
    visibility: "Internal"
  };
}

function upsertJiraSyncComment(comments: RequestComment[], issue: JiraIssue, now: string) {
  const comment = createJiraSyncComment(issue, now);
  const nextComments = comments.filter((item) => item.id !== comment.id);
  return [comment, ...nextComments];
}

function createJiraSyncCommentId(issue: JiraIssue) {
  return `jira-sync-${normalizeIdentifier(issue.id)}`;
}

function createJiraRequestId(issue: JiraIssue, existingIds: Set<string>) {
  const base = normalizeIdentifier(`jira-${issue.key}`);
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
    throw new Error(`Jira installation must include ${permission} permission.`);
  }
}

function createJiraInstallationId(id: string, accountId: string) {
  const base = requireText(id, "Jira installation id");
  const scope = normalizeIdentifier(accountId);
  const normalizedBase = base.toLowerCase();

  if (normalizedBase.includes(scope)) {
    return base;
  }

  return `${base}-${scope}`.slice(0, 160);
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

  return normalized || "jira-object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
