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
});
