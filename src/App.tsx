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
  Link2,
  ListChecks,
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
  Unlink,
  Waypoints
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import {
  clearOpenRoadState,
  createEntityId,
  createInitialOpenRoadState,
  exportWorkspace,
  importWorkspaceFromJson,
  initialWorkspaces,
  integrationChips,
  loadOpenRoadState,
  loadSelectedWorkspaceId,
  openRoadReducer,
  roadmapConfidenceLevels,
  roadmapLanes,
  roadmapVisibilities,
  requestOwners,
  requestStatuses,
  saveOpenRoadState,
  saveSelectedWorkspaceId,
  workStatuses,
  type ChangelogItem,
  type MergedRequestSource,
  type OpenRoadState,
  type RoadmapConfidence,
  type RoadmapItem,
  type RoadmapLane,
  type RoadmapVisibility,
  type RequestComment,
  type RequestItem,
  type RequestOwner,
  type RequestStatus,
  type WorkComment,
  type WorkItem,
  type Workspace,
  type WorkStatus
} from "./domain/openroad";

const triageViews = [
  { value: "all", label: "All active" },
  { value: "unassigned", label: "Unassigned" },
  { value: "needs-decision", label: "Needs decision" },
  { value: "high-signal", label: "High signal" }
] as const;

type NavItem = {
  label: "Inbox" | "Work" | "Roadmap" | "Changelog" | "Portal" | "Settings";
  count?: boolean;
  icon: typeof Inbox;
};

type RequestStatusFilter = "All" | RequestStatus;
type RequestArchiveFilter = "active" | "archived";
type TriageView = (typeof triageViews)[number]["value"];

type RequestDraft = {
  title: string;
  description: string;
  requester: string;
  source: string;
  tags: string;
};

type WorkDraft = {
  title: string;
  description: string;
  owner: RequestOwner;
  status: WorkStatus;
  targetDate: string;
  linkSelectedRequest: boolean;
};

type RoadmapDraft = {
  title: string;
  summary: string;
  lane: RoadmapLane;
  visibility: RoadmapVisibility;
  confidence: RoadmapConfidence;
  isStale: boolean;
  requestId: string;
  workItemId: string;
};

const emptyRequestDraft: RequestDraft = {
  title: "",
  description: "",
  requester: "",
  source: "Manual",
  tags: ""
};

const emptyWorkDraft: WorkDraft = {
  title: "",
  description: "",
  owner: "Unassigned",
  status: "Backlog",
  targetDate: "",
  linkSelectedRequest: true
};

const emptyRoadmapDraft: RoadmapDraft = {
  confidence: "Medium",
  isStale: false,
  lane: "Next",
  requestId: "",
  summary: "",
  title: "",
  visibility: "Private",
  workItemId: ""
};

const baseNavItems: NavItem[] = [
  { label: "Inbox", count: true, icon: Inbox },
  { label: "Roadmap", icon: Waypoints },
  { label: "Changelog", icon: BookOpen },
  { label: "Portal", icon: Globe2 },
  { label: "Settings", icon: Settings }
];

const workNavItem: NavItem = { label: "Work", icon: ListChecks };

function statusTone(status: RequestStatus | WorkStatus | ChangelogItem["state"]) {
  if (status === "Planned" || status === "Ready" || status === "Done") return "success";
  if (status === "Shipping soon" || status === "In progress") return "info";
  if (status === "Needs decision" || status === "Draft") return "warning";
  return "neutral";
}

