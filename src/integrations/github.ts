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

export const githubRequiredInstallationPermissions: IntegrationPermission[] = [
  "read:external",
  "read:openroad",
  "write:openroad"
];

export type GitHubRepository = {
  id: string;
  fullName: string;
  name: string;
  owner: string;
  url: string;
  visibility: "private" | "public" | "unknown";
};

export type GitHubIssue = {
  assignees: string[];
  author: string;
  body: string;
  closedAt?: string;
  createdAt?: string;
  id: string;
  labels: string[];
  milestone?: string;
  number: number;
  repository: GitHubRepository;
  state: "open" | "closed";
  stateReason?: string;
  title: string;
  updatedAt?: string;
  url: string;
};

export type GitHubPullRequest = {
  id: string;
  number: number;
  repository: GitHubRepository;
  state: "open" | "closed" | "merged";
  title: string;
  url: string;
};

export type GitHubInstallationInput = {
  accountId: string;
  accountName: string;
  createdAt?: string;
  id: string;
  permissions?: IntegrationPermission[];
  status?: IntegrationInstallation["status"];
  workspaceId: string;
};

export type GitHubIssueRequestOptions = {
  existingRequestIds?: string[];
  now?: string;
  requestId?: string;
};

export type GitHubInstallationCapabilities = {
  canImportIssues: boolean;
  canLinkPullRequests: boolean;
  canReceiveWebhooks: boolean;
  canWriteBackToGitHub: boolean;
};

export function createGitHubInstallation(
  input: GitHubInstallationInput
): IntegrationInstallation {
  const permissions = normalizePermissions(
    input.permissions ?? githubRequiredInstallationPermissions
  );

  assertHasPermission(permissions, "read:external");
  assertHasPermission(permissions, "read:openroad");
  assertHasPermission(permissions, "write:openroad");

  return {
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: requireText(input.id, "GitHub installation id"),
    permissions,
    provider: "github",
    providerAccountId: requireText(input.accountId, "GitHub account id"),
    providerAccountName: requireText(input.accountName, "GitHub account name"),
    status: input.status ?? "active",
    workspaceId: requireText(input.workspaceId, "OpenRoad workspace id")
  };
}

export function getGitHubInstallationCapabilities(
  installation: IntegrationInstallation
): GitHubInstallationCapabilities {
  return {
    canImportIssues:
      installation.provider === "github" &&
      installation.permissions.includes("read:external") &&
      installation.permissions.includes("write:openroad"),
    canLinkPullRequests:
      installation.provider === "github" &&
      installation.permissions.includes("read:external") &&
      installation.permissions.includes("write:openroad"),
    canReceiveWebhooks: installation.permissions.includes("webhook:receive"),
    canWriteBackToGitHub: installation.permissions.includes("write:external")
  };
}

export function parseGitHubIssuePayload(value: unknown): GitHubIssue {
  if (!isRecord(value)) {
    throw new Error("GitHub issue payload must be an object.");
  }

  if (isRecord(value.pull_request) || isRecord(value.pullRequest)) {
    throw new Error("GitHub pull requests must be linked as pull requests, not imported as issues.");
  }

  const repository = parseGitHubRepository(value.repository);
  const number = getNumber(value.number, "GitHub issue number");
  const title = requireText(getString(value.title), "GitHub issue title");
  const id = requireText(
    getString(value.node_id) ?? getString(value.nodeId) ?? getString(value.id),
    "GitHub issue id"
  );
  const state = parseIssueState(getString(value.state));
  const url =
    getString(value.html_url) ??
    getString(value.htmlUrl) ??
    `https://github.com/${repository.fullName}/issues/${number}`;

  return {
    assignees: parseNamedUsers(value.assignees),
    author: parseLogin(value.user) ?? "GitHub user",
    body: getString(value.body) ?? "",
    closedAt: getString(value.closed_at) ?? getString(value.closedAt),
    createdAt: getString(value.created_at) ?? getString(value.createdAt),
    id,
    labels: parseLabels(value.labels),
    milestone: parseMilestone(value.milestone),
    number,
    repository,
    state,
    stateReason: getString(value.state_reason) ?? getString(value.stateReason),
    title,
    updatedAt: getString(value.updated_at) ?? getString(value.updatedAt),
    url
  };
}

