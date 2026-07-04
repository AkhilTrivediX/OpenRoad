export const requestStatuses = ["New", "Needs decision", "Planned", "Shipping soon"] as const;
export const requestOwners = ["Unassigned", "Akhil", "Product", "Support", "Maintainer"] as const;
export const workStatuses = ["Backlog", "Ready", "In progress", "Done"] as const;
export const roadmapLanes = ["Now", "Next", "Later"] as const;
export const roadmapVisibilities = ["Private", "Public"] as const;
export const roadmapConfidenceLevels = ["Low", "Medium", "High"] as const;
export const changelogStates = ["Draft", "Ready"] as const;
export const changelogVisibilities = ["Private", "Public"] as const;
export const requestVisibilities = ["Private", "Public"] as const;
export const commentVisibilities = ["Internal", "Public", "Hidden"] as const;
export const notificationEventTypes = ["request-status-change", "changelog-published"] as const;
export const notificationEventStatuses = ["queued", "held"] as const;
export const openRoadSchemaVersion = 5;
export const openRoadStorageKey = "openroad:state:v1";
export const openRoadSelectedWorkspaceKey = "openroad:selected-workspace:v1";

export type RequestStatus = (typeof requestStatuses)[number];
export type RequestOwner = (typeof requestOwners)[number];
export type WorkStatus = (typeof workStatuses)[number];
export type RoadmapLane = (typeof roadmapLanes)[number];
export type RoadmapVisibility = (typeof roadmapVisibilities)[number];
export type RoadmapConfidence = (typeof roadmapConfidenceLevels)[number];
export type ChangelogState = (typeof changelogStates)[number];
export type ChangelogVisibility = (typeof changelogVisibilities)[number];
export type RequestVisibility = (typeof requestVisibilities)[number];
export type CommentVisibility = (typeof commentVisibilities)[number];
export type NotificationEventType = (typeof notificationEventTypes)[number];
export type NotificationEventStatus = (typeof notificationEventStatuses)[number];

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
  portal: PortalSettings;
  notifications: RequesterNotificationSettings;
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
  visibility: RequestVisibility;
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
  visibility: CommentVisibility;
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
  id: string;
  title: string;
  state: ChangelogState;
  visibility: ChangelogVisibility;
  publicSummary: string;
  privateNotes: string;
  sourceType: "Manual" | "Roadmap" | "Work";
  sourceId: string;
  requestIds: string[];
  roadmapItemIds: string[];
  workItemIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type IntegrationChip = {
  label: string;
  state: "Optional" | "Linked";
};

export type RequesterNotificationSettings = {
  defaultChangelogUpdates: boolean;
  defaultStatusUpdates: boolean;
  enabled: boolean;
  outbox: RequesterNotificationEvent[];
  preferences: RequesterNotificationPreference[];
  quietWindowHours: number;
};

export type RequesterNotificationPreference = {
  changelogUpdates: boolean;
  createdAt: string;
  id: string;
  requestId: string;
  requester: string;
  statusUpdates: boolean;
  updatedAt: string;
};

export type RequesterNotificationEvent = {
  body: string;
  changelogId?: string;
  changelogTitle?: string;
  createdAt: string;
  dedupeKey: string;
  id: string;
  nextStatus?: RequestStatus;
  previousStatus?: RequestStatus;
  requestId: string;
  requestTitle: string;
  requester: string;
  status: NotificationEventStatus;
  title: string;
  type: NotificationEventType;
};

export type PortalSettings = {
  enabled: boolean;
  allowVoting: boolean;
  allowComments: boolean;
  headline: string;
  intro: string;
};

export type PublicPortalComment = {
  id: string;
  author: string;
  body: string;
  age: string;
};

export type PublicPortalRequest = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  votes: number;
  hasCurrentUserVote: boolean;
  status: RequestStatus;
  age: string;
  comments: PublicPortalComment[];
};

