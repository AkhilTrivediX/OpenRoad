import { describe, expect, it } from "vitest";

import { createExternalObjectKey, validateProviderFixture } from "./adapter";
import {
  createGitHubInstallation,
  createGitHubIssueExternalRef,
  createGitHubIssueFixture,
  createGitHubIssueMapping,
  createGitHubPullRequestMapping,
  createOpenRoadRequestFromGitHubIssue,
  getGitHubInstallationCapabilities,
  mapGitHubIssueToRequestStatus,
  parseGitHubIssuePayload,
  parseGitHubPullRequestPayload,
  syncOpenRoadRequestFromGitHubIssue
} from "./github";

describe("GitHub issue integration", () => {
  it("parses REST-like GitHub issue payloads", () => {
    const issue = parseGitHubIssuePayload(gitHubIssuePayload());

    expect(issue).toMatchObject({
      author: "akhil",
      body: "Expose GitHub issue context.",
      id: "I_kwDOGH123",
      labels: ["needs-decision", "ux"],
      milestone: "Beta",
      number: 42,
      repository: {
        fullName: "AkhilTrivediX/OpenRoad",
        id: "R_kwDOR123"
      },
      state: "open",
      title: "Import GitHub issues"
    });
  });

  it("rejects pull requests and incomplete issue payloads", () => {
    expect(() =>
      parseGitHubIssuePayload({
        ...gitHubIssuePayload(),
        pull_request: { html_url: "https://github.com/AkhilTrivediX/OpenRoad/pull/7" }
      })
    ).toThrow("pull requests");
    expect(() =>
      parseGitHubIssuePayload({
        ...gitHubIssuePayload(),
        id: "",
        node_id: ""
      })
    ).toThrow("GitHub issue id");
    expect(() =>
      parseGitHubIssuePayload({
        ...gitHubIssuePayload(),
        title: ""
      })
    ).toThrow("GitHub issue title");
  });

  it("drops sensitive URL query strings before creating OpenRoad records", () => {
    const issue = parseGitHubIssuePayload(
      gitHubIssuePayload({
        html_url: "https://github.com/AkhilTrivediX/OpenRoad/issues/42?access_token=raw-secret#timeline",
        repository: repository({
          html_url: "https://github.com/AkhilTrivediX/OpenRoad?client_secret=raw-secret#readme"
        })
      })
    );
    const pullRequest = parseGitHubPullRequestPayload({
      ...gitHubPullRequestPayload(),
      html_url: "https://github.com/AkhilTrivediX/OpenRoad/pull/7?token=raw-secret#files"
    });
    const request = createOpenRoadRequestFromGitHubIssue(issue);
    const issueMapping = createGitHubIssueExternalRef(issue);

    expect(issue.url).toBe("https://github.com/AkhilTrivediX/OpenRoad/issues/42");
    expect(issue.repository.url).toBe("https://github.com/AkhilTrivediX/OpenRoad");
    expect(pullRequest.url).toBe("https://github.com/AkhilTrivediX/OpenRoad/pull/7");
    expect(issueMapping.url).toBe(issue.url);
    expect(JSON.stringify(request)).not.toContain("raw-secret");
    expect(JSON.stringify(request)).not.toContain("access_token");
  });

  it("maps GitHub issue state into OpenRoad request status conservatively", () => {
    expect(mapGitHubIssueToRequestStatus(parseGitHubIssuePayload(gitHubIssuePayload()))).toBe(
      "Needs decision"
    );
    expect(
      mapGitHubIssueToRequestStatus(
        parseGitHubIssuePayload(gitHubIssuePayload({ labels: [], milestone: { title: "Beta" } }))
      )
    ).toBe("Planned");
    expect(
      mapGitHubIssueToRequestStatus(
        parseGitHubIssuePayload(gitHubIssuePayload({ assignees: [], labels: [], milestone: null }))
      )
    ).toBe("New");
    expect(
      mapGitHubIssueToRequestStatus(
        parseGitHubIssuePayload(gitHubIssuePayload({ labels: [], state: "closed" }))
      )
    ).toBe("Shipping soon");
  });

  it("creates private OpenRoad requests without provider-specific schema fields", () => {
    const issue = parseGitHubIssuePayload(gitHubIssuePayload());
    const request = createOpenRoadRequestFromGitHubIssue(issue, {
      existingRequestIds: [],
      now: "2026-07-04T00:00:00.000Z"
    });

    expect(request).toMatchObject({
      archived: false,
      hasCurrentUserVote: false,
      publicVoterKeys: [],
      owner: "Unassigned",
      requester: "akhil",
      source: "GitHub",
      title: "Import GitHub issues",
      visibility: "Private",
      votes: 0
    });
    expect(Object.keys(request)).not.toContain("github");
    expect(request.comments[0]).toMatchObject({
      author: "GitHub",
      visibility: "Internal"
    });
  });

  it("syncs existing requests without duplicating GitHub sync comments", () => {
    const issue = parseGitHubIssuePayload(gitHubIssuePayload());
    const request = createOpenRoadRequestFromGitHubIssue(issue, {
      now: "2026-07-04T00:00:00.000Z"
    });
    const updatedIssue = parseGitHubIssuePayload(
      gitHubIssuePayload({ labels: [{ name: "planned" }], title: "Updated GitHub issue" })
    );
    const syncedOnce = syncOpenRoadRequestFromGitHubIssue(
      request,
      updatedIssue,
      "2026-07-04T01:00:00.000Z"
    );
    const syncedTwice = syncOpenRoadRequestFromGitHubIssue(
      syncedOnce,
      updatedIssue,
      "2026-07-04T02:00:00.000Z"
    );

    expect(syncedTwice.title).toBe("Updated GitHub issue");
    expect(syncedTwice.status).toBe("Planned");
    expect(syncedTwice.comments.filter((comment) => comment.author === "GitHub")).toHaveLength(1);
  });

  it("uses GitHub provider ids for issue and pull request mapping identity", () => {
    const installation = createInstallation();
    const issue = parseGitHubIssuePayload(gitHubIssuePayload({ number: 42, node_id: "issue-42" }));
    const collision = parseGitHubIssuePayload(
      gitHubIssuePayload({ number: 42, node_id: "issue-other-repo", repository: otherRepository() })
    );
    const pullRequest = parseGitHubPullRequestPayload(gitHubPullRequestPayload());
    const openRoad = {
      id: "request-1",
      type: "request" as const,
      workspaceId: "acme"
    };
    const issueMapping = createGitHubIssueMapping(
      installation,
      issue,
      openRoad,
      "2026-07-04T00:00:00.000Z"
    );
    const pullRequestMapping = createGitHubPullRequestMapping(
      installation,
      pullRequest,
      openRoad,
      "2026-07-04T00:00:00.000Z"
    );

    expect(createExternalObjectKey(createGitHubIssueExternalRef(issue))).not.toBe(
      createExternalObjectKey(createGitHubIssueExternalRef(collision))
    );
    expect(issueMapping.external.type).toBe("issue");
    expect(pullRequestMapping.external.type).toBe("pull-request");
    expect(issueMapping.openRoad).toEqual(openRoad);
    expect(pullRequestMapping.openRoad).toEqual(openRoad);
  });

  it("validates GitHub installation capabilities and provider fixtures", () => {
    const installation = createInstallation();
    const issue = parseGitHubIssuePayload(gitHubIssuePayload());
    const fixture = createGitHubIssueFixture(issue, installation, "request-1");

    expect(getGitHubInstallationCapabilities(installation)).toMatchObject({
      canImportIssues: true,
      canLinkPullRequests: true,
      canReceiveWebhooks: false,
      canWriteBackToGitHub: false
    });
    expect(validateProviderFixture(fixture)).toBe(fixture);
    expect(() =>
      createGitHubInstallation({
        accountId: "AkhilTrivediX",
        accountName: "AkhilTrivediX",
        id: "github-install",
        permissions: ["read:external", "read:openroad"],
        workspaceId: "acme"
      })
    ).toThrow("write:openroad");
  });
});

