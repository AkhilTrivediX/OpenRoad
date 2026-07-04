import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  openRoadSelectedWorkspaceKey,
  openRoadStorageKey
} from "../domain/openroad";
import { OpenRoadErrorBoundary } from "./OpenRoadErrorBoundary";

describe("OpenRoadErrorBoundary", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when the app is healthy", () => {
    render(
      <OpenRoadErrorBoundary>
        <p>Healthy workspace</p>
      </OpenRoadErrorBoundary>
    );

    expect(screen.getByText("Healthy workspace")).toBeInTheDocument();
    expect(screen.queryByLabelText("OpenRoad recovery")).not.toBeInTheDocument();
  });

  it("catches render crashes without exposing the thrown message", () => {
    render(
      <OpenRoadErrorBoundary>
        <CrashingChild message="secret requester payload" />
      </OpenRoadErrorBoundary>
    );

    const recovery = screen.getByLabelText("OpenRoad recovery");
    expect(within(recovery).getByRole("heading", { name: "OpenRoad caught a workspace crash." })).toBeInTheDocument();
    expect(within(recovery).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(recovery).getByRole("button", { name: "Reset local data" })).toBeInTheDocument();
    expect(screen.queryByText("secret requester payload")).not.toBeInTheDocument();
  });

  it("retries rendering when the crash condition is gone", async () => {
    const user = userEvent.setup();
    let shouldCrash = true;
    function MaybeCrash() {
      if (shouldCrash) throw new Error("temporary crash");
      return <p>Recovered workspace</p>;
    }

    render(
      <OpenRoadErrorBoundary>
        <MaybeCrash />
      </OpenRoadErrorBoundary>
    );

    expect(screen.getByLabelText("OpenRoad recovery")).toBeInTheDocument();
    shouldCrash = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered workspace")).toBeInTheDocument();
    expect(screen.queryByLabelText("OpenRoad recovery")).not.toBeInTheDocument();
  });

  it("clears only OpenRoad local browser data from the recovery screen", async () => {
    const user = userEvent.setup();
    localStorage.setItem(openRoadStorageKey, "{}");
    localStorage.setItem(openRoadSelectedWorkspaceKey, "acme");
    localStorage.setItem("unrelated", "keep");

    render(
      <OpenRoadErrorBoundary>
        <CrashingChild message="broken local state" />
      </OpenRoadErrorBoundary>
    );

    await user.click(screen.getByRole("button", { name: "Reset local data" }));

    expect(localStorage.getItem(openRoadStorageKey)).toBeNull();
    expect(localStorage.getItem(openRoadSelectedWorkspaceKey)).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(screen.getByRole("status")).toHaveTextContent("Local OpenRoad browser data was cleared.");
  });
});

function CrashingChild({ message }: { message: string }) {
  throw new Error(message);
  return null;
}
