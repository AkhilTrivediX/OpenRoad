export const requestStatuses = ["New", "Needs decision", "Planned", "Shipping soon"] as const;
export const requestOwners = ["Unassigned", "Akhil", "Product", "Support", "Maintainer"] as const;
export const workStatuses = ["Backlog", "Ready", "In progress", "Done"] as const;
export const roadmapLanes = ["Now", "Next", "Later"] as const;
export const roadmapVisibilities = ["Private", "Public"] as const;
export const roadmapConfidenceLevels = ["Low", "Medium", "High"] as const;
export const openRoadSchemaVersion = 2;
export const openRoadStorageKey = "openroad:state:v1";
export const openRoadSelectedWorkspaceKey = "openroad:selected-workspace:v1";

export type RequestStatus = (typeof requestStatuses)[number];
export type RequestOwner = (typeof requestOwners)[number];
export type WorkStatus = (typeof workStatuses)[number];
export type RoadmapLane = (typeof roadmapLanes)[number];
export type RoadmapVisibility = (typeof roadmapVisibilities)[number];
export type RoadmapConfidence = (typeof roadmapConfidenceLevels)[number];

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
  roadmap: Record<RoadmapLane, RoadmapItem[]>;
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

export type RoadmapItem = {
  id: string;
  title: string;
  summary: string;
  lane: RoadmapLane;
  visibility: RoadmapVisibility;
  confidence: RoadmapConfidence;
  isStale: boolean;
  requestIds: string[];
  workItemIds: string[];
  createdAt: string;
  updatedAt: string;
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
  | { type: "create-roadmap-item"; roadmapItem: RoadmapItem; workspaceId: string }
  | { type: "replace-roadmap-item"; roadmapItem: RoadmapItem; workspaceId: string }
  | { type: "delete-roadmap-item"; roadmapItemId: string; workspaceId: string }
  | { type: "replace-workspace"; workspace: Workspace }
  | { type: "replace-state"; state: OpenRoadState };

export const integrationChips: IntegrationChip[] = [
  { label: "GitHub", state: "Optional" },
  { label: "Jira", state: "Optional" },
  { label: "Linear", state: "Optional" }
];

function seedRoadmapItem(
  roadmapItem: Pick<RoadmapItem, "id" | "title" | "summary" | "lane"> &
    Partial<
      Pick<
        RoadmapItem,
        "visibility" | "confidence" | "isStale" | "requestIds" | "workItemIds"
      >
    >
): RoadmapItem {
  return {
    confidence: roadmapItem.confidence ?? "Medium",
    createdAt: "seed",
    id: roadmapItem.id,
    isStale: roadmapItem.isStale ?? false,
    lane: roadmapItem.lane,
    requestIds: roadmapItem.requestIds ?? [],
    summary: roadmapItem.summary,
    title: roadmapItem.title,
    updatedAt: "seed",
    visibility: roadmapItem.visibility ?? "Private",
    workItemIds: roadmapItem.workItemIds ?? []
  };
}

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
      Now: [
        seedRoadmapItem({
          confidence: "High",
          id: "roadmap-api-rate-limit-visibility",
          lane: "Now",
          requestIds: ["api-rate-limit-visibility"],
          summary: "Expose usage thresholds before CLI users hit API limits.",
          title: "API rate limit visibility",
          visibility: "Public"
        }),
        seedRoadmapItem({
          confidence: "Medium",
          id: "roadmap-webhook-retry-controls",
          lane: "Now",
          requestIds: ["webhook-retry-controls"],
          summary: "Let maintainers retry failed webhooks without support tickets.",
          title: "Webhook retry controls",
          visibility: "Private"
        })
      ],
      Next: [
        seedRoadmapItem({
          confidence: "Medium",
          id: "roadmap-bulk-export-csv",
          lane: "Next",
          requestIds: ["bulk-export-csv"],
          summary: "Give Success a weekly account-review export path.",
          title: "Bulk export to CSV",
          visibility: "Public"
        }),
        seedRoadmapItem({
          confidence: "Low",
          id: "roadmap-saved-feedback-views",
          isStale: true,
          lane: "Next",
          summary: "Let teams keep reusable views for high-signal feedback.",
          title: "Saved feedback views",
          visibility: "Private"
        })
      ],
      Later: [
        seedRoadmapItem({
          confidence: "Low",
          id: "roadmap-custom-request-fields",
          lane: "Later",
          summary: "Support workspace-specific request metadata.",
          title: "Custom request fields",
          visibility: "Private"
        }),
        seedRoadmapItem({
          confidence: "Low",
          id: "roadmap-public-roadmap-rss",
          lane: "Later",
          summary: "Expose a followable roadmap feed once public visibility is ready.",
          title: "Public roadmap RSS",
          visibility: "Private"
        })
      ]
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
      Now: [
        seedRoadmapItem({
          confidence: "High",
          id: "roadmap-contributor-guide-checklist",
          lane: "Now",
          requestIds: ["contributor-guide-checklist"],
          summary: "Make first contribution steps visible before a pull request.",
          title: "Contributor guide checklist",
          visibility: "Public"
        })
      ],
      Next: [
        seedRoadmapItem({
          confidence: "Medium",
          id: "roadmap-release-notes-rss",
          lane: "Next",
          requestIds: ["release-notes-rss"],
          summary: "Let subscribers follow maintainer release notes through RSS.",
          title: "Release notes RSS",
          visibility: "Public"
        })
      ],
      Later: [
        seedRoadmapItem({
          confidence: "Low",
          id: "roadmap-issue-template-cleanup",
          lane: "Later",
          requestIds: ["issue-template-cleanup"],
          summary: "Simplify issue templates for community moderators.",
          title: "Issue template cleanup",
          visibility: "Private"
        })
      ]
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

  if (action.type === "create-roadmap-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) =>
      addRoadmapItemToWorkspace(workspace, action.roadmapItem)
    );
  }

  if (action.type === "replace-roadmap-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) =>
      replaceRoadmapItemInWorkspace(workspace, action.roadmapItem)
    );
  }

  if (action.type === "delete-roadmap-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) =>
      removeRoadmapItemFromWorkspace(workspace, action.roadmapItemId)
    );
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

