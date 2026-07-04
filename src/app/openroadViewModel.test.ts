import { describe, expect, it } from "vitest";

import {
  createInitialOpenRoadState,
  type MergedRequestSource,
  type RequestComment,
  type RequestItem
} from "../domain/openroad";
import {
  flattenRoadmap,
  parseTags,
  requestMatchesQuery,
  requestMatchesTriageView,
  resolveInitialWorkspaceId,
  statusTone
} from "./openroadViewModel";

describe("openroad view model helpers", () => {
  it("resolves a selected workspace only when it still exists", () => {
    const state = createInitialOpenRoadState();
    const existingWorkspaceId = state.workspaces[1].id;

    expect(resolveInitialWorkspaceId(state, existingWorkspaceId)).toBe(existingWorkspaceId);
    expect(resolveInitialWorkspaceId(state, "missing")).toBe(state.workspaces[0].id);
    expect(resolveInitialWorkspaceId({ schemaVersion: state.schemaVersion, workspaces: [] }, null)).toBe(
      "acme"
    );
  });

  it("normalizes and deduplicates comma-separated tags", () => {
    expect(parseTags(" Roadmap, Enterprise, roadmap ,, Bugs ")).toEqual([
      "roadmap",
      "enterprise",
      "bugs"
    ]);
  });

  it("matches request search across comments and merged sources", () => {
    const request = createRequest({
      comments: [{ author: "Maya", body: "The billing team asked for this." }],
      mergedSources: [{ title: "Stripe export", requester: "Finance", source: "Support", tags: ["billing"] }]
    });

    expect(requestMatchesQuery(request, "billing team")).toBe(true);
    expect(requestMatchesQuery(request, "stripe")).toBe(true);
    expect(requestMatchesQuery(request, "unrelated")).toBe(false);
    expect(requestMatchesQuery(request, " ")).toBe(true);
  });

  it("preserves triage view semantics and status tones", () => {
    expect(requestMatchesTriageView(createRequest({ owner: "Unassigned" }), "unassigned")).toBe(true);
    expect(requestMatchesTriageView(createRequest({ status: "Needs decision" }), "needs-decision")).toBe(true);
    expect(requestMatchesTriageView(createRequest({ votes: 80 }), "high-signal")).toBe(true);
    expect(requestMatchesTriageView(createRequest({ comments: [{ body: "Please", author: "Akhil" }] }), "high-signal")).toBe(true);
    expect(statusTone("Planned")).toBe("success");
    expect(statusTone("In progress")).toBe("info");
    expect(statusTone("Draft")).toBe("warning");
    expect(statusTone("New")).toBe("neutral");
  });

  it("flattens roadmap lanes in product lane order", () => {
    const state = createInitialOpenRoadState();
    const workspace = state.workspaces[0];
    const flattened = flattenRoadmap(workspace.roadmap);

    expect(flattened.map((item) => item.lane)).toEqual([
      ...workspace.roadmap.Now.map((item) => item.lane),
      ...workspace.roadmap.Next.map((item) => item.lane),
      ...workspace.roadmap.Later.map((item) => item.lane)
    ]);
  });
});

type RequestFixtureOverrides = Partial<Omit<RequestItem, "comments" | "mergedSources">> & {
  comments?: Array<Pick<RequestComment, "author" | "body"> & Partial<RequestComment>>;
  mergedSources?: Array<
    Pick<MergedRequestSource, "requester" | "source" | "tags" | "title"> &
      Partial<MergedRequestSource>
  >;
};

function createRequest(overrides: RequestFixtureOverrides = {}): RequestItem {
  const { comments, mergedSources, ...requestOverrides } = overrides;

  return {
    age: "Today",
    archived: false,
    comments:
      comments?.map((comment, index) => ({
        age: "Today",
        id: `comment-${index}`,
        visibility: "Internal",
        ...comment
      })) ?? [],
    description: "Improve customer exports.",
    hasCurrentUserVote: false,
    publicVoterKeys: [],
    id: "req-test",
    mergedSources:
      mergedSources?.map((source, index) => ({
        age: "Today",
        commentCount: 0,
        description: "Merged source",
        hasCurrentUserVote: false,
        id: `source-${index}`,
        mergedAt: "Today",
        owner: "Product",
        status: "New",
        votes: 0,
        ...source
      })) ?? [],
    owner: "Product",
    requester: "Akhil",
    source: "Manual",
    status: "New",
    tags: ["export"],
    title: "Export roadmap",
    visibility: "Private",
    votes: 0,
    ...requestOverrides
  };
}
