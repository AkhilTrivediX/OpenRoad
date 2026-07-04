import { describe, expect, it } from "vitest";

import { createInitialOpenRoadState, type ChangelogItem, type WorkItem } from "../domain/openroad";
import { changelogSourceLabel, createChangelogSourceChoices } from "./openroadChangelog";
import { flattenRoadmap } from "./openroadViewModel";

describe("openroad changelog helpers", () => {
  it("creates changelog source choices from manual, done work, and roadmap items", () => {
    const workspace = createInitialOpenRoadState().workspaces[0];
    const choices = createChangelogSourceChoices(
      [createWorkItem({ status: "Done" }), createWorkItem({ id: "backlog", status: "Backlog", title: "Backlog task" })],
      flattenRoadmap(workspace.roadmap)
    );

    expect(choices[0]).toMatchObject({ label: "Manual draft", sourceKey: "manual" });
    expect(choices.some((choice) => choice.sourceKey.startsWith("work:"))).toBe(true);
    expect(choices.every((choice) => !choice.label.includes("Backlog"))).toBe(true);
    expect(choices.some((choice) => choice.sourceKey.startsWith("roadmap:"))).toBe(true);
  });

  it("labels changelog sources and handles removed source objects", () => {
    const workspace = createInitialOpenRoadState().workspaces[0];
    const roadmapItems = flattenRoadmap(workspace.roadmap);
    const doneWork = createWorkItem({ status: "Done" });
    const sourceWorkspace = { workItems: [doneWork] };
    const roadmapItem = roadmapItems[0];

    expect(changelogSourceLabel(createChangelog({ sourceType: "Manual" }), sourceWorkspace, roadmapItems)).toBe(
      "Manual draft"
    );
    expect(
      changelogSourceLabel(
        createChangelog({ sourceId: doneWork?.id, sourceType: "Work" }),
        sourceWorkspace,
        roadmapItems
      )
    ).toBe(`Work: ${doneWork?.title}`);
    expect(
      changelogSourceLabel(
        createChangelog({ sourceId: roadmapItem.id, sourceType: "Roadmap" }),
        sourceWorkspace,
        roadmapItems
      )
    ).toBe(`Roadmap: ${roadmapItem.title}`);
    expect(changelogSourceLabel(createChangelog({ sourceId: "missing", sourceType: "Work" }), sourceWorkspace, roadmapItems)).toBe(
      "Work source removed"
    );
  });
});

function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    comments: [],
    createdAt: "Today",
    description: "Ready to publish.",
    id: "done-work",
    owner: "Akhil",
    requestIds: ["api-rate-limit-visibility"],
    status: "Done",
    targetDate: "2026-07-04",
    title: "Audit event export",
    ...overrides
  };
}

function createChangelog(overrides: Partial<ChangelogItem>): ChangelogItem {
  return {
    createdAt: "Today",
    id: "changelog-test",
    privateNotes: "",
    publicSummary: "",
    requestIds: [],
    roadmapItemIds: [],
    sourceId: "",
    sourceType: "Manual",
    state: "Draft",
    title: "Changelog test",
    updatedAt: "Today",
    visibility: "Private",
    workItemIds: [],
    ...overrides
  };
}