function addRoadmapItemToWorkspace(
  workspace: Workspace,
  roadmapItem: RoadmapItem
): Workspace {
  return {
    ...workspace,
    roadmap: {
      ...workspace.roadmap,
      [roadmapItem.lane]: [
        cloneValue(roadmapItem),
        ...workspace.roadmap[roadmapItem.lane]
      ]
    }
  };
}

function replaceRoadmapItemInWorkspace(
  workspace: Workspace,
  roadmapItem: RoadmapItem
): Workspace {
  const nextRoadmap = createEmptyRoadmap();
  for (const lane of roadmapLanes) {
    nextRoadmap[lane] = workspace.roadmap[lane].filter(
      (item) => item.id !== roadmapItem.id
    );
  }

  nextRoadmap[roadmapItem.lane] = [
    cloneValue(roadmapItem),
    ...nextRoadmap[roadmapItem.lane]
  ];

  return {
    ...workspace,
    roadmap: nextRoadmap
  };
}

function removeRoadmapItemFromWorkspace(
  workspace: Workspace,
  roadmapItemId: string
): Workspace {
  const nextRoadmap = createEmptyRoadmap();
  for (const lane of roadmapLanes) {
    nextRoadmap[lane] = workspace.roadmap[lane].filter(
      (item) => item.id !== roadmapItemId
    );
  }

  return {
    ...workspace,
    roadmap: nextRoadmap
  };
}

function createEmptyRoadmap(): Record<RoadmapLane, RoadmapItem[]> {
  return {
    Later: [],
    Next: [],
    Now: []
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

  if (typeof parsed.schemaVersion !== "number") {
    throw new Error("Import schema version is not supported.");
  }

  if (
    parsed.schemaVersion > openRoadSchemaVersion
  ) {
    throw new Error("Import schema version is not supported.");
  }

  if (parsed.schemaVersion !== openRoadSchemaVersion) {
    return migrateWorkspaceFromPreviousSchema(parsed.workspace);
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

  if (
    (value.schemaVersion === 1 ||
      value.schemaVersion === 0 ||
      value.schemaVersion === undefined) &&
    Array.isArray(value.workspaces)
  ) {
    return {
      schemaVersion: openRoadSchemaVersion,
      workspaces: value.workspaces.map(migrateWorkspaceFromPreviousSchema)
    };
  }

  if (typeof value.schemaVersion === "number" && value.schemaVersion > openRoadSchemaVersion) {
    throw new Error("Saved OpenRoad data was created by a newer version.");
  }

  throw new Error("Saved OpenRoad schema version is not supported.");
}

function migrateWorkspaceFromPreviousSchema(value: unknown): Workspace {
  if (!isRecord(value)) {
    throw new Error("Saved OpenRoad workspace is invalid.");
  }

  const migrated = {
    ...value,
    roadmap: migrateRoadmapFromPreviousSchema(value.roadmap),
    workItems: Array.isArray(value.workItems) ? value.workItems : []
  };

  if (!isWorkspace(migrated)) {
    throw new Error("Saved OpenRoad workspace cannot be migrated.");
  }

  return cloneValue(migrated);
}

function migrateRoadmapFromPreviousSchema(
  value: unknown
): Record<RoadmapLane, RoadmapItem[]> {
  if (!isRecord(value)) {
    return createEmptyRoadmap();
  }

  const roadmap = createEmptyRoadmap();
  for (const lane of roadmapLanes) {
    const items = value[lane];
    if (!Array.isArray(items)) continue;
    roadmap[lane] = items.map((item, index) => {
      if (isRoadmapItem(item)) return cloneValue(item);
      if (typeof item === "string") {
        return roadmapItemFromLegacyTitle(item, lane, index);
      }
      throw new Error("Saved OpenRoad roadmap item cannot be migrated.");
    });
  }

  return roadmap;
}

function roadmapItemFromLegacyTitle(
  title: string,
  lane: RoadmapLane,
  index: number
): RoadmapItem {
  return {
    confidence: "Medium",
    createdAt: "migrated",
    id: `roadmap-${lane.toLowerCase()}-${index}-${slugify(title)}`,
    isStale: false,
    lane,
    requestIds: [],
    summary: "",
    title,
    updatedAt: "migrated",
    visibility: "Private",
    workItemIds: []
  };
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
    value.roadmap.Now.every(isRoadmapItem) &&
    Array.isArray(value.roadmap.Next) &&
    value.roadmap.Next.every(isRoadmapItem) &&
    Array.isArray(value.roadmap.Later) &&
    value.roadmap.Later.every(isRoadmapItem) &&
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

function isRoadmapItem(value: unknown): value is RoadmapItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    roadmapLanes.includes(value.lane as RoadmapLane) &&
    roadmapVisibilities.includes(value.visibility as RoadmapVisibility) &&
    roadmapConfidenceLevels.includes(value.confidence as RoadmapConfidence) &&
    typeof value.isStale === "boolean" &&
    Array.isArray(value.requestIds) &&
    value.requestIds.every((requestId) => typeof requestId === "string") &&
    Array.isArray(value.workItemIds) &&
    value.workItemIds.every((workItemId) => typeof workItemId === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
