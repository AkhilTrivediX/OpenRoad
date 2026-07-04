import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { OpenRoadState } from "../src/domain/openroad.js";
import type { OpenRoadActor, WorkspaceRole } from "./access.js";

export const openRoadTeamSchemaVersion = 1;

export type TeamUser = {
  createdAt: string;
  email: string;
  id: string;
  name: string;
};

export type WorkspaceMembership = {
  createdAt: string;
  id: string;
  role: WorkspaceRole;
  userId: string;
  workspaceId: string;
};

export type AuditEvent = {
  actorId: string;
  actorType: OpenRoadActor["type"];
  createdAt: string;
  id: string;
  requestId: string;
  summary: string;
  type: string;
  workspaceId?: string;
};

export type TeamState = {
  auditEvents: AuditEvent[];
  memberships: WorkspaceMembership[];
  schemaVersion: typeof openRoadTeamSchemaVersion;
  users: TeamUser[];
};

export type TeamStoreLoadStatus = "ready" | "seeded" | "migrated" | "recovered";

export type TeamStoreLoadResult = {
  backupPath?: string;
  state: TeamState;
  status: TeamStoreLoadStatus;
};

export type TeamStoreSeedOptions = {
  ownerEmail?: string;
  ownerName?: string;
};

export type TeamStore = {
  load(openRoadState: OpenRoadState): Promise<TeamStoreLoadResult>;
  recordAuditEvent(
    openRoadState: OpenRoadState,
    event: Omit<AuditEvent, "createdAt" | "id">
  ): Promise<AuditEvent>;
};

export class TeamStoreError extends Error {
  code: "corrupt_state" | "future_schema" | "invalid_state";