function flattenRoadmap(roadmap: Workspace["roadmap"]) {
  return roadmapLanes.flatMap((lane) => roadmap[lane]);
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
  const [loadResult] = useState(() => loadOpenRoadState());
  const [openRoadState, dispatchOpenRoad] = useReducer(
    openRoadReducer,
    loadResult.state
  );
  const workspaceList = openRoadState.workspaces as Workspace[];
  const [workspaceId, setWorkspaceId] = useState(() => {
    const selectedWorkspaceId = loadSelectedWorkspaceId();

    if (
      selectedWorkspaceId &&
      loadResult.state.workspaces.some((item) => item.id === selectedWorkspaceId)
    ) {
      return selectedWorkspaceId;
    }

    return loadResult.state.workspaces[0]?.id ?? initialWorkspaces[0].id;
  });
  const [persistenceMessage, setPersistenceMessage] = useState(
    loadResult.status === "recovered"
      ? loadResult.error ?? "Saved OpenRoad data could not be loaded. Demo data is active."
      : ""
  );
  const [exportPreview, setExportPreview] = useState("");
  const [importDraft, setImportDraft] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isAddingRequest, setIsAddingRequest] = useState(false);
  const [newRequestDraft, setNewRequestDraft] = useState<RequestDraft>(emptyRequestDraft);
  const [isAddingWorkItem, setIsAddingWorkItem] = useState(false);
  const [newWorkDraft, setNewWorkDraft] = useState<WorkDraft>(emptyWorkDraft);
  const [isAddingRoadmapItem, setIsAddingRoadmapItem] = useState(false);
  const [newRoadmapDraft, setNewRoadmapDraft] =
    useState<RoadmapDraft>(emptyRoadmapDraft);
  const [requestQuery, setRequestQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>("All");
  const [archiveFilter, setArchiveFilter] = useState<RequestArchiveFilter>("active");
  const [triageView, setTriageView] = useState<TriageView>("all");
  const [commentDraft, setCommentDraft] = useState("");
  const [workCommentDraft, setWorkCommentDraft] = useState("");
  const [duplicateMergeTargetId, setDuplicateMergeTargetId] = useState("");
  const [selectedRequestIdByWorkspace, setSelectedRequestIdByWorkspace] = useState<
    Record<string, string | undefined>
  >({});
  const [selectedWorkItemIdByWorkspace, setSelectedWorkItemIdByWorkspace] = useState<
    Record<string, string | undefined>
  >({});
  const workspace = useMemo(
    () => workspaceList.find((item) => item.id === workspaceId) ?? workspaceList[0],
    [workspaceId, workspaceList]
  );
  useEffect(() => {
    try {
      saveOpenRoadState(openRoadState as OpenRoadState);
    } catch {
      setPersistenceMessage("OpenRoad could not save local workspace data.");
    }
  }, [openRoadState]);
  useEffect(() => {
    saveSelectedWorkspaceId(workspaceId);
  }, [workspaceId]);
  const activeRequestCount = useMemo(
    () => workspace.requests.filter((request) => !request.archived).length,
    [workspace.requests]
  );
  const workItemCount = workspace.workItems.length;
  const hasWorkItems = workItemCount > 0;
  const roadmapItems = useMemo(() => flattenRoadmap(workspace.roadmap), [workspace.roadmap]);
  const roadmapItemCount = roadmapItems.length;
  const navItems = useMemo(() => {
    if (!hasWorkItems) return baseNavItems;
    return [baseNavItems[0], workNavItem, ...baseNavItems.slice(1)];
  }, [hasWorkItems]);
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
  const selectedRequestWorkItems = useMemo(
    () =>
      selectedRequest
        ? workspace.workItems.filter((workItem) =>
            workItem.requestIds.includes(selectedRequest.id)
          )
        : [],
    [selectedRequest, workspace.workItems]
  );
  const selectedWorkItem = useMemo(() => {
    const selectedWorkItemId = selectedWorkItemIdByWorkspace[workspace.id];
    return (
      workspace.workItems.find((workItem) => workItem.id === selectedWorkItemId) ??
      workspace.workItems[0] ??
      null
    );
  }, [selectedWorkItemIdByWorkspace, workspace.id, workspace.workItems]);
  const selectedWorkItemRequests = useMemo(
    () =>
      selectedWorkItem
        ? selectedWorkItem.requestIds.flatMap((requestId) => {
            const request = workspace.requests.find((item) => item.id === requestId);
            return request ? [request] : [];
          })
        : [],
    [selectedWorkItem, workspace.requests]
  );

  function updateCurrentWorkspace(updater: (workspace: Workspace) => Workspace) {
    dispatchOpenRoad({
      type: "replace-workspace",
      workspace: updater(workspace)
    });
  }

  function updateRequest(requestId: string, updater: (request: RequestItem) => RequestItem) {
    updateCurrentWorkspace((item) => ({
      ...item,
      requests: item.requests.map((request) =>
        request.id === requestId ? updater(request) : request
      )
    }));
  }

  function updateWorkItem(workItemId: string, updater: (workItem: WorkItem) => WorkItem) {
    updateCurrentWorkspace((item) => ({
      ...item,
      workItems: item.workItems.map((workItem) =>
        workItem.id === workItemId ? updater(workItem) : workItem
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

  function selectWorkItem(workItemId: string | undefined) {
    setSelectedWorkItemIdByWorkspace((items) => ({
      ...items,
      [workspace.id]: workItemId
    }));
    setWorkCommentDraft("");
  }

  function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (!name) return;

    const createdWorkspace: Workspace = {
      id: createEntityId(name.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
      name,
      plan: "Standalone workspace",
      summary: "Ready for requests, roadmap, and changelog work.",
      requests: [],
      workItems: [],
      roadmap: {
        Now: [],
        Next: [],
        Later: []
      },
      changelog: [],
      integrations: integrationChips
    };

    dispatchOpenRoad({ type: "create-workspace", workspace: createdWorkspace });
    setWorkspaceId(createdWorkspace.id);
    setNewWorkspaceName("");
    setIsCreatingWorkspace(false);
    setIsAddingRequest(false);
    setIsAddingWorkItem(false);
    setIsAddingRoadmapItem(false);
    setNewWorkDraft(emptyWorkDraft);
    setNewRoadmapDraft(emptyRoadmapDraft);
    setWorkCommentDraft("");
    resetRequestFilters();
  }

  function addRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newRequestDraft.title.trim();
    if (!title) return;

    const createdRequest: RequestItem = {
      id: createEntityId("manual"),
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
      }),
      workItems: item.workItems.map((workItem) =>
        workItem.requestIds.includes(duplicate.id)
          ? {
              ...workItem,
              requestIds: Array.from(
                new Set(
                  workItem.requestIds.map((requestId) =>
                    requestId === duplicate.id ? selectedRequest.id : requestId
                  )
                )
              )
            }
          : workItem
      )
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
      id: createEntityId("comment"),
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

  function addWorkItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newWorkDraft.title.trim();
    if (!title) return;

    const requestIds =
      selectedRequest && newWorkDraft.linkSelectedRequest ? [selectedRequest.id] : [];
    const createdWorkItem: WorkItem = {
      id: createEntityId("work"),
      title,
      description: newWorkDraft.description.trim(),
      owner: newWorkDraft.owner,
      status: newWorkDraft.status,
      targetDate: newWorkDraft.targetDate,
      requestIds,
      comments: [],
      createdAt: "just now"
    };

    updateCurrentWorkspace((item) => ({
      ...item,
      workItems: [createdWorkItem, ...item.workItems]
    }));
    selectWorkItem(createdWorkItem.id);
    setNewWorkDraft({ ...emptyWorkDraft, linkSelectedRequest: Boolean(selectedRequest) });
    setIsAddingWorkItem(false);
  }

  function updateSelectedWorkItem(updater: (workItem: WorkItem) => WorkItem) {
    if (!selectedWorkItem) return;
    updateWorkItem(selectedWorkItem.id, updater);
  }

  function addWorkComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = workCommentDraft.trim();
    if (!selectedWorkItem || !body) return;

    const comment: WorkComment = {
      id: createEntityId("work-comment"),
      author: "Akhil",
      body,
      age: "just now"
    };

    updateWorkItem(selectedWorkItem.id, (workItem) => ({
      ...workItem,
      comments: [comment, ...workItem.comments]
    }));
    setWorkCommentDraft("");
  }

  function unlinkRequestFromWorkItem(workItemId: string, requestId: string) {
    updateWorkItem(workItemId, (workItem) => ({
      ...workItem,
      requestIds: workItem.requestIds.filter((item) => item !== requestId)
    }));
  }

  function startRoadmapItem() {
    setIsAddingRoadmapItem(true);
    setNewRoadmapDraft((draft) => ({
      ...draft,
      requestId: selectedRequest?.id ?? ""
    }));
  }

  function addRoadmapItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newRoadmapDraft.title.trim();
    if (!title) return;

    const createdRoadmapItem: RoadmapItem = {
      confidence: newRoadmapDraft.confidence,
      createdAt: "just now",
      id: createEntityId("roadmap"),
      isStale: newRoadmapDraft.isStale,
      lane: newRoadmapDraft.lane,
      requestIds: newRoadmapDraft.requestId ? [newRoadmapDraft.requestId] : [],
      summary: newRoadmapDraft.summary.trim(),
      title,
      updatedAt: "just now",
      visibility: newRoadmapDraft.visibility,
      workItemIds: newRoadmapDraft.workItemId ? [newRoadmapDraft.workItemId] : []
    };

    dispatchOpenRoad({
      roadmapItem: createdRoadmapItem,
      type: "create-roadmap-item",
      workspaceId: workspace.id
    });
    setIsAddingRoadmapItem(false);
    setNewRoadmapDraft(emptyRoadmapDraft);
  }

  function findRoadmapItem(roadmapItemId: string) {
    return roadmapItems.find((item) => item.id === roadmapItemId);
  }

  function updateRoadmapItem(
    roadmapItemId: string,
    updater: (roadmapItem: RoadmapItem) => RoadmapItem
  ) {
    const roadmapItem = findRoadmapItem(roadmapItemId);
    if (!roadmapItem) return;

    dispatchOpenRoad({
      roadmapItem: updater({ ...roadmapItem, updatedAt: "just now" }),
      type: "replace-roadmap-item",
      workspaceId: workspace.id
    });
  }

  function linkRequestToRoadmap(roadmapItemId: string, requestId: string) {
    if (!requestId) return;
    updateRoadmapItem(roadmapItemId, (roadmapItem) => ({
      ...roadmapItem,
      requestIds: Array.from(new Set([...roadmapItem.requestIds, requestId]))
    }));
  }

  function unlinkRequestFromRoadmap(roadmapItemId: string, requestId: string) {
    updateRoadmapItem(roadmapItemId, (roadmapItem) => ({
      ...roadmapItem,
      requestIds: roadmapItem.requestIds.filter((item) => item !== requestId)
    }));
  }

  function linkWorkItemToRoadmap(roadmapItemId: string, workItemId: string) {
    if (!workItemId) return;
    updateRoadmapItem(roadmapItemId, (roadmapItem) => ({
      ...roadmapItem,
      workItemIds: Array.from(new Set([...roadmapItem.workItemIds, workItemId]))
    }));
  }

  function unlinkWorkItemFromRoadmap(roadmapItemId: string, workItemId: string) {
    updateRoadmapItem(roadmapItemId, (roadmapItem) => ({
      ...roadmapItem,
      workItemIds: roadmapItem.workItemIds.filter((item) => item !== workItemId)
    }));
  }

  function removeRoadmapItem(roadmapItemId: string) {
    dispatchOpenRoad({
      roadmapItemId,
      type: "delete-roadmap-item",
      workspaceId: workspace.id
    });
  }

  function exportCurrentWorkspace() {
    setExportPreview(exportWorkspace(workspace));
    setPersistenceMessage("Workspace export is ready.");
  }

  function importWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const importedWorkspace = importWorkspaceFromJson(importDraft);
      const action = workspaceList.some((item) => item.id === importedWorkspace.id)
        ? "replace-workspace"
        : "create-workspace";

      dispatchOpenRoad({ type: action, workspace: importedWorkspace });
      setWorkspaceId(importedWorkspace.id);
      setImportDraft("");
      setExportPreview("");
      setPersistenceMessage(`Imported ${importedWorkspace.name}.`);
      resetRequestFilters();
    } catch (error) {
      setPersistenceMessage(
        error instanceof Error ? error.message : "Workspace import failed."
      );
    }
  }

  function resetDemoData() {
    const nextState = createInitialOpenRoadState();
    clearOpenRoadState();
    dispatchOpenRoad({ type: "replace-state", state: nextState });
    setWorkspaceId(nextState.workspaces[0].id);
    setPersistenceMessage("Demo data restored.");
    setExportPreview("");
    setImportDraft("");
    setIsCreatingWorkspace(false);
    setIsAddingRequest(false);
    setIsAddingWorkItem(false);
    setIsAddingRoadmapItem(false);
    setNewRoadmapDraft(emptyRoadmapDraft);
    resetRequestFilters();
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
                setIsAddingWorkItem(false);
                setIsAddingRoadmapItem(false);
                setCommentDraft("");
                setWorkCommentDraft("");
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
            <button
              aria-controls="work"
              className="secondary-action compact"
              onClick={() => {
                setIsAddingWorkItem((value) => !value);
                setNewWorkDraft((draft) => ({
                  ...draft,
                  linkSelectedRequest: Boolean(selectedRequest)
                }));
              }}
              type="button"
            >
              <ListChecks aria-hidden="true" size={14} />
              New work item
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
              <small>Work</small>
              <strong>{workItemCount}</strong>
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

                {selectedRequestWorkItems.length ? (
                  <div className="linked-work" aria-label="Linked work for selected request">
                    <div className="source-history-header">
                      <Link2 aria-hidden="true" size={14} />
                      <strong>Linked work</strong>
                    </div>
                    <div className="linked-work-list">
                      {selectedRequestWorkItems.map((workItem) => (
                        <article className="linked-work-item" key={workItem.id}>
                          <span className={`status-badge ${statusTone(workItem.status)}`}>
                            {workItem.status}
                          </span>
                          <strong>{workItem.title}</strong>
                          <small>
                            {workItem.owner}
                            {workItem.targetDate ? ` / Target ${workItem.targetDate}` : ""}
                          </small>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}

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

          </aside>

          {isAddingWorkItem || hasWorkItems ? (
            <section className="panel work-panel" id="work" aria-labelledby="work-title">
              <div className="panel-header">
                <div>
                  <span className="section-label">Work</span>
                  <h2 id="work-title">Internal delivery</h2>
                </div>
                <div className="panel-actions">
                  <span className="panel-count">
                    {workItemCount} {workItemCount === 1 ? "item" : "items"}
                  </span>
                  {!isAddingWorkItem ? (
                    <button
                      className="secondary-action compact"
                      onClick={() => {
                        setIsAddingWorkItem(true);
                        setNewWorkDraft((draft) => ({
                          ...draft,
                          linkSelectedRequest: Boolean(selectedRequest)
                        }));
                      }}
                      type="button"
                    >
                      <ListChecks aria-hidden="true" size={14} />
                      New work item
                    </button>
                  ) : null}
                </div>
              </div>

              {isAddingWorkItem ? (
                <form
                  aria-label="Create work item"
                  className="work-composer"
                  onSubmit={addWorkItem}
                >
                  <label>
                    <span>Work title</span>
                    <input
                      autoFocus
                      onChange={(event) =>
                        setNewWorkDraft((draft) => ({
                          ...draft,
                          title: event.target.value
                        }))
                      }
                      placeholder="e.g. Build usage meter"
                      value={newWorkDraft.title}
                    />
                  </label>
                  <label>
                    <span>Owner</span>
                    <select
                      aria-label="Work item owner"
                      onChange={(event) =>
                        setNewWorkDraft((draft) => ({
                          ...draft,
                          owner: event.target.value as RequestOwner
                        }))
                      }
                      value={newWorkDraft.owner}
                    >
                      {requestOwners.map((owner) => (
                        <option key={owner} value={owner}>
                          {owner}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      aria-label="Work item status"
                      onChange={(event) =>
                        setNewWorkDraft((draft) => ({
                          ...draft,
                          status: event.target.value as WorkStatus
                        }))
                      }
                      value={newWorkDraft.status}
                    >
                      {workStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Target date</span>
                    <input
                      aria-label="Work item target date"
                      onChange={(event) =>
                        setNewWorkDraft((draft) => ({
                          ...draft,
                          targetDate: event.target.value
                        }))
                      }
                      type="date"
                      value={newWorkDraft.targetDate}
                    />
                  </label>
                  <label className="wide-field">
                    <span>Description</span>
                    <textarea
                      onChange={(event) =>
                        setNewWorkDraft((draft) => ({
                          ...draft,
                          description: event.target.value
                        }))
                      }
                      placeholder="What needs to happen before this can ship?"
                      value={newWorkDraft.description}
                    />
                  </label>
                  <label className="check-field wide-field">
                    <input
                      checked={Boolean(selectedRequest) && newWorkDraft.linkSelectedRequest}
                      disabled={!selectedRequest}
                      onChange={(event) =>
                        setNewWorkDraft((draft) => ({
                          ...draft,
                          linkSelectedRequest: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      {selectedRequest
                        ? `Link selected request: ${selectedRequest.title}`
                        : "Link selected request"}
                    </span>
                  </label>
                  <div className="composer-actions wide-field">
                    <button className="primary-action" type="submit">
                      Create work item
                    </button>
                    <button
                      className="secondary-action"
                      onClick={() => {
                        setIsAddingWorkItem(false);
                        setNewWorkDraft({
                          ...emptyWorkDraft,
                          linkSelectedRequest: Boolean(selectedRequest)
                        });
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}

              <div className="work-layout">
                <div className="work-list" aria-label="Work items">
                  {workspace.workItems.length ? (
                    workspace.workItems.map((workItem, index) => (
                      <button
                        aria-pressed={selectedWorkItem?.id === workItem.id}
                        className={
                          selectedWorkItem?.id === workItem.id
                            ? "work-row active"
                            : "work-row"
                        }
                        key={workItem.id}
                        onClick={() => selectWorkItem(workItem.id)}
                        type="button"
                      >
                        <span className="route-node" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="work-main">
                          <strong>{workItem.title}</strong>
                          <small>
                            {workItem.owner} / {workItem.targetDate || "No target date"} /{" "}
                            {workItem.requestIds.length}{" "}
                            {workItem.requestIds.length === 1 ? "request" : "requests"}
                          </small>
                        </span>
                        <span className={`status-badge ${statusTone(workItem.status)}`}>
                          {workItem.status}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state compact-empty">
                      <strong>No work items yet</strong>
                      <p>Create one when a request is ready for delivery planning.</p>
                    </div>
                  )}
                </div>

                <aside className="work-detail" aria-label="Selected work item">
                  {selectedWorkItem ? (
                    <>
                      <div className="work-detail-head">
                        <div>
                          <span className="section-label">Selected work</span>
                          <h3>{selectedWorkItem.title}</h3>
                        </div>
                        <span className={`status-badge ${statusTone(selectedWorkItem.status)}`}>
                          {selectedWorkItem.status}
                        </span>
                      </div>

                      <p className="work-description">
                        {selectedWorkItem.description || "No delivery notes yet."}
                      </p>

                      <form
                        className="work-editor"
                        aria-label="Edit selected work item"
                        onSubmit={(event) => event.preventDefault()}
                      >
                        <label>
                          <span>Owner</span>
                          <select
                            aria-label="Selected work item owner"
                            onChange={(event) =>
                              updateSelectedWorkItem((workItem) => ({
                                ...workItem,
                                owner: event.target.value as RequestOwner
                              }))
                            }
                            value={selectedWorkItem.owner}
                          >
                            {requestOwners.map((owner) => (
                              <option key={owner} value={owner}>
                                {owner}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Status</span>
                          <select
                            aria-label="Selected work item status"
                            onChange={(event) =>
                              updateSelectedWorkItem((workItem) => ({
                                ...workItem,
                                status: event.target.value as WorkStatus
                              }))
                            }
                            value={selectedWorkItem.status}
                          >
                            {workStatuses.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Target date</span>
                          <input
                            aria-label="Selected work item target date"
                            onChange={(event) =>
                              updateSelectedWorkItem((workItem) => ({
                                ...workItem,
                                targetDate: event.target.value
                              }))
                            }
                            type="date"
                            value={selectedWorkItem.targetDate}
                          />
                        </label>
                      </form>

                      <div className="linked-requests" aria-label="Linked requests for selected work item">
                        <div className="source-history-header">
                          <Link2 aria-hidden="true" size={14} />
                          <strong>Request evidence</strong>
                        </div>
                        {selectedWorkItemRequests.length ? (
                          selectedWorkItemRequests.map((request) => (
                            <article className="linked-request-item" key={request.id}>
                              <div>
                                <strong>{request.title}</strong>
                                <small>
                                  {request.requester} / {request.source} / {request.votes} votes
                                </small>
                              </div>
                              <button
                                aria-label={`Unlink ${request.title}`}
                                className="secondary-action compact"
                                onClick={() =>
                                  unlinkRequestFromWorkItem(selectedWorkItem.id, request.id)
                                }
                                type="button"
                              >
                                <Unlink aria-hidden="true" size={13} />
                                Unlink
                              </button>
                            </article>
                          ))
                        ) : (
                          <div className="empty-state compact-empty">
                            <strong>No linked requests</strong>
                            <p>This work item can stay standalone or link to requests later.</p>
                          </div>
                        )}
                      </div>

                      <form
                        className="work-comment-form"
                        aria-label="Add work item comment"
                        onSubmit={addWorkComment}
                      >
                        <label>
                          <span>Work item comment</span>
                          <textarea
                            onChange={(event) => setWorkCommentDraft(event.target.value)}
                            placeholder="Add delivery notes, blockers, or acceptance context"
                            value={workCommentDraft}
                          />
                        </label>
                        <button className="secondary-action" type="submit">
                          <MessageCircle aria-hidden="true" size={14} />
                          Add work comment
                        </button>
                      </form>

                      <div className="work-comment-list" aria-label="Work item comments">
                        {selectedWorkItem.comments.length ? (
                          selectedWorkItem.comments.map((comment) => (
                            <article className="comment-item" key={comment.id}>
                              <strong>{comment.author}</strong>
                              <p>{comment.body}</p>
                              <small>{comment.age}</small>
                            </article>
                          ))
                        ) : (
                          <div className="empty-state compact-empty">
                            <strong>No work comments yet</strong>
                            <p>Add delivery context when implementation starts moving.</p>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state compact-empty">
                      <strong>Select work</strong>
                      <p>Internal delivery details and linked request evidence will appear here.</p>
                    </div>
                  )}
                </aside>
              </div>
            </section>
          ) : null}

          <section className="panel route-map-panel" id="roadmap" aria-labelledby="roadmap-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Roadmap</span>
                <h2 id="roadmap-title">Now / Next / Later</h2>
              </div>
              <div className="panel-actions">
                <span className="panel-count">
                  {roadmapItemCount} {roadmapItemCount === 1 ? "item" : "items"}
                </span>
                {!isAddingRoadmapItem ? (
                  <button className="secondary-action compact" onClick={startRoadmapItem} type="button">
                    <Waypoints aria-hidden="true" size={14} />
                    New roadmap item
                  </button>
                ) : null}
              </div>
            </div>

            {isAddingRoadmapItem ? (
              <form className="roadmap-form" aria-label="Create roadmap item" onSubmit={addRoadmapItem}>
                <label>
                  <span>Roadmap title</span>
                  <input
                    autoFocus
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({ ...draft, title: event.target.value }))
                    }
                    placeholder="e.g. Account-level usage exports"
                    value={newRoadmapDraft.title}
                  />
                </label>
                <label>
                  <span>Lane</span>
                  <select
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({
                        ...draft,
                        lane: event.target.value as RoadmapLane
                      }))
                    }
                    value={newRoadmapDraft.lane}
                  >
                    {roadmapLanes.map((lane) => (
                      <option key={lane} value={lane}>
                        {lane}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide-field">
                  <span>Summary</span>
                  <textarea
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({ ...draft, summary: event.target.value }))
                    }
                    placeholder="What should a reader understand about this direction?"
                    value={newRoadmapDraft.summary}
                  />
                </label>
                <label>
                  <span>Visibility</span>
                  <select
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({
                        ...draft,
                        visibility: event.target.value as RoadmapVisibility
                      }))
                    }
                    value={newRoadmapDraft.visibility}
                  >
                    {roadmapVisibilities.map((visibility) => (
                      <option key={visibility} value={visibility}>
                        {visibility}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Confidence</span>
                  <select
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({
                        ...draft,
                        confidence: event.target.value as RoadmapConfidence
                      }))
                    }
                    value={newRoadmapDraft.confidence}
                  >
                    {roadmapConfidenceLevels.map((confidence) => (
                      <option key={confidence} value={confidence}>
                        {confidence}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Linked request</span>
                  <select
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({ ...draft, requestId: event.target.value }))
                    }
                    value={newRoadmapDraft.requestId}
                  >
                    <option value="">No request link</option>
                    {workspace.requests.map((request) => (
                      <option key={request.id} value={request.id}>
                        {request.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Linked work</span>
                  <select
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({ ...draft, workItemId: event.target.value }))
                    }
                    value={newRoadmapDraft.workItemId}
                  >
                    <option value="">No work link</option>
                    {workspace.workItems.map((workItem) => (
                      <option key={workItem.id} value={workItem.id}>
                        {workItem.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check-field">
                  <input
                    checked={newRoadmapDraft.isStale}
                    onChange={(event) =>
                      setNewRoadmapDraft((draft) => ({ ...draft, isStale: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>Needs review</span>
                </label>
                <div className="composer-actions wide-field">
                  <button className="primary-action" type="submit">
                    Create roadmap item
                  </button>
                  <button
                    className="secondary-action"
                    onClick={() => {
                      setIsAddingRoadmapItem(false);
                      setNewRoadmapDraft(emptyRoadmapDraft);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {roadmapItemCount === 0 && !isAddingRoadmapItem ? (
              <div className="empty-state roadmap-empty">
                <strong>No roadmap items yet</strong>
                <p>Start with one clear direction, then link requests or work when evidence exists.</p>
                <button className="primary-action" onClick={startRoadmapItem} type="button">
                  <Plus aria-hidden="true" size={16} />
                  New roadmap item
                </button>
              </div>
            ) : null}

            <div className="roadmap-lanes">
              {roadmapLanes.map((lane) => (
                <div className="lane" key={lane}>
                  <strong>{lane}</strong>
                  <div className="roadmap-item-list">
                    {workspace.roadmap[lane].length ? (
                      workspace.roadmap[lane].map((item) => {
                        const linkedRequests = item.requestIds.flatMap((requestId) => {
                          const request = workspace.requests.find((entry) => entry.id === requestId);
                          return request ? [request] : [];
                        });
                        const linkedWorkItems = item.workItemIds.flatMap((workItemId) => {
                          const workItem = workspace.workItems.find((entry) => entry.id === workItemId);
                          return workItem ? [workItem] : [];
                        });
                        const requestChoices = workspace.requests.filter(
                          (request) => !item.requestIds.includes(request.id)
                        );
                        const workChoices = workspace.workItems.filter(
                          (workItem) => !item.workItemIds.includes(workItem.id)
                        );

                        return (
                          <article className="roadmap-item" key={item.id}>
                            <div className="roadmap-item-header">
                              <h3>{item.title}</h3>
                              <button
                                aria-label={`Remove ${item.title} from roadmap`}
                                className="icon-button"
                                onClick={() => removeRoadmapItem(item.id)}
                                type="button"
                              >
                                <Archive aria-hidden="true" size={14} />
                              </button>
                            </div>
                            <p>{item.summary || "No public wording drafted yet."}</p>
                            <div className="roadmap-badges" aria-label={`${item.title} roadmap state`}>
                              <span className={`status-badge ${item.visibility === "Public" ? "success" : "neutral"}`}>
                                {item.visibility}
                              </span>
                              <span className="status-badge info">{item.confidence} confidence</span>
                              {item.isStale ? (
                                <span className="status-badge warning">Needs review</span>
                              ) : null}
                            </div>
                            <div className="roadmap-controls">
                              <label>
                                <span>Lane</span>
                                <select
                                  aria-label={`Lane for ${item.title}`}
                                  onChange={(event) =>
                                    updateRoadmapItem(item.id, (roadmapItem) => ({
                                      ...roadmapItem,
                                      lane: event.target.value as RoadmapLane
                                    }))
                                  }
                                  value={item.lane}
                                >
                                  {roadmapLanes.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Visibility</span>
                                <select
                                  aria-label={`Visibility for ${item.title}`}
                                  onChange={(event) =>
                                    updateRoadmapItem(item.id, (roadmapItem) => ({
                                      ...roadmapItem,
                                      visibility: event.target.value as RoadmapVisibility
                                    }))
                                  }
                                  value={item.visibility}
                                >
                                  {roadmapVisibilities.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Confidence</span>
                                <select
                                  aria-label={`Confidence for ${item.title}`}
                                  onChange={(event) =>
                                    updateRoadmapItem(item.id, (roadmapItem) => ({
                                      ...roadmapItem,
                                      confidence: event.target.value as RoadmapConfidence
                                    }))
                                  }
                                  value={item.confidence}
                                >
                                  {roadmapConfidenceLevels.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="check-field">
                                <input
                                  aria-label={`Needs review for ${item.title}`}
                                  checked={item.isStale}
                                  onChange={(event) =>
                                    updateRoadmapItem(item.id, (roadmapItem) => ({
                                      ...roadmapItem,
                                      isStale: event.target.checked
                                    }))
                                  }
                                  type="checkbox"
                                />
                                <span>Needs review</span>
                              </label>
                            </div>
                            <div className="roadmap-links">
                              <div aria-label={`Requests linked to ${item.title}`}>
                                <strong>Requests</strong>
                                {linkedRequests.length ? (
                                  linkedRequests.map((request) => (
                                    <button
                                      className="link-pill"
                                      key={request.id}
                                      onClick={() => unlinkRequestFromRoadmap(item.id, request.id)}
                                      type="button"
                                    >
                                      {request.title}
                                      <Unlink aria-hidden="true" size={12} />
                                    </button>
                                  ))
                                ) : (
                                  <span>No requests linked</span>
                                )}
                                {requestChoices.length ? (
                                  <select
                                    aria-label={`Link request to ${item.title}`}
                                    onChange={(event) => linkRequestToRoadmap(item.id, event.target.value)}
                                    value=""
                                  >
                                    <option value="">Link request</option>
                                    {requestChoices.map((request) => (
                                      <option key={request.id} value={request.id}>
                                        {request.title}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                              </div>
                              <div aria-label={`Work linked to ${item.title}`}>
                                <strong>Work</strong>
                                {linkedWorkItems.length ? (
                                  linkedWorkItems.map((workItem) => (
                                    <button
                                      className="link-pill"
                                      key={workItem.id}
                                      onClick={() => unlinkWorkItemFromRoadmap(item.id, workItem.id)}
                                      type="button"
                                    >
                                      {workItem.title}
                                      <Unlink aria-hidden="true" size={12} />
                                    </button>
                                  ))
                                ) : (
                                  <span>No work linked</span>
                                )}
                                {workChoices.length ? (
                                  <select
                                    aria-label={`Link work to ${item.title}`}
                                    onChange={(event) => linkWorkItemToRoadmap(item.id, event.target.value)}
                                    value=""
                                  >
                                    <option value="">Link work</option>
                                    {workChoices.map((workItem) => (
                                      <option key={workItem.id} value={workItem.id}>
                                        {workItem.title}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="lane-empty">
                        <CircleDot aria-hidden="true" size={12} />
                        <span>Nothing placed yet</span>
                      </div>
                    )}
                  </div>
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

          <section className="panel settings-panel" id="settings" aria-labelledby="settings-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Settings</span>
                <h2 id="settings-title">Workspace data</h2>
              </div>
            </div>

            <div className="settings-grid">
              <section className="data-tools" aria-label="Workspace data tools">
                <div className="source-history-header">
                  <Settings aria-hidden="true" size={14} />
                  <strong>Local data</strong>
                </div>
                {persistenceMessage ? (
                  <p className="persistence-message" role="status">
                    {persistenceMessage}
                  </p>
                ) : null}
                <div className="data-tool-actions">
                  <button
                    className="secondary-action compact"
                    onClick={exportCurrentWorkspace}
                    type="button"
                  >
                    Export workspace
                  </button>
                  <button
                    className="secondary-action compact"
                    onClick={resetDemoData}
                    type="button"
                  >
                    Reset demo data
                  </button>
                </div>
                {exportPreview ? (
                  <label className="data-textarea">
                    <span>Workspace export JSON</span>
                    <textarea readOnly value={exportPreview} />
                  </label>
                ) : null}
                <form className="import-form" aria-label="Import workspace" onSubmit={importWorkspace}>
                  <label className="data-textarea">
                    <span>Workspace import JSON</span>
                    <textarea
                      onChange={(event) => setImportDraft(event.target.value)}
                      placeholder="Paste an OpenRoad workspace export"
                      value={importDraft}
                    />
                  </label>
                  <button
                    className="secondary-action compact"
                    disabled={!importDraft.trim()}
                    type="submit"
                  >
                    Import workspace
                  </button>
                </form>
              </section>

              <div className="integration-chips" aria-label="Optional integrations">
                {workspace.integrations.map((integration) => (
                  <span className="integration-chip" key={integration.label}>
                    <RadioTower aria-hidden="true" size={13} />
                    {integration.label}
                    <small>{integration.state}</small>
                  </span>
                ))}
              </div>
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
        <span>
          <ListChecks aria-hidden="true" size={14} />
          {workItemCount} {workItemCount === 1 ? "work item" : "work items"}
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