export function parseGitHubPullRequestPayload(value: unknown): GitHubPullRequest {
  if (!isRecord(value)) {
    throw new Error("GitHub pull request payload must be an object.");
  }

  const repository = parseGitHubRepository(value.repository);
  const number = getNumber(value.number, "GitHub pull request number");
  const title = requireText(getString(value.title), "GitHub pull request title");
  const id = requireText(
    getString(value.node_id) ?? getString(value.nodeId) ?? getString(value.id),
    "GitHub pull request id"
  );
  const stateText = getString(value.state);
  const state =
    stateText === "closed" || stateText === "merged" || stateText === "open"
      ? stateText
      : "open";
  const url =
    getString(value.html_url) ??
    getString(value.htmlUrl) ??
    `https://github.com/${repository.fullName}/pull/${number}`;

  return {
    id,
    number,
    repository,
    state,
    title,
    url
  };
}

export function createGitHubIssueExternalRef(issue: GitHubIssue): ExternalObjectRef {
  return {
    id: issue.id,
    key: `${issue.repository.fullName}#${issue.number}`,
    provider: "github",
    type: "issue",
    url: issue.url
  };
}

export function createGitHubPullRequestExternalRef(
  pullRequest: GitHubPullRequest
): ExternalObjectRef {
  return {
    id: pullRequest.id,
    key: `${pullRequest.repository.fullName}#${pullRequest.number}`,
    provider: "github",
    type: "pull-request",
    url: pullRequest.url
  };
}

export function createOpenRoadRequestFromGitHubIssue(
  issue: GitHubIssue,
  options: GitHubIssueRequestOptions = {}
): RequestItem {
  const now = options.now ?? new Date().toISOString();

  return {
    age: "imported now",
    archived: false,
    comments: [createGitHubSyncComment(issue, now)],
    description: createGitHubIssueDescription(issue),
    hasCurrentUserVote: false,
    id:
      options.requestId ??
      createGitHubRequestId(issue, new Set(options.existingRequestIds ?? [])),
    mergedSources: [],
    owner: "Unassigned",
    requester: issue.author,
    source: "GitHub",
    status: mapGitHubIssueToRequestStatus(issue),
    tags: createGitHubIssueTags(issue),
    title: issue.title,
    visibility: "Private",
    votes: 0
  };
}

export function syncOpenRoadRequestFromGitHubIssue(
  request: RequestItem,
  issue: GitHubIssue,
  now = new Date().toISOString()
): RequestItem {
  return {
    ...request,
    comments: upsertGitHubSyncComment(request.comments, issue, now),
    description: createGitHubIssueDescription(issue),
    status: mapGitHubIssueToRequestStatus(issue),
    tags: mergeTags(request.tags, createGitHubIssueTags(issue)),
    title: issue.title
  };
}

export function createGitHubIssueMapping(
  installation: IntegrationInstallation,
  issue: GitHubIssue,
  openRoad: OpenRoadObjectRef,
  connectedAt: string
): ExternalObjectMapping {
  return createMapping(installation, createGitHubIssueExternalRef(issue), openRoad, connectedAt);
}

export function createGitHubPullRequestMapping(
  installation: IntegrationInstallation,
  pullRequest: GitHubPullRequest,
  openRoad: OpenRoadObjectRef,
  connectedAt: string
): ExternalObjectMapping {
  return createMapping(
    installation,
    createGitHubPullRequestExternalRef(pullRequest),
    openRoad,
    connectedAt
  );
}

