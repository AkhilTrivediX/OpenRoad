import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialOpenRoadState } from "./domain/openroad";
import { App } from "./App";

async function createWorkItem(
  user: ReturnType<typeof userEvent.setup>,
  title = "Build usage meter",
  targetDate = "2026-07-15"
) {
  await user.click(screen.getAllByRole("button", { name: /New work item/ })[0]);
  await user.type(screen.getByLabelText("Work title"), title);
  await user.type(screen.getByLabelText("Work item target date"), targetDate);
  await user.click(screen.getByRole("button", { name: "Create work item" }));
}

async function createRequest(
  user: ReturnType<typeof userEvent.setup>,
  title = "Roadmap evidence"
) {
  await user.click(screen.getAllByRole("button", { name: "Add request" })[0]);
  await user.type(screen.getByLabelText("Request title"), title);
  await user.click(screen.getByRole("button", { name: "Capture request" }));
}

async function createPublicRequest(
  user: ReturnType<typeof userEvent.setup>,
  title = "Public portal request"
) {
  await user.click(screen.getAllByRole("button", { name: "Add request" })[0]);
  await user.type(screen.getByLabelText("Request title"), title);
  await user.selectOptions(screen.getByLabelText("Request visibility"), "Public");
  await user.click(screen.getByRole("button", { name: "Capture request" }));
}

async function createRoadmapItem(
  user: ReturnType<typeof userEvent.setup>,
  title = "Customer-facing roadmap"
) {
  const roadmap = screen.getByRole("region", { name: /Now \/ Next \/ Later/ });
  await user.click(within(roadmap).getAllByRole("button", { name: "New roadmap item" })[0]);
  const form = screen.getByRole("form", { name: "Create roadmap item" });
  await user.type(within(form).getByLabelText("Roadmap title"), title);
  await user.click(screen.getByRole("button", { name: "Create roadmap item" }));
}