export type PublicPortalRoadmapItem = {
  id: string;
  title: string;
  summary: string;
  lane: RoadmapLane;
  confidence: RoadmapConfidence;
  isStale: boolean;
  linkedRequestCount: number;
};

export type PublicPortalChangelogItem = {
  id: string;
  title: string;
  publicSummary: string;
  updatedAt: string;
  linkedRequestCount: number;
};

export type PublicPortalSnapshot = {
  enabled: boolean;
  allowVoting: boolean;
  allowComments: boolean;
  headline: string;
  intro: string;
  requests: PublicPortalRequest[];
  requestCount: number;
  roadmap: Record<RoadmapLane, PublicPortalRoadmapItem[]>;
  roadmapCount: number;
  changelog: PublicPortalChangelogItem[];
  changelogCount: number;
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
  | { type: "create-changelog-item"; changelogItem: ChangelogItem; workspaceId: string }
  | { type: "replace-changelog-item"; changelogItem: ChangelogItem; workspaceId: string }
  | { type: "delete-changelog-item"; changelogItemId: string; workspaceId: string }
  | { type: "replace-portal-settings"; portal: PortalSettings; workspaceId: string }
  | {
      type: "replace-notification-settings";
      notifications: RequesterNotificationSettings;
      workspaceId: string;
    }
  | { type: "replace-workspace"; workspace: Workspace }
  | { type: "replace-state"; state: OpenRoadState };

export const integrationChips: IntegrationChip[] = [
  { label: "GitHub", state: "Optional" },
  { label: "Jira", state: "Optional" },
  { label: "Linear", state: "Optional" }
];

export const defaultPortalSettings: PortalSettings = {
  allowComments: true,
  allowVoting: true,
  enabled: true,
  headline: "Public roadmap",
  intro: "Vote on requests, follow the roadmap, and read shipped updates without needing an account."
};

export const defaultNotificationSettings: RequesterNotificationSettings = {
  defaultChangelogUpdates: true,
  defaultStatusUpdates: true,
  enabled: true,
  outbox: [],
  preferences: [],
  quietWindowHours: 24
};

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

function seedChangelogItem(
  changelogItem: Pick<
    ChangelogItem,
    "id" | "title" | "state" | "visibility" | "publicSummary"
  > &
    Partial<
      Pick<
        ChangelogItem,
        | "privateNotes"
        | "sourceType"
        | "sourceId"
        | "requestIds"
        | "roadmapItemIds"
        | "workItemIds"
      >
    >
): ChangelogItem {
  return {
    createdAt: "seed",
    id: changelogItem.id,
    privateNotes: changelogItem.privateNotes ?? "",
    publicSummary: changelogItem.publicSummary,
    requestIds: changelogItem.requestIds ?? [],
    roadmapItemIds: changelogItem.roadmapItemIds ?? [],
    sourceId: changelogItem.sourceId ?? "",
    sourceType: changelogItem.sourceType ?? "Manual",
    state: changelogItem.state,
    title: changelogItem.title,
    updatedAt: "seed",
    visibility: changelogItem.visibility,
    workItemIds: changelogItem.workItemIds ?? []
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
        visibility: "Public",
        age: "2h ago",
        archived: false,
        comments: [
          {
            id: "api-comment-1",
            author: "Success",
            body: "Three customers asked for a visible limit meter this week.",
            age: "1h ago",
            visibility: "Internal"
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
        visibility: "Private",
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
        visibility: "Public",
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
        visibility: "Private",
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
      seedChangelogItem({
        id: "changelog-inline-markdown-comments",
        publicSummary:
          "Comments now keep lightweight markdown readable when teams collect release evidence.",
        requestIds: ["api-rate-limit-visibility"],
        state: "Ready",
        title: "Inline markdown in comments",
        visibility: "Public"
      }),
      seedChangelogItem({
        id: "changelog-email-digest-improvements",
        privateNotes: "Needs customer-facing wording before it can be published.",
        publicSummary:
          "A clearer account digest is being prepared for teams that review feedback weekly.",
        requestIds: ["bulk-export-csv"],
        state: "Draft",
        title: "Email digest improvements",
        visibility: "Private"
      })
    ],
    portal: {
      ...defaultPortalSettings,
      headline: "Acme OSS public board",
      intro: "Track open requests, planned roadmap work, and release notes from the Acme OSS team."
    },
    notifications: defaultNotificationSettings,
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
        visibility: "Public",
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
        visibility: "Private",
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
        visibility: "Private",
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
      seedChangelogItem({
        id: "changelog-new-maintainer-queue",
        privateNotes: "Standalone work item",
        publicSummary:
          "Maintainers can now keep contributor requests moving without an external tracker.",
        requestIds: ["contributor-guide-checklist"],
        state: "Draft",
        title: "New maintainer queue",
        visibility: "Private"
      })
    ],
    portal: {
      ...defaultPortalSettings,
      headline: "Maintainer Lab public board",
      intro: "See what the maintainers are considering, planning, and preparing to ship."
    },
    notifications: defaultNotificationSettings,
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
    return updateWorkspaceById(state, action.workspaceId, (workspace) => {
      const previousRequest = workspace.requests.find((request) => request.id === action.request.id);
      const nextWorkspace = {
        ...workspace,
        requests: workspace.requests.map((request) =>
          request.id === action.request.id ? cloneValue(action.request) : request
        )
      };

      return previousRequest
        ? queueStatusChangeNotification(nextWorkspace, previousRequest, action.request)
        : nextWorkspace;
    });
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

  if (action.type === "create-changelog-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      changelog: [cloneValue(action.changelogItem), ...workspace.changelog]
    }));
  }

  if (action.type === "replace-changelog-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => {
      const previousChangelogItem = workspace.changelog.find(
        (changelogItem) => changelogItem.id === action.changelogItem.id
      );
      const nextWorkspace = {
        ...workspace,
        changelog: workspace.changelog.map((changelogItem) =>
          changelogItem.id === action.changelogItem.id
            ? cloneValue(action.changelogItem)
            : changelogItem
        )
      };

      return previousChangelogItem
        ? queueChangelogPublishNotifications(nextWorkspace, previousChangelogItem, action.changelogItem)
        : nextWorkspace;
    });
  }

  if (action.type === "delete-changelog-item") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      changelog: workspace.changelog.filter(
        (changelogItem) => changelogItem.id !== action.changelogItemId
      )
    }));
  }

  if (action.type === "replace-portal-settings") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      portal: cloneValue(action.portal)
    }));
  }

  if (action.type === "replace-notification-settings") {
    return updateWorkspaceById(state, action.workspaceId, (workspace) => ({
      ...workspace,
      notifications: sanitizeNotificationSettings(action.notifications)
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

export function getRequesterNotificationPreference(
  notifications: RequesterNotificationSettings,
  request: Pick<RequestItem, "id" | "requester">
) {
  return notifications.preferences.find(
    (preference) =>
      preference.requestId === request.id &&
      normalizePreferenceIdentity(preference.requester) ===
        normalizePreferenceIdentity(request.requester)
  );
}

export function resolveRequesterNotificationPreference(
  notifications: RequesterNotificationSettings,
  request: Pick<RequestItem, "id" | "requester">
) {
  const preference = getRequesterNotificationPreference(notifications, request);

  return {
    changelogUpdates: preference?.changelogUpdates ?? notifications.defaultChangelogUpdates,
    preference,
    statusUpdates: preference?.statusUpdates ?? notifications.defaultStatusUpdates
  };
}

export function setRequesterNotificationPreference(
  workspace: Workspace,
  request: Pick<RequestItem, "id" | "requester">,
  updates: Pick<RequesterNotificationPreference, "changelogUpdates" | "statusUpdates">,
  now = "just now"
): Workspace {
  const existing = getRequesterNotificationPreference(workspace.notifications, request);
  const nextPreference: RequesterNotificationPreference = {
    changelogUpdates: updates.changelogUpdates,
    createdAt: existing?.createdAt ?? now,
    id: existing?.id ?? createNotificationPreferenceId(request),
    requestId: request.id,
    requester: request.requester,
    statusUpdates: updates.statusUpdates,
    updatedAt: now
  };
  const nextPreferences = [
    nextPreference,
    ...workspace.notifications.preferences.filter((preference) => preference.id !== nextPreference.id)
  ].slice(0, 500);

  return {
    ...workspace,
    notifications: sanitizeNotificationSettings({
      ...workspace.notifications,
      preferences: nextPreferences
    })
  };
}

function queueStatusChangeNotification(
  workspace: Workspace,
  previousRequest: RequestItem,
  nextRequest: RequestItem,
  now = new Date().toISOString()
): Workspace {
  if (
    previousRequest.status === nextRequest.status ||
    !isNotifiableRequestStatus(nextRequest.status)
  ) {
    return workspace;
  }

  const preference = resolveRequesterNotificationPreference(workspace.notifications, nextRequest);
  if (!workspace.notifications.enabled || !preference.statusUpdates) return workspace;

  const dedupeKey = createStatusNotificationDedupeKey(nextRequest.id, nextRequest.status);

  return appendNotificationEvent(
    workspace,
    {
      body: `${nextRequest.title} moved from ${previousRequest.status} to ${nextRequest.status}.`,
      createdAt: now,
      dedupeKey,
      id: createNotificationEventId("request-status", now, nextRequest.id, dedupeKey),
      nextStatus: nextRequest.status,
      previousStatus: previousRequest.status,
      requestId: nextRequest.id,
      requestTitle: nextRequest.title,
      requester: nextRequest.requester,
      status: "queued",
      title: `${nextRequest.status}: ${nextRequest.title}`,
      type: "request-status-change"
    },
    now
  );
}

function queueChangelogPublishNotifications(
  workspace: Workspace,
  previousChangelogItem: ChangelogItem,
  nextChangelogItem: ChangelogItem,
  now = new Date().toISOString()
): Workspace {
  if (isPublishedChangelog(previousChangelogItem) || !isPublishedChangelog(nextChangelogItem)) {
    return workspace;
  }

  return nextChangelogItem.requestIds.reduce((nextWorkspace, requestId) => {
    const request = nextWorkspace.requests.find((item) => item.id === requestId);
    if (!request) return nextWorkspace;

    const preference = resolveRequesterNotificationPreference(nextWorkspace.notifications, request);
    if (!nextWorkspace.notifications.enabled || !preference.changelogUpdates) return nextWorkspace;

    const dedupeKey = createChangelogNotificationDedupeKey(request.id, nextChangelogItem.id);

    return appendNotificationEvent(
      nextWorkspace,
      {
        body: `A public changelog update is ready: ${nextChangelogItem.publicSummary}`,
        changelogId: nextChangelogItem.id,
        changelogTitle: nextChangelogItem.title,
        createdAt: now,
        dedupeKey,
        id: createNotificationEventId("changelog", now, request.id, dedupeKey),
        requestId: request.id,
        requestTitle: request.title,
        requester: request.requester,
        status: "queued",
        title: `Shipped update: ${nextChangelogItem.title}`,
        type: "changelog-published"
      },
      now
    );
  }, workspace);
}

function appendNotificationEvent(
  workspace: Workspace,
  event: RequesterNotificationEvent,
  now: string
): Workspace {
  if (isDuplicateNotificationEvent(workspace.notifications, event.dedupeKey, now)) {
    return workspace;
  }

  return {
    ...workspace,
    notifications: sanitizeNotificationSettings({
      ...workspace.notifications,
      outbox: [event, ...workspace.notifications.outbox].slice(0, 200)
    })
  };
}

function isDuplicateNotificationEvent(
  notifications: RequesterNotificationSettings,
  dedupeKey: string,
  now: string
) {
  const quietWindowMs = Math.max(1, notifications.quietWindowHours) * 60 * 60 * 1000;
  const nowTime = Date.parse(now);

  return notifications.outbox.some((event) => {
    if (event.dedupeKey !== dedupeKey) return false;
    const eventTime = Date.parse(event.createdAt);
    if (!Number.isFinite(nowTime) || !Number.isFinite(eventTime)) return true;
    return nowTime - eventTime <= quietWindowMs;
  });
}

function sanitizeNotificationSettings(
  settings: RequesterNotificationSettings
): RequesterNotificationSettings {
  return {
    defaultChangelogUpdates: settings.defaultChangelogUpdates,
    defaultStatusUpdates: settings.defaultStatusUpdates,
    enabled: settings.enabled,
    outbox: settings.outbox.filter(isRequesterNotificationEvent).slice(0, 200),
    preferences: settings.preferences.filter(isRequesterNotificationPreference).slice(0, 500),
    quietWindowHours: Number.isFinite(settings.quietWindowHours)
      ? Math.max(1, Math.min(168, Math.round(settings.quietWindowHours)))
      : defaultNotificationSettings.quietWindowHours
  };
}

function isNotifiableRequestStatus(status: RequestStatus) {
  return status === "Planned" || status === "Shipping soon";
}

function isPublishedChangelog(changelogItem: ChangelogItem) {
  return changelogItem.state === "Ready" && changelogItem.visibility === "Public";
}

function createStatusNotificationDedupeKey(requestId: string, status: RequestStatus) {
  return `request-status-change:${requestId}:${status}`;
}

function createChangelogNotificationDedupeKey(requestId: string, changelogId: string) {
  return `changelog-published:${requestId}:${changelogId}`;
}

function createNotificationPreferenceId(request: Pick<RequestItem, "id" | "requester">) {
  return `notification-pref-${slugify(request.id)}-${slugify(request.requester)}`;
}

function createNotificationEventId(
  prefix: string,
  now: string,
  requestId: string,
  discriminator: string
) {
  return `${prefix}-${slugify(requestId)}-${slugify(discriminator)}-${slugify(now)}`;
}

function normalizePreferenceIdentity(value: string) {
  return value.trim().toLowerCase();
}

function createEmptyRoadmap(): Record<RoadmapLane, RoadmapItem[]> {
  return {
    Later: [],
    Next: [],
    Now: []
  };
}

function createEmptyPublicRoadmap(): Record<RoadmapLane, PublicPortalRoadmapItem[]> {
  return {
    Later: [],
    Next: [],
    Now: []
  };
}

export function createPublicPortalSnapshot(
  workspace: Workspace,
  query = ""
): PublicPortalSnapshot {
  const normalizedQuery = normalizeSearchText(query);
  const allPublicRequests = workspace.requests.filter(
    (request) => request.visibility === "Public" && !request.archived
  );
  const requests = allPublicRequests
    .filter((request) => {
      if (!normalizedQuery) return true;
      return normalizeSearchText(
        [request.title, request.description, request.tags.join(" ")].join(" ")
      ).includes(normalizedQuery);
    })
    .map(publicPortalRequestFromRequest);

  const roadmap = createEmptyPublicRoadmap();
  for (const lane of roadmapLanes) {
    roadmap[lane] = workspace.roadmap[lane]
      .filter((item) => item.visibility === "Public")
      .map((item) => ({
        confidence: item.confidence,
        id: item.id,
        isStale: item.isStale,
        lane: item.lane,
        linkedRequestCount: item.requestIds.length,
        summary: item.summary,
        title: item.title
      }));
  }

  const changelog = workspace.changelog
    .filter((item) => item.visibility === "Public" && item.state === "Ready")
    .map((item) => ({
      id: item.id,
      linkedRequestCount: item.requestIds.length,
      publicSummary: item.publicSummary,
      title: item.title,
      updatedAt: item.updatedAt
    }));

  return {
    allowComments: workspace.portal.allowComments,
    allowVoting: workspace.portal.allowVoting,
    changelog,
    changelogCount: changelog.length,
    enabled: workspace.portal.enabled,
    headline: workspace.portal.headline,
    intro: workspace.portal.intro,
    requestCount: allPublicRequests.length,
    requests,
    roadmap,
    roadmapCount: roadmapLanes.reduce(
      (count, lane) => count + roadmap[lane].length,
      0
    )
  };
}

function publicPortalRequestFromRequest(request: RequestItem): PublicPortalRequest {
  return {
    age: request.age,
    comments: request.comments
      .filter((comment) => comment.visibility === "Public")
      .map((comment) => ({
        age: comment.age,
        author: comment.author,
        body: comment.body,
        id: comment.id
      })),
    description: request.description,
    hasCurrentUserVote: request.hasCurrentUserVote,
    id: request.id,
    status: request.status,
    tags: [...request.tags],
    title: request.title,
    votes: request.votes
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
      value.schemaVersion === 2 ||
      value.schemaVersion === 3 ||
      value.schemaVersion === 4 ||
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
    changelog: migrateChangelogFromPreviousSchema(value.changelog),
    notifications: migrateNotificationSettingsFromPreviousSchema(value.notifications),
    portal: migratePortalSettingsFromPreviousSchema(value.portal),
    requests: migrateRequestsFromPreviousSchema(value.requests),
    roadmap: migrateRoadmapFromPreviousSchema(value.roadmap),
    workItems: Array.isArray(value.workItems) ? value.workItems : []
  };

  if (!isWorkspace(migrated)) {
    throw new Error("Saved OpenRoad workspace cannot be migrated.");
  }

  return cloneValue(migrated);
}

function migratePortalSettingsFromPreviousSchema(value: unknown): PortalSettings {
  if (isPortalSettings(value)) {
    return cloneValue(value);
  }

  return cloneValue(defaultPortalSettings);
}

function migrateNotificationSettingsFromPreviousSchema(
  value: unknown
): RequesterNotificationSettings {
  if (isNotificationSettings(value)) {
    return sanitizeNotificationSettings(cloneValue(value));
  }

  return cloneValue(defaultNotificationSettings);
}

function migrateRequestsFromPreviousSchema(value: unknown): RequestItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((request) => {
    if (!isRecord(request)) {
      throw new Error("Saved OpenRoad request cannot be migrated.");
    }

    const migrated = {
      ...request,
      comments: migrateRequestCommentsFromPreviousSchema(request.comments),
      visibility: requestVisibilities.includes(request.visibility as RequestVisibility)
        ? request.visibility
        : request.source === "Portal"
          ? "Public"
          : "Private"
    };

    if (!isRequestItem(migrated)) {
      throw new Error("Saved OpenRoad request cannot be migrated.");
    }

    return cloneValue(migrated);
  });
}

function migrateRequestCommentsFromPreviousSchema(value: unknown): RequestComment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((comment) => {
    if (isRequestComment(comment)) return cloneValue(comment);
    if (
      isRecord(comment) &&
      typeof comment.id === "string" &&
      typeof comment.author === "string" &&
      typeof comment.body === "string" &&
      typeof comment.age === "string"
    ) {
      return {
        age: comment.age,
        author: comment.author,
        body: comment.body,
        id: comment.id,
        visibility: "Internal"
      };
    }

    throw new Error("Saved OpenRoad request comment cannot be migrated.");
  });
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

function migrateChangelogFromPreviousSchema(value: unknown): ChangelogItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    if (isChangelogItem(item)) return cloneValue(item);
    if (
      isRecord(item) &&
      typeof item.title === "string" &&
      changelogStates.includes(item.state as ChangelogState) &&
      typeof item.detail === "string"
    ) {
      return changelogItemFromLegacyPreview(
        {
          detail: item.detail,
          state: item.state as ChangelogState,
          title: item.title
        },
        index
      );
    }
    throw new Error("Saved OpenRoad changelog item cannot be migrated.");
  });
}

