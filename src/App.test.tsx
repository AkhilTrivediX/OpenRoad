import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("OpenRoad workspace shell", () => {
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

  it("communicates standalone-first use and optional integrations", () => {
    render(<App />);

    expect(screen.getByText("Standalone first")).toBeInTheDocument();
    expect(
      screen.getByText(/Connect GitHub, Jira, or Linear later/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Optional integrations")).toBeInTheDocument();
    expect(screen.getAllByText("Optional")).toHaveLength(3);
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
    expect(screen.getAllByText("Nothing placed yet")).toHaveLength(3);
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
      within(screen.getByRole("region", { name: /Now \/ Next \/ Later/ })).getByText(
        "API rate limit visibility"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Draft queue")).toBeInTheDocument();
    expect(screen.getByText("Inline markdown in comments")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "API rate limit visibility" })).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "API rate limit visibility" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Duplicate request" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge duplicate" })).toBeDisabled();
  });

  it("keeps the selected inspector to four major triage actions", () => {
    render(<App />);

    const inspector = screen.getByRole("complementary", { name: /API rate limit visibility/ });
    expect(within(inspector).getAllByRole("button")).toHaveLength(4);
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
});
