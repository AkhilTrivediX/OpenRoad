import {
  Archive,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Command,
  Copy,
  GitMerge,
  Globe2,
  Inbox,
  KeyRound,
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
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  ThumbsUp,
  Unlink,
  UserPlus,
  Waypoints
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import {
  clearOpenRoadState,
  changelogStates,
  changelogVisibilities,
  createPublicPortalSnapshot,
  createEntityId,
  defaultNotificationSettings,
  defaultPortalSettings,
  createInitialOpenRoadState,
  exportWorkspace,
  importWorkspaceFromJson,
  integrationChips,
  loadOpenRoadState,
  loadSelectedWorkspaceId,
  openRoadReducer,
  roadmapConfidenceLevels,
  roadmapLanes,
  roadmapVisibilities,
  requestOwners,
  requestStatuses,
  requestVisibilities,
  resolveRequesterNotificationPreference,
  saveOpenRoadState,
  saveSelectedWorkspaceId,
  setRequesterNotificationPreference,
  workStatuses,
  type ChangelogItem,
  type ChangelogState,
  type ChangelogVisibility,
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
  type RequestVisibility,
  type WorkComment,
  type WorkItem,
  type Workspace,
  type WorkStatus
} from "./domain/openroad";
import {
  changelogSourceLabel,
  createChangelogSourceChoices,
  type ChangelogSourceChoice
} from "./app/openroadChangelog";
import { createAssistantTriageSuggestion } from "./app/openroadAssistant";
import {
  emptyChangelogDraft,
  emptyPortalCommentDraft,
  emptyRequestDraft,
  emptyRoadmapDraft,
  emptyWorkDraft,
  type ChangelogDraft,
  type PortalCommentDraft,
  type RequestDraft,
  type RoadmapDraft,
  type WorkDraft
} from "./app/openroadDrafts";
import {
  flattenRoadmap,
  parseTags,
  requestMatchesQuery,
  requestMatchesTriageView,
  resolveInitialWorkspaceId,
  statusTone,
  triageViews,
  type RequestArchiveFilter,
  type RequestStatusFilter,
  type TriageView
} from "./app/openroadViewModel";
import {
  acceptOpenRoadInvitationSession,
  isServerPersistenceEnabled,
  isOpenRoadServerAuthRequiredError,
  loginOpenRoadOwner,
  loadServerOpenRoadState,
  saveServerOpenRoadState,
  type ServerOpenRoadScope
} from "./persistence/openroadServer";
import {
  createStandaloneIntegrationStatus,
  loadWorkspaceIntegrationStatus,
  runProviderManualSync,
  type IntegrationProviderStatus,
  type WorkspaceIntegrationStatus
} from "./persistence/openroadIntegrations";
import {
  acceptWorkspaceInvitationToken,
  createStandaloneInvitationAccess,
  createWorkspaceInvitation,
  loadWorkspaceInvitations,
  revokeWorkspaceInvitation,
  type WorkspaceInvitationAccess,
  type WorkspaceRole as InvitationWorkspaceRole
} from "./persistence/openroadInvitations";

type NavItem = {
  label: "Inbox" | "Work" | "Roadmap" | "Changelog" | "Portal" | "Settings";
  count?: boolean;
  icon: typeof Inbox;
};

const baseNavItems: NavItem[] = [
  { label: "Inbox", count: true, icon: Inbox },
  { label: "Roadmap", icon: Waypoints },
  { label: "Changelog", icon: BookOpen },
  { label: "Portal", icon: Globe2 },
  { label: "Settings", icon: Settings }
];

const workNavItem: NavItem = { label: "Work", icon: ListChecks };
const navTargets = new Set(["inbox", "work", "roadmap", "changelog", "portal", "settings"]);
const invitationRoles: InvitationWorkspaceRole[] = ["Viewer", "Contributor", "Maintainer", "Owner"];

function getActiveNavTarget() {
  if (typeof window === "undefined") return "inbox";

  const target = window.location.hash.replace(/^#/, "").toLowerCase();
  return navTargets.has(target) ? target : "inbox";
}

export function App() {
  const [serverPersistenceEnabled] = useState(() => isServerPersistenceEnabled());
  const hasLoadedServerState = useRef(!serverPersistenceEnabled);
  const hasServerSaveFailed = useRef(false);
  const skipNextServerSave = useRef(false);
  const [loadResult] = useState(() => loadOpenRoadState());
  const [openRoadState, dispatchOpenRoad] = useReducer(
    openRoadReducer,
    loadResult.state
  );
  const workspaceList = openRoadState.workspaces as Workspace[];
  const [workspaceId, setWorkspaceId] = useState(() => {
    return resolveInitialWorkspaceId(loadResult.state, loadSelectedWorkspaceId());
  });
  const [persistenceMessage, setPersistenceMessage] = useState(
    loadResult.status === "recovered"
      ? loadResult.error ?? "Saved OpenRoad data could not be loaded. Demo data is active."
      : ""
  );
  const [serverAccessScope, setServerAccessScope] = useState<"local" | ServerOpenRoadScope>(
    "local"
  );
  const [ownerLoginState, setOwnerLoginState] = useState<"idle" | "required" | "submitting">("idle");
  const [ownerLoginToken, setOwnerLoginToken] = useState("");
  const [ownerLoginMessage, setOwnerLoginMessage] = useState("");
  const [memberLoginDraft, setMemberLoginDraft] = useState({ name: "", token: "" });
  const [memberLoginState, setMemberLoginState] = useState<"idle" | "submitting">("idle");
  const [memberLoginMessage, setMemberLoginMessage] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState<WorkspaceIntegrationStatus>(() =>
    createStandaloneIntegrationStatus(resolveInitialWorkspaceId(loadResult.state, loadSelectedWorkspaceId()))
  );
  const [integrationActionMessage, setIntegrationActionMessage] = useState("");
  const [syncingProvider, setSyncingProvider] = useState<"github" | "jira" | "linear" | undefined>();
  const [invitationAccess, setInvitationAccess] = useState<WorkspaceInvitationAccess>(() =>
    createStandaloneInvitationAccess(resolveInitialWorkspaceId(loadResult.state, loadSelectedWorkspaceId()))
  );
  const [invitationDraft, setInvitationDraft] = useState<{
    email: string;
    name: string;
    role: InvitationWorkspaceRole;
  }>({ email: "", name: "", role: "Viewer" });
  const [invitationActionMessage, setInvitationActionMessage] = useState("");
  const [invitationErrorMessage, setInvitationErrorMessage] = useState("");
  const [createdInvitationToken, setCreatedInvitationToken] = useState<{
    email: string;
    token: string;
  } | null>(null);
  const [isCreatingInvitation, setIsCreatingInvitation] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | undefined>();
  const [acceptTokenDraft, setAcceptTokenDraft] = useState({ name: "", token: "" });
  const [isAcceptingInvitation, setIsAcceptingInvitation] = useState(false);
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
  const [isAddingChangelogItem, setIsAddingChangelogItem] = useState(false);
  const [newChangelogDraft, setNewChangelogDraft] =
    useState<ChangelogDraft>(emptyChangelogDraft);
  const [requestQuery, setRequestQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>("All");
  const [archiveFilter, setArchiveFilter] = useState<RequestArchiveFilter>("active");
  const [triageView, setTriageView] = useState<TriageView>("all");
  const [commentDraft, setCommentDraft] = useState("");
  const [portalSearch, setPortalSearch] = useState("");
  const [portalCommentDraft, setPortalCommentDraft] =
    useState<PortalCommentDraft>(emptyPortalCommentDraft);
  const [workCommentDraft, setWorkCommentDraft] = useState("");
  const [isAssistantEnabled, setIsAssistantEnabled] = useState(true);
  const [activeNavTarget, setActiveNavTarget] = useState(() => getActiveNavTarget());
  const [duplicateMergeTargetId, setDuplicateMergeTargetId] = useState("");
  const [selectedRequestIdByWorkspace, setSelectedRequestIdByWorkspace] = useState<
    Record<string, string | undefined>
  >({});
  const [selectedWorkItemIdByWorkspace, setSelectedWorkItemIdByWorkspace] = useState<
    Record<string, string | undefined>
  >({});
  const [selectedRoadmapItemIdByWorkspace, setSelectedRoadmapItemIdByWorkspace] =
    useState<Record<string, string | undefined>>({});
  const [selectedChangelogItemIdByWorkspace, setSelectedChangelogItemIdByWorkspace] =
    useState<Record<string, string | undefined>>({});
  const [selectedPortalRequestIdByWorkspace, setSelectedPortalRequestIdByWorkspace] =
    useState<Record<string, string | undefined>>({});
  const workspace = useMemo(
    () => workspaceList.find((item) => item.id === workspaceId) ?? workspaceList[0],
    [workspaceId, workspaceList]
  );
  const isServerMemberSession =
    serverPersistenceEnabled && serverAccessScope === "workspace-member";

  function applyServerLoadResult(result: Awaited<ReturnType<typeof loadServerOpenRoadState>>) {
    hasLoadedServerState.current = true;
    hasServerSaveFailed.current = false;
    skipNextServerSave.current = true;
    setServerAccessScope(result.serverScope);
    dispatchOpenRoad({ type: "replace-state", state: result.state });
    setWorkspaceId((currentWorkspaceId) =>
      result.state.workspaces.some((item) => item.id === currentWorkspaceId)
        ? currentWorkspaceId
        : result.state.workspaces[0]?.id ?? currentWorkspaceId
    );
    setOwnerLoginState("idle");
    setOwnerLoginMessage("");
    setMemberLoginMessage("");
    setPersistenceMessage(
      result.serverScope === "workspace-member"
        ? "Member workspace connected."
        : result.status === "recovered"
        ? result.error ?? "Server data was recovered. Seed data is active."
        : "Server storage connected."
    );
  }

  async function signInOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const adminToken = ownerLoginToken.trim();
    if (!adminToken || ownerLoginState === "submitting") return;

    setOwnerLoginState("submitting");
    setOwnerLoginMessage("");

    try {
      await loginOpenRoadOwner(adminToken);
      const result = await loadServerOpenRoadState();
      applyServerLoadResult(result);
      setOwnerLoginToken("");
    } catch (error) {
      setOwnerLoginState("required");
      setOwnerLoginMessage(
        isOpenRoadServerAuthRequiredError(error)
          ? "Token was not accepted. Check the server admin token and try again."
          : "OpenRoad could not complete sign-in. Check the server and try again."
      );
    }
  }

  async function signInWithInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const token = memberLoginDraft.token.trim();
    if (!token || memberLoginState === "submitting") return;

    setMemberLoginState("submitting");
    setMemberLoginMessage("");
    setOwnerLoginMessage("");

    try {
      await acceptOpenRoadInvitationSession(token, memberLoginDraft.name.trim());
      const result = await loadServerOpenRoadState();
      applyServerLoadResult(result);
      setMemberLoginDraft({ name: "", token: "" });
    } catch (error) {
      setMemberLoginMessage(
        error instanceof Error
          ? error.message
          : "OpenRoad could not accept this invitation. Check the token and try again."
      );
    } finally {
      setMemberLoginState("idle");
    }
  }

  useEffect(() => {
    try {
      saveOpenRoadState(openRoadState as OpenRoadState);
    } catch {
      setPersistenceMessage("OpenRoad could not save local workspace data.");
    }

    if (
      !serverPersistenceEnabled ||
      !hasLoadedServerState.current ||
      hasServerSaveFailed.current
    ) {
      return;
    }

    if (skipNextServerSave.current) {
      skipNextServerSave.current = false;
      return;
    }

    let isCancelled = false;

    saveServerOpenRoadState(openRoadState as OpenRoadState).catch(() => {
      if (isCancelled) return;
      hasServerSaveFailed.current = true;
      setPersistenceMessage(
        "OpenRoad could not save server workspace data. Local browser data is active."
      );
    });

    return () => {
      isCancelled = true;
    };
  }, [openRoadState, serverPersistenceEnabled]);
  useEffect(() => {
    if (!serverPersistenceEnabled) return;

    let isCancelled = false;

    loadServerOpenRoadState()
      .then((result) => {
        if (isCancelled) return;
        applyServerLoadResult(result);
      })
      .catch((error) => {
        if (isCancelled) return;

        if (isOpenRoadServerAuthRequiredError(error)) {
          setOwnerLoginState("required");
          setOwnerLoginMessage("");
          setPersistenceMessage("");
          return;
        }

        hasLoadedServerState.current = true;
        hasServerSaveFailed.current = true;
        setServerAccessScope("local");
        setPersistenceMessage("Server storage is unavailable. Local browser data is active.");
      });

    return () => {
      isCancelled = true;
    };
  }, [serverPersistenceEnabled]);
  useEffect(() => {
    let isCancelled = false;

    setIntegrationActionMessage("");

    if (!serverPersistenceEnabled) {
      setIntegrationStatus(createStandaloneIntegrationStatus(workspaceId));
      return;
    }

    if (ownerLoginState !== "idle") {
      setIntegrationStatus(createStandaloneIntegrationStatus(workspaceId));
      return;
    }

    loadWorkspaceIntegrationStatus(workspaceId).then((status) => {
      if (isCancelled) return;
      setIntegrationStatus(status);
    });

    return () => {
      isCancelled = true;
    };
  }, [ownerLoginState, serverPersistenceEnabled, workspaceId]);
  useEffect(() => {
    let isCancelled = false;

    setInvitationActionMessage("");
    setInvitationErrorMessage("");
    setCreatedInvitationToken(null);

    if (!serverPersistenceEnabled) {
      setInvitationAccess(createStandaloneInvitationAccess(workspaceId));
      return;
    }

    if (ownerLoginState !== "idle") {
      setInvitationAccess(
        createStandaloneInvitationAccess(
          workspaceId,
          "Team invitations require an owner session before they can be managed."
        )
      );
      return;
    }

    loadWorkspaceInvitations(workspaceId).then((access) => {
      if (isCancelled) return;
      setInvitationAccess(access);
    });

    return () => {
      isCancelled = true;
    };
  }, [ownerLoginState, serverPersistenceEnabled, workspaceId]);
  useEffect(() => {
    saveSelectedWorkspaceId(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    function syncActiveNavTarget() {
      setActiveNavTarget(getActiveNavTarget());
    }

    window.addEventListener("hashchange", syncActiveNavTarget);
    syncActiveNavTarget();

    return () => {
      window.removeEventListener("hashchange", syncActiveNavTarget);
    };
  }, []);

  useEffect(() => {
    document
      .getElementById(activeNavTarget)
      ?.scrollIntoView?.({ block: "start", inline: "nearest" });
  }, [activeNavTarget]);

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
  const selectedRequestNotificationPreference = useMemo(
    () =>
      selectedRequest
        ? resolveRequesterNotificationPreference(workspace.notifications, selectedRequest)
        : null,
    [selectedRequest, workspace.notifications]
  );
  const selectedRequestNotifications = useMemo(
    () =>
      selectedRequest
        ? workspace.notifications.outbox
            .filter((event) => event.requestId === selectedRequest.id)
            .slice(0, 4)
        : [],
    [selectedRequest, workspace.notifications.outbox]
  );
  const selectedAssistantSuggestion = useMemo(
    () =>
      selectedRequest && isAssistantEnabled
        ? createAssistantTriageSuggestion(workspace, selectedRequest, roadmapItems)
        : null,
    [isAssistantEnabled, roadmapItems, selectedRequest, workspace]
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
  const selectedRoadmapItem = useMemo(() => {
    const selectedRoadmapItemId = selectedRoadmapItemIdByWorkspace[workspace.id];
    return (
      roadmapItems.find((roadmapItem) => roadmapItem.id === selectedRoadmapItemId) ??
      roadmapItems[0] ??
      null
    );
  }, [roadmapItems, selectedRoadmapItemIdByWorkspace, workspace.id]);
  const selectedRoadmapRequests = useMemo(
    () =>
      selectedRoadmapItem
        ? selectedRoadmapItem.requestIds.flatMap((requestId) => {
            const request = workspace.requests.find((item) => item.id === requestId);
            return request ? [request] : [];
          })
        : [],
    [selectedRoadmapItem, workspace.requests]
  );
  const selectedRoadmapWorkItems = useMemo(
    () =>
      selectedRoadmapItem
        ? selectedRoadmapItem.workItemIds.flatMap((workItemId) => {
            const workItem = workspace.workItems.find((item) => item.id === workItemId);
            return workItem ? [workItem] : [];
          })
        : [],
    [selectedRoadmapItem, workspace.workItems]
  );
  const selectedRoadmapRequestChoices = useMemo(
    () =>
      selectedRoadmapItem
        ? workspace.requests.filter(
            (request) => !selectedRoadmapItem.requestIds.includes(request.id)
          )
        : [],
    [selectedRoadmapItem, workspace.requests]
  );
  const selectedRoadmapWorkChoices = useMemo(
    () =>
      selectedRoadmapItem
        ? workspace.workItems.filter(
            (workItem) => !selectedRoadmapItem.workItemIds.includes(workItem.id)
          )
        : [],
    [selectedRoadmapItem, workspace.workItems]
  );
  const changelogSourceChoices = useMemo<ChangelogSourceChoice[]>(
    () => createChangelogSourceChoices(workspace.workItems, roadmapItems),
    [roadmapItems, workspace.workItems]
  );
  const selectedChangelogItem = useMemo(() => {
    const selectedChangelogItemId = selectedChangelogItemIdByWorkspace[workspace.id];
    return (
      workspace.changelog.find((changelogItem) => changelogItem.id === selectedChangelogItemId) ??
      workspace.changelog[0] ??
      null
    );
  }, [selectedChangelogItemIdByWorkspace, workspace.changelog, workspace.id]);
  const selectedChangelogRequests = useMemo(
    () =>
      selectedChangelogItem
        ? selectedChangelogItem.requestIds.flatMap((requestId) => {
            const request = workspace.requests.find((item) => item.id === requestId);
            return request ? [request] : [];
          })
        : [],
    [selectedChangelogItem, workspace.requests]
  );
  const selectedChangelogRequestChoices = useMemo(
    () =>
      selectedChangelogItem
        ? workspace.requests.filter(
            (request) => !selectedChangelogItem.requestIds.includes(request.id)
          )
        : [],
    [selectedChangelogItem, workspace.requests]
  );
  const portalSnapshot = useMemo(
    () => createPublicPortalSnapshot(workspace, portalSearch),
    [portalSearch, workspace]
  );
  const selectedPortalRequest = useMemo(() => {
    const selectedPortalRequestId = selectedPortalRequestIdByWorkspace[workspace.id];
    return (
      portalSnapshot.requests.find((request) => request.id === selectedPortalRequestId) ??
      portalSnapshot.requests[0] ??
      null
    );
  }, [portalSnapshot.requests, selectedPortalRequestIdByWorkspace, workspace.id]);
  const selectedPortalSourceRequest = useMemo(
    () =>
      selectedPortalRequest
        ? workspace.requests.find((request) => request.id === selectedPortalRequest.id) ?? null
        : null,
    [selectedPortalRequest, workspace.requests]
  );
  const selectedPortalModerationComments = useMemo(
    () =>
      selectedPortalSourceRequest
        ? selectedPortalSourceRequest.comments.filter(
            (comment) => comment.visibility === "Public" || comment.visibility === "Hidden"
          )
        : [],
    [selectedPortalSourceRequest]
  );

  function updateCurrentWorkspace(updater: (workspace: Workspace) => Workspace) {
    dispatchOpenRoad({
      type: "replace-workspace",
      workspace: updater(workspace)
    });
  }

  function updateRequest(requestId: string, updater: (request: RequestItem) => RequestItem) {
    const request = workspace.requests.find((item) => item.id === requestId);
    if (!request) return;

    dispatchOpenRoad({
      request: updater(request),
      type: "replace-request",
      workspaceId: workspace.id
    });
  }

  function updatePortalSettings(updater: (portal: Workspace["portal"]) => Workspace["portal"]) {
    dispatchOpenRoad({
      portal: updater(workspace.portal),
      type: "replace-portal-settings",
      workspaceId: workspace.id
    });
  }

  async function syncProviderLinkedIssues(provider: IntegrationProviderStatus) {
    if (provider.provider !== "github" && provider.provider !== "jira" && provider.provider !== "linear") {
      return;
    }
    const installationId = provider.accounts[0]?.id;
    if (!installationId || syncingProvider) return;

    setSyncingProvider(provider.provider);
    setIntegrationActionMessage(`Queueing ${provider.label} linked issue sync...`);

    try {
      const result = await runProviderManualSync(provider.provider, workspace.id, installationId);
      setIntegrationActionMessage(result.message);

      if (serverPersistenceEnabled) {
        const [status, serverState] = await Promise.all([
          loadWorkspaceIntegrationStatus(workspace.id),
          loadServerOpenRoadState().catch(() => undefined)
        ]);
        setIntegrationStatus(status);

        if (serverState) {
          skipNextServerSave.current = true;
          dispatchOpenRoad({ type: "replace-state", state: serverState.state });
        }
      }
    } finally {
      setSyncingProvider(undefined);
    }
  }

  async function refreshWorkspaceInvitations() {
    if (!serverPersistenceEnabled) {
      setInvitationAccess(createStandaloneInvitationAccess(workspace.id));
      return;
    }

    const access = await loadWorkspaceInvitations(workspace.id);
    setInvitationAccess(access);
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreatingInvitation) return;

    const email = invitationDraft.email.trim();
    if (!email) {
      setInvitationErrorMessage("Email is required before creating an invitation.");
      return;
    }

    setIsCreatingInvitation(true);
    setInvitationActionMessage("");
    setInvitationErrorMessage("");
    setCreatedInvitationToken(null);

    try {
      const result = await createWorkspaceInvitation(workspace.id, {
        email,
        name: invitationDraft.name,
        role: invitationDraft.role
      });

      if (result.status !== "created" || !result.invitation || !result.acceptToken) {
        setInvitationErrorMessage(result.message);
        return;
      }

      setInvitationDraft({ email: "", name: "", role: "Viewer" });
      setCreatedInvitationToken({
        email: result.invitation.email,
        token: result.acceptToken
      });
      setInvitationActionMessage(result.message);
      await refreshWorkspaceInvitations();
    } finally {
      setIsCreatingInvitation(false);
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (revokingInvitationId) return;

    setRevokingInvitationId(invitationId);
    setInvitationActionMessage("");
    setInvitationErrorMessage("");

    try {
      const result = await revokeWorkspaceInvitation(workspace.id, invitationId);

      if (result.status !== "revoked") {
        setInvitationErrorMessage(result.message);
        return;
      }

      setInvitationActionMessage(result.message);
      setCreatedInvitationToken(null);
      await refreshWorkspaceInvitations();
    } finally {
      setRevokingInvitationId(undefined);
    }
  }

  async function acceptInvitationToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const token = acceptTokenDraft.token.trim();
    if (!token || isAcceptingInvitation) return;

    setIsAcceptingInvitation(true);
    setInvitationActionMessage("");
    setInvitationErrorMessage("");

    try {
      const result = await acceptWorkspaceInvitationToken(token, acceptTokenDraft.name);

      if (result.status !== "accepted") {
        setInvitationErrorMessage(result.message);
        return;
      }

      setAcceptTokenDraft({ name: "", token: "" });
      setInvitationActionMessage(result.message);
      await refreshWorkspaceInvitations();
    } finally {
      setIsAcceptingInvitation(false);
    }
  }

  async function copyCreatedInvitationToken() {
    if (!createdInvitationToken) return;

    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable.");
      }

      await navigator.clipboard.writeText(createdInvitationToken.token);
      setInvitationActionMessage("Invitation token copied.");
    } catch {
      setInvitationActionMessage("Select the token field to copy it.");
    }
  }

  function updateSelectedRequestNotificationPreference(
    key: "changelogUpdates" | "statusUpdates",
    enabled: boolean
  ) {
    if (!selectedRequest || !selectedRequestNotificationPreference) return;

    dispatchOpenRoad({
      type: "replace-workspace",
      workspace: setRequesterNotificationPreference(
        workspace,
        selectedRequest,
        {
          changelogUpdates:
            key === "changelogUpdates"
              ? enabled
              : selectedRequestNotificationPreference.changelogUpdates,
          statusUpdates:
            key === "statusUpdates"
              ? enabled
              : selectedRequestNotificationPreference.statusUpdates
        },
        new Date().toISOString()
      )
    });
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

  function selectRoadmapItem(roadmapItemId: string | undefined) {
    setSelectedRoadmapItemIdByWorkspace((items) => ({
      ...items,
      [workspace.id]: roadmapItemId
    }));
  }

  function selectChangelogItem(changelogItemId: string | undefined) {
    setSelectedChangelogItemIdByWorkspace((items) => ({
      ...items,
      [workspace.id]: changelogItemId
    }));
  }

  function selectPortalRequest(requestId: string | undefined) {
    setSelectedPortalRequestIdByWorkspace((items) => ({
      ...items,
      [workspace.id]: requestId
    }));
    setPortalCommentDraft(emptyPortalCommentDraft);
  }

  function getChangelogSourceChoice(sourceKey: string) {
    return (
      changelogSourceChoices.find((choice) => choice.sourceKey === sourceKey) ??
      changelogSourceChoices[0]
    );
  }

  function applyChangelogSource(sourceKey: string) {
    const sourceChoice = getChangelogSourceChoice(sourceKey);
    setNewChangelogDraft((draft) => ({
      ...draft,
      privateNotes: sourceChoice.privateNotes,
      publicSummary: sourceChoice.publicSummary,
      requestIds: sourceChoice.requestIds,
      roadmapItemIds: sourceChoice.roadmapItemIds,
      sourceKey: sourceChoice.sourceKey,
      sourceType: sourceChoice.sourceType,
      title: sourceChoice.title,
      workItemIds: sourceChoice.workItemIds
    }));
  }

  function createAssistantChangelogDraft() {
    if (!selectedAssistantSuggestion) return;

    const suggestion = selectedAssistantSuggestion.changelogSuggestion;
    const sourceId =
      suggestion.sourceKey === "manual"
        ? ""
        : suggestion.sourceKey.split(":").slice(1).join(":");
    const createdChangelogItem: ChangelogItem = {
      createdAt: "just now",
      id: createEntityId("changelog"),
      privateNotes: suggestion.privateNotes,
      publicSummary: suggestion.publicSummary,
      requestIds: Array.from(new Set(suggestion.requestIds)),
      roadmapItemIds: Array.from(new Set(suggestion.roadmapItemIds)),
      sourceId,
      sourceType: suggestion.sourceType,
      state: "Draft",
      title: suggestion.title,
      updatedAt: "just now",
      visibility: "Private",
      workItemIds: Array.from(new Set(suggestion.workItemIds))
    };

    dispatchOpenRoad({
      changelogItem: createdChangelogItem,
      type: "create-changelog-item",
      workspaceId: workspace.id
    });
    setIsAddingChangelogItem(false);
    setNewChangelogDraft(emptyChangelogDraft);
    selectChangelogItem(createdChangelogItem.id);
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
      portal: {
        ...defaultPortalSettings,
        headline: `${name} public board`,
        intro: "Share visible requests, roadmap direction, and release updates from this workspace."
      },
      notifications: defaultNotificationSettings,
      integrations: integrationChips
    };

    dispatchOpenRoad({ type: "create-workspace", workspace: createdWorkspace });
    setWorkspaceId(createdWorkspace.id);
    setNewWorkspaceName("");
    setIsCreatingWorkspace(false);
    setIsAddingRequest(false);
    setIsAddingWorkItem(false);
    setIsAddingRoadmapItem(false);
    setIsAddingChangelogItem(false);
    setNewWorkDraft(emptyWorkDraft);
    setNewRoadmapDraft(emptyRoadmapDraft);
    setNewChangelogDraft(emptyChangelogDraft);
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
      publicVoterKeys: [],
      status: "New",
      owner: "Unassigned",
      visibility: newRequestDraft.visibility,
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
            publicVoterKeys: Array.from(
              new Set([...request.publicVoterKeys, ...duplicate.publicVoterKeys])
            ),
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
      age: "just now",
      visibility: "Internal"
    };

    updateRequest(selectedRequest.id, (request) => ({
      ...request,
      comments: [comment, ...request.comments]
    }));
    setCommentDraft("");
  }

  function togglePortalVote(requestId: string) {
    if (!workspace.portal.allowVoting) return;
    updateRequest(requestId, (request) => ({
      ...request,
      hasCurrentUserVote: !request.hasCurrentUserVote,
      votes: request.hasCurrentUserVote
        ? Math.max(0, request.votes - 1)
        : request.votes + 1
    }));
  }

  function addPortalComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.portal.allowComments || !selectedPortalRequest) return;
    const body = portalCommentDraft.body.trim();
    if (!body) return;

    const comment: RequestComment = {
      age: "just now",
      author: portalCommentDraft.author.trim() || "Portal visitor",
      body,
      id: createEntityId("portal-comment"),
      visibility: "Public"
    };

    updateRequest(selectedPortalRequest.id, (request) => ({
      ...request,
      comments: [comment, ...request.comments]
    }));
    setPortalCommentDraft(emptyPortalCommentDraft);
    selectPortalRequest(selectedPortalRequest.id);
  }

  function setPortalCommentVisibility(
    requestId: string,
    commentId: string,
    visibility: RequestComment["visibility"]
  ) {
    updateRequest(requestId, (request) => ({
      ...request,
      comments: request.comments.map((comment) =>
        comment.id === commentId ? { ...comment, visibility } : comment
      )
    }));
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
    selectRoadmapItem(createdRoadmapItem.id);
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
    const nextRoadmapItem = roadmapItems.find((item) => item.id !== roadmapItemId);
    dispatchOpenRoad({
      roadmapItemId,
      type: "delete-roadmap-item",
      workspaceId: workspace.id
    });
    if (selectedRoadmapItem?.id === roadmapItemId) {
      selectRoadmapItem(nextRoadmapItem?.id);
    }
  }

  function startChangelogItem() {
    setIsAddingChangelogItem(true);
    setNewChangelogDraft(emptyChangelogDraft);
  }

  function addChangelogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newChangelogDraft.title.trim();
    if (!title) return;

    const sourceId =
      newChangelogDraft.sourceKey === "manual"
        ? ""
        : newChangelogDraft.sourceKey.split(":").slice(1).join(":");
    const createdChangelogItem: ChangelogItem = {
      createdAt: "just now",
      id: createEntityId("changelog"),
      privateNotes: newChangelogDraft.privateNotes.trim(),
      publicSummary: newChangelogDraft.publicSummary.trim(),
      requestIds: Array.from(new Set(newChangelogDraft.requestIds)),
      roadmapItemIds: Array.from(new Set(newChangelogDraft.roadmapItemIds)),
      sourceId,
      sourceType: newChangelogDraft.sourceType,
      state: newChangelogDraft.state,
      title,
      updatedAt: "just now",
      visibility: newChangelogDraft.visibility,
      workItemIds: Array.from(new Set(newChangelogDraft.workItemIds))
    };

    dispatchOpenRoad({
      changelogItem: createdChangelogItem,
      type: "create-changelog-item",
      workspaceId: workspace.id
    });
    setIsAddingChangelogItem(false);
    setNewChangelogDraft(emptyChangelogDraft);
    selectChangelogItem(createdChangelogItem.id);
  }

  function updateChangelogItem(
    changelogItemId: string,
    updater: (changelogItem: ChangelogItem) => ChangelogItem
  ) {
    const changelogItem = workspace.changelog.find((item) => item.id === changelogItemId);
    if (!changelogItem) return;

    dispatchOpenRoad({
      changelogItem: updater({ ...changelogItem, updatedAt: "just now" }),
      type: "replace-changelog-item",
      workspaceId: workspace.id
    });
  }

  function linkRequestToChangelog(changelogItemId: string, requestId: string) {
    if (!requestId) return;
    updateChangelogItem(changelogItemId, (changelogItem) => ({
      ...changelogItem,
      requestIds: Array.from(new Set([...changelogItem.requestIds, requestId]))
    }));
  }

  function unlinkRequestFromChangelog(changelogItemId: string, requestId: string) {
    updateChangelogItem(changelogItemId, (changelogItem) => ({
      ...changelogItem,
      requestIds: changelogItem.requestIds.filter((item) => item !== requestId)
    }));
  }

  function removeChangelogItem(changelogItemId: string) {
    const nextChangelogItem = workspace.changelog.find((item) => item.id !== changelogItemId);
    dispatchOpenRoad({
      changelogItemId,
      type: "delete-changelog-item",
      workspaceId: workspace.id
    });
    if (selectedChangelogItem?.id === changelogItemId) {
      selectChangelogItem(nextChangelogItem?.id);
    }
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
      setIsAddingChangelogItem(false);
      setNewChangelogDraft(emptyChangelogDraft);
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
    setIsAddingChangelogItem(false);
    setNewRoadmapDraft(emptyRoadmapDraft);
    setNewChangelogDraft(emptyChangelogDraft);
    resetRequestFilters();
  }

  if (serverPersistenceEnabled && ownerLoginState !== "idle") {
    const isSigningIn = ownerLoginState === "submitting";
    const isJoiningWorkspace = memberLoginState === "submitting";

    return (
      <main className="app-shell owner-auth-shell" aria-label="OpenRoad owner sign-in">
        <aside className="route-index owner-auth-rail" aria-label="OpenRoad identity">
          <div className="brand" aria-label="OpenRoad">
            <span className="brand-mark" aria-hidden="true">
              <RouteGlyph />
            </span>
            <span className="brand-copy">
              <strong>OpenRoad</strong>
              <small>route room</small>
            </span>
          </div>
          <div className="owner-auth-rail-copy">
            <span className="section-label">Server access</span>
            <strong>Session required</strong>
            <p>Use an owner token or a workspace invitation to enter this deployment.</p>
          </div>
        </aside>

        <section className="owner-auth-deck" aria-labelledby="owner-auth-title">
          <form
            aria-label="Create owner session"
            className="owner-auth-panel"
            onSubmit={signInOwner}
          >
            <div className="owner-auth-heading">
              <span className="owner-auth-icon" aria-hidden="true">
                <KeyRound size={18} strokeWidth={1.8} />
              </span>
              <div>
                <span className="section-label">OpenRoad server</span>
                <h1 id="owner-auth-title">Sign in to continue</h1>
              </div>
            </div>

            <p>
              Enter the server admin token once. OpenRoad will create an httpOnly session cookie
              and then load the shared workspace.
            </p>

            <label className="owner-token-field">
              <span>Admin token</span>
              <input
                autoComplete="current-password"
                autoFocus
                disabled={isSigningIn}
                onChange={(event) => setOwnerLoginToken(event.target.value)}
                type="password"
                value={ownerLoginToken}
              />
            </label>

            {ownerLoginMessage ? (
              <p className="owner-auth-message" role="alert">
                {ownerLoginMessage}
              </p>
            ) : null}

            <div className="owner-auth-actions">
              <button className="primary-action" disabled={!ownerLoginToken.trim() || isSigningIn} type="submit">
                <KeyRound aria-hidden="true" size={15} />
                {isSigningIn ? "Signing in..." : "Create owner session"}
              </button>
            </div>
          </form>

          <form
            aria-label="Join invited workspace"
            className="owner-auth-panel member-auth-panel"
            onSubmit={signInWithInvitation}
          >
            <div className="owner-auth-heading">
              <span className="owner-auth-icon" aria-hidden="true">
                <UserPlus size={18} strokeWidth={1.8} />
              </span>
              <div>
                <span className="section-label">Workspace invite</span>
                <h2>Join as a member</h2>
              </div>
            </div>

            <p>
              Paste the invitation token from the workspace owner. OpenRoad will create a
              scoped member session for the invited workspace only.
            </p>

            <label className="owner-token-field">
              <span>Invitation token</span>
              <input
                autoComplete="one-time-code"
                disabled={isJoiningWorkspace}
                onChange={(event) =>
                  setMemberLoginDraft((draft) => ({ ...draft, token: event.target.value }))
                }
                type="password"
                value={memberLoginDraft.token}
              />
            </label>

            <label className="owner-token-field">
              <span>Name</span>
              <input
                autoComplete="name"
                disabled={isJoiningWorkspace}
                onChange={(event) =>
                  setMemberLoginDraft((draft) => ({ ...draft, name: event.target.value }))
                }
                placeholder="Optional"
                value={memberLoginDraft.name}
              />
            </label>

            {memberLoginMessage ? (
              <p className="owner-auth-message" role="alert">
                {memberLoginMessage}
              </p>
            ) : null}

            <div className="owner-auth-actions">
              <button
                className="secondary-action"
                disabled={!memberLoginDraft.token.trim() || isJoiningWorkspace}
                type="submit"
              >
                <UserPlus aria-hidden="true" size={15} />
                {isJoiningWorkspace ? "Joining..." : "Join workspace"}
              </button>
            </div>
          </form>
        </section>
      </main>
    );
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
            const target = item.label.toLowerCase();
            const isActive = activeNavTarget === target;
            return (
              <a
                aria-current={isActive ? "page" : undefined}
                className={isActive ? "nav-item active" : "nav-item"}
                href={`#${target}`}
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
                setIsAddingChangelogItem(false);
                setCommentDraft("");
                setWorkCommentDraft("");
                setNewChangelogDraft(emptyChangelogDraft);
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
              disabled={isServerMemberSession}
              onClick={() => setIsCreatingWorkspace((value) => !value)}
              title={
                isServerMemberSession
                  ? "Member sessions are scoped to invited workspaces."
                  : undefined
              }
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

        <section className="brief-plate" id="overview" aria-label="Standalone workflow">
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
              <span>Visibility</span>
              <select
                aria-label="Request visibility"
                onChange={(event) =>
                  setNewRequestDraft((draft) => ({
                    ...draft,
                    visibility: event.target.value as RequestVisibility
                  }))
                }
                value={newRequestDraft.visibility}
              >
                {requestVisibilities.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {visibility}
                  </option>
                ))}
              </select>
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
                    <span>Visibility</span>
                    <select
                      aria-label="Selected request visibility"
                      onChange={(event) =>
                        updateSelectedRequest((request) => ({
                          ...request,
                          visibility: event.target.value as RequestVisibility
                        }))
                      }
                      value={selectedRequest.visibility}
                    >
                      {requestVisibilities.map((visibility) => (
                        <option key={visibility} value={visibility}>
                          {visibility}
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
                    <dt>Portal</dt>
                    <dd>{selectedRequest.visibility}</dd>
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

                {selectedRequest ? (
                  <div className="assistant-panel" aria-label="Assistant triage">
                    <div className="source-history-header">
                      <Sparkles aria-hidden="true" size={14} />
                      <strong>Triage assist</strong>
                      <label className="assistant-toggle">
                        <input
                          checked={isAssistantEnabled}
                          onChange={(event) => setIsAssistantEnabled(event.target.checked)}
                          type="checkbox"
                        />
                        <span>Assistant suggestions</span>
                      </label>
                    </div>

                    {selectedAssistantSuggestion ? (
                      <>
                        <div className="assistant-summary">
                          <div>
                            <span>Problem</span>
                            <p>{selectedAssistantSuggestion.summary.problem}</p>
                          </div>
                          <div>
                            <span>Signal</span>
                            <p>{selectedAssistantSuggestion.summary.signal}</p>
                          </div>
                          <div>
                            <span>Next</span>
                            <p>{selectedAssistantSuggestion.summary.nextAction}</p>
                          </div>
                        </div>

                        <div className="assistant-suggestions" aria-label="Duplicate suggestions">
                          <strong>Possible duplicates</strong>
                          {selectedAssistantSuggestion.duplicates.length ? (
                            selectedAssistantSuggestion.duplicates.map((suggestion) => (
                              <article
                                className="assistant-suggestion"
                                key={suggestion.request.id}
                              >
                                <span>
                                  <strong>{suggestion.request.title}</strong>
                                  <small>{suggestion.score} match</small>
                                </span>
                                <p>{suggestion.reasons.join(". ")}</p>
                              </article>
                            ))
                          ) : (
                            <small className="quiet-note">No strong duplicate signal.</small>
                          )}
                        </div>

                        <div
                          className="assistant-changelog"
                          aria-label="Assistant changelog suggestion"
                        >
                          <span>
                            <strong>{selectedAssistantSuggestion.changelogSuggestion.title}</strong>
                            <small>
                              {selectedAssistantSuggestion.changelogSuggestion.reasons.join(" / ")}
                            </small>
                          </span>
                          <p>{selectedAssistantSuggestion.changelogSuggestion.publicSummary}</p>
                          <button
                            className="secondary-action compact"
                            onClick={createAssistantChangelogDraft}
                            type="button"
                          >
                            <Plus aria-hidden="true" size={14} />
                            Create private draft
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="assistant-paused">
                        <span>Assistant suggestions are paused for this session.</span>
                      </div>
                    )}
                  </div>
                ) : null}

                {selectedRequestNotificationPreference ? (
                  <div className="notification-panel" aria-label="Requester notifications">
                    <div className="source-history-header">
                      <Bell aria-hidden="true" size={14} />
                      <strong>Requester updates</strong>
                      <small>{selectedRequestNotifications.length} queued</small>
                    </div>
                    <div className="notification-toggles">
                      <label className="check-field">
                        <input
                          checked={selectedRequestNotificationPreference.statusUpdates}
                          onChange={(event) =>
                            updateSelectedRequestNotificationPreference(
                              "statusUpdates",
                              event.target.checked
                            )
                          }
                          type="checkbox"
                        />
                        <span>Status</span>
                      </label>
                      <label className="check-field">
                        <input
                          checked={selectedRequestNotificationPreference.changelogUpdates}
                          onChange={(event) =>
                            updateSelectedRequestNotificationPreference(
                              "changelogUpdates",
                              event.target.checked
                            )
                          }
                          type="checkbox"
                        />
                        <span>Changelog</span>
                      </label>
                    </div>
                    {selectedRequestNotifications.length ? (
                      <div className="notification-list">
                        {selectedRequestNotifications.map((event) => (
                          <article className="notification-item" key={event.id}>
                            <strong>{event.title}</strong>
                            <p>{event.body}</p>
                            <small>{event.status} / quiet {workspace.notifications.quietWindowHours}h</small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <small className="quiet-note">
                        No queued updates for {selectedRequest.requester}.
                      </small>
                    )}
                  </div>
                ) : null}

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
                        <small>
                          {comment.age} / {comment.visibility}
                        </small>
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

            {roadmapItemCount ? (
              <div className="roadmap-workspace">
                <div className="roadmap-lanes">
                  {roadmapLanes.map((lane) => (
                    <div className="lane" key={lane}>
                      <strong>{lane}</strong>
                      <div className="roadmap-item-list">
                        {workspace.roadmap[lane].length ? (
                          workspace.roadmap[lane].map((item) => (
                            <button
                              aria-label={[
                                item.title,
                                item.summary || "No public wording drafted yet",
                                item.visibility,
                                `${item.confidence} confidence`,
                                item.isStale ? "Needs review" : null,
                                `${item.requestIds.length} requests`,
                                `${item.workItemIds.length} work items`
                              ]
                                .filter(Boolean)
                                .join(". ")}
                              aria-pressed={selectedRoadmapItem?.id === item.id}
                              className={
                                selectedRoadmapItem?.id === item.id
                                  ? "roadmap-row selected"
                                  : "roadmap-row"
                              }
                              key={item.id}
                              onClick={() => selectRoadmapItem(item.id)}
                              type="button"
                            >
                              <span className="roadmap-row-main">
                                <strong>{item.title}</strong>
                                <small>{item.summary || "No public wording drafted yet."}</small>
                              </span>
                              <span className="roadmap-row-meta" aria-hidden="true">
                                <span className={`status-badge ${item.visibility === "Public" ? "success" : "neutral"}`}>
                                  {item.visibility}
                                </span>
                                <span className="status-badge info">{item.confidence}</span>
                                {item.isStale ? (
                                  <span className="status-badge warning">Review</span>
                                ) : null}
                                <small>
                                  {item.requestIds.length} req / {item.workItemIds.length} work
                                </small>
                              </span>
                            </button>
                          ))
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

                {selectedRoadmapItem ? (
                  <aside
                    className="roadmap-detail"
                    aria-label={`Selected roadmap item ${selectedRoadmapItem.title}`}
                  >
                    <div className="roadmap-detail-header">
                      <div>
                        <span className="section-label">Selected roadmap item</span>
                        <h3>{selectedRoadmapItem.title}</h3>
                      </div>
                      <button
                        aria-label={`Remove ${selectedRoadmapItem.title} from roadmap`}
                        className="icon-button"
                        onClick={() => removeRoadmapItem(selectedRoadmapItem.id)}
                        type="button"
                      >
                        <Archive aria-hidden="true" size={14} />
                      </button>
                    </div>
                    <p>{selectedRoadmapItem.summary || "No public wording drafted yet."}</p>
                    <div className="roadmap-badges" aria-label={`${selectedRoadmapItem.title} roadmap state`}>
                      <span className={`status-badge ${selectedRoadmapItem.visibility === "Public" ? "success" : "neutral"}`}>
                        {selectedRoadmapItem.visibility}
                      </span>
                      <span className="status-badge info">
                        {selectedRoadmapItem.confidence} confidence
                      </span>
                      {selectedRoadmapItem.isStale ? (
                        <span className="status-badge warning">Needs review</span>
                      ) : null}
                    </div>
                    <div className="roadmap-controls">
                      <label>
                        <span>Lane</span>
                        <select
                          aria-label={`Lane for ${selectedRoadmapItem.title}`}
                          onChange={(event) =>
                            updateRoadmapItem(selectedRoadmapItem.id, (roadmapItem) => ({
                              ...roadmapItem,
                              lane: event.target.value as RoadmapLane
                            }))
                          }
                          value={selectedRoadmapItem.lane}
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
                          aria-label={`Visibility for ${selectedRoadmapItem.title}`}
                          onChange={(event) =>
                            updateRoadmapItem(selectedRoadmapItem.id, (roadmapItem) => ({
                              ...roadmapItem,
                              visibility: event.target.value as RoadmapVisibility
                            }))
                          }
                          value={selectedRoadmapItem.visibility}
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
                          aria-label={`Confidence for ${selectedRoadmapItem.title}`}
                          onChange={(event) =>
                            updateRoadmapItem(selectedRoadmapItem.id, (roadmapItem) => ({
                              ...roadmapItem,
                              confidence: event.target.value as RoadmapConfidence
                            }))
                          }
                          value={selectedRoadmapItem.confidence}
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
                          aria-label={`Needs review for ${selectedRoadmapItem.title}`}
                          checked={selectedRoadmapItem.isStale}
                          onChange={(event) =>
                            updateRoadmapItem(selectedRoadmapItem.id, (roadmapItem) => ({
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
                      <div aria-label={`Requests linked to ${selectedRoadmapItem.title}`}>
                        <strong>Requests</strong>
                        {selectedRoadmapRequests.length ? (
                          selectedRoadmapRequests.map((request) => (
                            <button
                              className="link-pill"
                              key={request.id}
                              onClick={() =>
                                unlinkRequestFromRoadmap(selectedRoadmapItem.id, request.id)
                              }
                              type="button"
                            >
                              {request.title}
                              <Unlink aria-hidden="true" size={12} />
                            </button>
                          ))
                        ) : (
                          <span>No requests linked</span>
                        )}
                        {selectedRoadmapRequestChoices.length ? (
                          <select
                            aria-label={`Link request to ${selectedRoadmapItem.title}`}
                            onChange={(event) =>
                              linkRequestToRoadmap(selectedRoadmapItem.id, event.target.value)
                            }
                            value=""
                          >
                            <option value="">Link request</option>
                            {selectedRoadmapRequestChoices.map((request) => (
                              <option key={request.id} value={request.id}>
                                {request.title}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                      <div aria-label={`Work linked to ${selectedRoadmapItem.title}`}>
                        <strong>Work</strong>
                        {selectedRoadmapWorkItems.length ? (
                          selectedRoadmapWorkItems.map((workItem) => (
                            <button
                              className="link-pill"
                              key={workItem.id}
                              onClick={() =>
                                unlinkWorkItemFromRoadmap(selectedRoadmapItem.id, workItem.id)
                              }
                              type="button"
                            >
                              {workItem.title}
                              <Unlink aria-hidden="true" size={12} />
                            </button>
                          ))
                        ) : (
                          <span>No work linked</span>
                        )}
                        {selectedRoadmapWorkChoices.length ? (
                          <select
                            aria-label={`Link work to ${selectedRoadmapItem.title}`}
                            onChange={(event) =>
                              linkWorkItemToRoadmap(selectedRoadmapItem.id, event.target.value)
                            }
                            value=""
                          >
                            <option value="">Link work</option>
                            {selectedRoadmapWorkChoices.map((workItem) => (
                              <option key={workItem.id} value={workItem.id}>
                                {workItem.title}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                    </div>
                  </aside>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="panel release-panel" id="changelog" aria-labelledby="changelog-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Changelog</span>
                <h2 id="changelog-title">Draft queue</h2>
              </div>
              <div className="panel-actions">
                <span className="status-badge neutral">
                  {workspace.changelog.length} {workspace.changelog.length === 1 ? "draft" : "drafts"}
                </span>
                {!isAddingChangelogItem ? (
                  <button className="secondary-action compact" onClick={startChangelogItem} type="button">
                    <Plus aria-hidden="true" size={14} />
                    New changelog draft
                  </button>
                ) : null}
              </div>
            </div>

            {isAddingChangelogItem ? (
              <form className="changelog-form" aria-label="Create changelog draft" onSubmit={addChangelogItem}>
                <label className="wide-field">
                  <span>Source</span>
                  <select
                    aria-label="Changelog source"
                    onChange={(event) => applyChangelogSource(event.target.value)}
                    value={newChangelogDraft.sourceKey}
                  >
                    {changelogSourceChoices.map((sourceChoice) => (
                      <option key={sourceChoice.sourceKey} value={sourceChoice.sourceKey}>
                        {sourceChoice.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Title</span>
                  <input
                    aria-label="Changelog title"
                    onChange={(event) =>
                      setNewChangelogDraft((draft) => ({ ...draft, title: event.target.value }))
                    }
                    value={newChangelogDraft.title}
                  />
                </label>
                <label>
                  <span>Visibility</span>
                  <select
                    aria-label="Changelog visibility"
                    onChange={(event) =>
                      setNewChangelogDraft((draft) => ({
                        ...draft,
                        visibility: event.target.value as ChangelogVisibility
                      }))
                    }
                    value={newChangelogDraft.visibility}
                  >
                    {changelogVisibilities.map((visibility) => (
                      <option key={visibility} value={visibility}>
                        {visibility}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide-field">
                  <span>Public wording</span>
                  <textarea
                    aria-label="Public wording"
                    onChange={(event) =>
                      setNewChangelogDraft((draft) => ({
                        ...draft,
                        publicSummary: event.target.value
                      }))
                    }
                    value={newChangelogDraft.publicSummary}
                  />
                </label>
                <label className="wide-field">
                  <span>Private notes</span>
                  <textarea
                    aria-label="Private notes"
                    onChange={(event) =>
                      setNewChangelogDraft((draft) => ({
                        ...draft,
                        privateNotes: event.target.value
                      }))
                    }
                    value={newChangelogDraft.privateNotes}
                  />
                </label>
                <label>
                  <span>State</span>
                  <select
                    aria-label="Changelog state"
                    onChange={(event) =>
                      setNewChangelogDraft((draft) => ({
                        ...draft,
                        state: event.target.value as ChangelogState
                      }))
                    }
                    value={newChangelogDraft.state}
                  >
                    {changelogStates.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="composer-actions">
                  <button className="primary-action" type="submit">
                    Create changelog draft
                  </button>
                  <button
                    className="secondary-action"
                    onClick={() => {
                      setIsAddingChangelogItem(false);
                      setNewChangelogDraft(emptyChangelogDraft);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {workspace.changelog.length === 0 && !isAddingChangelogItem ? (
              <div className="empty-state compact-empty">
                <strong>No changelog drafts</strong>
                <p>Draft updates from shipped work or roadmap items when there is something to announce.</p>
                <button className="primary-action" onClick={startChangelogItem} type="button">
                  <Plus aria-hidden="true" size={16} />
                  New changelog draft
                </button>
              </div>
            ) : null}

            {workspace.changelog.length ? (
              <div className="changelog-workspace">
                <div className="changelog-list" aria-label="Changelog drafts">
                  {workspace.changelog.map((item) => (
                    <button
                      aria-label={[
                        item.title,
                        item.state,
                        item.visibility,
                        changelogSourceLabel(item, workspace, roadmapItems),
                        `${item.requestIds.length} linked requests`
                      ].join(". ")}
                      aria-pressed={selectedChangelogItem?.id === item.id}
                      className={
                        selectedChangelogItem?.id === item.id
                          ? "changelog-row selected"
                          : "changelog-row"
                      }
                      key={item.id}
                      onClick={() => selectChangelogItem(item.id)}
                      type="button"
                    >
                      <span className="changelog-row-main">
                        <strong>{item.title}</strong>
                        <small>{item.publicSummary || "No public wording drafted yet."}</small>
                      </span>
                      <span className="changelog-row-meta" aria-hidden="true">
                        <span className={`status-badge ${statusTone(item.state)}`}>
                          {item.state}
                        </span>
                        <span className={`status-badge ${item.visibility === "Public" ? "success" : "neutral"}`}>
                          {item.visibility}
                        </span>
                        <small>{item.requestIds.length} request links</small>
                      </span>
                    </button>
                  ))}
                </div>

                {selectedChangelogItem ? (
                  <aside
                    className="changelog-detail"
                    aria-label={`Selected changelog draft ${selectedChangelogItem.title}`}
                  >
                    <div className="changelog-detail-header">
                      <div>
                        <span className="section-label">Selected changelog draft</span>
                        <h3>{selectedChangelogItem.title}</h3>
                      </div>
                      <button
                        aria-label={`Remove ${selectedChangelogItem.title} from changelog`}
                        className="icon-button"
                        onClick={() => removeChangelogItem(selectedChangelogItem.id)}
                        type="button"
                      >
                        <Archive aria-hidden="true" size={14} />
                      </button>
                    </div>

                    <div className="changelog-badges">
                      <span className={`status-badge ${statusTone(selectedChangelogItem.state)}`}>
                        {selectedChangelogItem.state}
                      </span>
                      <span className={`status-badge ${selectedChangelogItem.visibility === "Public" ? "success" : "neutral"}`}>
                        {selectedChangelogItem.visibility}
                      </span>
                      <span className="status-badge info">
                        {changelogSourceLabel(selectedChangelogItem, workspace, roadmapItems)}
                      </span>
                    </div>

                    <div className="changelog-editor">
                      <label className="wide-field">
                        <span>Title</span>
                        <input
                          aria-label={`Title for ${selectedChangelogItem.title}`}
                          onChange={(event) =>
                            updateChangelogItem(selectedChangelogItem.id, (changelogItem) => ({
                              ...changelogItem,
                              title: event.target.value
                            }))
                          }
                          value={selectedChangelogItem.title}
                        />
                      </label>
                      <label>
                        <span>State</span>
                        <select
                          aria-label={`State for ${selectedChangelogItem.title}`}
                          onChange={(event) =>
                            updateChangelogItem(selectedChangelogItem.id, (changelogItem) => ({
                              ...changelogItem,
                              state: event.target.value as ChangelogState
                            }))
                          }
                          value={selectedChangelogItem.state}
                        >
                          {changelogStates.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Visibility</span>
                        <select
                          aria-label={`Visibility for ${selectedChangelogItem.title}`}
                          onChange={(event) =>
                            updateChangelogItem(selectedChangelogItem.id, (changelogItem) => ({
                              ...changelogItem,
                              visibility: event.target.value as ChangelogVisibility
                            }))
                          }
                          value={selectedChangelogItem.visibility}
                        >
                          {changelogVisibilities.map((visibility) => (
                            <option key={visibility} value={visibility}>
                              {visibility}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="wide-field">
                        <span>Public wording</span>
                        <textarea
                          aria-label={`Public wording for ${selectedChangelogItem.title}`}
                          onChange={(event) =>
                            updateChangelogItem(selectedChangelogItem.id, (changelogItem) => ({
                              ...changelogItem,
                              publicSummary: event.target.value
                            }))
                          }
                          value={selectedChangelogItem.publicSummary}
                        />
                      </label>
                      <label className="wide-field">
                        <span>Private notes</span>
                        <textarea
                          aria-label={`Private notes for ${selectedChangelogItem.title}`}
                          onChange={(event) =>
                            updateChangelogItem(selectedChangelogItem.id, (changelogItem) => ({
                              ...changelogItem,
                              privateNotes: event.target.value
                            }))
                          }
                          value={selectedChangelogItem.privateNotes}
                        />
                      </label>
                    </div>

                    <div className="changelog-links" aria-label={`Requests linked to ${selectedChangelogItem.title}`}>
                      <strong>Requesters to notify later</strong>
                      {selectedChangelogRequests.length ? (
                        selectedChangelogRequests.map((request) => (
                          <button
                            className="link-pill"
                            key={request.id}
                            onClick={() =>
                              unlinkRequestFromChangelog(selectedChangelogItem.id, request.id)
                            }
                            type="button"
                          >
                            {request.title}
                            <Unlink aria-hidden="true" size={12} />
                          </button>
                        ))
                      ) : (
                        <span>No requesters linked</span>
                      )}
                      {selectedChangelogRequestChoices.length ? (
                        <select
                          aria-label={`Link request to ${selectedChangelogItem.title}`}
                          onChange={(event) =>
                            linkRequestToChangelog(selectedChangelogItem.id, event.target.value)
                          }
                          value=""
                        >
                          <option value="">Link request</option>
                          {selectedChangelogRequestChoices.map((request) => (
                            <option key={request.id} value={request.id}>
                              {request.title}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>

                    <section
                      className="public-preview"
                      aria-label={`Public preview for ${selectedChangelogItem.title}`}
                    >
                      <span className="section-label">Public preview</span>
                      <strong>{selectedChangelogItem.title}</strong>
                      <p>{selectedChangelogItem.publicSummary || "No public wording drafted yet."}</p>
                      <small>
                        {selectedChangelogItem.visibility === "Public"
                          ? "Visible to public surfaces when portal publishing exists."
                          : "Private draft; hidden from public surfaces."}
                      </small>
                    </section>
                  </aside>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="panel portal-panel" id="portal" aria-labelledby="portal-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Portal</span>
                <h2 id="portal-title">Public portal preview</h2>
              </div>
              <div className="panel-actions">
                <span className={`status-badge ${portalSnapshot.enabled ? "success" : "neutral"}`}>
                  {portalSnapshot.enabled ? "Enabled" : "Paused"}
                </span>
                <span className="panel-count">
                  {portalSnapshot.requestCount} public{" "}
                  {portalSnapshot.requestCount === 1 ? "request" : "requests"}
                </span>
              </div>
            </div>

            <div className="portal-settings" aria-label="Portal settings">
              <label className="toggle-line">
                <input
                  checked={workspace.portal.enabled}
                  onChange={(event) =>
                    updatePortalSettings((portal) => ({
                      ...portal,
                      enabled: event.target.checked
                    }))
                  }
                  type="checkbox"
                />
                <span>Portal enabled</span>
              </label>
              <label className="toggle-line">
                <input
                  checked={workspace.portal.allowVoting}
                  onChange={(event) =>
                    updatePortalSettings((portal) => ({
                      ...portal,
                      allowVoting: event.target.checked
                    }))
                  }
                  type="checkbox"
                />
                <span>Voting</span>
              </label>
              <label className="toggle-line">
                <input
                  checked={workspace.portal.allowComments}
                  onChange={(event) =>
                    updatePortalSettings((portal) => ({
                      ...portal,
                      allowComments: event.target.checked
                    }))
                  }
                  type="checkbox"
                />
                <span>Comments</span>
              </label>
              <label>
                <span>Headline</span>
                <input
                  aria-label="Portal headline"
                  onChange={(event) =>
                    updatePortalSettings((portal) => ({
                      ...portal,
                      headline: event.target.value
                    }))
                  }
                  value={workspace.portal.headline}
                />
              </label>
              <label className="wide-field">
                <span>Intro</span>
                <input
                  aria-label="Portal intro"
                  onChange={(event) =>
                    updatePortalSettings((portal) => ({
                      ...portal,
                      intro: event.target.value
                    }))
                  }
                  value={workspace.portal.intro}
                />
              </label>
            </div>

            <div className="portal-preview" aria-label="Public portal preview surface">
              <header className="portal-hero">
                <div>
                  <span className="section-label">Public view</span>
                  <h3>{portalSnapshot.headline || "Public roadmap"}</h3>
                  <p>
                    {portalSnapshot.intro ||
                      "Follow requests, roadmap direction, and shipped updates."}
                  </p>
                </div>
                <div className="portal-ledger" aria-label="Public portal counts">
                  <span>
                    <small>Requests</small>
                    <strong>{portalSnapshot.requestCount}</strong>
                  </span>
                  <span>
                    <small>Roadmap</small>
                    <strong>{portalSnapshot.roadmapCount}</strong>
                  </span>
                  <span>
                    <small>Changelog</small>
                    <strong>{portalSnapshot.changelogCount}</strong>
                  </span>
                </div>
              </header>

              {!portalSnapshot.enabled ? (
                <div className="empty-state compact-empty">
                  <strong>Portal preview paused</strong>
                  <p>Enable the portal when this workspace is ready to show a public view.</p>
                </div>
              ) : (
                <>
                  <div className="portal-board" aria-label="Public feedback board">
                    <section className="portal-request-list" aria-labelledby="portal-board-title">
                      <div className="portal-section-header">
                        <div>
                          <span className="section-label">Feedback board</span>
                          <h3 id="portal-board-title">Public requests</h3>
                        </div>
                        <label className="portal-search">
                          <Search aria-hidden="true" size={14} />
                          <span>Search public requests</span>
                          <input
                            aria-label="Search public requests"
                            onChange={(event) => setPortalSearch(event.target.value)}
                            placeholder="Search public title, details, tags..."
                            value={portalSearch}
                          />
                        </label>
                      </div>

                      {portalSnapshot.requests.length ? (
                        <div className="portal-request-stack">
                          {portalSnapshot.requests.map((request) => (
                            <button
                              aria-label={`${request.title}. ${request.status}. ${request.votes} votes. ${request.comments.length} public comments`}
                              aria-pressed={selectedPortalRequest?.id === request.id}
                              className={
                                selectedPortalRequest?.id === request.id
                                  ? "portal-request-row selected"
                                  : "portal-request-row"
                              }
                              key={request.id}
                              onClick={() => selectPortalRequest(request.id)}
                              type="button"
                            >
                              <span className="portal-request-main">
                                <strong>{request.title}</strong>
                                <small>{request.description}</small>
                              </span>
                              <span className="portal-request-meta">
                                <span className={`status-badge ${statusTone(request.status)}`}>
                                  {request.status}
                                </span>
                                <small>{request.votes} votes</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact-empty">
                          <strong>No public requests</strong>
                          <p>
                            {portalSearch.trim()
                              ? "No public request matches this search."
                              : "Mark a request Public to show it on the portal."}
                          </p>
                        </div>
                      )}
                    </section>

                    <aside
                      className="portal-request-detail"
                      aria-label={
                        selectedPortalRequest
                          ? `Public request ${selectedPortalRequest.title}`
                          : "No public request selected"
                      }
                    >
                      {selectedPortalRequest ? (
                        <>
                          <div className="portal-detail-header">
                            <div>
                              <span className="section-label">Selected public request</span>
                              <h3>{selectedPortalRequest.title}</h3>
                            </div>
                            <span className={`status-badge ${statusTone(selectedPortalRequest.status)}`}>
                              {selectedPortalRequest.status}
                            </span>
                          </div>
                          <p>{selectedPortalRequest.description}</p>
                          <div className="tag-list" aria-label="Public request tags">
                            <Tag aria-hidden="true" size={13} />
                            {selectedPortalRequest.tags.length ? (
                              selectedPortalRequest.tags.map((tag) => <span key={tag}>{tag}</span>)
                            ) : (
                              <small>No public tags</small>
                            )}
                          </div>
                          <button
                            className="secondary-action"
                            disabled={!portalSnapshot.allowVoting}
                            onClick={() => togglePortalVote(selectedPortalRequest.id)}
                            type="button"
                          >
                            <ThumbsUp aria-hidden="true" size={14} />
                            {selectedPortalRequest.hasCurrentUserVote
                              ? "Remove portal vote"
                              : "Vote on request"}
                          </button>

                          <div className="portal-comments" aria-label="Public comments">
                            <div className="portal-section-header compact">
                              <strong>Public comments</strong>
                              <small>{selectedPortalRequest.comments.length} visible</small>
                            </div>
                            {selectedPortalRequest.comments.length ? (
                              selectedPortalRequest.comments.map((comment) => (
                                <article className="comment-item" key={comment.id}>
                                  <strong>{comment.author}</strong>
                                  <p>{comment.body}</p>
                                  <small>{comment.age}</small>
                                </article>
                              ))
                            ) : (
                              <span className="muted-line">No public comments yet.</span>
                            )}
                          </div>

                          {portalSnapshot.allowComments ? (
                            <form
                              className="portal-comment-form"
                              aria-label="Add public portal comment"
                              onSubmit={addPortalComment}
                            >
                              <label>
                                <span>Name</span>
                                <input
                                  aria-label="Portal comment author"
                                  onChange={(event) =>
                                    setPortalCommentDraft((draft) => ({
                                      ...draft,
                                      author: event.target.value
                                    }))
                                  }
                                  placeholder="Portal visitor"
                                  value={portalCommentDraft.author}
                                />
                              </label>
                              <label className="wide-field">
                                <span>Public note</span>
                                <textarea
                                  aria-label="Portal public note"
                                  onChange={(event) =>
                                    setPortalCommentDraft((draft) => ({
                                      ...draft,
                                      body: event.target.value
                                    }))
                                  }
                                  placeholder="Add a public note"
                                  value={portalCommentDraft.body}
                                />
                              </label>
                              <button className="secondary-action" type="submit">
                                <MessageCircle aria-hidden="true" size={14} />
                                Add public comment
                              </button>
                            </form>
                          ) : (
                            <div className="empty-state compact-empty">
                              <strong>Public comments disabled</strong>
                              <p>Existing public comments remain visible until moderated.</p>
                            </div>
                          )}

                          <div
                            className="portal-moderation"
                            aria-label={`Moderation for ${selectedPortalRequest.title}`}
                          >
                            <strong>Moderation</strong>
                            {selectedPortalModerationComments.length ? (
                              selectedPortalModerationComments.map((comment) => (
                                <div className="moderation-row" key={comment.id}>
                                  <span>
                                    {comment.author} / {comment.visibility}
                                  </span>
                                  <button
                                    className="secondary-action compact"
                                    onClick={() =>
                                      setPortalCommentVisibility(
                                        selectedPortalRequest.id,
                                        comment.id,
                                        comment.visibility === "Hidden" ? "Public" : "Hidden"
                                      )
                                    }
                                    type="button"
                                  >
                                    {comment.visibility === "Hidden"
                                      ? "Restore comment"
                                      : "Hide comment"}
                                  </button>
                                </div>
                              ))
                            ) : (
                              <span className="muted-line">No public comments to moderate.</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="empty-state compact-empty">
                          <strong>Select a public request</strong>
                          <p>Voting, public comments, and moderation controls appear here.</p>
                        </div>
                      )}
                    </aside>
                  </div>

                  <div className="portal-publish-grid">
                    <section className="public-roadmap" aria-label="Public roadmap">
                      <div className="portal-section-header">
                        <div>
                          <span className="section-label">Roadmap</span>
                          <h3>Public direction</h3>
                        </div>
                      </div>
                      <div className="public-roadmap-lanes">
                        {roadmapLanes.map((lane) => (
                          <div className="public-roadmap-lane" key={lane}>
                            <strong>{lane}</strong>
                            {portalSnapshot.roadmap[lane].length ? (
                              portalSnapshot.roadmap[lane].map((item) => (
                                <article key={item.id}>
                                  <span className={`status-badge ${item.isStale ? "warning" : "info"}`}>
                                    {item.confidence}
                                  </span>
                                  <h4>{item.title}</h4>
                                  <p>{item.summary || "No public wording drafted yet."}</p>
                                  <small>{item.linkedRequestCount} linked requests</small>
                                </article>
                              ))
                            ) : (
                              <small>No public items</small>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="public-changelog" aria-label="Public changelog">
                      <div className="portal-section-header">
                        <div>
                          <span className="section-label">Changelog</span>
                          <h3>Ready updates</h3>
                        </div>
                      </div>
                      {portalSnapshot.changelog.length ? (
                        <div className="public-changelog-list">
                          {portalSnapshot.changelog.map((item) => (
                            <article key={item.id}>
                              <span className="status-badge success">Ready</span>
                              <h4>{item.title}</h4>
                              <p>{item.publicSummary || "No public wording drafted yet."}</p>
                              <small>{item.linkedRequestCount} linked requests</small>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact-empty">
                          <strong>No public changelog yet</strong>
                          <p>Only Ready and Public changelog entries appear here.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="panel settings-panel" id="settings" aria-labelledby="settings-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Settings</span>
                <h2 id="settings-title">Controls and integrations</h2>
              </div>
            </div>

            <div className="settings-grid">
              <section className="access-control" aria-label="Team access">
                <div className="settings-section-header">
                  <div>
                    <div className="source-history-header">
                      <ShieldCheck aria-hidden="true" size={14} />
                      <strong>Access</strong>
                    </div>
                    <p>
                      Invite workspace members without changing the standalone product loop.
                    </p>
                  </div>
                  <span className={`status-badge ${getInvitationAccessTone(invitationAccess)}`}>
                    {getInvitationAccessLabel(invitationAccess)}
                  </span>
                </div>

                {invitationActionMessage ? (
                  <p className="invitation-message" role="status">
                    {invitationActionMessage}
                  </p>
                ) : null}
                {invitationErrorMessage ? (
                  <p className="invitation-message error" role="alert">
                    {invitationErrorMessage}
                  </p>
                ) : null}

                {invitationAccess.status === "ready" ? (
                  <>
                    <form
                      className="invitation-form"
                      aria-label="Create team invitation"
                      onSubmit={createInvitation}
                    >
                      <label>
                        <span>Email</span>
                        <input
                          aria-label="Invitation email"
                          onChange={(event) =>
                            setInvitationDraft((draft) => ({ ...draft, email: event.target.value }))
                          }
                          placeholder="teammate@example.com"
                          type="email"
                          value={invitationDraft.email}
                        />
                      </label>
                      <label>
                        <span>Name</span>
                        <input
                          aria-label="Invitation name"
                          onChange={(event) =>
                            setInvitationDraft((draft) => ({ ...draft, name: event.target.value }))
                          }
                          placeholder="Optional"
                          value={invitationDraft.name}
                        />
                      </label>
                      <label>
                        <span>Role</span>
                        <select
                          aria-label="Invitation role"
                          onChange={(event) =>
                            setInvitationDraft((draft) => ({
                              ...draft,
                              role: event.target.value as InvitationWorkspaceRole
                            }))
                          }
                          value={invitationDraft.role}
                        >
                          {invitationRoles.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="primary-action compact"
                        disabled={isCreatingInvitation || !invitationDraft.email.trim()}
                        type="submit"
                      >
                        <UserPlus aria-hidden="true" size={14} />
                        {isCreatingInvitation ? "Creating..." : "Create invitation"}
                      </button>
                    </form>

                    {createdInvitationToken ? (
                      <div className="invitation-token" aria-label="Created invitation token">
                        <div>
                          <strong>One-time token</strong>
                          <span>{createdInvitationToken.email}</span>
                        </div>
                        <label>
                          <span>One-time accept token</span>
                          <input
                            aria-label="Created invitation accept token"
                            readOnly
                            value={createdInvitationToken.token}
                          />
                        </label>
                        <button
                          className="secondary-action compact"
                          onClick={() => void copyCreatedInvitationToken()}
                          type="button"
                        >
                          <Copy aria-hidden="true" size={14} />
                          Copy token
                        </button>
                      </div>
                    ) : null}

                    <div className="invitation-list" aria-label="Workspace invitations">
                      {invitationAccess.invitations.length ? (
                        invitationAccess.invitations.map((invitation) => (
                          <article className="invitation-row" key={invitation.id}>
                            <div>
                              <strong>{invitation.email}</strong>
                              <span>
                                {invitation.invitedName ? `${invitation.invitedName} / ` : ""}
                                {invitation.role}
                              </span>
                            </div>
                            <span className={`status-badge ${getInvitationStatusTone(invitation.status)}`}>
                              {getInvitationStatusLabel(invitation.status)}
                            </span>
                            <button
                              className="secondary-action compact"
                              disabled={invitation.status !== "pending" || revokingInvitationId === invitation.id}
                              onClick={() => void revokeInvitation(invitation.id)}
                              type="button"
                            >
                              {revokingInvitationId === invitation.id ? "Revoking..." : "Revoke"}
                            </button>
                          </article>
                        ))
                      ) : (
                        <div className="empty-state compact-empty">
                          <strong>No invitations yet</strong>
                          <p>Create one only when a teammate needs workspace access.</p>
                        </div>
                      )}
                    </div>

                    <form
                      className="invitation-accept-form"
                      aria-label="Accept invitation token"
                      onSubmit={acceptInvitationToken}
                    >
                      <label>
                        <span>Accept token</span>
                        <input
                          aria-label="Invitation accept token"
                          onChange={(event) =>
                            setAcceptTokenDraft((draft) => ({ ...draft, token: event.target.value }))
                          }
                          placeholder="Paste token"
                          value={acceptTokenDraft.token}
                        />
                      </label>
                      <label>
                        <span>Name</span>
                        <input
                          aria-label="Accepted member name"
                          onChange={(event) =>
                            setAcceptTokenDraft((draft) => ({ ...draft, name: event.target.value }))
                          }
                          placeholder="Optional"
                          value={acceptTokenDraft.name}
                        />
                      </label>
                      <button
                        className="secondary-action compact"
                        disabled={isAcceptingInvitation || !acceptTokenDraft.token.trim()}
                        type="submit"
                      >
                        {isAcceptingInvitation ? "Checking..." : "Accept token"}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="empty-state compact-empty">
                    <strong>Server access required</strong>
                    <p>{invitationAccess.message ?? "Team invitation APIs are not available."}</p>
                  </div>
                )}
              </section>

              <section className="integration-control" aria-label="Optional integrations">
                <div className="settings-section-header">
                  <div>
                    <div className="source-history-header">
                      <RadioTower aria-hidden="true" size={14} />
                      <strong>Integrations</strong>
                    </div>
                    <p>{integrationStatus.message ?? "Provider status is scoped to this workspace."}</p>
                  </div>
                  <span className={`status-badge ${getIntegrationStatusTone(integrationStatus)}`}>
                    {getIntegrationStatusLabel(integrationStatus)}
                  </span>
                </div>

                {integrationActionMessage ? (
                  <p className="integration-action-message" role="status">
                    {integrationActionMessage}
                  </p>
                ) : null}

                <div className="provider-list" aria-label="Provider readiness">
                  {integrationStatus.providers.map((provider) => (
                    <article className="provider-row" key={provider.provider}>
                      <div className="provider-main">
                        <span className="provider-code" aria-hidden="true">
                          {getProviderCode(provider)}
                        </span>
                        <div>
                          <h3>{provider.label}</h3>
                          <p>{provider.statusText}</p>
                          <small>{getProviderMetric(provider)}</small>
                        </div>
                      </div>

                      <div className="provider-controls">
                        <span className={`status-badge ${getProviderTone(provider)}`}>
                          {getProviderConnectionLabel(provider)}
                        </span>
                        <button
                          aria-label={`${provider.label} sync linked issues`}
                          className="secondary-action compact provider-action"
                          disabled={
                            !provider.capabilities.manualSync || syncingProvider === provider.provider
                          }
                          onClick={() => void syncProviderLinkedIssues(provider)}
                          type="button"
                        >
                          <RotateCcw aria-hidden="true" size={14} />
                          {syncingProvider === provider.provider ? "Syncing..." : "Sync linked issues"}
                        </button>
                      </div>

                      <details className="provider-details">
                        <summary>Recent activity</summary>
                        {provider.recentJobs.length ? (
                          <ol>
                            {provider.recentJobs.map((job) => (
                              <li key={job.id}>
                                <span>{job.status}</span>
                                <strong>{job.reason}</strong>
                                <small>{formatIntegrationTime(job.completedAt ?? job.updatedAt)}</small>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p>No sync activity for this provider yet.</p>
                        )}
                      </details>
                    </article>
                  ))}
                </div>
              </section>

              <section className="data-tools" aria-label="Workspace data tools">
                <div className="settings-section-header">
                  <div>
                    <div className="source-history-header">
                      <Settings aria-hidden="true" size={14} />
                      <strong>Workspace data</strong>
                    </div>
                    <p>Export, import, or reset this workspace without touching provider credentials.</p>
                  </div>
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

function getProviderCode(provider: IntegrationProviderStatus) {
  if (provider.provider === "github") return "GH";
  if (provider.provider === "jira") return "JR";
  return "LN";
}

function getIntegrationStatusTone(status: WorkspaceIntegrationStatus) {
  if (status.status === "ready") return "success";
  if (status.status === "forbidden") return "warning";
  return "neutral";
}

function getIntegrationStatusLabel(status: WorkspaceIntegrationStatus) {
  if (status.status === "ready") return "Server metadata";
  if (status.status === "forbidden") return "Needs access";
  return "Standalone";
}

function getProviderTone(provider: IntegrationProviderStatus) {
  if (provider.connection === "connected") return "success";
  if (provider.connection === "attention") return "warning";
  if (provider.connection === "ready") return "info";
  return "neutral";
}

function getProviderConnectionLabel(provider: IntegrationProviderStatus) {
  if (provider.connection === "connected") return "Connected";
  if (provider.connection === "attention") return "Needs review";
  if (provider.connection === "ready") return "Ready";
  return "Optional";
}

function getProviderMetric(provider: IntegrationProviderStatus) {
  const linked =
    provider.linkedIssueMappings > 0
      ? `${provider.linkedIssueMappings} linked issue${provider.linkedIssueMappings === 1 ? "" : "s"}`
      : "No linked issues";
  const queue =
    provider.queuedSyncJobs + provider.runningSyncJobs > 0
      ? `${provider.queuedSyncJobs + provider.runningSyncJobs} active sync job${
          provider.queuedSyncJobs + provider.runningSyncJobs === 1 ? "" : "s"
        }`
      : "No active sync jobs";
  const account =
    provider.accounts[0]?.providerAccountName ??
    (provider.setupConfigured ? "Setup configured" : "Setup not configured");

  return `${account} / ${linked} / ${queue}`;
}

function getInvitationAccessTone(access: WorkspaceInvitationAccess) {
  if (access.status === "ready") return "success";
  if (access.status === "forbidden") return "warning";
  return "neutral";
}

function getInvitationAccessLabel(access: WorkspaceInvitationAccess) {
  if (access.status === "ready") return "Ready";
  if (access.status === "forbidden") return "Owner only";
  return "Server off";
}

function getInvitationStatusTone(status: string) {
  if (status === "accepted") return "success";
  if (status === "pending") return "info";
  if (status === "expired") return "warning";
  return "neutral";
}

function getInvitationStatusLabel(status: string) {
  if (status === "accepted") return "Accepted";
  if (status === "pending") return "Pending";
  if (status === "expired") return "Expired";
  return "Revoked";
}

function formatIntegrationTime(value: string | undefined) {
  if (!value) return "not recorded";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(new Date(parsed));
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
