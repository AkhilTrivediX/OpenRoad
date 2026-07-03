export const requestStatuses = ["New", "Needs decision", "Planned", "Shipping soon"] as const;
export const requestOwners = ["Unassigned", "Akhil", "Product", "Support", "Maintainer"] as const;
export const workStatuses = ["Backlog", "Ready", "In progress", "Done"] as const;
export const openRoadSchemaVersion = 1;
export const openRoadStorageKey = "openroad:state:v1";
export const openRoadSelectedWorkspaceKey = "openroad:selected-workspace:v1";

export type RequestStatus = (typeof requestStatuses)[number];
export type RequestOwner = (typeof requestOwners)[number];
export type WorkStatus = (typeof workStatuses)[number];

export type OpenRoadState = {
  schemaVersion: typeof openRoadSchemaVersion;
  workspaces: Workspace[];
};

export type Workspace = {
  id: string;
  name: string;
  plan: string;
  summary: string;
  requests: RequestItem[];
  workItems: WorkItem[];
  roadmap: Record<"Now" | "Next" | "Later", string[]>;
  changelog: ChangelogItem[];
  integrations: IntegrationChip[];
};

export type RequestItem = {
  id: string;
  title: string;
  description: string;
  requester: string;
  source: string;
  tags: string[];
  votes: number;
  hasCurrentUserVote: boolean;
  status: RequestStatus;
  owner: RequestOwner;
  age: string;
  archived: boolean;
  comments: RequestComment[];
  mergedSources: MergedRequestSource[];
};

export type RequestComment = {
  id: string;
  author: string;
  body: string;
  age: string;
};

export type WorkItem = {
  id: string;
  title: string;
  description: string;
  owner: RequestOwner;
  status: WorkStatus;
  targetDate: string;
  requestIds: string[];
  comments: WorkComment[];
  createdAt: string;
};

export type WorkComment = {
  id: string;
  author: string;
  body: string;
  age: string;
};

export type MergedRequestSource = {
  id: string;
  title: string;
  description: string;
  requester: string;
  source: string;
  owner: RequestOwner;
  status: RequestStatus;
  votes: number;
  hasCurrentUserVote: boolean;
  tags: string[];
  commentCount: number;
  age: string;
  mergedAt: string;
};

export type ChangelogItem = {
  title: string;
  state: "Draft" | "Ready";
  detail: string;
};

export type IntegrationChip = {
  label: string;
  state: "Optional" | "Linked";
};

export type LoadOpenRoadResult = {
  error?: string;
  state: OpenRoadState;
  status: "ready" | "recovered";
};

export type OpenRoadAction =
  | { type: "create-workspace"; workspace: Workspace }
  | { type: "create-request"; request: RequestItem; workspaceId: string }
  | { type: "replace-request"; request: RequestItem; workspaceId: string }
  | { type: "create-work-item"; workItem: WorkItem; workspaceId: string }
  | { type: "replace-work-item"; workItem: WorkItem; workspaceId: string }
  | { type: "replace-workspace"; workspace: Workspace }
  | { type: "replace-state"; state: OpenRoadState };

export const integrationChips: IntegrationChip[] = [
  { label: "GitHub", state: "Optional" },
  { label: "Jira", state: "Optional" },
  { label: "Linear", state: "Optional" }
];