function createInstallation() {
  return createGitHubInstallation({
    accountId: "AkhilTrivediX",
    accountName: "AkhilTrivediX",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "github-install",
    workspaceId: "acme"
  });
}

function gitHubIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    assignees: [{ login: "maintainer" }],
    body: "Expose GitHub issue context.",
    closed_at: null,
    created_at: "2026-07-04T00:00:00Z",
    html_url: "https://github.com/AkhilTrivediX/OpenRoad/issues/42",
    id: 123,
    labels: [{ name: "needs-decision" }, { name: "ux" }],
    milestone: { title: "Beta" },
    node_id: "I_kwDOGH123",
    number: 42,
    repository: repository(),
    state: "open",
    state_reason: null,
    title: "Import GitHub issues",
    updated_at: "2026-07-04T00:00:00Z",
    user: { login: "akhil" },
    ...overrides
  };
}

function gitHubPullRequestPayload() {
  return {
    body: "Closes #42.",
    html_url: "https://github.com/AkhilTrivediX/OpenRoad/pull/7",
    node_id: "PR_kwDOPR123",
    number: 7,
    repository: repository(),
    state: "open",
    title: "Implement GitHub issue import",
    user: { login: "akhil" }
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    full_name: "AkhilTrivediX/OpenRoad",
    html_url: "https://github.com/AkhilTrivediX/OpenRoad",
    name: "OpenRoad",
    node_id: "R_kwDOR123",
    owner: { login: "AkhilTrivediX" },
    private: false,
    ...overrides
  };
}

function otherRepository() {
  return {
    ...repository(),
    full_name: "AkhilTrivediX/OtherRoad",
    html_url: "https://github.com/AkhilTrivediX/OtherRoad",
    name: "OtherRoad",
    node_id: "R_kwDOR999"
  };
}
