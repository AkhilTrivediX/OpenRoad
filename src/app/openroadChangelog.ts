import type {
  ChangelogItem,
  RoadmapItem,
  WorkItem,
  Workspace
} from "../domain/openroad";

export type ChangelogSourceChoice = {
  label: string;
  privateNotes: string;
  publicSummary: string;
  requestIds: string[];
  roadmapItemIds: string[];
  sourceKey: string;
  sourceType: ChangelogItem["sourceType"];
  title: string;
  workItemIds: string[];
};

export function createChangelogSourceChoices(
  workItems: WorkItem[],
  roadmapItems: RoadmapItem[]
): ChangelogSourceChoice[] {
  const manualChoice: ChangelogSourceChoice = {
    label: "Manual draft",
    privateNotes: "",
    publicSummary: "",
    requestIds: [],
    roadmapItemIds: [],
    sourceKey: "manual",
    sourceType: "Manual",
    title: "",
    workItemIds: []
  };
  const workChoices = workItems
    .filter((workItem) => workItem.status === "Done")
    .map((workItem) => ({
      label: `Done work: ${workItem.title}`,
      privateNotes: [
        `Source: ${workItem.title}`,
        workItem.owner !== "Unassigned" ? `Owner: ${workItem.owner}` : null,
        workItem.targetDate ? `Target date: ${workItem.targetDate}` : null
      ]
        .filter(Boolean)
        .join(". "),
      publicSummary: workItem.description || `${workItem.title} is now available.`,
      requestIds: [...workItem.requestIds],
      roadmapItemIds: [],
      sourceKey: `work:${workItem.id}`,
      sourceType: "Work" as const,
      title: workItem.title,
      workItemIds: [workItem.id]
    }));
  const roadmapChoices = roadmapItems.map((roadmapItem) => ({
    label: `Roadmap: ${roadmapItem.title}`,
    privateNotes: [
      `Roadmap lane: ${roadmapItem.lane}`,
      `Visibility: ${roadmapItem.visibility}`,
      `${roadmapItem.confidence} confidence`
    ].join(". "),
    publicSummary: roadmapItem.summary || `${roadmapItem.title} is moving forward.`,
    requestIds: [...roadmapItem.requestIds],
    roadmapItemIds: [roadmapItem.id],
    sourceKey: `roadmap:${roadmapItem.id}`,
    sourceType: "Roadmap" as const,
    title: roadmapItem.title,
    workItemIds: [...roadmapItem.workItemIds]
  }));

  return [manualChoice, ...workChoices, ...roadmapChoices];
}

export function changelogSourceLabel(
  changelogItem: ChangelogItem,
  workspace: Pick<Workspace, "workItems">,
  roadmapItems: RoadmapItem[]
) {
  if (changelogItem.sourceType === "Manual") return "Manual draft";
  if (changelogItem.sourceType === "Work") {
    const workItem = workspace.workItems.find((item) => item.id === changelogItem.sourceId);
    return workItem ? `Work: ${workItem.title}` : "Work source removed";
  }
  const roadmapItem = roadmapItems.find((item) => item.id === changelogItem.sourceId);
  return roadmapItem ? `Roadmap: ${roadmapItem.title}` : "Roadmap source removed";
}
