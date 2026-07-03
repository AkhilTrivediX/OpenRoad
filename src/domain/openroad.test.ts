import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOpenRoadState,
  createPublicPortalSnapshot,
  createEntityId,
  createInitialOpenRoadState,
  exportWorkspace,
  importWorkspaceFromJson,
  loadOpenRoadState,
  loadSelectedWorkspaceId,
  migrateOpenRoadState,
  openRoadReducer,
  openRoadSchemaVersion,
  openRoadStorageKey,
  saveOpenRoadState,
  saveSelectedWorkspaceId,
  type ChangelogItem,
  type RoadmapItem,
  type RequestItem,
  type WorkItem
} from "./openroad";

beforeEach(() => {
  localStorage.clear();
});

function sampleRequest(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    id: "request-test",
    title: "Test request",
    description: "A test request.",
    requester: "Tester",
    source: "Manual",
    tags: ["test"],
    votes: 0,
    hasCurrentUserVote: false,
    status: "New",
    owner: "Unassigned",
    visibility: "Private",
    age: "just now",
    archived: false,
    comments: [],
    mergedSources: [],
    ...overrides
  };
}

function sampleWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-test",
    title: "Test work",
    description: "A test work item.",
    owner: "Unassigned",
    status: "Backlog",
    targetDate: "",
    requestIds: [],
    comments: [],
    createdAt: "just now",
    ...overrides
  };
}

function sampleRoadmapItem(overrides: Partial<RoadmapItem> = {}): RoadmapItem {
  return {
    confidence: "Medium",
    createdAt: "just now",
    id: "roadmap-test",
    isStale: false,
    lane: "Next",
    requestIds: [],
    summary: "A roadmap item.",
    title: "Test roadmap",
    updatedAt: "just now",
    visibility: "Private",
    workItemIds: [],
    ...overrides
  };
}

function sampleChangelogItem(overrides: Partial<ChangelogItem> = {}): ChangelogItem {
  return {
    createdAt: "just now",
    id: "changelog-test",
    privateNotes: "Internal rollout notes.",
    publicSummary: "A public release note.",
    requestIds: [],
    roadmapItemIds: [],
    sourceId: "",
    sourceType: "Manual",
    state: "Draft",
    title: "Test changelog",
    updatedAt: "just now",
    visibility: "Private",
    workItemIds: [],
    ...overrides
  };
}

