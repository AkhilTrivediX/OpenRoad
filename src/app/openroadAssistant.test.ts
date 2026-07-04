import { describe, expect, it } from "vitest";

import {
  createInitialOpenRoadState,
  type RequestItem,
  type WorkItem
} from "../domain/openroad";
import {
  createAssistantChangelogSuggestion,
  createAssistantTriageSuggestion,
  createDuplicateSuggestions,
  createRequestSummary
} from "./openroadAssistant";
import { flattenRoadmap } from "./openroadViewModel";

describe("openroad assistant helpers", () => {
  it("summarizes a request without using private comment bodies", () => {
    const request = createRequest({
      comments: [
        {
          age: "Today",
          author: "Akhil",
          body: "Internal customer escalation detail.",
          id: "internal-comment",
          visibility: "Internal"
        }
      ],
      description: "Users cannot see API rate limits before requests fail.",
      status: "New",
      votes: 120
    });

    const summary = createRequestSummary(request);

    expect(summary.problem).toBe("Users cannot see API rate limits before requests fail.");
    expect(summary.signal).toContain("120 votes, 1 comments");
    expect(summary.state).toBe("New / Product / Private");
    expect(summary.nextAction).toContain("Review duplicate risk");
    expect(JSON.stringify(summary)).not.toContain("Internal customer escalation detail");
  });

  it("ranks duplicate suggestions with specific explanations and excludes unsafe candidates", () => {
    const selected = createRequest({
      description: "Users cannot see API rate limits before requests fail.",
      id: "api-limits",
      requester: "CLI user",
      source: "Portal",
      tags: ["api", "usage"],
      title: "API rate limit visibility"
    });
    const merged = createRequest({
      id: "already-merged",
      tags: ["api", "usage"],
      title: "API limits already merged"
    });
    const requests = [
      selected,
      createRequest({
        id: "api-usage-thresholds",
        description: "Expose API usage thresholds before users hit request limits.",
        requester: "CLI user",
        source: "Portal",
        tags: ["api", "usage"],
        title: "API usage limit warning",
        votes: 98
      }),
      createRequest({
        archived: true,
        id: "archived-api",
        tags: ["api"],
        title: "Archived API request"
      }),
      merged,
      createRequest({
        description: "Single-page guide styling is hard to scan.",
        id: "tag-only-api",
        requester: "Docs reader",
        source: "Email",
        tags: ["api"],
        title: "Reader color contrast"
      }),
      createRequest({
        id: "theme-request",
        description: "Documentation theme preference.",
        tags: ["docs"],
        title: "Dark theme"
      })
    ];
    const suggestions = createDuplicateSuggestions(
      {
        ...selected,
        mergedSources: [{ ...merged, age: "Today", commentCount: 0, mergedAt: "Today" }]
      },
      requests
    );

    expect(suggestions.map((suggestion) => suggestion.request.id)).toEqual([
      "api-usage-thresholds"
    ]);
    expect(suggestions[0].score).toBeGreaterThan(weakScoreFloor);
    expect(suggestions[0].reasons.join(" ")).toContain("Tag overlap: api, usage");
    expect(suggestions[0].reasons.join(" ")).toContain("Requester match: CLI user");
  });

  it("creates changelog suggestions from linked Done work first", () => {
    const request = createRequest({
      id: "exports",
      title: "Bulk export status"
    });
    const suggestion = createAssistantChangelogSuggestion(
      request,
      [
        createWorkItem({
          description: "Bulk export progress is now visible for account admins.",
          id: "done-work",
          requestIds: ["exports"],
          status: "Done",
          title: "Bulk export progress"
        })
      ],
      []
    );

    expect(suggestion).toMatchObject({
      publicSummary:
        "A product update is ready. Review this private draft and write approved public wording before publishing.",
      requestIds: ["exports"],
      sourceKey: "work:done-work",
      sourceType: "Work",
      title: "Review completed work for changelog"
    });
    expect(suggestion.privateNotes).toContain("Assistant draft; review before publishing.");
    expect(suggestion.privateNotes).not.toContain("Bulk export progress");
    expect(suggestion.publicSummary).not.toContain("account admins");
    expect(suggestion.privateNotes).not.toContain("Internal customer escalation detail");
  });

  it("falls back to request context for changelog suggestions without linked Done work", () => {
    const request = createRequest({
      id: "docs-theme",
      title: "Dark mode for docs site"
    });
    const suggestion = createAssistantChangelogSuggestion(request, [], []);

    expect(suggestion).toMatchObject({
      requestIds: ["docs-theme"],
      sourceKey: "manual",
      sourceType: "Manual",
      title: "Review request for changelog",
      workItemIds: []
    });
    expect(suggestion.publicSummary).toBe(
      "A request update may be ready. Review this private draft and write approved public wording before publishing."
    );
    expect(suggestion.publicSummary).not.toContain("Dark mode for docs site");
  });

  it("builds a complete selected-request assistant bundle from workspace context", () => {
    const workspace = createInitialOpenRoadState().workspaces[0];
    const selected = workspace.requests.find((request) => request.id === "api-rate-limit-visibility");
    if (!selected) throw new Error("Fixture request missing.");

    const suggestion = createAssistantTriageSuggestion(
      workspace,
      selected,
      flattenRoadmap(workspace.roadmap)
    );

    expect(suggestion.summary.problem).toContain("API limits");
    expect(suggestion.changelogSuggestion.requestIds).toEqual(["api-rate-limit-visibility"]);
    expect(suggestion.duplicates.every((item) => item.request.id !== selected.id)).toBe(true);
  });
});

const weakScoreFloor = 44;

function createRequest(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    age: "Today",
    archived: false,
    comments: [],
    description: "Improve customer exports.",
    hasCurrentUserVote: false,
    publicVoterKeys: [],
    id: "req-test",
    mergedSources: [],
    owner: "Product",
    requester: "Akhil",
    source: "Manual",
    status: "New",
    tags: ["export"],
    title: "Export roadmap",
    visibility: "Private",
    votes: 0,
    ...overrides
  };
}

function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    comments: [],
    createdAt: "Today",
    description: "Ready to publish.",
    id: "done-work",
    owner: "Akhil",
    requestIds: ["req-test"],
    status: "Done",
    targetDate: "2026-07-04",
    title: "Done work",
    ...overrides
  };
}