function changelogItemFromLegacyPreview(
  item: { detail: string; state: ChangelogState; title: string },
  index: number
): ChangelogItem {
  return {
    createdAt: "migrated",
    id: `changelog-${index}-${slugify(item.title)}`,
    privateNotes: item.detail,
    publicSummary: item.title,
    requestIds: [],
    roadmapItemIds: [],
    sourceId: "",
    sourceType: "Manual",
    state: item.state,
    title: item.title,
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
    value.changelog.every(isChangelogItem) &&
    isPortalSettings(value.portal) &&
    isNotificationSettings(value.notifications) &&
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
    requestVisibilities.includes(value.visibility as RequestVisibility) &&
    typeof value.age === "string" &&
    typeof value.archived === "boolean" &&
    Array.isArray(value.comments) &&
    value.comments.every(isRequestComment) &&
    Array.isArray(value.mergedSources)
  );
}

function isRequestComment(value: unknown): value is RequestComment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.author === "string" &&
    typeof value.body === "string" &&
    typeof value.age === "string" &&
    commentVisibilities.includes(value.visibility as CommentVisibility)
  );
}

function isPortalSettings(value: unknown): value is PortalSettings {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.allowVoting === "boolean" &&
    typeof value.allowComments === "boolean" &&
    typeof value.headline === "string" &&
    typeof value.intro === "string"
  );
}