export const initialWorkspaces: Workspace[] = [
  {
    id: "acme",
    name: "Acme OSS",
    plan: "Demo workspace",
    summary: "Standalone feedback loop with optional delivery links.",
    requests: [
      {
        id: "api-rate-limit-visibility",
        title: "API rate limit visibility",
        description:
          "Users cannot tell when they are close to hitting API limits. This blocks debugging and creates repeated support requests.",
        requester: "CLI user",
        source: "Portal",
        tags: ["api", "usage"],
        votes: 142,
        hasCurrentUserVote: false,
        status: "Needs decision",
        owner: "Unassigned",
        age: "2h ago",
        archived: false,
        comments: [
          {
            id: "api-comment-1",
            author: "Success",
            body: "Three customers asked for a visible limit meter this week.",
            age: "1h ago"
          }
        ],
        mergedSources: []
      },
      {
        id: "bulk-export-csv",
        title: "Support bulk export to CSV",
        description:
          "Support needs a quick way to export customer request lists for weekly account reviews.",
        requester: "Success team",
        source: "Email",
        tags: ["export", "success"],
        votes: 97,
        hasCurrentUserVote: false,
        status: "Planned",
        owner: "Support",
        age: "5h ago",
        archived: false,
        comments: [],
        mergedSources: []
      },
      {
        id: "dark-mode-docs",
        title: "Dark mode for docs site",
        description: "Docs readers want a dark theme that matches the CLI and product UI.",
        requester: "Docs feedback",
        source: "Portal",
        tags: ["docs", "theme"],
        votes: 89,
        hasCurrentUserVote: false,
        status: "New",
        owner: "Unassigned",
        age: "1d ago",
        archived: false,
        comments: [],
        mergedSources: []
      },
      {
        id: "webhook-retry-controls",
        title: "Webhook retry controls",
        description:
          "Maintainers need to retry failed webhooks without opening support tickets.",
        requester: "Maintainer note",
        source: "Manual",
        tags: ["webhooks"],
        votes: 76,
        hasCurrentUserVote: true,
        status: "Shipping soon",
        owner: "Akhil",
        age: "1d ago",
        archived: false,
        comments: [],
        mergedSources: []
      }
    ],
    workItems: [],
    roadmap: {
      Now: ["API rate limit visibility", "Webhook retry controls"],
      Next: ["Bulk export to CSV", "Saved feedback views"],
      Later: ["Custom request fields", "Public roadmap RSS"]
    },
    changelog: [
      {
        title: "Inline markdown in comments",
        state: "Ready",
        detail: "Linked to 18 requesters"
      },
      {
        title: "Email digest improvements",
        state: "Draft",
        detail: "Needs public wording"
      }
    ],
    integrations: integrationChips
  },
  {
    id: "maintainer",
    name: "Maintainer Lab",
    plan: "Community workspace",
    summary: "A smaller project using OpenRoad without external trackers.",
    requests: [
      {
        id: "contributor-guide-checklist",
        title: "Contributor guide checklist",
        description:
          "First-time contributors need a clear checklist before opening their first pull request.",
        requester: "First-time contributor",
        source: "Portal",
        tags: ["community", "docs"],
        votes: 34,
        hasCurrentUserVote: false,
        status: "New",
        owner: "Maintainer",
        age: "3h ago",
        archived: false,
        comments: [],
        mergedSources: []
      },
      {
        id: "release-notes-rss",
        title: "Release notes RSS",
        description: "Maintainers want subscribers to follow release notes through RSS.",
        requester: "Maintainer",
        source: "Manual",
        tags: ["release", "rss"],
        votes: 21,
        hasCurrentUserVote: false,
        status: "Planned",
        owner: "Unassigned",
        age: "1d ago",
        archived: false,
        comments: [],
        mergedSources: []
      },
      {
        id: "issue-template-cleanup",
        title: "Issue template cleanup",
        description: "Community moderators want simpler issue templates for bug reports.",
        requester: "Community moderator",
        source: "Manual",
        tags: ["community"],
        votes: 19,
        hasCurrentUserVote: false,
        status: "Needs decision",
        owner: "Unassigned",
        age: "2d ago",
        archived: false,
        comments: [],
        mergedSources: []
      }
    ],
    workItems: [],
    roadmap: {
      Now: ["Contributor guide checklist"],
      Next: ["Release notes RSS"],
      Later: ["Issue template cleanup"]
    },
    changelog: [
      {
        title: "New maintainer queue",
        state: "Draft",
        detail: "Standalone work item"
      }
    ],
    integrations: integrationChips
  }
];

export function createInitialOpenRoadState(): OpenRoadState {
  return {
    schemaVersion: openRoadSchemaVersion,
    workspaces: cloneValue(initialWorkspaces)
  };
}

export function createEntityId(prefix: string, now = Date.now()) {
  return `${prefix}-${now}`;
}

export function openRoadReducer(state: OpenRoadState, action: OpenRoadAction): OpenRoadState {
  if (action.type === "create-workspace") {
    return {
      ...state,
      workspaces: [...state.workspaces, cloneValue(action.workspace)]
    };
  }

  if (action.type === "create-request") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      requests: [cloneValue(action.request), ...workspace.requests]
    }));
  }

  if (action.type === "replace-request") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      requests: workspace.requests.map((request) =>
        request.id === action.request.id ? cloneValue(action.request) : request
      )
    }));
  }

  if (action.type === "create-work-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      workItems: [cloneValue(action.workItem), ...workspace.workItems]
    }));
  }

  if (action.type === "replace-work-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      workItems: workspace.workItems.map((workItem) =>
        workItem.id === action.workItem.id ? cloneValue(action.workItem) : workItem
      )
    }));
  }

  if (action.type === "replace-workspace") {
    return {
      ...state,
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === action.workspace.id ? cloneValue(action.workspace) : workspace
      )
    };
  }

  if (action.type === "replace-state") {
    return cloneValue(action.state);
  }

  return state;
}

function updateWorkspaceById(
  state: OpenRoadState,
  workspaceId: string,
  updater: (workspace: Workspace) => Workspace
): OpenRoadState {
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === workspaceId ? updater(workspace) : workspace
    )
  };
}

