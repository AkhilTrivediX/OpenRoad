import {
  Archive,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Command,
  GitMerge,
  Globe2,
  Inbox,
  LayoutDashboard,
  MessageCircle,
  MessageSquareText,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Tag,
  ThumbsUp,
  Waypoints
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

const requestStatuses = ["New", "Needs decision", "Planned", "Shipping soon"] as const;
const requestOwners = ["Unassigned", "Akhil", "Product", "Support", "Maintainer"] as const;
const triageViews = [
  { value: "all", label: "All active" },
  { value: "unassigned", label: "Unassigned" },
  { value: "needs-decision", label: "Needs decision" },
  { value: "high-signal", label: "High signal" }
] as const;
const integrationChips: IntegrationChip[] = [
  { label: "GitHub", state: "Optional" },
  { label: "Jira", state: "Optional" },
  { label: "Linear", state: "Optional" }
];

type NavItem = {
  label: "Inbox" | "Roadmap" | "Changelog" | "Portal" | "Settings";
  count?: boolean;
  icon: typeof Inbox;
};

type RequestStatus = (typeof requestStatuses)[number];
type RequestOwner = (typeof requestOwners)[number];
type RequestStatusFilter = "All" | RequestStatus;
type RequestArchiveFilter = "active" | "archived";
type TriageView = (typeof triageViews)[number]["value"];

type Workspace = {
  id: string;
  name: string;
  plan: string;
  summary: string;
  requests: RequestItem[];
  roadmap: Record<"Now" | "Next" | "Later", string[]>;
  changelog: ChangelogItem[];
  integrations: IntegrationChip[];
};

type RequestItem = {
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

type RequestComment = {
  id: string;
  author: string;
  body: string;
  age: string;
};

type MergedRequestSource = {
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

type ChangelogItem = {
  title: string;
  state: "Draft" | "Ready";
  detail: string;
};

type IntegrationChip = {
  label: string;
  state: "Optional" | "Linked";
};

type RequestDraft = {
  title: string;
  description: string;
  requester: string;
  source: string;
  tags: string;
};

const emptyRequestDraft: RequestDraft = {
  title: "",
  description: "",
  requester: "",
  source: "Manual",
  tags: ""
};

const navItems: NavItem[] = [
  { label: "Inbox", count: true, icon: Inbox },
  { label: "Roadmap", icon: Waypoints },
  { label: "Changelog", icon: BookOpen },
  { label: "Portal", icon: Globe2 },
  { label: "Settings", icon: Settings }
];

const initialWorkspaces: Workspace[] = [
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

function statusTone(status: RequestStatus | ChangelogItem["state"]) {
  if (status === "Planned" || status === "Ready") return "success";
  if (status === "Shipping soon") return "info";
  if (status === "Needs decision" || status === "Draft") return "warning";
  return "neutral";
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function requestMatchesQuery(request: RequestItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    request.title,
    request.description,
    request.requester,
    request.source,
    request.status,
    request.owner,
    request.tags.join(" "),
    request.comments.map((comment) => `${comment.author} ${comment.body}`).join(" "),
    request.mergedSources
      .map(
        (source) =>
          `${source.title} ${source.requester} ${source.source} ${source.tags.join(" ")}`
      )
      .join(" ")
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function requestMatchesTriageView(request: RequestItem, view: TriageView) {
  if (view === "unassigned") return request.owner === "Unassigned";
  if (view === "needs-decision") return request.status === "Needs decision";
  if (view === "high-signal") {
    return request.votes >= 80 || request.comments.length > 0 || request.mergedSources.length > 0;
  }
  return true;
}

export function App() {
  const [workspaceList, setWorkspaceList] = useState(initialWorkspaces);
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaces[0].id);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isAddingRequest, setIsAddingRequest] = useState(false);
  const [newRequestDraft, setNewRequestDraft] = useState<RequestDraft>(emptyRequestDraft);
  const [requestQuery, setRequestQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>("All");
  const [archiveFilter, setArchiveFilter] = useState<RequestArchiveFilter>("active");
  const [triageView, setTriageView] = useState<TriageView>("all");
  const [commentDraft, setCommentDraft] = useState("");
  const [duplicateMergeTargetId, setDuplicateMergeTargetId] = useState("");
  const [selectedRequestIdByWorkspace, setSelectedRequestIdByWorkspace] = useState<
    Record<string, string | undefined>
  >({});
  const workspace = useMemo(
    () => workspaceList.find((item) => item.id === workspaceId) ?? workspaceList[0],
    [workspaceId, workspaceList]
  );
  const activeRequestCount = useMemo(
    () => workspace.requests.filter((request) => !request.archived).length,
    [workspace.requests]
  );
  const requestScope = useMemo(
    () =>
      workspace.requests.filter((request) =>
          archiveFilter === "archived" ? request.archived : !request.archived
      ),
    [archiveFilter, workspace.requests]
  );
  const activeRequests = useMemo(
    () => workspace.requests.filter((request) => !request.archived),
    [workspace.requests]
  );
  const filteredRequests = useMemo(
    () =>
      requestScope.filter(
        (request) =>
          requestMatchesTriageView(request, triageView) &&
          (statusFilter === "All" || request.status === statusFilter) &&
          requestMatchesQuery(request, requestQuery)
      ),
    [requestQuery, requestScope, statusFilter, triageView]
  );
  const selectedRequest = useMemo(() => {
    const selectedRequestId = selectedRequestIdByWorkspace[workspace.id];
    return (
      requestScope.find((request) => request.id === selectedRequestId) ??
      filteredRequests[0] ??
      null
    );
  }, [filteredRequests, requestScope, selectedRequestIdByWorkspace, workspace.id]);
  const hasSearchOrStatusFilter = requestQuery.trim() !== "" || statusFilter !== "All";
  const hasSavedViewFilter = triageView !== "all";
  const hasRequestFilters = hasSearchOrStatusFilter || archiveFilter !== "active" || hasSavedViewFilter;
  const emptyRequestTitle = hasSearchOrStatusFilter
    ? "No matching requests"
    : hasSavedViewFilter
      ? "No requests in this view"
    : archiveFilter === "archived"
      ? "No archived requests"
      : "No requests yet";
  const triageStats = useMemo(
    () => ({
      unassigned: filteredRequests.filter((request) => request.owner === "Unassigned").length,
      needsDecision: filteredRequests.filter((request) => request.status === "Needs decision").length,
      highSignal: filteredRequests.filter((request) => requestMatchesTriageView(request, "high-signal"))
        .length
    }),
    [filteredRequests]
  );
  const mergeCandidates = useMemo(
    () =>
      selectedRequest && !selectedRequest.archived
        ? activeRequests.filter((request) => request.id !== selectedRequest.id)
        : [],
    [activeRequests, selectedRequest]
  );

  function updateCurrentWorkspace(updater: (workspace: Workspace) => Workspace) {
    setWorkspaceList((items) =>
      items.map((item) => (item.id === workspace.id ? updater(item) : item))
    );
  }

  function updateRequest(requestId: string, updater: (request: RequestItem) => RequestItem) {
    updateCurrentWorkspace((item) => ({
      ...item,
      requests: item.requests.map((request) =>
        request.id === requestId ? updater(request) : request
      )
    }));
  }

  function resetRequestFilters() {
    setRequestQuery("");
    setStatusFilter("All");
    setArchiveFilter("active");
    setTriageView("all");
  }

  function selectRequest(requestId: string | undefined) {
    setSelectedRequestIdByWorkspace((items) => ({
      ...items,
      [workspace.id]: requestId
    }));
    setCommentDraft("");
    setDuplicateMergeTargetId("");
  }

  function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (!name) return;

    const createdWorkspace: Workspace = {
      id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      name,
      plan: "Standalone workspace",
      summary: "Ready for requests, roadmap, and changelog work.",
      requests: [],
      roadmap: {
        Now: [],
        Next: [],
        Later: []
      },
      changelog: [],
      integrations: integrationChips
    };

    setWorkspaceList((items) => [...items, createdWorkspace]);
    setWorkspaceId(createdWorkspace.id);
    setNewWorkspaceName("");
    setIsCreatingWorkspace(false);
    setIsAddingRequest(false);
    resetRequestFilters();
  }

  function addRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newRequestDraft.title.trim();
    if (!title) return;

    const createdRequest: RequestItem = {
      id: `manual-${Date.now()}`,
      title,
      description: newRequestDraft.description.trim(),
      requester: newRequestDraft.requester.trim() || "Manual capture",
      source: newRequestDraft.source.trim() || "Manual",
      tags: parseTags(newRequestDraft.tags),
      votes: 0,
      hasCurrentUserVote: false,
      status: "New",
      owner: "Unassigned",
      age: "just now",
      archived: false,
      comments: [],
      mergedSources: []
    };

    updateCurrentWorkspace((item) => ({
      ...item,
      requests: [createdRequest, ...item.requests]
    }));
    selectRequest(createdRequest.id);
    setNewRequestDraft(emptyRequestDraft);
    setArchiveFilter("active");
    setStatusFilter("All");
    setTriageView("all");
    setRequestQuery("");
    setIsAddingRequest(false);
  }

  function updateSelectedRequest(updater: (request: RequestItem) => RequestItem) {
    if (!selectedRequest) return;
    updateRequest(selectedRequest.id, updater);
  }

  function normalizeSelectedRequestTitle() {
    updateSelectedRequest((request) => ({
      ...request,
      title: request.title.trim() || "Untitled request"
    }));
  }

  function toggleVote() {
    updateSelectedRequest((request) => ({
      ...request,
      hasCurrentUserVote: !request.hasCurrentUserVote,
      votes: request.hasCurrentUserVote
        ? Math.max(0, request.votes - 1)
        : request.votes + 1
    }));
  }

  function mergeDuplicateRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRequest || !duplicateMergeTargetId) return;
    if (selectedRequest.archived) return;
    const duplicate = workspace.requests.find(
      (request) => request.id === duplicateMergeTargetId && !request.archived
    );
    if (!duplicate || duplicate.id === selectedRequest.id) return;

    const sourceRecord: MergedRequestSource = {
      id: duplicate.id,
      title: duplicate.title,
      description: duplicate.description,
      requester: duplicate.requester,
      source: duplicate.source,
      owner: duplicate.owner,
      status: duplicate.status,
      votes: duplicate.votes,
      hasCurrentUserVote: duplicate.hasCurrentUserVote,
      tags: duplicate.tags,
      commentCount: duplicate.comments.length,
      age: duplicate.age,
      mergedAt: "just now"
    };

    updateCurrentWorkspace((item) => ({
      ...item,
      requests: item.requests.flatMap((request) => {
        if (request.id === duplicate.id) return [];
        if (request.id !== selectedRequest.id) return [request];

        return [
          {
            ...request,
            votes: request.votes + duplicate.votes,
            hasCurrentUserVote:
              request.hasCurrentUserVote || duplicate.hasCurrentUserVote,
            tags: Array.from(new Set([...request.tags, ...duplicate.tags])),
            comments: [
              ...request.comments,
              ...duplicate.comments.map((comment) => ({
                ...comment,
                id: `${duplicate.id}-${comment.id}`
              }))
            ],
            mergedSources: [
              sourceRecord,
              ...duplicate.mergedSources,
              ...request.mergedSources
            ]
          }
        ];
      })
    }));
    selectRequest(selectedRequest.id);
  }

  function archiveSelectedRequest() {
    if (!selectedRequest) return;
    const isRestoring = selectedRequest.archived;
    const nextActiveRequest = workspace.requests.find(
      (request) => request.id !== selectedRequest.id && !request.archived
    );

    updateRequest(selectedRequest.id, (request) => ({
      ...request,
      archived: !request.archived
    }));

    setArchiveFilter("active");
    selectRequest(isRestoring ? selectedRequest.id : nextActiveRequest?.id);
  }

  function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!selectedRequest || !body) return;

    const comment: RequestComment = {
      id: `comment-${Date.now()}`,
      author: "Akhil",
      body,
      age: "just now"
    };

    updateRequest(selectedRequest.id, (request) => ({
      ...request,
      comments: [comment, ...request.comments]
    }));
    setCommentDraft("");
  }

  return (
    <main className="app-shell" aria-label="OpenRoad workspace shell">
      <aside className="route-index" aria-label="Primary navigation">
        <div className="brand" aria-label="OpenRoad">
          <span className="brand-mark" aria-hidden="true">
            <RouteGlyph />
          </span>
          <span className="brand-copy">
            <strong>OpenRoad</strong>
            <small>route room</small>
          </span>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                aria-current={item.label === "Inbox" ? "page" : undefined}
                className={item.label === "Inbox" ? "nav-item active" : "nav-item"}
                href={`#${item.label.toLowerCase()}`}
                key={item.label}
              >
                <Icon aria-hidden="true" size={17} strokeWidth={1.75} />
                <span>{item.label}</span>
                {item.count ? <strong>{activeRequestCount}</strong> : null}
              </a>
            );
          })}
        </nav>

        <section className="workspace-plate" aria-label="Workspace status">
          <span>{workspace.plan}</span>
          <strong>{workspace.name}</strong>
          <p>{workspace.summary}</p>
        </section>
      </aside>

      <section className="operations-deck">
        <header className="command-deck">
          <label className="workspace-switcher">
            <span className="sr-only">Workspace</span>
            <LayoutDashboard aria-hidden="true" size={16} />
            <select
              aria-label="Workspace"
              onChange={(event) => {
                setWorkspaceId(event.target.value);
                setIsAddingRequest(false);
                setCommentDraft("");
              }}
              value={workspaceId}
            >
              {workspaceList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" size={14} />
          </label>

          <div className="command-bar" role="search">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Search requests"
              onChange={(event) => setRequestQuery(event.target.value)}
              placeholder="Search requests, requester, tags..."
              type="search"
              value={requestQuery}
            />
            <kbd>
              <Command aria-hidden="true" size={12} />K
            </kbd>
          </div>

          <div className="top-actions">
            <button
              className="secondary-action compact"
              onClick={() => setIsCreatingWorkspace((value) => !value)}
              type="button"
            >
              New workspace
            </button>
            <button className="icon-button" aria-label="Notifications">
              <Bell aria-hidden="true" size={16} />
            </button>
            <span className="avatar" aria-label="Current user Akhil">
              AT
            </span>
          </div>
        </header>

        {isCreatingWorkspace ? (
          <form className="workspace-form" onSubmit={createWorkspace}>
            <label>
              <span>Workspace name</span>
              <input
                autoFocus
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                placeholder="e.g. Mobile Platform"
                value={newWorkspaceName}
              />
            </label>
            <button className="primary-action" type="submit">
              Create workspace
            </button>
          </form>
        ) : null}

        <section className="brief-plate" id="portal" aria-label="Standalone workflow">
          <div className="brief-copy">
            <span className="section-label">Standalone first</span>
            <h1>Turn requests into roadmap and changelog updates.</h1>
            <p>
              Start in OpenRoad today. Connect GitHub, Jira, or Linear later when
              delivery sync is useful.
            </p>
          </div>

          <div className="brief-instruments" aria-label="Workspace instruments">
            <span>
              <small>Requests</small>
              <strong>{activeRequestCount}</strong>
            </span>
            <span>
              <small>Mode</small>
              <strong>Standalone</strong>
            </span>
          </div>

          {isAddingRequest ? null : (
            <button
              aria-controls="request-composer"
              className="primary-action"
              onClick={() => setIsAddingRequest(true)}
              type="button"
            >
              <Plus aria-hidden="true" size={16} />
              Add request
            </button>
          )}
        </section>

        {isAddingRequest ? (
          <form
            aria-label="Add request"
            className="request-composer"
            id="request-composer"
            onSubmit={addRequest}
          >
            <label>
              <span>Request title</span>
              <input
                autoFocus
                onChange={(event) =>
                  setNewRequestDraft((draft) => ({ ...draft, title: event.target.value }))
                }
                placeholder="e.g. Export customer list"
                value={newRequestDraft.title}
              />
            </label>
            <label>
              <span>Requester</span>
              <input
                onChange={(event) =>
                  setNewRequestDraft((draft) => ({
                    ...draft,
                    requester: event.target.value
                  }))
                }
                placeholder="e.g. Success team"
                value={newRequestDraft.requester}
              />
            </label>
            <label className="wide-field">
              <span>Description</span>
              <textarea
                onChange={(event) =>
                  setNewRequestDraft((draft) => ({
                    ...draft,
                    description: event.target.value
                  }))
                }
                placeholder="What did the user ask for, and why does it matter?"
                value={newRequestDraft.description}
              />
            </label>
            <label>
              <span>Source</span>
              <input
                onChange={(event) =>
                  setNewRequestDraft((draft) => ({ ...draft, source: event.target.value }))
                }
                placeholder="Manual"
                value={newRequestDraft.source}
              />
            </label>
            <label>
              <span>Tags</span>
              <input
                onChange={(event) =>
                  setNewRequestDraft((draft) => ({ ...draft, tags: event.target.value }))
                }
                placeholder="export, enterprise"
                value={newRequestDraft.tags}
              />
            </label>
            <div className="composer-actions wide-field">
              <button className="primary-action" type="submit">
                Capture request
              </button>
              <button
                className="secondary-action"
                onClick={() => {
                  setIsAddingRequest(false);
                  setNewRequestDraft(emptyRequestDraft);
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        <section className="map-board">
          <section className="panel intake-panel" id="inbox" aria-labelledby="inbox-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Inbox</span>
                <h2 id="inbox-title">Requests needing attention</h2>
              </div>
              <button className="secondary-action" onClick={resetRequestFilters} type="button">
                View all
              </button>
            </div>

            <div className="route-protocol" aria-label="Activation steps">
              {[
                ["Capture request", "Add feedback from users"],
                ["Manage signal", "Vote, comment, tag, archive"],
                ["Move to roadmap", "Choose what to build next"]
              ].map(([title, detail], index) => (
                <span className="protocol-step" key={title}>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <strong>{title}</strong>
                  <em>{detail}</em>
                </span>
              ))}
            </div>

            <div className="request-tools" aria-label="Request filters">
              <SlidersHorizontal aria-hidden="true" size={14} />
              <label>
                <span>View</span>
                <select
                  aria-label="Saved triage view"
                  onChange={(event) => setTriageView(event.target.value as TriageView)}
                  value={triageView}
                >
                  {triageViews.map((view) => (
                    <option key={view.value} value={view.value}>
                      {view.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select
                  aria-label="Status filter"
                  onChange={(event) =>
                    setStatusFilter(event.target.value as RequestStatusFilter)
                  }
                  value={statusFilter}
                >
                  <option value="All">All statuses</option>
                  {requestStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Queue</span>
                <select
                  aria-label="Archive filter"
                  onChange={(event) =>
                    setArchiveFilter(event.target.value as RequestArchiveFilter)
                  }
                  value={archiveFilter}
                >
                  <option value="active">Active requests</option>
                  <option value="archived">Archived requests</option>
                </select>
              </label>
              {hasRequestFilters && filteredRequests.length ? (
                <button className="secondary-action compact" onClick={resetRequestFilters} type="button">
                  Reset filters
                </button>
              ) : null}
            </div>

            <div className="triage-summary" aria-label="Triage summary">
              <span>
                <small>Unassigned</small>
                <strong>{triageStats.unassigned}</strong>
              </span>
              <span>
                <small>Needs decision</small>
                <strong>{triageStats.needsDecision}</strong>
              </span>
              <span>
                <small>High signal</small>
                <strong>{triageStats.highSignal}</strong>
              </span>
            </div>

            {filteredRequests.length ? (
              <div className="request-list">
                {filteredRequests.map((request, index) => (
                  <button
                    aria-pressed={selectedRequest?.id === request.id}
                    className={
                      selectedRequest?.id === request.id
                        ? "request-row active"
                        : "request-row"
                    }
                    key={request.id}
                    onClick={() => selectRequest(request.id)}
                    type="button"
                  >
                    <span className="route-node" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="request-main">
                      <strong>{request.title}</strong>
                      <small>
                        {request.requester} / {request.source} / {request.owner} / {request.age}
                        {request.mergedSources.length ? ` / +${request.mergedSources.length} merged` : ""}
                      </small>
                    </span>
                    <span className="vote-count">{request.votes}</span>
                    <span className={`status-badge ${statusTone(request.status)}`}>
                      {request.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>{emptyRequestTitle}</strong>
                <p>
                  {hasRequestFilters
                    ? "Adjust or clear filters to return to the active request queue."
                    : "Capture the first user request here. You can connect sources later."}
                </p>
                {hasRequestFilters ? (
                  <button className="secondary-action" onClick={resetRequestFilters} type="button">
                    Reset filters
                  </button>
                ) : (
                  <button
                    aria-controls="request-composer"
                    className="secondary-action"
                    onClick={() => setIsAddingRequest(true)}
                    type="button"
                  >
                    Add request
                  </button>
                )}
              </div>
            )}
          </section>

          <aside className="panel inspector" aria-labelledby="inspector-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Selected request</span>
                <h2 id="inspector-title">
                  {selectedRequest ? selectedRequest.title : "No request selected"}
                </h2>
              </div>
              {selectedRequest ? (
                <span className={`status-badge ${statusTone(selectedRequest.status)}`}>
                  {selectedRequest.status}
                </span>
              ) : null}
            </div>

            {selectedRequest ? (
              <>
                <div className="request-actions" aria-label="Request actions">
                  <button className="secondary-action" onClick={toggleVote} type="button">
                    <ThumbsUp aria-hidden="true" size={14} />
                    {selectedRequest.hasCurrentUserVote ? "Remove vote" : "Add vote"}
                  </button>
                  <button className="secondary-action" onClick={archiveSelectedRequest} type="button">
                    {selectedRequest.archived ? (
                      <RotateCcw aria-hidden="true" size={14} />
                    ) : (
                      <Archive aria-hidden="true" size={14} />
                    )}
                    {selectedRequest.archived ? "Restore request" : "Archive request"}
                  </button>
                </div>

                <form
                  className="triage-controls"
                  aria-label="Triage controls"
                  onSubmit={mergeDuplicateRequest}
                >
                  <label>
                    <span>Owner</span>
                    <select
                      aria-label="Selected request owner"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          owner: event.target.value as RequestOwner
                        }))
                      }
                      value={selectedRequest.owner}
                    >
                      {requestOwners.map((owner) => (
                        <option key={owner} value={owner}>
                          {owner}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Duplicate</span>
                    <select
                      aria-label="Duplicate request"
                      disabled={!mergeCandidates.length}
                      onChange={(event) => setDuplicateMergeTargetId(event.target.value)}
                      value={duplicateMergeTargetId}
                    >
                      <option value="">Choose duplicate</option>
                      {mergeCandidates.map((request) => (
                        <option key={request.id} value={request.id}>
                          {request.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-action"
                    disabled={!duplicateMergeTargetId}
                    type="submit"
                  >
                    <GitMerge aria-hidden="true" size={14} />
                    Merge duplicate
                  </button>
                </form>

                <form
                  className="request-editor"
                  aria-label="Edit selected request"
                  onSubmit={(event) => event.preventDefault()}
                >
                  <label className="wide-field">
                    <span>Title</span>
                    <input
                      aria-label="Selected request title"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          title: event.target.value
                        }))
                      }
                      onBlur={normalizeSelectedRequestTitle}
                      value={selectedRequest.title}
                    />
                  </label>
                  <label className="wide-field">
                    <span>Description</span>
                    <textarea
                      aria-label="Selected request description"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          description: event.target.value
                        }))
                      }
                      value={selectedRequest.description}
                    />
                  </label>
                  <label>
                    <span>Requester</span>
                    <input
                      aria-label="Selected request requester"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          requester: event.target.value
                        }))
                      }
                      value={selectedRequest.requester}
                    />
                  </label>
                  <label>
                    <span>Source</span>
                    <input
                      aria-label="Selected request source"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          source: event.target.value
                        }))
                      }
                      value={selectedRequest.source}
                    />
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      aria-label="Selected request status"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          status: event.target.value as RequestStatus
                        }))
                      }
                      value={selectedRequest.status}
                    >
                      {requestStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Tags</span>
                    <input
                      aria-label="Selected request tags"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          tags: parseTags(event.target.value)
                        }))
                      }
                      value={selectedRequest.tags.join(", ")}
                    />
                  </label>
                </form>

                <div className="tag-list" aria-label="Selected tag list">
                  <Tag aria-hidden="true" size={13} />
                  {selectedRequest.tags.length ? (
                    selectedRequest.tags.map((tag) => <span key={tag}>{tag}</span>)
                  ) : (
                    <small>No tags</small>
                  )}
                </div>

                <dl className="detail-list">
                  <div>
                    <dt>Requested by</dt>
                    <dd>{selectedRequest.requester}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{selectedRequest.source}</dd>
                  </div>
                  <div>
                    <dt>Votes</dt>
                    <dd>{selectedRequest.votes}</dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{selectedRequest.owner}</dd>
                  </div>
                  <div>
                    <dt>Comments</dt>
                    <dd>{selectedRequest.comments.length}</dd>
                  </div>
                  <div>
                    <dt>Merged</dt>
                    <dd>{selectedRequest.mergedSources.length}</dd>
                  </div>
                  <div>
                    <dt>Archive</dt>
                    <dd>{selectedRequest.archived ? "Archived" : "Active"}</dd>
                  </div>
                </dl>

                {selectedRequest.mergedSources.length ? (
                  <div className="source-history" aria-label="Merged source history">
                    <div className="source-history-header">
                      <GitMerge aria-hidden="true" size={14} />
                      <strong>Source history</strong>
                    </div>
                    {selectedRequest.mergedSources.map((source) => (
                      <article className="source-history-item" key={source.id}>
                        <strong>{source.title}</strong>
                        <p>
                          {source.requester} / {source.source} / {source.owner} /{" "}
                          {source.status} / {source.votes} votes / {source.commentCount}{" "}
                          comments
                        </p>
                        <p>{source.description}</p>
                        <small>
                          Merged {source.mergedAt}
                          {source.tags.length ? ` / ${source.tags.join(", ")}` : ""}
                        </small>
                      </article>
                    ))}
                  </div>
                ) : null}

                <form className="comment-form" aria-label="Add comment" onSubmit={addComment}>
                  <label>
                    <span>Comment</span>
                    <textarea
                      onChange={(event) => setCommentDraft(event.target.value)}
                      placeholder="Add evidence, context, or a customer quote"
                      value={commentDraft}
                    />
                  </label>
                  <button className="secondary-action" type="submit">
                    <MessageCircle aria-hidden="true" size={14} />
                    Add comment
                  </button>
                </form>

                <div className="comment-list" aria-label="Request comments">
                  {selectedRequest.comments.length ? (
                    selectedRequest.comments.map((comment) => (
                      <article className="comment-item" key={comment.id}>
                        <strong>{comment.author}</strong>
                        <p>{comment.body}</p>
                        <small>{comment.age}</small>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state compact-empty">
                      <strong>No comments yet</strong>
                      <p>Add the first note when a request has evidence worth preserving.</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state compact-empty">
                <strong>Select a request</strong>
                <p>Request details, evidence, and optional work links will appear here.</p>
              </div>
            )}

            <div className="integration-chips" id="settings" aria-label="Optional integrations">
              {workspace.integrations.map((integration) => (
                <span className="integration-chip" key={integration.label}>
                  <RadioTower aria-hidden="true" size={13} />
                  {integration.label}
                  <small>{integration.state}</small>
                </span>
              ))}
            </div>
          </aside>

          <section className="panel route-map-panel" id="roadmap" aria-labelledby="roadmap-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Roadmap preview</span>
                <h2 id="roadmap-title">Now / Next / Later</h2>
              </div>
              <a href="#roadmap">Open Roadmap</a>
            </div>
            <div className="roadmap-lanes">
              {Object.entries(workspace.roadmap).map(([lane, items]) => (
                <div className="lane" key={lane}>
                  <strong>{lane}</strong>
                  <ul>
                    {items.length ? (
                      items.map((item) => (
                        <li key={item}>
                          <CircleDot aria-hidden="true" size={12} />
                          <span>{item}</span>
                        </li>
                      ))
                    ) : (
                      <li>
                        <CircleDot aria-hidden="true" size={12} />
                        <span>Nothing placed yet</span>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="panel release-panel" id="changelog" aria-labelledby="changelog-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Changelog</span>
                <h2 id="changelog-title">Draft queue</h2>
              </div>
              <a href="#changelog">Open Changelog</a>
            </div>
            <div className="changelog-list">
              {workspace.changelog.length ? (
                workspace.changelog.map((item) => (
                  <article className="changelog-item" key={item.title}>
                    <span className={`status-badge ${statusTone(item.state)}`}>
                      {item.state}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))
              ) : (
                <div className="empty-state compact-empty">
                  <strong>No changelog drafts</strong>
                  <p>Draft updates from shipped roadmap items when work starts landing.</p>
                </div>
              )}
            </div>
          </section>
        </section>
      </section>

      <div className="bottom-status" aria-label="System status">
        <span>
          <CheckCircle2 aria-hidden="true" size={14} />
          Standalone mode ready
        </span>
        <span>
          <MessageSquareText aria-hidden="true" size={14} />
          {activeRequestCount} {activeRequestCount === 1 ? "request" : "requests"}
        </span>
      </div>
    </main>
  );
}

function RouteGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 5h7a7 7 0 0 1 7 7v7" />
      <path d="M5 5v14h14" />
      <path d="M9 9h3a3 3 0 0 1 3 3v3" />
    </svg>
  );
}
