import {
  initialWorkspaces,
  roadmapLanes,
  type ChangelogItem,
  type OpenRoadState,
  type RequestItem,
  type RequestStatus,
  type WorkStatus,
  type Workspace
} from "../domain/openroad";

export const triageViews = [
  { value: "all", label: "All active" },
  { value: "unassigned", label: "Unassigned" },
  { value: "needs-decision", label: "Needs decision" },
  { value: "high-signal", label: "High signal" }
] as const;

export type RequestStatusFilter = "All" | RequestStatus;
export type RequestArchiveFilter = "active" | "archived";
export type TriageView = (typeof triageViews)[number]["value"];

export function resolveInitialWorkspaceId(
  state: OpenRoadState,
  selectedWorkspaceId: string | null | undefined
) {
  if (
    selectedWorkspaceId &&
    state.workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
  ) {
    return selectedWorkspaceId;
  }

  return state.workspaces[0]?.id ?? initialWorkspaces[0].id;
}

export function statusTone(status: RequestStatus | WorkStatus | ChangelogItem["state"]) {
  if (status === "Planned" || status === "Ready" || status === "Done") return "success";
  if (status === "Shipping soon" || status === "In progress") return "info";
  if (status === "Needs decision" || status === "Draft") return "warning";
  return "neutral";
}

export function flattenRoadmap(roadmap: Workspace["roadmap"]) {
  return roadmapLanes.flatMap((lane) => roadmap[lane]);
}

export function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function requestMatchesQuery(request: RequestItem, query: string) {
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

export function requestMatchesTriageView(request: RequestItem, view: TriageView) {
  if (view === "unassigned") return request.owner === "Unassigned";
  if (view === "needs-decision") return request.status === "Needs decision";
  if (view === "high-signal") {
    return request.votes >= 80 || request.comments.length > 0 || request.mergedSources.length > 0;
  }
  return true;
}