function isNotificationSettings(value: unknown): value is RequesterNotificationSettings {
  return (
    isRecord(value) &&
    typeof value.defaultChangelogUpdates === "boolean" &&
    typeof value.defaultStatusUpdates === "boolean" &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.outbox) &&
    value.outbox.every(isRequesterNotificationEvent) &&
    Array.isArray(value.preferences) &&
    value.preferences.every(isRequesterNotificationPreference) &&
    typeof value.quietWindowHours === "number"
  );
}

function isRequesterNotificationPreference(
  value: unknown
): value is RequesterNotificationPreference {
  return (
    isRecord(value) &&
    typeof value.changelogUpdates === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.id === "string" &&
    typeof value.requestId === "string" &&
    typeof value.requester === "string" &&
    typeof value.statusUpdates === "boolean" &&
    typeof value.updatedAt === "string"
  );
}

function isRequesterNotificationEvent(value: unknown): value is RequesterNotificationEvent {
  return (
    isRecord(value) &&
    typeof value.body === "string" &&
    (value.changelogId === undefined || typeof value.changelogId === "string") &&
    (value.changelogTitle === undefined || typeof value.changelogTitle === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.dedupeKey === "string" &&
    typeof value.id === "string" &&
    (value.nextStatus === undefined || requestStatuses.includes(value.nextStatus as RequestStatus)) &&
    (value.previousStatus === undefined ||
      requestStatuses.includes(value.previousStatus as RequestStatus)) &&
    typeof value.requestId === "string" &&
    typeof value.requestTitle === "string" &&
    typeof value.requester === "string" &&
    notificationEventStatuses.includes(value.status as NotificationEventStatus) &&
    typeof value.title === "string" &&
    notificationEventTypes.includes(value.type as NotificationEventType)
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

function isChangelogItem(value: unknown): value is ChangelogItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    changelogStates.includes(value.state as ChangelogState) &&
    changelogVisibilities.includes(value.visibility as ChangelogVisibility) &&
    typeof value.publicSummary === "string" &&
    typeof value.privateNotes === "string" &&
    (value.sourceType === "Manual" ||
      value.sourceType === "Roadmap" ||
      value.sourceType === "Work") &&
    typeof value.sourceId === "string" &&
    Array.isArray(value.requestIds) &&
    value.requestIds.every((requestId) => typeof requestId === "string") &&
    Array.isArray(value.roadmapItemIds) &&
    value.roadmapItemIds.every((roadmapItemId) => typeof roadmapItemId === "string") &&
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

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
