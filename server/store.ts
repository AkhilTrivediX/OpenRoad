import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createInitialOpenRoadState,
  migrateOpenRoadState,
  openRoadSchemaVersion,
  type OpenRoadState
} from "../src/domain/openroad.js";

export type StoreLoadStatus = "ready" | "seeded" | "migrated" | "recovered";

export type StoreLoadResult = {
  backupPath?: string;
  state: OpenRoadState;
  status: StoreLoadStatus;
};

export type OpenRoadStore = {
  load(): Promise<StoreLoadResult>;
  replaceState(value: unknown): Promise<OpenRoadState>;
};

export class OpenRoadStoreError extends Error {
  code: "corrupt_state" | "future_schema" | "invalid_state";

  constructor(code: OpenRoadStoreError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class FileOpenRoadStore implements OpenRoadStore {
  constructor(private readonly dataFile: string) {}

  async load(): Promise<StoreLoadResult> {
    let raw: string;

    try {
      raw = await readFile(this.dataFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const state = createInitialOpenRoadState();
        await this.writeState(state);
        return { state, status: "seeded" };
      }

      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const state = parseOpenRoadState(parsed);
      const status = getPersistedSchemaVersion(parsed) === openRoadSchemaVersion ? "ready" : "migrated";

      if (status === "migrated") {
        await this.writeState(state);
      }

      return { state, status };
    } catch (error) {
      if (error instanceof OpenRoadStoreError && error.code === "future_schema") {
        throw error;
      }

      const backupPath = await this.backupCorruptState();
      const state = createInitialOpenRoadState();
      await this.writeState(state);
      return { backupPath, state, status: "recovered" };
    }
  }

  async replaceState(value: unknown): Promise<OpenRoadState> {
    const state = parseOpenRoadState(value);
    await this.writeState(state);
    return state;
  }

  private async backupCorruptState() {
    const backupPath = `${this.dataFile}.corrupt-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    await mkdir(dirname(this.dataFile), { recursive: true });
    await rename(this.dataFile, backupPath);
    return backupPath;
  }

  private async writeState(state: OpenRoadState) {
    await mkdir(dirname(this.dataFile), { recursive: true });
    const temporaryPath = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.dataFile);
  }
}

export function parseOpenRoadState(value: unknown): OpenRoadState {
  try {
    return migrateOpenRoadState(value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OpenRoad state is invalid.";

    if (message.includes("newer version")) {
      throw new OpenRoadStoreError("future_schema", message);
    }

    throw new OpenRoadStoreError("invalid_state", message);
  }
}

export function resolveOpenRoadDataFile(env = process.env) {
  return resolve(env.OPENROAD_DATA_FILE ?? ".openroad/openroad-state.json");
}

function getPersistedSchemaVersion(value: unknown) {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { schemaVersion?: unknown };
  return typeof record.schemaVersion === "number" ? record.schemaVersion : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
