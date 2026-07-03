import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOpenRoadState,
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

    expect(importWorkspaceFromJson(exported)).toMatchObject({
      id: "acme",
      name: "Acme OSS"
    });
  });

  it("rejects invalid workspace imports", () => {
    expect(() => importWorkspaceFromJson("{}")).toThrow("schema version");
    expect(() => importWorkspaceFromJson("not-json")).toThrow("valid JSON");
  });
});
