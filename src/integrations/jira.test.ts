import { describe, expect, it } from "vitest";

import { createExternalObjectKey, validateProviderFixture } from "./adapter";
import {
  createJiraInstallation,
  createJiraIssueExternalRef,
  createJiraIssueFixture,
  createJiraIssueMapping,
  createOpenRoadRequestFromJiraIssue,
  getJiraInstallationCapabilities,
  mapJiraIssueToRequestStatus,
  parseJiraIssuePayload,
  syncOpenRoadRequestFromJiraIssue
} from "./jira";

describe("Jira issue integration", () => {
  it("parses Jira Cloud REST/webhook-like issue payloads", () => {
    const issue = parseJiraIssuePayload(jiraIssuePayload());

    expect(issue).toMatchObject({
      assignee: "Akhil Trivedi",
      body: "Users need Jira context.\nKeep the roadmap calm.",
      cloudId: "cloud-123",
      id: "10042",
      issueType: "Story",
      key: "OPEN-42",
      labels: ["needs-decision", "ux"],
      priority: "High",
      project: {
        key: "OPEN",
        name: "OpenRoad"
      },
      reporter: "Customer Ops",
      status: {
        category: {
          key: "new",
          name: "To Do"
        },
        name: "Triage"
      },
      title: "Import Jira issues"
    });
  });

  it("rejects incomplete Jira issue payloads", () => {
    expect(() => parseJiraIssuePayload({ ...jiraIssuePayload(), id: "" })).toThrow(
      "Jira issue id"
    );
    expect(() => parseJiraIssuePayload({ ...jiraIssuePayload(), key: "" })).toThrow(
      "Jira issue key"
    );
    expect(() =>
      parseJiraIssuePayload({ ...jiraIssuePayload(), fields: { ...jiraFields(), summary: "" } })
    ).toThrow("Jira issue summary");
    expect(() =>
      parseJiraIssuePayload({ ...jiraIssuePayload(), fields: { ...jiraFields(), project: {} } })
    ).toThrow("Jira project id");
  });

  it("drops sensitive URL query strings before creating OpenRoad records", () => {
    const issue = parseJiraIssuePayload(
      jiraIssuePayload({
        url: "https://openroad.atlassian.net/browse/OPEN-42?access_token=raw-secret#activity"
      })
    );
    const request = createOpenRoadRequestFromJiraIssue(issue, {
      now: "2026-07-04T00:00:00.000Z"
    });

    expect(issue.url).toBe("https://openroad.atlassian.net/browse/OPEN-42");
    expect(JSON.stringify(request)).not.toContain("raw-secret");
    expect(JSON.stringify(request)).not.toContain("access_token");
  });

  it("maps Jira status category and labels into OpenRoad status conservatively", () => {
    expect(mapJiraIssueToRequestStatus(parseJiraIssuePayload(jiraIssuePayload()))).toBe(
      "Needs decision"
    );
    expect(
      mapJiraIssueToRequestStatus(
        parseJiraIssuePayload(
          jiraIssuePayload({
            fields: jiraFields({
              assignee: null,
              labels: [],
              status: {
                id: "3",
                name: "To Do",
                statusCategory: { key: "new", name: "To Do" }
              }
            })
          })
        )
      )
    ).toBe("New");
    expect(
      mapJiraIssueToRequestStatus(
        parseJiraIssuePayload(
          jiraIssuePayload({
            fields: jiraFields({
              labels: [],
              status: {
                id: "4",
                name: "In Progress",
                statusCategory: { key: "indeterminate", name: "In Progress" }
              }
            })
          })
        )
      )
    ).toBe("Planned");
    expect(
      mapJiraIssueToRequestStatus(
        parseJiraIssuePayload(
          jiraIssuePayload({
            fields: jiraFields({
              labels: [],
              status: {
                id: "5",
                name: "Done",
                statusCategory: { key: "done", name: "Done" }
              }
            })
          })
        )
      )
    ).toBe("Shipping soon");
  });

  it("creates private OpenRoad requests without provider-specific schema fields", () => {
    const issue = parseJiraIssuePayload(jiraIssuePayload());
    const request = createOpenRoadRequestFromJiraIssue(issue, {
      existingRequestIds: [],
      now: "2026-07-04T00:00:00.000Z"
    });

    expect(request).toMatchObject({
      archived: false,
      hasCurrentUserVote: false,
      publicVoterKeys: [],
      owner: "Maintainer",
      requester: "Customer Ops",
      source: "Jira",
      title: "Import Jira issues",
      visibility: "Private",
      votes: 0
    });
    expect(Object.keys(request)).not.toContain("jira");
    expect(request.comments[0]).toMatchObject({
      author: "Jira",
      visibility: "Internal"
    });
    expect(request.tags).toEqual(
      expect.arrayContaining(["jira", "project:OPEN", "jira:type:Story"])
    );
    expect(request.description).toContain("Project: OpenRoad (OPEN)");
  });

  it("syncs existing requests without duplicating Jira sync comments", () => {
    const issue = parseJiraIssuePayload(jiraIssuePayload());
    const request = createOpenRoadRequestFromJiraIssue(issue, {
      now: "2026-07-04T00:00:00.000Z"
    });
    const updatedIssue = parseJiraIssuePayload(
      jiraIssuePayload({
        fields: jiraFields({
          labels: ["planned"],
          status: {
            id: "4",
            name: "In Progress",
            statusCategory: { key: "indeterminate", name: "In Progress" }
          },
          summary: "Updated Jira issue"
        })
      })
    );
    const syncedOnce = syncOpenRoadRequestFromJiraIssue(
      request,
      updatedIssue,
      "2026-07-04T01:00:00.000Z"
    );
    const syncedTwice = syncOpenRoadRequestFromJiraIssue(
      syncedOnce,
      updatedIssue,
      "2026-07-04T02:00:00.000Z"
    );

    expect(syncedTwice.title).toBe("Updated Jira issue");
    expect(syncedTwice.status).toBe("Planned");
    expect(syncedTwice.comments.filter((comment) => comment.author === "Jira")).toHaveLength(1);
  });

  it("uses Jira provider ids for issue mapping identity", () => {
    const installation = createInstallation();
    const issue = parseJiraIssuePayload(jiraIssuePayload({ id: "10042" }));
    const collision = parseJiraIssuePayload(
      jiraIssuePayload({
        fields: jiraFields({
          project: { id: "project-other", key: "OPEN", name: "Other OpenRoad" }
        }),
        id: "10042",
        self: "https://api.atlassian.com/ex/jira/cloud-other/rest/api/3/issue/10042"
      })
    );
    const openRoad = {
      id: "request-1",
      type: "request" as const,
      workspaceId: "acme"
    };
    const mapping = createJiraIssueMapping(
      installation,
      issue,
      openRoad,
      "2026-07-04T00:00:00.000Z"
    );

    expect(createExternalObjectKey(createJiraIssueExternalRef(issue))).not.toBe(
      createExternalObjectKey(createJiraIssueExternalRef(collision))
    );
    expect(mapping.external.type).toBe("issue");
    expect(mapping.openRoad).toEqual(openRoad);
  });

  it("validates Jira installation capabilities and provider fixtures", () => {
    const installation = createInstallation();
    const secondSiteInstallation = createJiraInstallation({
      accountId: "jira-cloud-other",
      accountName: "Other OpenRoad Jira",
      createdAt: "2026-07-04T00:00:00.000Z",
      id: "jira-install",
      workspaceId: "acme"
    });
    const issue = parseJiraIssuePayload(jiraIssuePayload());
    const fixture = createJiraIssueFixture(issue, installation, "request-1");

    expect(installation.id).toBe("jira-install-jira-cloud");
    expect(secondSiteInstallation.id).toBe("jira-install-jira-cloud-other");
    expect(getJiraInstallationCapabilities(installation)).toMatchObject({
      canImportIssues: true,
      canReceiveWebhooks: false,
      canWriteBackToJira: false
    });
    expect(validateProviderFixture(fixture)).toBe(fixture);
    expect(() =>
      createJiraInstallation({
        accountId: "jira-cloud",
        accountName: "OpenRoad Jira",
        id: "jira-install",
        permissions: ["read:external", "read:openroad"],
        workspaceId: "acme"
      })
    ).toThrow("write:openroad");
  });
});