describe("OpenRoad domain state", () => {
  it("creates entity ids with stable prefixes", () => {
    expect(createEntityId("manual", 123)).toBe("manual-123");
  });

  it("creates and replaces requests through reducer actions", () => {
    const state = createInitialOpenRoadState();
    const workspaceId = state.workspaces[0].id;
    const created = openRoadReducer(state, {
      request: sampleRequest(),
      type: "create-request",
      workspaceId
    });
    const editedRequest = {
      ...created.workspaces[0].requests[0],
      owner: "Akhil" as const,
      status: "Planned" as const,
      votes: 4
    };
    const edited = openRoadReducer(created, {
      request: editedRequest,
      type: "replace-request",
      workspaceId
    });

    expect(edited.workspaces[0].requests[0]).toMatchObject({
      id: "request-test",
      owner: "Akhil",
      status: "Planned",
      votes: 4
    });
  });

  it("creates and replaces work items through reducer actions", () => {
    const state = createInitialOpenRoadState();
    const workspaceId = state.workspaces[0].id;
    const created = openRoadReducer(state, {
      type: "create-work-item",
      workItem: sampleWorkItem({ requestIds: ["request-test"] }),
      workspaceId
    });
    const editedWorkItem = {
      ...created.workspaces[0].workItems[0],
      owner: "Product" as const,
      status: "In progress" as const,
      targetDate: "2026-08-02"
    };
    const edited = openRoadReducer(created, {
      type: "replace-work-item",
      workItem: editedWorkItem,
      workspaceId
    });

    expect(edited.workspaces[0].workItems[0]).toMatchObject({
      owner: "Product",
      requestIds: ["request-test"],
      status: "In progress",
      targetDate: "2026-08-02"
    });
  });

  it("creates, moves, links, and removes roadmap items through reducer actions", () => {
    const state = createInitialOpenRoadState();
    const workspaceId = state.workspaces[0].id;
    const created = openRoadReducer(state, {
      roadmapItem: sampleRoadmapItem({
        lane: "Now",
        requestIds: ["api-rate-limit-visibility"],
        workItemIds: ["work-test"]
      }),
      type: "create-roadmap-item",
      workspaceId
    });

    expect(created.workspaces[0].roadmap.Now[0]).toMatchObject({
      lane: "Now",
      requestIds: ["api-rate-limit-visibility"],
      title: "Test roadmap",
      workItemIds: ["work-test"]
    });

    const moved = openRoadReducer(created, {
      roadmapItem: {
        ...created.workspaces[0].roadmap.Now[0],
        confidence: "High",
        isStale: true,
        lane: "Later",
        requestIds: ["api-rate-limit-visibility", "bulk-export-csv"],
        visibility: "Public"
      },
      type: "replace-roadmap-item",
      workspaceId
    });

    expect(moved.workspaces[0].roadmap.Now).not.toContainEqual(
      expect.objectContaining({ id: "roadmap-test" })
    );
    expect(moved.workspaces[0].roadmap.Later[0]).toMatchObject({
      confidence: "High",
      isStale: true,
      lane: "Later",
      requestIds: ["api-rate-limit-visibility", "bulk-export-csv"],
      visibility: "Public"
    });

    const removed = openRoadReducer(moved, {
      roadmapItemId: "roadmap-test",
      type: "delete-roadmap-item",
      workspaceId
    });

    expect(
      removed.workspaces[0].roadmap.Later.some((item) => item.id === "roadmap-test")
    ).toBe(false);
  });

  it("creates, replaces, and removes changelog items through reducer actions", () => {
    const state = createInitialOpenRoadState();
    const workspaceId = state.workspaces[0].id;
    const created = openRoadReducer(state, {
      changelogItem: sampleChangelogItem({
        requestIds: ["api-rate-limit-visibility"],
        workItemIds: ["work-test"]
      }),
      type: "create-changelog-item",
      workspaceId
    });

    expect(created.workspaces[0].changelog[0]).toMatchObject({
      id: "changelog-test",
      requestIds: ["api-rate-limit-visibility"],
      title: "Test changelog",
      visibility: "Private",
      workItemIds: ["work-test"]
    });

    const edited = openRoadReducer(created, {
      changelogItem: {
        ...created.workspaces[0].changelog[0],
        publicSummary: "Ready public wording.",
        state: "Ready",
        visibility: "Public"
      },
      type: "replace-changelog-item",
      workspaceId
    });

    expect(edited.workspaces[0].changelog[0]).toMatchObject({
      publicSummary: "Ready public wording.",
      state: "Ready",
      visibility: "Public"
    });

    const removed = openRoadReducer(edited, {
      changelogItemId: "changelog-test",
      type: "delete-changelog-item",
      workspaceId
    });

    expect(
      removed.workspaces[0].changelog.some((item) => item.id === "changelog-test")
    ).toBe(false);
  });

  it("saves and loads current schema state", () => {
    const state = openRoadReducer(createInitialOpenRoadState(), {
      request: sampleRequest({ title: "Persisted request" }),
      type: "create-request",
      workspaceId: "acme"
    });

    saveOpenRoadState(state);

    const result = loadOpenRoadState();

    expect(result.status).toBe("ready");
    expect(result.state.schemaVersion).toBe(openRoadSchemaVersion);
    expect(result.state.workspaces[0].requests[0].title).toBe("Persisted request");
  });

  it("saves, loads, and clears the selected workspace preference", () => {
    saveSelectedWorkspaceId("workspace-two");

    expect(loadSelectedWorkspaceId()).toBe("workspace-two");

    clearOpenRoadState();

    expect(loadSelectedWorkspaceId()).toBeUndefined();
  });

  it("migrates previous schema workspaces by adding work items", () => {
    const state = createInitialOpenRoadState();
    const previous = {
      schemaVersion: 0,
      workspaces: state.workspaces.map(({ workItems: _workItems, ...workspace }) => workspace)
    };

    const migrated = migrateOpenRoadState(previous);

    expect(migrated.schemaVersion).toBe(openRoadSchemaVersion);
    expect(migrated.workspaces[0].workItems).toEqual([]);
  });

  it("migrates schema version 1 roadmap lane strings into roadmap items", () => {
    const state = createInitialOpenRoadState();
    const previous = {
      schemaVersion: 1,
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        roadmap: {
          Later: ["Legacy later item"],
          Next: [],
          Now: ["Legacy now item"]
        }
      }))
    };

    const migrated = migrateOpenRoadState(previous);

    expect(migrated.schemaVersion).toBe(openRoadSchemaVersion);
    expect(migrated.workspaces[0].roadmap.Now[0]).toMatchObject({
      lane: "Now",
      title: "Legacy now item",
      visibility: "Private"
    });
    expect(migrated.workspaces[0].roadmap.Later[0]).toMatchObject({
      id: "roadmap-later-0-legacy-later-item",
      lane: "Later"
    });
  });

  it("migrates legacy changelog previews into private changelog drafts", () => {
    const state = createInitialOpenRoadState();
    const previous = {
      schemaVersion: 2,
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        changelog: [
          {
            detail: "Internal detail that should stay private.",
            state: "Ready",
            title: "Legacy release note"
          }
        ]
      }))
    };

    const migrated = migrateOpenRoadState(previous);

    expect(migrated.schemaVersion).toBe(openRoadSchemaVersion);
    expect(migrated.workspaces[0].changelog[0]).toMatchObject({
      id: "changelog-0-legacy-release-note",
      privateNotes: "Internal detail that should stay private.",
      publicSummary: "Legacy release note",
      sourceType: "Manual",
      title: "Legacy release note",
      visibility: "Private"
    });
  });

  it("migrates schema version 3 workspaces into portal-ready records", () => {
    const state = createInitialOpenRoadState();
    const previous = {
      schemaVersion: 3,
      workspaces: state.workspaces.map(({ portal: _portal, requests, ...workspace }) => ({
        ...workspace,
        requests: requests.map(({ visibility: _visibility, comments, ...request }) => ({
          ...request,
          comments: comments.map(({ visibility: _commentVisibility, ...comment }) => comment)
        }))
      }))
    };

    const migrated = migrateOpenRoadState(previous);

    expect(migrated.schemaVersion).toBe(openRoadSchemaVersion);
    expect(migrated.workspaces[0].portal).toMatchObject({
      allowComments: true,
      allowVoting: true,
      enabled: true
    });
    expect(migrated.workspaces[0].requests[0]).toMatchObject({
      source: "Portal",
      visibility: "Public"
    });
    expect(migrated.workspaces[0].requests[1]).toMatchObject({
      source: "Email",
      visibility: "Private"
    });
    expect(migrated.workspaces[0].requests[0].comments[0]).toMatchObject({
      visibility: "Internal"
    });
  });

  it("creates public portal snapshots without leaking private workspace data", () => {
    const workspace = createInitialOpenRoadState().workspaces[0];
    const snapshot = createPublicPortalSnapshot(
      {
        ...workspace,
        changelog: [
          sampleChangelogItem({
            id: "public-ready",
            privateNotes: "Secret rollout note.",
            publicSummary: "Public release wording.",
            state: "Ready",
            title: "Public ready release",
            visibility: "Public"
          }),
          sampleChangelogItem({
            id: "public-draft",
            publicSummary: "Draft wording.",
            state: "Draft",
            title: "Draft should stay hidden",
            visibility: "Public"
          }),
          sampleChangelogItem({
            id: "private-ready",
            publicSummary: "Private wording.",
            state: "Ready",
            title: "Private should stay hidden",
            visibility: "Private"
          })
        ],
        requests: [
          sampleRequest({
            comments: [
              {
                age: "just now",
                author: "Visitor",
                body: "Visible public comment.",
                id: "comment-public",
                visibility: "Public"
              },
              {
                age: "just now",
                author: "Team",
                body: "Internal evidence.",
                id: "comment-internal",
                visibility: "Internal"
              },
              {
                age: "just now",
                author: "Visitor",
                body: "Hidden public comment.",
                id: "comment-hidden",
                visibility: "Hidden"
              }
            ],
            description: "Alpha public description.",
            id: "public-alpha",
            source: "Email",
            tags: ["alpha"],
            title: "Alpha public request",
            visibility: "Public"
          }),
          sampleRequest({
            id: "private-alpha",
            title: "Alpha private request",
            visibility: "Private"
          }),
          sampleRequest({
            archived: true,
            id: "archived-alpha",
            title: "Alpha archived request",
            visibility: "Public"
          })
        ],
        roadmap: {
          Later: [
            sampleRoadmapItem({
              id: "public-later",
              lane: "Later",
              title: "Public later",
              visibility: "Public"
            })
          ],
          Next: [],
          Now: [
            sampleRoadmapItem({
              id: "private-now",
              lane: "Now",
              title: "Private now",
              visibility: "Private"
            })
          ]
        }
      },
      "alpha"
    );

    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]).toMatchObject({
      comments: [
        {
          body: "Visible public comment.",
          id: "comment-public"
        }
      ],
      id: "public-alpha",
      title: "Alpha public request"
    });
    expect(snapshot.requests[0]).not.toHaveProperty("owner");
    expect(snapshot.requests[0]).not.toHaveProperty("source");
    expect(snapshot.roadmap.Now).toEqual([]);
    expect(snapshot.roadmap.Later[0]).toMatchObject({
      id: "public-later",
      title: "Public later"
    });
    expect(snapshot.changelog).toHaveLength(1);
    expect(snapshot.changelog[0]).toMatchObject({
      id: "public-ready",
      publicSummary: "Public release wording."
    });
    expect(JSON.stringify(snapshot)).not.toContain("Secret rollout note.");
    expect(JSON.stringify(snapshot)).not.toContain("Internal evidence.");
    expect(JSON.stringify(snapshot)).not.toContain("Hidden public comment.");
    expect(JSON.stringify(snapshot)).not.toContain("Private should stay hidden");
  });

  it("recovers from corrupt persisted data without throwing", () => {
    localStorage.setItem(openRoadStorageKey, "{not-json");

    const result = loadOpenRoadState();

    expect(result.status).toBe("recovered");
    expect(result.state.workspaces[0].id).toBe("acme");
    expect(result.error).toBeTruthy();
  });

  it("rejects unknown future schema", () => {
    expect(() =>
      migrateOpenRoadState({
        schemaVersion: openRoadSchemaVersion + 1,
        workspaces: []
      })
    ).toThrow("newer version");
  });

  it("exports and imports a valid workspace", () => {
    const workspace = createInitialOpenRoadState().workspaces[0];
    const exported = exportWorkspace(workspace);
    const imported = importWorkspaceFromJson(exported);

    expect(imported).toMatchObject({
      id: "acme",
      name: "Acme OSS"
    });
    expect(imported.roadmap.Now[0].title).toBe("API rate limit visibility");
  });

  it("rejects invalid workspace imports", () => {
    const workspace = createInitialOpenRoadState().workspaces[0];

    expect(() => importWorkspaceFromJson("{}")).toThrow("schema version");
    expect(() => importWorkspaceFromJson("not-json")).toThrow("valid JSON");
    expect(() =>
      importWorkspaceFromJson(
        JSON.stringify({
          schemaVersion: openRoadSchemaVersion,
          workspace: {
            ...workspace,
            changelog: [{ title: "Malformed changelog" }]
          }
        })
      )
    ).toThrow("valid workspace");
    expect(() =>
      importWorkspaceFromJson(
        JSON.stringify({
          schemaVersion: openRoadSchemaVersion,
          workspace: {
            ...workspace,
            portal: {
              ...workspace.portal,
              allowVoting: "yes"
            }
          }
        })
      )
    ).toThrow("valid workspace");
    expect(() =>
      importWorkspaceFromJson(
        JSON.stringify({
          schemaVersion: openRoadSchemaVersion,
          workspace: {
            ...workspace,
            requests: [
              {
                ...workspace.requests[0],
                visibility: "External"
              }
            ]
          }
        })
      )
    ).toThrow("valid workspace");
    expect(() =>
      importWorkspaceFromJson(
        JSON.stringify({
          schemaVersion: openRoadSchemaVersion,
          workspace: {
            ...workspace,
            requests: [
              {
                ...workspace.requests[0],
                comments: [
                  {
                    ...workspace.requests[0].comments[0],
                    visibility: "Pending"
                  }
                ]
              }
            ]
          }
        })
      )
    ).toThrow("valid workspace");
  });
});
