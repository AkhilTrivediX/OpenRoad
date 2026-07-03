// @vitest-environment node

import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createInitialOpenRoadState,
  openRoadSchemaVersion
} from "../src/domain/openroad";
import { FileOpenRoadStore, OpenRoadStoreError } from "./store";

describe("FileOpenRoadStore", () => {
  it("creates a seed state when the data file is missing", async () => {
    const dataFile = await createTempDataFile();
    const store = new FileOpenRoadStore(dataFile);

    const result = await store.load();
    const persisted = JSON.parse(await readFile(dataFile, "utf8")) as {
      schemaVersion: number;
    };

    expect(result.status).toBe("seeded");
    expect(result.state.schemaVersion).toBe(openRoadSchemaVersion);
    expect(persisted.schemaVersion).toBe(openRoadSchemaVersion);
  });

  it("persists modified state and reloads it from disk", async () => {
    const dataFile = await createTempDataFile();
    const store = new FileOpenRoadStore(dataFile);
    const state = createInitialOpenRoadState();
    const nextState = {
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          name: "Production Desk"
        },
        ...state.workspaces.slice(1)
      ]
    };

    await store.replaceState(nextState);
    const result = await store.load();

    expect(result.status).toBe("ready");
    expect(result.state.workspaces[0].name).toBe("Production Desk");
  });

  it("migrates previous-schema persisted state", async () => {
    const dataFile = await createTempDataFile();
    const state = createInitialOpenRoadState();
    const previousState = {
      schemaVersion: 3,
      workspaces: state.workspaces.map(({ portal: _portal, requests, ...workspace }) => ({
        ...workspace,
        requests: requests.map(({ visibility: _visibility, comments, ...request }) => ({
          ...request,
          comments: comments.map(({ visibility: _commentVisibility, ...comment }) => comment)
        }))
      }))
    };
    await writeFile(dataFile, JSON.stringify(previousState), "utf8");

    const result = await new FileOpenRoadStore(dataFile).load();

    expect(result.status).toBe("migrated");
    expect(result.state.schemaVersion).toBe(openRoadSchemaVersion);
    expect(result.state.workspaces[0].portal.enabled).toBe(true);
    expect(result.state.workspaces[0].requests[0].visibility).toBeTruthy();
  });

  it("backs up corrupt state and recovers to seed data", async () => {
    const dataFile = await createTempDataFile();
    await writeFile(dataFile, "{not-json", "utf8");

    const result = await new FileOpenRoadStore(dataFile).load();
    const files = await readdir(join(dataFile, ".."));
    const persisted = JSON.parse(await readFile(dataFile, "utf8")) as {
      schemaVersion: number;
    };

    expect(result.status).toBe("recovered");
    expect(result.backupPath).toContain(".corrupt-");
    expect(files.some((file) => file.includes(".corrupt-"))).toBe(true);
    expect(persisted.schemaVersion).toBe(openRoadSchemaVersion);
    expect(result.state.workspaces[0].id).toBe("acme");
  });

  it("rejects future-schema state instead of overwriting it", async () => {
    const dataFile = await createTempDataFile();
    await writeFile(
      dataFile,
      JSON.stringify({ schemaVersion: openRoadSchemaVersion + 1, workspaces: [] }),
      "utf8"
    );

    await expect(new FileOpenRoadStore(dataFile).load()).rejects.toMatchObject({
      code: "future_schema"
    });
    await expect(
      new FileOpenRoadStore(dataFile).replaceState({
        schemaVersion: openRoadSchemaVersion + 1,
        workspaces: []
      })
    ).rejects.toBeInstanceOf(OpenRoadStoreError);
  });

  it("rejects invalid replacement state", async () => {
    const dataFile = await createTempDataFile();
    const store = new FileOpenRoadStore(dataFile);

    await expect(
      store.replaceState({
        schemaVersion: openRoadSchemaVersion,
        workspaces: [{ id: "broken" }]
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
  });
});

async function createTempDataFile() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-store-"));
  return join(directory, "state.json");
}