  constructor(code: TeamStoreError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class FileTeamStore implements TeamStore {
  constructor(
    private readonly teamFile: string,
    private readonly seedOptions: TeamStoreSeedOptions = {}
  ) {}

  async load(openRoadState: OpenRoadState): Promise<TeamStoreLoadResult> {
    let raw: string;

    try {
      raw = await readFile(this.teamFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const state = createInitialTeamState(openRoadState, this.seedOptions);
        await this.writeState(state);
        return { state, status: "seeded" };
      }

      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const state = parseTeamState(parsed);
      const status =
        getPersistedSchemaVersion(parsed) === openRoadTeamSchemaVersion ? "ready" : "migrated";
      const withWorkspaceMemberships = ensureWorkspaceMemberships(
        state,
        openRoadState,
        this.seedOptions
      );

      if (status === "migrated" || withWorkspaceMemberships !== state) {
        await this.writeState(withWorkspaceMemberships);
      }

      return { state: withWorkspaceMemberships, status };
    } catch (error) {
      if (error instanceof TeamStoreError && error.code === "future_schema") {
        throw error;
      }

      const backupPath = await this.backupCorruptState();
      const state = createInitialTeamState(openRoadState, this.seedOptions);
      await this.writeState(state);
      return { backupPath, state, status: "recovered" };
    }
  }

  async recordAuditEvent(
    openRoadState: OpenRoadState,
    event: Omit<AuditEvent, "createdAt" | "id">
  ) {
    const result = await this.load(openRoadState);
    const auditEvent: AuditEvent = {
      ...event,
      createdAt: new Date().toISOString(),
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    };
    const state = {
      ...result.state,
      auditEvents: [auditEvent, ...result.state.auditEvents].slice(0, 1000)
    };
    await this.writeState(state);
    return auditEvent;
  }

  private async backupCorruptState() {
    const backupPath = `${this.teamFile}.corrupt-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    await mkdir(dirname(this.teamFile), { recursive: true });
    await rename(this.teamFile, backupPath);
    return backupPath;
  }

  private async writeState(state: TeamState) {
    await mkdir(dirname(this.teamFile), { recursive: true });
    const temporaryPath = `${this.teamFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.teamFile);
  }
}

export function createInitialTeamState(
  openRoadState: OpenRoadState,
  seedOptions: TeamStoreSeedOptions = {}
): TeamState {
  const owner = createSeedOwner(seedOptions);

  return {
    auditEvents: [],
    memberships: openRoadState.workspaces.map((workspace) => ({
      createdAt: "seed",
      id: `membership-${owner.id}-${workspace.id}`,
      role: "Owner",
      userId: owner.id,
      workspaceId: workspace.id
    })),
    schemaVersion: openRoadTeamSchemaVersion,
    users: [owner]
  };
}

export function parseTeamState(value: unknown): TeamState {
  if (!isRecord(value)) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is not an object.");
  }

  if (typeof value.schemaVersion === "number" && value.schemaVersion > openRoadTeamSchemaVersion) {
    throw new TeamStoreError(
      "future_schema",
      "OpenRoad team metadata was created by a newer version."
    );
  }

  if (
    value.schemaVersion !== openRoadTeamSchemaVersion ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.auditEvents)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  if (
    !value.users.every(isTeamUser) ||
    !value.memberships.every(isWorkspaceMembership) ||
    !value.auditEvents.every(isAuditEvent)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  return cloneValue({
    auditEvents: value.auditEvents,
    memberships: value.memberships,
    schemaVersion: openRoadTeamSchemaVersion,
    users: value.users
  });
}

export function resolveOpenRoadTeamFile(env = process.env) {
  return resolve(env.OPENROAD_TEAM_FILE ?? ".openroad/openroad-team.json");
}

function ensureWorkspaceMemberships(
  state: TeamState,
  openRoadState: OpenRoadState,
  seedOptions: TeamStoreSeedOptions
) {
  const owner = state.users[0] ?? createSeedOwner(seedOptions);
  const existingKeys = new Set(
    state.memberships.map((membership) => `${membership.userId}:${membership.workspaceId}`)
  );
  const missingMemberships = openRoadState.workspaces.flatMap((workspace) => {
    const key = `${owner.id}:${workspace.id}`;
    if (existingKeys.has(key)) return [];
    return [
      {
        createdAt: "seed",
        id: `membership-${owner.id}-${workspace.id}`,
        role: "Owner" as const,
        userId: owner.id,
        workspaceId: workspace.id
      }
    ];
  });

  if (missingMemberships.length === 0 && state.users.length > 0) {
    return state;
  }

  return {
    ...state,
    memberships: [...state.memberships, ...missingMemberships],
    users: state.users.length > 0 ? state.users : [owner]
  };
}

function createSeedOwner(seedOptions: TeamStoreSeedOptions): TeamUser {
  return {
    createdAt: "seed",
    email: seedOptions.ownerEmail ?? "owner@openroad.local",
    id: "local-owner",
    name: seedOptions.ownerName ?? "Local owner"
  };
}

function isTeamUser(value: unknown): value is TeamUser {
  return (
    isRecord(value) &&
    typeof value.createdAt === "string" &&
    typeof value.email === "string" &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  );
}

function isWorkspaceMembership(value: unknown): value is WorkspaceMembership {
  return (
    isRecord(value) &&
    typeof value.createdAt === "string" &&
    typeof value.id === "string" &&
    (value.role === "Owner" ||
      value.role === "Maintainer" ||
      value.role === "Contributor" ||
      value.role === "Viewer") &&
    typeof value.userId === "string" &&
    typeof value.workspaceId === "string"
  );
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return (
    isRecord(value) &&
    typeof value.actorId === "string" &&
    typeof value.actorType === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.id === "string" &&
    typeof value.requestId === "string" &&
    typeof value.summary === "string" &&
    typeof value.type === "string" &&
    (value.workspaceId === undefined || typeof value.workspaceId === "string")
  );
}

function getPersistedSchemaVersion(value: unknown) {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { schemaVersion?: unknown };
  return typeof record.schemaVersion === "number" ? record.schemaVersion : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
