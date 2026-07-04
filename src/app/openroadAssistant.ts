import type {
  ChangelogItem,
  RequestItem,
  RoadmapItem,
  WorkItem,
  Workspace
} from "../domain/openroad";

export type AssistantDuplicateSuggestion = {
  request: RequestItem;
  reasons: string[];
  score: number;
};

export type AssistantRequestSummary = {
  nextAction: string;
  problem: string;
  signal: string;
  state: string;
};

export type AssistantChangelogSuggestion = {
  privateNotes: string;
  publicSummary: string;
  reasons: string[];
  requestIds: string[];
  roadmapItemIds: string[];
  sourceKey: string;
  sourceType: ChangelogItem["sourceType"];
  title: string;
  workItemIds: string[];
};

export type AssistantTriageSuggestion = {
  changelogSuggestion: AssistantChangelogSuggestion;
  duplicates: AssistantDuplicateSuggestion[];
  summary: AssistantRequestSummary;
};

const maxDuplicateSuggestions = 3;
const weakDuplicateScore = 45;
const stopWords = new Set([
  "and",
  "are",
  "for",
  "from",
  "into",
  "that",
  "the",
  "this",
  "with",
  "when",
  "want",
  "wants",
  "users",
  "user"
]);

export function createAssistantTriageSuggestion(
  workspace: Workspace,
  selectedRequest: RequestItem,
  roadmapItems: RoadmapItem[]
): AssistantTriageSuggestion {
  return {
    changelogSuggestion: createAssistantChangelogSuggestion(
      selectedRequest,
      workspace.workItems,
      roadmapItems
    ),
    duplicates: createDuplicateSuggestions(selectedRequest, workspace.requests),
    summary: createRequestSummary(selectedRequest)
  };
}

export function createRequestSummary(request: RequestItem): AssistantRequestSummary {
  const commentCount = request.comments.length;
  const mergedCount = request.mergedSources.length;
  const tagText = request.tags.length ? `Tags: ${request.tags.join(", ")}.` : "No tags yet.";

  return {
    nextAction: nextActionForRequest(request),
    problem: summarizeProblem(request),
    signal: `${request.votes} votes, ${commentCount} comments, ${mergedCount} merged sources. ${tagText}`,
    state: `${request.status} / ${request.owner} / ${request.visibility}`
  };
}

export function createDuplicateSuggestions(
  selectedRequest: RequestItem,
  requests: RequestItem[]
): AssistantDuplicateSuggestion[] {
  const mergedRequestIds = new Set(selectedRequest.mergedSources.map((source) => source.id));

  return requests
    .filter(
      (request) =>
        request.id !== selectedRequest.id &&
        !request.archived &&
        !mergedRequestIds.has(request.id)
    )
    .map((request) => scoreDuplicateCandidate(selectedRequest, request))
    .filter((suggestion) => suggestion.score >= weakDuplicateScore)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.request.votes !== left.request.votes) return right.request.votes - left.request.votes;
      return left.request.title.localeCompare(right.request.title);
    })
    .slice(0, maxDuplicateSuggestions);
}

export function createAssistantChangelogSuggestion(
  request: RequestItem,
  workItems: WorkItem[],
  roadmapItems: RoadmapItem[]
): AssistantChangelogSuggestion {
  const doneWork = workItems.find(
    (workItem) => workItem.status === "Done" && workItem.requestIds.includes(request.id)
  );
  if (doneWork) {
    return {
      privateNotes: [
        "Assistant draft; review before publishing.",
        "Source: linked Done work.",
        `Request status: ${request.status}.`,
        `${request.votes} votes and ${request.comments.length} comments.`,
        "Public wording is intentionally generic until a maintainer writes approved copy."
      ].join(" "),
      publicSummary:
        "A product update is ready. Review this private draft and write approved public wording before publishing.",
      reasons: ["Linked Done work", `Request signal: ${request.votes} votes`],
      requestIds: [request.id],
      roadmapItemIds: [],
      sourceKey: `work:${doneWork.id}`,
      sourceType: "Work",
      title: "Review completed work for changelog",
      workItemIds: [doneWork.id]
    };
  }

  const roadmapItem = roadmapItems.find((item) => item.requestIds.includes(request.id));
  if (roadmapItem) {
    return {
      privateNotes: [
        "Assistant draft; review before publishing.",
        `Roadmap lane: ${roadmapItem.lane}.`,
        `Confidence: ${roadmapItem.confidence}.`,
        `Request status: ${request.status}.`,
        "Public wording is intentionally generic until a maintainer writes approved copy."
      ].join(" "),
      publicSummary:
        "A roadmap update may be ready. Review this private draft and write approved public wording before publishing.",
      reasons: [`Linked ${roadmapItem.lane} roadmap item`, `${roadmapItem.confidence} confidence`],
      requestIds: [request.id],
      roadmapItemIds: [roadmapItem.id],
      sourceKey: `roadmap:${roadmapItem.id}`,
      sourceType: "Roadmap",
      title: "Review roadmap item for changelog",
      workItemIds: [...roadmapItem.workItemIds]
    };
  }

  return {
    privateNotes: [
      "Assistant draft; review before publishing.",
      `Request status: ${request.status}.`,
      `${request.votes} votes and ${request.comments.length} comments.`,
      "Public wording is intentionally generic until a maintainer writes approved copy."
    ].join(" "),
    publicSummary:
      "A request update may be ready. Review this private draft and write approved public wording before publishing.",
    reasons: ["Selected request context", `Request signal: ${request.votes} votes`],
    requestIds: [request.id],
    roadmapItemIds: [],
    sourceKey: "manual",
    sourceType: "Manual",
    title: "Review request for changelog",
    workItemIds: []
  };
}

