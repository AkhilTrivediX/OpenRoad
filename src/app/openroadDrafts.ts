import type {
  ChangelogItem,
  ChangelogState,
  ChangelogVisibility,
  RequestOwner,
  RequestVisibility,
  RoadmapConfidence,
  RoadmapLane,
  RoadmapVisibility,
  WorkStatus
} from "../domain/openroad";

export type RequestDraft = {
  title: string;
  description: string;
  requester: string;
  source: string;
  tags: string;
  visibility: RequestVisibility;
};

export type WorkDraft = {
  title: string;
  description: string;
  owner: RequestOwner;
  status: WorkStatus;
  targetDate: string;
  linkSelectedRequest: boolean;
};

export type RoadmapDraft = {
  title: string;
  summary: string;
  lane: RoadmapLane;
  visibility: RoadmapVisibility;
  confidence: RoadmapConfidence;
  isStale: boolean;
  requestId: string;
  workItemId: string;
};

export type ChangelogDraft = {
  privateNotes: string;
  publicSummary: string;
  requestIds: string[];
  roadmapItemIds: string[];
  sourceKey: string;
  sourceType: ChangelogItem["sourceType"];
  state: ChangelogState;
  title: string;
  visibility: ChangelogVisibility;
  workItemIds: string[];
};

export type PortalCommentDraft = {
  author: string;
  body: string;
};

export const emptyRequestDraft: RequestDraft = {
  title: "",
  description: "",
  requester: "",
  source: "Manual",
  tags: "",
  visibility: "Private"
};

export const emptyWorkDraft: WorkDraft = {
  title: "",
  description: "",
  owner: "Unassigned",
  status: "Backlog",
  targetDate: "",
  linkSelectedRequest: true
};

export const emptyRoadmapDraft: RoadmapDraft = {
  confidence: "Medium",
  isStale: false,
  lane: "Next",
  requestId: "",
  summary: "",
  title: "",
  visibility: "Private",
  workItemId: ""
};

export const emptyChangelogDraft: ChangelogDraft = {
  privateNotes: "",
  publicSummary: "",
  requestIds: [],
  roadmapItemIds: [],
  sourceKey: "manual",
  sourceType: "Manual",
  state: "Draft",
  title: "",
  visibility: "Private",
  workItemIds: []
};

export const emptyPortalCommentDraft: PortalCommentDraft = {
  author: "",
  body: ""
};