describe("OpenRoad workspace shell", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders the shell title and default workspace", () => {
    render(<App />);

    expect(screen.getByLabelText("OpenRoad")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveValue("acme");
    expect(within(screen.getByLabelText("Workspace status")).getByText("Acme OSS")).toBeInTheDocument();
  });

  it("renders only the default navigation items", () => {
    render(<App />);

    const primaryNav = screen.getByLabelText("Primary navigation");
    ["Inbox", "Roadmap", "Changelog", "Portal", "Settings"].forEach((item) => {
      expect(within(primaryNav).getByRole("link", { name: new RegExp(item) })).toBeInTheDocument();
    });

    ["Work", "Prioritize", "Insights", "Sync logs", "Audit"].forEach((item) => {
      expect(within(primaryNav).queryByRole("link", { name: new RegExp(item) })).not.toBeInTheDocument();
    });
  });

  it("keeps primary navigation targets reachable", () => {
    render(<App />);

    const primaryNav = screen.getByLabelText("Primary navigation");
    ["Inbox", "Roadmap", "Changelog", "Portal", "Settings"].forEach((item) => {
      const link = within(primaryNav).getByRole("link", { name: new RegExp(item) });
      const targetId = link.getAttribute("href")?.replace("#", "");

      expect(targetId).toBeTruthy();
      expect(document.getElementById(targetId as string)).toBeInTheDocument();
    });
  });

  it("marks the current hash target in primary navigation", async () => {
    const user = userEvent.setup();
    render(<App />);

    const primaryNav = screen.getByLabelText("Primary navigation");
    const inboxLink = within(primaryNav).getByRole("link", { name: /Inbox/ });
    const settingsLink = within(primaryNav).getByRole("link", { name: "Settings" });

    expect(inboxLink).toHaveAttribute("aria-current", "page");

    await user.click(settingsLink);

    expect(settingsLink).toHaveAttribute("aria-current", "page");
    expect(inboxLink).not.toHaveAttribute("aria-current");
  });

  it("communicates standalone-first use and optional integrations", () => {
    render(<App />);

    expect(screen.getByText("Standalone first")).toBeInTheDocument();
    expect(
      screen.getByText(/Connect GitHub, Jira, or Linear later/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Optional integrations")).toBeInTheDocument();
    expect(screen.getAllByText("Optional")).toHaveLength(3);
  });

  it("renders server integration status in Settings without exposing logs by default", async () => {
    vi.stubEnv("VITE_OPENROAD_SERVER_SYNC", "on");
    const fetchMock = createSettingsIntegrationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("Server metadata")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getByText(/1 linked issue mapping ready for manual sync/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GitHub sync linked issues" })).toBeEnabled();
    expect(screen.queryByText("sync-job-1")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("installation-token");
  });

  it("runs GitHub manual sync from Settings when the server reports support", async () => {
    vi.stubEnv("VITE_OPENROAD_SERVER_SYNC", "on");
    const fetchMock = createSettingsIntegrationFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "GitHub sync linked issues" }));

    expect(await screen.findByText("GitHub linked issue sync completed.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme/integrations/github/sync/jobs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/integrations/sync/run",
      expect.objectContaining({ method: "POST" })
    );
    expect(document.body.textContent).not.toContain("installation-token");
  });

  it("runs Linear manual sync from Settings when the server reports support", async () => {
    vi.stubEnv("VITE_OPENROAD_SERVER_SYNC", "on");
    const fetchMock = createSettingsIntegrationFetchMock({ linearReady: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Linear sync linked issues" }));

    expect(await screen.findByText("Linear linked issue sync completed.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme/integrations/linear/sync/jobs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/integrations/sync/run",
      expect.objectContaining({
        body: JSON.stringify({ limit: 5, provider: "linear", workspaceId: "acme" }),
        method: "POST"
      })
    );
    expect(document.body.textContent).not.toContain("linear-access-secret");
  });

  it("switches workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Workspace" }), "maintainer");

    expect(
      within(screen.getByLabelText("Workspace status")).getByText("Maintainer Lab")
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Contributor guide checklist/ }
      )
    ).toBeInTheDocument();
  });

  it("creates a blank standalone workspace", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Launch Desk");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveDisplayValue("Launch Desk");
    expect(within(screen.getByLabelText("Workspace status")).getByText("Launch Desk")).toBeInTheDocument();
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
    expect(screen.getByText("No request selected")).toBeInTheDocument();
    expect(screen.getByText("No roadmap items yet")).toBeInTheDocument();
    expect(screen.getByText("No changelog drafts")).toBeInTheDocument();
  });

  it("selects request rows and updates the inspector", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Support bulk export to CSV/ }
      )
    );

    expect(
      screen.getByRole("heading", { name: "Support bulk export to CSV" })
    ).toBeInTheDocument();
    expect(screen.getByText("Success team")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("captures a manual request in a blank standalone workspace", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Support Desk");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await user.click(screen.getAllByRole("button", { name: "Add request" })[0]);
    await user.type(screen.getByLabelText("Request title"), "Export customer list");
    await user.click(screen.getByRole("button", { name: "Capture request" }));

    expect(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Export customer list/ }
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Export customer list" })).toBeInTheDocument();
    expect(screen.getByText("Manual capture")).toBeInTheDocument();
    expect(screen.getByText("1 request")).toBeInTheDocument();
  });

  it("renders roadmap and changelog previews", () => {
    render(<App />);

    expect(screen.getByText("Now / Next / Later")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: /Now \/ Next \/ Later/ })).getByRole(
        "heading",
        { name: "API rate limit visibility" }
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Draft queue")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Changelog drafts")).getByRole("button", {
        name: /Inline markdown in comments/
      })
    ).toBeInTheDocument();
  });

  it("keeps roadmap rows scannable and edits only the selected item", async () => {
    const user = userEvent.setup();
    render(<App />);

    const roadmap = screen.getByRole("region", { name: /Now \/ Next \/ Later/ });

    expect(
      within(roadmap).getByRole("complementary", {
        name: "Selected roadmap item API rate limit visibility"
      })
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Lane for /)).toHaveLength(1);

    await user.click(within(roadmap).getByRole("button", { name: /Bulk export to CSV/ }));

    const selectedDetail = within(roadmap).getByRole("complementary", {
      name: "Selected roadmap item Bulk export to CSV"
    });
    expect(within(selectedDetail).getByLabelText("Lane for Bulk export to CSV")).toHaveValue(
      "Next"
    );
    expect(screen.queryByLabelText("Lane for API rate limit visibility")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Lane for /)).toHaveLength(1);
  });

  it("creates and edits roadmap items in a blank workspace", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Roadmap Lab");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    const roadmap = screen.getByRole("region", { name: /Now \/ Next \/ Later/ });
    expect(within(roadmap).getByText("No roadmap items yet")).toBeInTheDocument();

    await user.click(within(roadmap).getAllByRole("button", { name: "New roadmap item" })[0]);
    const form = screen.getByRole("form", { name: "Create roadmap item" });
    await user.type(within(form).getByLabelText("Roadmap title"), "Customer-facing roadmap");
    await user.type(within(form).getByLabelText("Summary"), "Show the next public direction.");
    await user.selectOptions(within(form).getByLabelText("Lane"), "Now");
    await user.selectOptions(within(form).getByLabelText("Visibility"), "Public");
    await user.selectOptions(within(form).getByLabelText("Confidence"), "High");
    await user.click(within(form).getByLabelText("Needs review"));
    await user.click(screen.getByRole("button", { name: "Create roadmap item" }));

    const selectedDetail = screen.getByRole("complementary", {
      name: "Selected roadmap item Customer-facing roadmap"
    });
    expect(
      within(selectedDetail).getByRole("heading", { name: "Customer-facing roadmap" })
    ).toBeInTheDocument();
    expect(within(selectedDetail).getByText("Show the next public direction.")).toBeInTheDocument();
    const roadmapState = within(selectedDetail).getByLabelText(
      "Customer-facing roadmap roadmap state"
    );
    expect(within(roadmapState).getByText("Public")).toBeInTheDocument();
    expect(within(roadmapState).getByText("High confidence")).toBeInTheDocument();
    expect(within(roadmapState).getByText("Needs review")).toBeInTheDocument();

    await user.selectOptions(
      within(selectedDetail).getByLabelText("Lane for Customer-facing roadmap"),
      "Later"
    );

    expect(within(selectedDetail).getByLabelText("Lane for Customer-facing roadmap")).toHaveValue(
      "Later"
    );
  });

  it("links and unlinks requests and work items from roadmap items", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Roadmap Links");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await createRequest(user, "Roadmap evidence");
    await createWorkItem(user, "Ship roadmap evidence", "2026-10-08");

    const roadmap = screen.getByRole("region", { name: /Now \/ Next \/ Later/ });
    await user.click(within(roadmap).getAllByRole("button", { name: "New roadmap item" })[0]);
    const form = screen.getByRole("form", { name: "Create roadmap item" });
    await user.type(within(form).getByLabelText("Roadmap title"), "Evidence-led launch");
    await user.selectOptions(within(form).getByLabelText("Linked request"), "Roadmap evidence");
    await user.click(screen.getByRole("button", { name: "Create roadmap item" }));
    await user.selectOptions(
      screen.getByLabelText("Link work to Evidence-led launch"),
      "Ship roadmap evidence"
    );

    expect(screen.getByLabelText("Requests linked to Evidence-led launch")).toHaveTextContent(
      "Roadmap evidence"
    );
    expect(screen.getByLabelText("Work linked to Evidence-led launch")).toHaveTextContent(
      "Ship roadmap evidence"
    );

    await user.click(
      within(screen.getByLabelText("Requests linked to Evidence-led launch")).getByRole(
        "button",
        { name: /Roadmap evidence/ }
      )
    );

    expect(screen.getByLabelText("Requests linked to Evidence-led launch")).toHaveTextContent(
      "No requests linked"
    );
  });

  it("creates a manual changelog draft and keeps private notes out of public preview", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Release Desk");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    const changelog = screen.getByRole("region", { name: "Draft queue" });
    expect(within(changelog).getByText("No changelog drafts")).toBeInTheDocument();

    await user.click(within(changelog).getAllByRole("button", { name: "New changelog draft" })[0]);
    const form = screen.getByRole("form", { name: "Create changelog draft" });
    await user.type(within(form).getByLabelText("Changelog title"), "July release");
    await user.type(within(form).getByLabelText("Public wording"), "We shipped a calmer release flow.");
    await user.type(within(form).getByLabelText("Private notes"), "Internal rollout key stays here.");
    await user.click(screen.getByRole("button", { name: "Create changelog draft" }));

    const selectedDetail = screen.getByRole("complementary", {
      name: "Selected changelog draft July release"
    });
    expect(within(selectedDetail).getByLabelText("Visibility for July release")).toHaveValue(
      "Private"
    );
    expect(within(selectedDetail).getByText("Internal rollout key stays here.")).toBeInTheDocument();

    const publicPreview = screen.getByRole("region", {
      name: "Public preview for July release"
    });
    expect(within(publicPreview).getByText("We shipped a calmer release flow.")).toBeInTheDocument();
    expect(within(publicPreview).queryByText("Internal rollout key stays here.")).not.toBeInTheDocument();
  });

  it("creates a changelog draft from Done work and carries linked requests", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Work Release Desk");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await createRequest(user, "Release requester");
    await createWorkItem(user, "Ship release source", "2026-10-18");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Selected work item status" }),
      "Done"
    );

    const changelog = screen.getByRole("region", { name: "Draft queue" });
    await user.click(within(changelog).getAllByRole("button", { name: "New changelog draft" })[0]);
    const form = screen.getByRole("form", { name: "Create changelog draft" });
    const sourceSelect = within(form).getByLabelText("Changelog source");
    const workSource = within(form).getByRole("option", {
      name: "Done work: Ship release source"
    }) as HTMLOptionElement;
    await user.selectOptions(
      sourceSelect,
      workSource.value
    );
    await user.click(screen.getByRole("button", { name: "Create changelog draft" }));

    const selectedDetail = screen.getByRole("complementary", {
      name: "Selected changelog draft Ship release source"
    });
    expect(within(selectedDetail).getByText("Work: Ship release source")).toBeInTheDocument();
    expect(screen.getByLabelText("Requests linked to Ship release source")).toHaveTextContent(
      "Release requester"
    );
  });

  it("creates a changelog draft from roadmap and edits request links", async () => {
    const user = userEvent.setup();
    render(<App />);

    const changelog = screen.getByRole("region", { name: "Draft queue" });
    await user.click(within(changelog).getAllByRole("button", { name: "New changelog draft" })[0]);
    const form = screen.getByRole("form", { name: "Create changelog draft" });
    await user.selectOptions(
      within(form).getByLabelText("Changelog source"),
      "roadmap:roadmap-bulk-export-csv"
    );
    await user.click(screen.getByRole("button", { name: "Create changelog draft" }));

    expect(screen.getByRole("complementary", {
      name: "Selected changelog draft Bulk export to CSV"
    })).toBeInTheDocument();
    expect(screen.getByLabelText("Requests linked to Bulk export to CSV")).toHaveTextContent(
      "Support bulk export to CSV"
    );

    await user.click(
      within(screen.getByLabelText("Requests linked to Bulk export to CSV")).getByRole(
        "button",
        { name: /Support bulk export to CSV/ }
      )
    );
    expect(screen.getByLabelText("Requests linked to Bulk export to CSV")).toHaveTextContent(
      "No requesters linked"
    );

    await user.selectOptions(
      screen.getByLabelText("Link request to Bulk export to CSV"),
      "api-rate-limit-visibility"
    );
    expect(screen.getByLabelText("Requests linked to Bulk export to CSV")).toHaveTextContent(
      "API rate limit visibility"
    );
  });

  it("renders a public portal without private workspace details", () => {
    render(<App />);

    const primaryNav = screen.getByLabelText("Primary navigation");
    expect(within(primaryNav).getByRole("link", { name: /Portal/ })).toHaveAttribute(
      "href",
      "#portal"
    );

    const portal = screen.getByRole("region", { name: "Public portal preview" });
    const board = within(portal).getByLabelText("Public feedback board");
    const publicRoadmap = within(portal).getByLabelText("Public roadmap");
    const publicChangelog = within(portal).getByLabelText("Public changelog");

    expect(
      within(board).getByRole("button", { name: /API rate limit visibility/ })
    ).toBeInTheDocument();
    expect(
      within(board).getByRole("button", { name: /Dark mode for docs site/ })
    ).toBeInTheDocument();
    expect(within(board).queryByRole("button", { name: /Support bulk export to CSV/ })).not.toBeInTheDocument();
    expect(within(board).queryByText("Three customers asked for a visible limit meter this week.")).not.toBeInTheDocument();
    expect(within(board).queryByText("Success team")).not.toBeInTheDocument();
    expect(within(board).queryByText("Unassigned")).not.toBeInTheDocument();

    expect(within(publicRoadmap).getByText("API rate limit visibility")).toBeInTheDocument();
    expect(within(publicRoadmap).getByText("Bulk export to CSV")).toBeInTheDocument();
    expect(within(publicRoadmap).queryByText("Webhook retry controls")).not.toBeInTheDocument();
    expect(within(publicChangelog).getByText("Inline markdown in comments")).toBeInTheDocument();
    expect(within(publicChangelog).queryByText("Email digest improvements")).not.toBeInTheDocument();
    expect(within(portal).queryByText("Needs customer-facing wording before it can be published.")).not.toBeInTheDocument();
  });

  it("searches, votes, comments, and moderates public portal requests", async () => {
    const user = userEvent.setup();
    render(<App />);

    const portal = screen.getByRole("region", { name: "Public portal preview" });
    const board = within(portal).getByLabelText("Public feedback board");

    await user.type(within(portal).getByLabelText("Search public requests"), "docs");
    expect(
      within(board).getByRole("button", { name: /Dark mode for docs site/ })
    ).toBeInTheDocument();
    expect(within(board).queryByRole("button", { name: /API rate limit visibility/ })).not.toBeInTheDocument();

    await user.clear(within(portal).getByLabelText("Search public requests"));
    await user.click(
      within(board).getByRole("button", { name: /API rate limit visibility/ })
    );
    await user.click(within(portal).getByRole("button", { name: "Vote on request" }));
    expect(within(portal).getByRole("button", { name: "Remove portal vote" })).toBeInTheDocument();

    await user.type(within(portal).getByLabelText("Portal comment author"), "Beta visitor");
    await user.type(within(portal).getByLabelText("Portal public note"), "This would help our CLI users.");
    await user.click(within(portal).getByRole("button", { name: "Add public comment" }));

    expect(within(portal).getByText("This would help our CLI users.")).toBeInTheDocument();
    expect(within(portal).queryByText("Three customers asked for a visible limit meter this week.")).not.toBeInTheDocument();

    await user.click(within(portal).getByRole("button", { name: "Hide comment" }));
    expect(within(portal).queryByText("This would help our CLI users.")).not.toBeInTheDocument();
    await user.click(within(portal).getByRole("button", { name: "Restore comment" }));
    expect(within(portal).getByText("This would help our CLI users.")).toBeInTheDocument();

    await user.click(within(portal).getByRole("checkbox", { name: "Comments" }));
    expect(within(portal).queryByRole("form", { name: "Add public portal comment" })).not.toBeInTheDocument();
    expect(within(portal).getByText("Public comments disabled")).toBeInTheDocument();
    expect(within(portal).getByText("This would help our CLI users.")).toBeInTheDocument();
  });

  it("runs the portal from standalone objects in a blank workspace", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Portal Lab");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await createPublicRequest(user, "Publish public signup status");

    const portal = screen.getByRole("region", { name: "Public portal preview" });
    expect(
      within(portal).getByRole("button", { name: /Publish public signup status/ })
    ).toBeInTheDocument();
    expect(within(portal).getByText("Portal Lab public board")).toBeInTheDocument();
  });

  it("captures a standalone request with details and tags", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Request Lab");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await user.click(screen.getAllByRole("button", { name: "Add request" })[0]);

    const composer = screen.getByRole("form", { name: "Add request" });
    await user.type(within(composer).getByLabelText("Request title"), "Usage billing export");
    await user.type(
      within(composer).getByLabelText("Description"),
      "Finance needs a monthly usage export."
    );
    await user.type(within(composer).getByLabelText("Requester"), "Finance team");
    await user.clear(within(composer).getByLabelText("Source"));
    await user.type(within(composer).getByLabelText("Source"), "Slack");
    await user.type(within(composer).getByLabelText("Tags"), "billing, export");
    await user.click(screen.getByRole("button", { name: "Capture request" }));

    expect(screen.getByRole("heading", { name: "Usage billing export" })).toBeInTheDocument();
    expect(screen.getByText("Finance team")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("billing")).toBeInTheDocument();
    expect(screen.getByText("export")).toBeInTheDocument();
  });

  it("edits selected request metadata and status", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Support bulk export to CSV/ }
      )
    );
    await user.clear(screen.getByLabelText("Selected request title"));
    await user.type(screen.getByLabelText("Selected request title"), "CSV exports for accounts");
    await user.clear(screen.getByLabelText("Selected request requester"));
    await user.type(screen.getByLabelText("Selected request requester"), "Revenue team");
    await user.clear(screen.getByLabelText("Selected request source"));
    await user.type(screen.getByLabelText("Selected request source"), "Customer call");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Selected request status" }),
      "Shipping soon"
    );

    expect(screen.getByRole("heading", { name: "CSV exports for accounts" })).toBeInTheDocument();
    expect(screen.getByText("Revenue team")).toBeInTheDocument();
    expect(screen.getByText("Customer call")).toBeInTheDocument();
    expect(screen.getAllByText("Shipping soon").length).toBeGreaterThan(0);
  });

  it("assigns an owner during request triage", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    await user.click(within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Selected request owner" }),
      "Product"
    );

    expect(
      within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ })
    ).toHaveTextContent("Product");
    expect(screen.getAllByText("Product").length).toBeGreaterThan(0);
  });

  it("queues requester status notifications from the request inspector", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Dark mode for docs site/ }
      )
    );
    await user.selectOptions(screen.getByLabelText("Selected request status"), "Planned");

    const panel = screen.getByLabelText("Requester notifications");
    expect(within(panel).getByText("1 queued")).toBeInTheDocument();
    expect(within(panel).getByText("Planned: Dark mode for docs site")).toBeInTheDocument();
    expect(within(panel).getByText(/moved from New to Planned/)).toBeInTheDocument();
  });

  it("counts requester notifications for the selected request only", async () => {
    const user = userEvent.setup();
    render(<App />);
    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });

    await user.click(within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ }));
    await user.selectOptions(screen.getByLabelText("Selected request status"), "Planned");
    expect(within(screen.getByLabelText("Requester notifications")).getByText("1 queued")).toBeInTheDocument();

    await user.click(within(inboxRegion).getByRole("button", { name: /API rate limit visibility/ }));
    const panel = screen.getByLabelText("Requester notifications");

    expect(within(panel).getByText("0 queued")).toBeInTheDocument();
    expect(within(panel).getByText(/No queued updates for CLI user/)).toBeInTheDocument();
  });

  it("honors requester status notification opt-outs in the inspector", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Dark mode for docs site/ }
      )
    );
    const panel = screen.getByLabelText("Requester notifications");

    await user.click(within(panel).getByRole("checkbox", { name: "Status" }));
    await user.selectOptions(screen.getByLabelText("Selected request status"), "Planned");

    expect(within(panel).getByText("0 queued")).toBeInTheDocument();
    expect(within(panel).getByText(/No queued updates for Docs feedback/)).toBeInTheDocument();
  });

  it("adds and removes the current user's vote", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Dark mode for docs site/ }
      )
    );
    await user.click(screen.getByRole("button", { name: "Add vote" }));

    expect(screen.getByRole("button", { name: "Remove vote" })).toBeInTheDocument();
    expect(screen.getAllByText("90").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Remove vote" }));

    expect(screen.getByRole("button", { name: "Add vote" })).toBeInTheDocument();
    expect(screen.getAllByText("89").length).toBeGreaterThan(0);
  });

  it("adds a comment to the selected request", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Dark mode for docs site/ }
      )
    );
    await user.type(screen.getByLabelText("Comment"), "Include docs reader preferences.");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(screen.getByText("Include docs reader preferences.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Request comments")).getByText("Akhil")).toBeInTheDocument();
  });

  it("searches requests and resets a no-results state", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    const search = screen.getByRole("searchbox", {
      name: "Search requests"
    });

    await user.type(search, "webhook");

    expect(within(inboxRegion).getByRole("button", { name: /Webhook retry controls/ })).toBeInTheDocument();
    expect(within(inboxRegion).queryByRole("button", { name: /API rate limit visibility/ })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "not-a-real-request");

    expect(screen.getByText("No matching requests")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(within(inboxRegion).getByRole("button", { name: /API rate limit visibility/ })).toBeInTheDocument();
  });

  it("filters requests by status", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Status filter" }),
      "Needs decision"
    );

    expect(within(inboxRegion).getByRole("button", { name: /API rate limit visibility/ })).toBeInTheDocument();
    expect(within(inboxRegion).queryByRole("button", { name: /Support bulk export to CSV/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status filter" }), "Planned");

    expect(within(inboxRegion).getByRole("button", { name: /Support bulk export to CSV/ })).toBeInTheDocument();
    expect(within(inboxRegion).queryByRole("button", { name: /API rate limit visibility/ })).not.toBeInTheDocument();
  });

  it("filters requests by saved triage view and resets to all active requests", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Saved triage view" }),
      "unassigned"
    );

    expect(within(inboxRegion).getByRole("button", { name: /API rate limit visibility/ })).toBeInTheDocument();
    expect(within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ })).toBeInTheDocument();
    expect(within(inboxRegion).queryByRole("button", { name: /Support bulk export to CSV/ })).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Saved triage view" }),
      "high-signal"
    );

    expect(within(inboxRegion).getByRole("button", { name: /Support bulk export to CSV/ })).toBeInTheDocument();
    expect(within(inboxRegion).queryByRole("button", { name: /Webhook retry controls/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(within(inboxRegion).getByRole("button", { name: /Webhook retry controls/ })).toBeInTheDocument();
  });

  it("merges a duplicate request and preserves source history", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    await user.click(within(inboxRegion).getByRole("button", { name: /Webhook retry controls/ }));
    await user.type(screen.getByLabelText("Comment"), "Retry button should show the failure reason.");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    await user.click(within(inboxRegion).getByRole("button", { name: /API rate limit visibility/ }));

    const duplicateSelect = screen.getByRole("combobox", { name: "Duplicate request" });
    expect(
      within(duplicateSelect).queryByRole("option", { name: "API rate limit visibility" })
    ).not.toBeInTheDocument();

    await user.selectOptions(duplicateSelect, "webhook-retry-controls");
    await user.click(screen.getByRole("button", { name: "Merge duplicate" }));

    expect(
      within(inboxRegion).queryByRole("button", { name: /Webhook retry controls/ })
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "API rate limit visibility" })).getByRole(
        "heading",
        { name: "API rate limit visibility" }
      )
    ).toBeInTheDocument();
    const sourceHistory = screen.getByLabelText("Merged source history");
    expect(within(sourceHistory).getByText("Webhook retry controls")).toBeInTheDocument();
    expect(
      within(sourceHistory).getByText(
        /Maintainer note \/ Manual \/ Akhil \/ Shipping soon \/ 76 votes \/ 1 comments/
      )
    ).toBeInTheDocument();
    expect(within(sourceHistory).getByText(/Maintainers need to retry failed webhooks/)).toBeInTheDocument();
    expect(screen.getByText("Retry button should show the failure reason.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove vote" })).toBeInTheDocument();
    expect(screen.getAllByText("218").length).toBeGreaterThan(0);
  });

  it("does not merge active requests into an archived selected request", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Archive request" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Archive filter" }), "archived");

    expect(
      within(screen.getByRole("complementary", { name: "API rate limit visibility" })).getByRole(
        "heading",
        { name: "API rate limit visibility" }
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Duplicate request" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge duplicate" })).toBeDisabled();
  });

  it("keeps the selected inspector to four major triage actions", () => {
    render(<App />);

    const inspector = screen.getByRole("complementary", { name: "API rate limit visibility" });
    expect(within(within(inspector).getByLabelText("Request actions")).getAllByRole("button")).toHaveLength(2);
    expect(within(within(inspector).getByRole("form", { name: "Triage controls" })).getAllByRole("button")).toHaveLength(1);
    expect(within(within(inspector).getByRole("form", { name: "Add comment" })).getByRole("button", { name: "Add comment" })).toBeInTheDocument();
  });

  it("shows assistant triage and creates a private changelog draft only after approval", async () => {
    const user = userEvent.setup();
    render(<App />);

    const assistant = screen.getByLabelText("Assistant triage");
    expect(within(assistant).getByText("Triage assist")).toBeInTheDocument();
    const assistantToggle = within(assistant).getByRole("checkbox", {
      name: "Assistant suggestions"
    });
    expect(assistantToggle).toBeChecked();
    expect(within(assistant).getByText("Possible duplicates")).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", {
        name: "Selected changelog draft Review roadmap item for changelog"
      })
    ).not.toBeInTheDocument();
    await user.click(assistantToggle);
    expect(within(assistant).getByText("Assistant suggestions are paused for this session.")).toBeInTheDocument();
    expect(within(assistant).queryByRole("button", { name: "Create private draft" })).not.toBeInTheDocument();
    await user.click(assistantToggle);

    await user.click(within(assistant).getByRole("button", { name: "Create private draft" }));
    const changelogDetail = screen.getByRole("complementary", {
      name: "Selected changelog draft Review roadmap item for changelog"
    });

    expect(within(changelogDetail).getByLabelText("State for Review roadmap item for changelog")).toHaveValue("Draft");
    expect(within(changelogDetail).getByLabelText("Visibility for Review roadmap item for changelog")).toHaveValue("Private");
    expect(within(changelogDetail).getByLabelText("Public wording for Review roadmap item for changelog")).toHaveValue(
      "A roadmap update may be ready. Review this private draft and write approved public wording before publishing."
    );
  });

  it("archives requests and shows archived requests through the queue filter", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    await user.click(within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ }));
    await user.click(screen.getByRole("button", { name: "Archive request" }));

    expect(within(inboxRegion).queryByRole("button", { name: /Dark mode for docs site/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Archive filter" }), "archived");

    expect(within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore request" })).toBeInTheDocument();
  });

  it("keeps the selected request open when edits stop matching active filters", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    await user.selectOptions(screen.getByRole("combobox", { name: "Status filter" }), "New");
    await user.click(within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Selected request status" }),
      "Planned"
    );

    expect(screen.getByRole("heading", { name: "Dark mode for docs site" })).toBeInTheDocument();
    expect(screen.getByText("No matching requests")).toBeInTheDocument();
  });

  it("clears unsent comments when archive changes the selected request", async () => {
    const user = userEvent.setup();
    render(<App />);

    const inboxRegion = screen.getByRole("region", { name: /Requests needing attention/ });
    await user.click(within(inboxRegion).getByRole("button", { name: /Dark mode for docs site/ }));
    await user.type(screen.getByLabelText("Comment"), "Carry this nowhere.");
    await user.click(screen.getByRole("button", { name: "Archive request" }));

    expect(screen.getByLabelText("Comment")).toHaveValue("");
    expect(screen.queryByText("Carry this nowhere.")).not.toBeInTheDocument();
  });

  it("normalizes blank edited request titles on blur", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      within(screen.getByRole("region", { name: /Requests needing attention/ })).getByRole(
        "button",
        { name: /Dark mode for docs site/ }
      )
    );
    await user.clear(screen.getByLabelText("Selected request title"));
    await user.tab();

    expect(screen.getByRole("heading", { name: "Untitled request" })).toBeInTheDocument();
  });

  it("creates a linked internal work item from the selected request", async () => {
    const user = userEvent.setup();
    render(<App />);

    const primaryNav = screen.getByLabelText("Primary navigation");
    expect(within(primaryNav).queryByRole("link", { name: /Work/ })).not.toBeInTheDocument();

    await createWorkItem(user);

    expect(within(primaryNav).getByRole("link", { name: /Work/ })).toHaveAttribute(
      "href",
      "#work"
    );
    expect(screen.getByText("1 work item")).toBeInTheDocument();
    expect(screen.getByLabelText("Linked work for selected request")).toHaveTextContent(
      "Build usage meter"
    );
    expect(screen.getByLabelText("Linked requests for selected work item")).toHaveTextContent(
      "API rate limit visibility"
    );
  });

  it("edits work item owner, status, target date, and comments", async () => {
    const user = userEvent.setup();
    render(<App />);

    await createWorkItem(user);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Selected work item owner" }),
      "Akhil"
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Selected work item status" }),
      "In progress"
    );
    await user.clear(screen.getByLabelText("Selected work item target date"));
    await user.type(screen.getByLabelText("Selected work item target date"), "2026-08-02");
    await user.type(screen.getByLabelText("Work item comment"), "Add acceptance checks.");
    await user.click(screen.getByRole("button", { name: "Add work comment" }));

    expect(screen.getByRole("combobox", { name: "Selected work item owner" })).toHaveValue(
      "Akhil"
    );
    expect(screen.getByRole("combobox", { name: "Selected work item status" })).toHaveValue(
      "In progress"
    );
    expect(screen.getByLabelText("Selected work item target date")).toHaveValue("2026-08-02");
    expect(screen.getByText("Add acceptance checks.")).toBeInTheDocument();
  });

  it("unlinks a request from work without deleting either object", async () => {
    const user = userEvent.setup();
    render(<App />);

    await createWorkItem(user);
    await user.click(screen.getByRole("button", { name: "Unlink API rate limit visibility" }));

    expect(
      within(screen.getByRole("complementary", { name: "API rate limit visibility" })).getByRole(
        "heading",
        { name: "API rate limit visibility" }
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Work items")).getByRole("button", {
        name: /Build usage meter/
      })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Linked work for selected request")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Linked requests for selected work item")).toHaveTextContent(
      "No linked requests"
    );
  });

  it("creates standalone work in a blank workspace without exposing Work nav early", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Delivery Lab");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    const primaryNav = screen.getByLabelText("Primary navigation");
    expect(within(primaryNav).queryByRole("link", { name: /Work/ })).not.toBeInTheDocument();

    await createWorkItem(user, "Publish RSS adapter", "2026-09-11");

    expect(within(primaryNav).getByRole("link", { name: /Work/ })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Work items")).getByRole("button", {
        name: /Publish RSS adapter/
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Linked requests for selected work item")).toHaveTextContent(
      "No linked requests"
    );
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
  });

  it("persists created requests across app remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Persistent Desk");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await user.click(screen.getAllByRole("button", { name: "Add request" })[0]);
    await user.type(screen.getByLabelText("Request title"), "Keep this request");
    await user.click(screen.getByRole("button", { name: "Capture request" }));

    unmount();
    render(<App />);

    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveDisplayValue(
      "Persistent Desk"
    );
    expect(screen.getByRole("heading", { name: "Keep this request" })).toBeInTheDocument();
  });

  it("persists roadmap edits across app remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Roadmap Memory");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await createRoadmapItem(user, "Reload-safe roadmap");
    await user.selectOptions(screen.getByLabelText("Lane for Reload-safe roadmap"), "Later");
    await user.selectOptions(screen.getByLabelText("Visibility for Reload-safe roadmap"), "Public");

    unmount();
    render(<App />);

    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveDisplayValue(
      "Roadmap Memory"
    );
    expect(
      screen.getByRole("complementary", {
        name: "Selected roadmap item Reload-safe roadmap"
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Lane for Reload-safe roadmap")).toHaveValue("Later");
    expect(screen.getByLabelText("Visibility for Reload-safe roadmap")).toHaveValue("Public");
  });

  it("persists changelog drafts across app remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Changelog Memory");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    const changelog = screen.getByRole("region", { name: "Draft queue" });
    await user.click(within(changelog).getAllByRole("button", { name: "New changelog draft" })[0]);
    const form = screen.getByRole("form", { name: "Create changelog draft" });
    await user.type(within(form).getByLabelText("Changelog title"), "Reload-safe changelog");
    await user.type(within(form).getByLabelText("Public wording"), "This release note survives reload.");
    await user.selectOptions(within(form).getByLabelText("Changelog visibility"), "Public");
    await user.click(screen.getByRole("button", { name: "Create changelog draft" }));

    unmount();
    render(<App />);

    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveDisplayValue(
      "Changelog Memory"
    );
    expect(
      screen.getByRole("complementary", {
        name: "Selected changelog draft Reload-safe changelog"
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Visibility for Reload-safe changelog")).toHaveValue("Public");
    expect(
      within(
        screen.getByRole("region", { name: "Public preview for Reload-safe changelog" })
      ).getByText("This release note survives reload.")
    ).toBeInTheDocument();
  });

  it("recovers from corrupt local data and can restore demo data", async () => {
    const user = userEvent.setup();
    localStorage.setItem("openroad:state:v1", "{not-json");
    render(<App />);

    expect(
      screen.getByText(/Saved OpenRoad data could not be loaded/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset demo data" }));

    expect(screen.getByText("Demo data restored.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveDisplayValue("Acme OSS");
  });

  it("exports and imports workspace data", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Export Desk");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await user.click(screen.getAllByRole("button", { name: "Add request" })[0]);
    await user.type(screen.getByLabelText("Request title"), "Portable request");
    await user.click(screen.getByRole("button", { name: "Capture request" }));
    await user.selectOptions(screen.getByLabelText("Selected request visibility"), "Public");
    const portal = screen.getByRole("region", { name: "Public portal preview" });
    await user.clear(within(portal).getByLabelText("Portal headline"));
    await user.type(within(portal).getByLabelText("Portal headline"), "Exported portal board");
    await user.click(within(portal).getByRole("button", { name: /Portable request/ }));
    await user.type(within(portal).getByLabelText("Portal public note"), "Portable public comment.");
    await user.click(within(portal).getByRole("button", { name: "Add public comment" }));
    await user.click(within(portal).getByRole("checkbox", { name: "Comments" }));
    await createRoadmapItem(user, "Portable roadmap");
    const changelog = screen.getByRole("region", { name: "Draft queue" });
    await user.click(within(changelog).getAllByRole("button", { name: "New changelog draft" })[0]);
    const form = screen.getByRole("form", { name: "Create changelog draft" });
    await user.type(within(form).getByLabelText("Changelog title"), "Portable changelog");
    await user.type(within(form).getByLabelText("Public wording"), "Portable public wording.");
    await user.click(screen.getByRole("button", { name: "Create changelog draft" }));
    await user.click(screen.getByRole("button", { name: "Export workspace" }));

    const exported = (screen.getByLabelText("Workspace export JSON") as HTMLTextAreaElement)
      .value;
    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    fireEvent.change(screen.getByLabelText("Workspace import JSON"), {
      target: { value: exported }
    });
    await user.click(screen.getByRole("button", { name: "Import workspace" }));

    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveDisplayValue("Export Desk");
    expect(screen.getByRole("complementary", { name: "Portable request" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Portable roadmap" })).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", {
        name: "Selected changelog draft Portable changelog"
      })
    ).toBeInTheDocument();
    const importedPortal = screen.getByRole("region", { name: "Public portal preview" });
    expect(within(importedPortal).getByText("Exported portal board")).toBeInTheDocument();
    expect(
      within(importedPortal).getByRole("button", { name: /Portable request/ })
    ).toBeInTheDocument();
    expect(within(importedPortal).getByText("Portable public comment.")).toBeInTheDocument();
    expect(within(importedPortal).getByText("Public comments disabled")).toBeInTheDocument();
  }, 10_000);
});

function createSettingsIntegrationFetchMock(options: { linearReady?: boolean } = {}) {
  const state = createInitialOpenRoadState();

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "/api/openroad/state") {
      return jsonResponse({
        state,
        status: method === "PUT" ? "saved" : "ready"
      });
    }

    if (url === "/api/openroad/workspaces/acme/integrations/status") {
      return jsonResponse({
        integrationMetadata: {
          recovered: false,
          schemaVersion: 3,
          status: "ready"
        },
        providers: [
          {
            accounts: [
              {
                createdAt: "2026-07-04T00:00:00Z",
                id: "github-install",
                providerAccountName: "AkhilTrivediX",
                status: "active"
              }
            ],
            activeCredentials: 0,
            activeInstallations: 1,
            capabilities: {
              disconnect: true,
              import: true,
              liveSync: true,
              manualSync: true,
              setup: true,
              webhooks: true
            },
            connection: "connected",
            label: "GitHub",
            lastSyncedAt: "2026-07-04T00:30:00Z",
            linkedIssueMappings: 1,
            linkedMappings: 1,
            provider: "github",
            queuedSyncJobs: 0,
            recentJobs: [
              {
                attempt: 1,
                completedAt: "2026-07-04T00:30:00Z",
                createdAt: "2026-07-04T00:00:00Z",
                id: "sync-job-1",
                installationId: "github-install",
                provider: "github",
                reason: "manual",
                resultSummary: "Synced one mapping.",
                status: "succeeded",
                updatedAt: "2026-07-04T00:30:00Z",
                workspaceId: "acme"
              }
            ],
            runningSyncJobs: 0,
            setupConfigured: true,
            statusText: "Connected. 1 linked issue mapping ready for manual sync.",
            syncWorkerConfigured: true,
            totalInstallations: 1
          },
          {
            accounts: [],
            activeCredentials: 0,
            activeInstallations: 0,
            capabilities: {
              disconnect: false,
              import: false,
              liveSync: false,
              manualSync: false,
              setup: false,
              webhooks: false
            },
            connection: "optional",
            label: "Jira",
            linkedIssueMappings: 0,
            linkedMappings: 0,
            provider: "jira",
            queuedSyncJobs: 0,
            recentJobs: [],
            runningSyncJobs: 0,
            setupConfigured: false,
            statusText: "Optional. Server setup is not configured yet.",
            syncWorkerConfigured: false,
            totalInstallations: 0
          },
          {
            accounts: options.linearReady
              ? [
                  {
                    createdAt: "2026-07-04T00:00:00Z",
                    id: "linear-install",
                    providerAccountName: "OpenRoad",
                    status: "active"
                  }
                ]
              : [],
            activeCredentials: options.linearReady ? 1 : 0,
            activeInstallations: options.linearReady ? 1 : 0,
            capabilities: {
              disconnect: Boolean(options.linearReady),
              import: Boolean(options.linearReady),
              liveSync: Boolean(options.linearReady),
              manualSync: Boolean(options.linearReady),
              setup: false,
              webhooks: false
            },
            connection: options.linearReady ? "connected" : "optional",
            label: "Linear",
            linkedIssueMappings: options.linearReady ? 1 : 0,
            linkedMappings: options.linearReady ? 1 : 0,
            provider: "linear",
            queuedSyncJobs: 0,
            recentJobs: [],
            runningSyncJobs: 0,
            setupConfigured: false,
            statusText: options.linearReady
              ? "Connected. 1 linked issue mapping ready for manual sync."
              : "Optional. Server setup is not configured yet.",
            syncWorkerConfigured: Boolean(options.linearReady),
            totalInstallations: options.linearReady ? 1 : 0
          }
        ],
        status: "ready",
        workspaceId: "acme"
      });
    }

    if (url === "/api/openroad/workspaces/acme/integrations/github/sync/jobs") {
      return jsonResponse({ job: { id: "sync-job-1", status: "queued" }, status: "queued" }, 201);
    }

    if (url === "/api/openroad/workspaces/acme/integrations/linear/sync/jobs") {
      return jsonResponse({ job: { id: "sync-job-1", status: "queued" }, status: "queued" }, 201);
    }

    if (url === "/api/openroad/integrations/sync/run") {
      return jsonResponse({
        claimed: 1,
        processed: [{ id: "sync-job-1", kind: "success", status: "succeeded" }],
        status: "processed"
      });
    }

    return jsonResponse({ error: { message: "Unhandled test request." } }, 404);
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