function scoreDuplicateCandidate(
  selectedRequest: RequestItem,
  candidate: RequestItem
): AssistantDuplicateSuggestion {
  const titleOverlap = intersect(
    tokenSet(selectedRequest.title),
    tokenSet(candidate.title)
  );
  const descriptionOverlap = intersect(
    tokenSet(selectedRequest.description),
    tokenSet(candidate.description)
  ).filter((term) => !titleOverlap.includes(term));
  const tagOverlap = intersect(
    new Set(selectedRequest.tags.map(normalizeTerm)),
    new Set(candidate.tags.map(normalizeTerm))
  );
  const reasons: string[] = [];
  let score = 0;

  if (tagOverlap.length) {
    score += tagOverlap.length * 35;
    reasons.push(`Tag overlap: ${tagOverlap.join(", ")}`);
  }
  if (titleOverlap.length) {
    score += titleOverlap.length * 20;
    reasons.push(`Title terms: ${titleOverlap.slice(0, 4).join(", ")}`);
  }
  if (descriptionOverlap.length) {
    score += Math.min(24, descriptionOverlap.length * 8);
    reasons.push(`Description terms: ${descriptionOverlap.slice(0, 4).join(", ")}`);
  }
  if (normalizeTerm(selectedRequest.requester) === normalizeTerm(candidate.requester)) {
    score += 12;
    reasons.push(`Requester match: ${candidate.requester}`);
  }
  if (normalizeTerm(selectedRequest.source) === normalizeTerm(candidate.source)) {
    score += 8;
    reasons.push(`Source match: ${candidate.source}`);
  }
  if (selectedRequest.status === candidate.status) {
    score += 4;
    reasons.push(`Same status: ${candidate.status}`);
  }

  const sameRequester =
    normalizeTerm(selectedRequest.requester) === normalizeTerm(candidate.requester);
  const sameSource = normalizeTerm(selectedRequest.source) === normalizeTerm(candidate.source);
  const hasTextSignal = titleOverlap.length > 0 || descriptionOverlap.length >= 2;
  const hasStrongNonTextSignal = tagOverlap.length >= 2 && (sameRequester || sameSource);
  if (!hasTextSignal && !hasStrongNonTextSignal) {
    score = Math.min(score, weakDuplicateScore - 1);
  }

  return { request: candidate, reasons, score };
}

function summarizeProblem(request: RequestItem) {
  const source = request.description.trim() || request.title.trim();
  return limitText(source, 170);
}

function nextActionForRequest(request: RequestItem) {
  if (request.archived) return "No action needed while archived.";
  if (request.status === "New" && request.votes >= 80) {
    return "Review duplicate risk, assign an owner, then decide if this should move to roadmap.";
  }
  if (request.status === "Needs decision") {
    return "Resolve the owner or scope decision before adding delivery work.";
  }
  if (request.status === "Planned") {
    return "Keep linked delivery work current and prepare a draft once work is Done.";
  }
  if (request.status === "Shipping soon") {
    return "Prepare public changelog wording and requester updates.";
  }
  return "Keep gathering signal or link the next concrete delivery step.";
}

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((term) => term.trim())
      .filter((term) => term.length > 2 && !stopWords.has(term))
  );
}

function intersect(left: Set<string>, right: Set<string>) {
  return Array.from(left).filter((term) => right.has(term)).sort();
}

function normalizeTerm(value: string) {
  return value.trim().toLowerCase();
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trim()}...`;
}
