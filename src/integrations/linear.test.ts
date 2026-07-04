import { describe, expect, it } from "vitest";

import { createExternalObjectKey, validateProviderFixture } from "./adapter";
import {
  createLinearInstallation,
  createLinearIssueExternalRef,
  createLinearIssueFixture,
  createLinearIssueMapping,
  createOpenRoadRequestFromLinearIssue,
  getLinearInstallationCapabilities,
  mapLinearIssueToRequestStatus,
  parseLinearIssuePayload,
  syncOpenRoadRequestFromLinearIssue
} from "./linear";

describe("Linear issue integration", () => {
  it("parses GraphQL/webhook-like Linear issue payloads", () => {
    const issue = parseLinearIssuePayload(linearIssuePayload());

    expect(issue).toMatchObject({
      assignee: "Akhil Trivedi",
      body: "Users want Linear issue context.",
      creator: "Customer Ops",
      id: "lin-issue-123",
      identifier: "OPEN-42",
      labels: ["needs-decision", "ux"],
      project: "OpenRoad Beta",
      state: {
        name: "Triage",
        type: "triage"
      },
      team: {
        key: "OPEN",
        name: "OpenRoad"
      },
      title: "Import Linear issues"
    });
  });

  it("rejects incomplete Linear issue payloads", () => {
    expect(() => parseLinearIssuePayload({ ...linearIssuePayload(), id: "" })).toThrow(
      "Linear issue id"
    );
    expect(() => parseLinearIssuePayload({ ...linearIssuePayload(), identifier: "" })).toThrow(
      "Linear issue identifier"
    );
    expect(() => parseLinearIssuePayload({ ...linearIssuePayload(), title: "" })).toThrow(
      "Linear issue title"
    );
    expect(() => parseLinearIssuePayload({ ...linearIssuePayload(), team: {} })).toThrow(
      "Linear team id"
    );
  });

  it("maps Linear workflow state into OpenRoad request status conservatively", () => {
    expect(mapLinearIssueToRequestStatus(parseLinearIssuePayload(linearIssuePayload()))).toBe(
      "Needs decision"
    );
    expect(
      mapLinearIssueToRequestStatus(
        parseLinearIssuePayload(
          linearIssuePayload({
            labels: { nodes: [] },
            state: { id: "state-started", name: "In Progress", type: "started" }
          })
        )
      )
    ).toBe("Planned");
    expect(
      mapLinearIssueToRequestStatus(
        parseLinearIssuePayload(
          linearIssuePayload({
            assignee: null,
            labels: { nodes: [] },
            project: null,
            state: { id: "state-new", name: "Inbox", type: "unstarted" }
          })
        )
      )
    ).toBe("Planned");
    expect(
      mapLinearIssueToRequestStatus(
        parseLinearIssuePayload(
          linearIssuePayload({
            labels: { nodes: [] },
            state: { id: "state-done", name: "Done", type: "completed" }
          })
        )
      )
    ).toBe("Shipping soon");
  });

  it("creates private OpenRoad requests without provider-specific schema fields", () => {
    const issue = parseLinearIssuePayload(linearIssuePayload());
    const request = createOpenRoadRequestFromLinearIssue(issue, {
      existingRequestIds: [],
      now: "2026-07-04T00:00:00.000Z"
    });

    expect(request).toMatchObject({
      archived: false,
      hasCurrentUserVote: false,
      owner: "Maintainer",
      requester: "Customer Ops",
      source: "Linear",
      title: "Import Linear issues",
      visibility: "Private",
      votes: 0
    });
    expect(Object.keys(request)).not.toContain("linear");
    expect(request.comments[0]).toMatchObject({
      author: "Linear",
      visibility: "Internal"
    });
    expect(request.tags).toEqual(
      expect.arrayContaining(["linear", "team:OPEN", "linear:needs-decision"])
    );
  });

  it("syncs existing requests without duplicating Linear sync comments", () => {
    const issue = parseLinearIssuePayload(linearIssuePayload());
    const request = createOpenRoadRequestFromLinearIssue(issue, {
      now: "2026-07-04T00:00:00.000Z"
    });
    const updatedIssue = parseLinearIssuePayload(
      linearIssuePayload({
        labels: { nodes: [{ name: "planned" }] },
        state: { id: "state-started", name: "Started", type: "started" },
        title: "Updated Linear issue"
      })
    );
    const syncedOnce = syncOpenRoadRequestFromLinearIssue(
      request,
      updatedIssue,
      "2026-07-04T01:00:00.000Z"
    );
    const syncedTwice = syncOpenRoadRequestFromLinearIssue(
      syncedOnce,
      updatedIssue,
      "2026-07-04T02:00:00.000Z"
    );

    expect(syncedTwice.title).toBe("Updated Linear issue");
    expect(syncedTwice.status).toBe("Planned");
    expect(syncedTwice.comments.filter((comment) => comment.author === "Linear")).toHaveLength(1);
  });

  it("uses Linear provider ids for issue mapping identity", () => {
    const installation = createInstallation();
    const issue = parseLinearIssuePayload(linearIssuePayload({ id: "lin-issue-42" }));
    const collision = parseLinearIssuePayload(
      linearIssuePayload({
        id: "lin-other-workspace-42",
        team: { id: "team-other", key: "OPEN", name: "Other OpenRoad" }
      })
    );
    const openRoad = {
      id: "request-1",
      type: "request" as const,
      workspaceId: "acme"
    };
    const mapping = createLinearIssueMapping(
      installation,
      issue,
      openRoad,
      "2026-07-04T00:00:00.000Z"
    );

    expect(createExternalObjectKey(createLinearIssueExternalRef(issue))).not.toBe(
      createExternalObjectKey(createLinearIssueExternalRef(collision))
    );
    expect(mapping.external.type).toBe("issue");
    expect(mapping.openRoad).toEqual(openRoad);
  });

  it("validates Linear installation capabilities and provider fixtures", () => {
    const installation = createInstallation();
    const issue = parseLinearIssuePayload(linearIssuePayload());
    const fixture = createLinearIssueFixture(issue, installation, "request-1");

    expect(getLinearInstallationCapabilities(installation)).toMatchObject({
      canImportIssues: true,
      canReceiveWebhooks: false,
      canWriteBackToLinear: false
    });
    expect(validateProviderFixture(fixture)).toBe(fixture);
    expect(() =>
      createLinearInstallation({
        accountId: "linear-team",
        accountName: "OpenRoad",
        id: "linear-install",
        permissions: ["read:external", "read:openroad"],
        workspaceId: "acme"
      })
    ).toThrow("write:openroad");
  });
});

function createInstallation() {
  return createLinearInstallation({
    accountId: "linear-team",
    accountName: "OpenRoad",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "linear-install",
    workspaceId: "acme"
  });
}

function linearIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    assignee: { displayName: "Akhil Trivedi", id: "user-akhil" },
    creator: { displayName: "Customer Ops", id: "user-ops" },
    description: "Users want Linear issue context.",
    id: "lin-issue-123",
    identifier: "OPEN-42",
    labels: { nodes: [{ name: "needs-decision" }, { name: "ux" }] },
    priority: 2,
    project: { id: "project-beta", name: "OpenRoad Beta" },
    state: { id: "state-triage", name: "Triage", type: "triage" },
    team: { id: "team-open", key: "OPEN", name: "OpenRoad" },
    title: "Import Linear issues",
    updatedAt: "2026-07-04T00:00:00Z",
    url: "https://linear.app/openroad/issue/OPEN-42/import-linear-issues",
    ...overrides
  };
}