export function createGitHubIssueFixture(
  issue: GitHubIssue,
  installation: IntegrationInstallation,
  requestId: string
): ProviderFixture {
  return {
    external: createGitHubIssueExternalRef(issue),
    fields: {
      labels: issue.labels,
      repository: issue.repository.fullName,
      state: issue.state,
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

export function mapGitHubIssueToRequestStatus(issue: GitHubIssue): RequestStatus {
  const labels = issue.labels.map((label) => label.toLowerCase());

  if (issue.state === "closed") return "Shipping soon";
  if (
    labels.some((label) =>
      ["needs-decision", "needs decision", "discussion", "question"].includes(label)
    )
  ) {
    return "Needs decision";
  }
  if (
    issue.milestone ||
    issue.assignees.length > 0 ||
    labels.some((label) => ["planned", "accepted", "in-progress", "ready"].includes(label))
  ) {
    return "Planned";
  }
  return "New";
}

function parseGitHubRepository(value: unknown): GitHubRepository {
  if (!isRecord(value)) {
    throw new Error("GitHub repository payload must be an object.");
  }

  const fullName =
    getString(value.full_name) ??
    getString(value.fullName) ??
    getRepositoryFullName(value.owner, value.name);
  const [ownerFromFullName, nameFromFullName] = fullName.split("/");

  return {
    fullName,
    id: requireText(getString(value.node_id) ?? getString(value.nodeId) ?? getString(value.id), "GitHub repository id"),
    name: requireText(getString(value.name) ?? nameFromFullName, "GitHub repository name"),
    owner: requireText(parseRepositoryOwner(value.owner) ?? ownerFromFullName, "GitHub repository owner"),
    url:
      getString(value.html_url) ??
      getString(value.htmlUrl) ??
      `https://github.com/${fullName}`,
    visibility:
      value.private === true
        ? "private"
        : value.private === false
          ? "public"
          : "unknown"
  };
}

function getRepositoryFullName(owner: unknown, name: unknown) {
  const ownerName = parseRepositoryOwner(owner);
  const repositoryName = getString(name);
  if (!ownerName || !repositoryName) {
    throw new Error("GitHub repository full name is required.");
  }
  return `${ownerName}/${repositoryName}`;
}

function parseRepositoryOwner(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (isRecord(value)) return getString(value.login) ?? getString(value.name);
  return undefined;
}

function parseIssueState(value: string | undefined): GitHubIssue["state"] {
  if (value === "open" || value === "closed") return value;
  throw new Error("GitHub issue state must be open or closed.");
}

function parseLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((label) => {
      if (typeof label === "string") return label.trim();
      if (isRecord(label)) return getString(label.name);
      return undefined;
    })
    .filter((label): label is string => Boolean(label))
    .slice(0, 20);
}

function parseNamedUsers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(parseLogin).filter((login): login is string => Boolean(login)).slice(0, 20);
}

function parseLogin(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (isRecord(value)) return getString(value.login);
  return undefined;
}

function parseMilestone(value: unknown) {
  if (!isRecord(value)) return undefined;
  return getString(value.title);
}

function createGitHubIssueDescription(issue: GitHubIssue) {
  const body = issue.body.trim() || "No GitHub issue body was provided.";
  return [
    `Imported from GitHub issue ${issue.repository.fullName}#${issue.number}.`,
    `Source: ${issue.url}`,
    "",
    body
  ].join("\n");
}

function createGitHubIssueTags(issue: GitHubIssue) {
  return mergeTags(
    ["github", `repo:${issue.repository.fullName}`],
    issue.labels.map((label) => `github:${label}`)
  ).slice(0, 12);
}

function createGitHubSyncComment(issue: GitHubIssue, now: string): RequestComment {
  return {
    age: `synced ${now}`,
    author: "GitHub",
    body: `Linked to GitHub issue ${issue.repository.fullName}#${issue.number}: ${issue.url}`,
    id: createGitHubSyncCommentId(issue),
    visibility: "Internal"
  };
}

function upsertGitHubSyncComment(
  comments: RequestComment[],
  issue: GitHubIssue,
  now: string
) {
  const comment = createGitHubSyncComment(issue, now);
  const nextComments = comments.filter((item) => item.id !== comment.id);
  return [comment, ...nextComments];
}

function createGitHubSyncCommentId(issue: GitHubIssue) {
  return `github-sync-${normalizeIdentifier(issue.id)}`;
}

function createGitHubRequestId(issue: GitHubIssue, existingIds: Set<string>) {
  const base = normalizeIdentifier(`github-${issue.repository.fullName}-${issue.number}`);
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
    throw new Error(`GitHub installation must include ${permission} permission.`);
  }
}

function getString(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function getNumber(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
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

  return normalized || "github-object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