export function loadOpenRoadState(storage = getBrowserStorage()): LoadOpenRoadResult {
  if (!storage) {
    return { state: createInitialOpenRoadState(), status: "ready" };
  }

  const raw = storage.getItem(openRoadStorageKey);
  if (!raw) {
    return { state: createInitialOpenRoadState(), status: "ready" };
  }

  try {
    return { state: migrateOpenRoadState(JSON.parse(raw)), status: "ready" };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Saved OpenRoad data could not be loaded. ${error.message}`
          : "Saved OpenRoad data could not be loaded.",
      state: createInitialOpenRoadState(),
      status: "recovered"
    };
  }
}

export function saveOpenRoadState(state: OpenRoadState, storage = getBrowserStorage()) {
  if (!storage) return;
  storage.setItem(openRoadStorageKey, JSON.stringify(state));
}

export function loadSelectedWorkspaceId(storage = getBrowserStorage()) {
  if (!storage) return undefined;
  return storage.getItem(openRoadSelectedWorkspaceKey) ?? undefined;
}

export function saveSelectedWorkspaceId(
  workspaceId: string,
  storage = getBrowserStorage()
) {
  if (!storage) return;
  storage.setItem(openRoadSelectedWorkspaceKey, workspaceId);
}

export function clearOpenRoadState(storage = getBrowserStorage()) {
  if (!storage) return;
  storage.removeItem(openRoadStorageKey);
  storage.removeItem(openRoadSelectedWorkspaceKey);
}

export function exportWorkspace(workspace: Workspace) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      schemaVersion: openRoadSchemaVersion,
      workspace
    },
    null,
    2
  );
}

export function importWorkspaceFromJson(value: string): Workspace {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Import must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Import must be an OpenRoad workspace export.");
  }

  if (parsed.schemaVersion !== openRoadSchemaVersion) {
    throw new Error("Import schema version is not supported.");
  }

  if (!isWorkspace(parsed.workspace)) {
    throw new Error("Import does not contain a valid workspace.");
  }

  return cloneValue(parsed.workspace);
}

export function migrateOpenRoadState(value: unknown): OpenRoadState {
  if (!isRecord(value)) {
    throw new Error("Saved OpenRoad data is not an object.");
  }

  if (value.schemaVersion === openRoadSchemaVersion && Array.isArray(value.workspaces)) {
    const workspaces = value.workspaces;
    if (!workspaces.every(isWorkspace)) {
      throw new Error("Saved OpenRoad workspaces are invalid.");
    }
    return {
      schemaVersion: openRoadSchemaVersion,
      workspaces: cloneValue(workspaces)
    };
  }

  if ((value.schemaVersion === 0 || value.schemaVersion === undefined) && Array.isArray(value.workspaces)) {
    return {
      schemaVersion: openRoadSchemaVersion,
      workspaces: value.workspaces.map(migrateWorkspaceV0)
    };
  }

  if (typeof value.schemaVersion === "number" && value.schemaVersion > openRoadSchemaVersion) {
    throw new Error("Saved OpenRoad data was created by a newer version.");
  }

  throw new Error("Saved OpenRoad schema version is not supported.");
}

function migrateWorkspaceV0(value: unknown): Workspace {
  if (!isRecord(value)) {
    throw new Error("Saved OpenRoad workspace is invalid.");
  }

  const migrated = {
    ...value,
    workItems: Array.isArray(value.workItems) ? value.workItems : []
  };

  if (!isWorkspace(migrated)) {
    throw new Error("Saved OpenRoad workspace cannot be migrated.");
  }

  return cloneValue(migrated);
}

function isWorkspace(value: unknown): value is Workspace {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.plan === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.requests) &&
    value.requests.every(isRequestItem) &&
    Array.isArray(value.workItems) &&
    value.workItems.every(isWorkItem) &&
    isRecord(value.roadmap) &&
    Array.isArray(value.roadmap.Now) &&
    Array.isArray(value.roadmap.Next) &&
    Array.isArray(value.roadmap.Later) &&
    Array.isArray(value.changelog) &&
    Array.isArray(value.integrations)
  );
}

function isRequestItem(value: unknown): value is RequestItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.requester === "string" &&
    typeof value.source === "string" &&
    Array.isArray(value.tags) &&
    typeof value.votes === "number" &&
    typeof value.hasCurrentUserVote === "boolean" &&
    requestStatuses.includes(value.status as RequestStatus) &&
    requestOwners.includes(value.owner as RequestOwner) &&
    typeof value.age === "string" &&
    typeof value.archived === "boolean" &&
    Array.isArray(value.comments) &&
    Array.isArray(value.mergedSources)
  );
}

function isWorkItem(value: unknown): value is WorkItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    requestOwners.includes(value.owner as RequestOwner) &&
    workStatuses.includes(value.status as WorkStatus) &&
    typeof value.targetDate === "string" &&
    Array.isArray(value.requestIds) &&
    Array.isArray(value.comments) &&
    typeof value.createdAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