function createInstallation() {
  return createJiraInstallation({
    accountId: "jira-cloud",
    accountName: "OpenRoad Jira",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "jira-install",
    workspaceId: "acme"
  });
}

function jiraIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    fields: jiraFields(),
    id: "10042",
    key: "OPEN-42",
    self: "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/10042",
    url: "https://openroad.atlassian.net/browse/OPEN-42",
    ...overrides
  };
}

function jiraFields(overrides: Record<string, unknown> = {}) {
  return {
    assignee: { accountId: "acct-akhil", displayName: "Akhil Trivedi" },
    description: {
      content: [
        {
          content: [{ text: "Users need Jira context.", type: "text" }],
          type: "paragraph"
        },
        {
          content: [{ text: "Keep the roadmap calm.", type: "text" }],
          type: "paragraph"
        }
      ],
      type: "doc",
      version: 1
    },
    issuetype: { id: "10001", name: "Story" },
    labels: ["needs-decision", "ux"],
    priority: { id: "2", name: "High" },
    project: { id: "project-open", key: "OPEN", name: "OpenRoad" },
    reporter: { accountId: "acct-ops", displayName: "Customer Ops" },
    status: {
      id: "3",
      name: "Triage",
      statusCategory: { key: "new", name: "To Do" }
    },
    summary: "Import Jira issues",
    updated: "2026-07-04T00:00:00.000+0000",
    ...overrides
  };
}
