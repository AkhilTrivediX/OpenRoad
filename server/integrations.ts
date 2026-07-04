import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  externalObjectTypes,
  integrationPermissions,
  integrationProviders,
  openRoadObjectTypes,
  type ExternalObjectMapping,
  type IntegrationInstallation,
  type IntegrationProvider,
  type IntegrationPermission
} from "../src/integrations/adapter.js";

export const openRoadIntegrationSchemaVersion = 1;

export type IntegrationState = {
  installations: IntegrationInstallation[];
  mappings: ExternalObjectMapping[];
  schemaVersion: typeof openRoadIntegrationSchemaVersion;
  syncEvents: IntegrationSyncEvent[];
};

export type IntegrationSyncEvent = {
  createdAt: string;
  deliveryId: string;
  event: string;
  id: string;
  installationId?: string;
  provider: IntegrationProvider;
  result: "accepted" | "duplicate" | "ignored" | "synced";
  summary: string;
  workspaceId?: string;
};

export type IntegrationStoreLoadStatus = "ready" | "seeded" | "recovered";

export type IntegrationStoreLoadResult = {
  backupPath?: string;
  state: IntegrationState;
  status: IntegrationStoreLoadStatus;
};

export type IntegrationStore = {
  load(): Promise<IntegrationStoreLoadResult>;
  replaceState(value: IntegrationState): Promise<IntegrationState>;
  upsertInstallation(installation: IntegrationInstallation): Promise<IntegrationInstallation>;
  upsertMapping(mapping: ExternalObjectMapping): Promise<ExternalObjectMapping>;
};

export class IntegrationStoreError extends Error {
  code: "corrupt_state" | "future_schema" | "invalid_state";

  constructor(code: IntegrationStoreError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class FileIntegrationStore implements IntegrationStore {
  constructor(private readonly integrationFile: string) {}

  async load(): Promise<IntegrationStoreLoadResult> {
    let raw: string;

    try {
      raw = await readFile(this.integrationFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const state = createInitialIntegrationState();
        await this.writeState(state);
        return { state, status: "seeded" };
      }

      throw error;
    }

    try {
      return { state: parseIntegrationState(JSON.parse(raw) as unknown), status: "ready" };
    } catch (error) {
      if (error instanceof IntegrationStoreError && error.code === "future_schema") {
        throw error;
      }

      const backupPath = await this.backupCorruptState();
      const state = createInitialIntegrationState();
      await this.writeState(state);
      return { backupPath, state, status: "recovered" };
    }
  }

  async replaceState(value: IntegrationState) {
    const state = parseIntegrationState(value);
    await this.writeState(state);
    return state;
  }

  async upsertInstallation(installation: IntegrationInstallation) {
    const result = await this.load();
    const nextInstallation = sanitizeIntegrationInstallation(installation);
    const state = parseIntegrationState({
      ...result.state,
      installations: upsertInstallationByKey(result.state.installations, nextInstallation)
    });

    await this.writeState(state);
    return cloneValue(nextInstallation);
  }

  async upsertMapping(mapping: ExternalObjectMapping) {
    const result = await this.load();
    const nextMapping = sanitizeExternalObjectMapping(mapping);
    const state = parseIntegrationState({
      ...result.state,
      mappings: upsertById(result.state.mappings, nextMapping)
    });

    await this.writeState(state);
    return cloneValue(nextMapping);
  }

  private async backupCorruptState() {
    const backupPath = `${this.integrationFile}.corrupt-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    await mkdir(dirname(this.integrationFile), { recursive: true });
    await rename(this.integrationFile, backupPath);
    return backupPath;
  }

  private async writeState(state: IntegrationState) {
    await mkdir(dirname(this.integrationFile), { recursive: true });
    const temporaryPath = `${this.integrationFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.integrationFile);
  }
}

export function createInitialIntegrationState(): IntegrationState {
  return {
    installations: [],
    mappings: [],
    schemaVersion: openRoadIntegrationSchemaVersion,
    syncEvents: []
  };
}

export function parseIntegrationState(value: unknown): IntegrationState {
  if (!isRecord(value)) {
    throw new IntegrationStoreError("invalid_state", "OpenRoad integration metadata is not an object.");
  }

  if (
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > openRoadIntegrationSchemaVersion
  ) {
    throw new IntegrationStoreError(
      "future_schema",
      "OpenRoad integration metadata was created by a newer version."
    );
  }

  if (
    value.schemaVersion !== openRoadIntegrationSchemaVersion ||
    !Array.isArray(value.installations) ||
    !Array.isArray(value.mappings) ||
    (value.syncEvents !== undefined && !Array.isArray(value.syncEvents))
  ) {
    throw new IntegrationStoreError("invalid_state", "OpenRoad integration metadata is invalid.");
  }

  if (
    !value.installations.every(isIntegrationInstallation) ||
    !value.mappings.every(isMapping) ||
    (Array.isArray(value.syncEvents) && !value.syncEvents.every(isSyncEvent))
  ) {
    throw new IntegrationStoreError("invalid_state", "OpenRoad integration metadata is invalid.");
  }

  return cloneValue({
    installations: value.installations.map(sanitizeIntegrationInstallation),
    mappings: value.mappings.map(sanitizeExternalObjectMapping),
    schemaVersion: openRoadIntegrationSchemaVersion,
    syncEvents: (value.syncEvents ?? []).map(sanitizeIntegrationSyncEvent).slice(0, 1000)
  });
}

export function resolveOpenRoadIntegrationFile(env = process.env) {
  return resolve(env.OPENROAD_INTEGRATION_FILE ?? ".openroad/openroad-integrations.json");
}

export function sanitizeIntegrationInstallation(
  installation: IntegrationInstallation
): IntegrationInstallation {
  return {
    createdAt: installation.createdAt,
    id: installation.id,
    permissions: installation.permissions.filter(isIntegrationPermission),
    provider: installation.provider,
    providerAccountId: installation.providerAccountId,
    providerAccountName: installation.providerAccountName,
    status: installation.status,
    workspaceId: installation.workspaceId
  };
}

export function sanitizeExternalObjectMapping(
  mapping: ExternalObjectMapping
): ExternalObjectMapping {
  return {
    connectedAt: mapping.connectedAt,
    ...(mapping.disconnectedAt ? { disconnectedAt: mapping.disconnectedAt } : {}),
    external: {
      id: mapping.external.id,
      ...(mapping.external.key ? { key: mapping.external.key } : {}),
      provider: mapping.external.provider,
      type: mapping.external.type,
      ...(mapping.external.url ? { url: mapping.external.url } : {})
    },
    id: mapping.id,
    installationId: mapping.installationId,
    ...(mapping.lastSyncedAt ? { lastSyncedAt: mapping.lastSyncedAt } : {}),
    openRoad: {
      id: mapping.openRoad.id,
      type: mapping.openRoad.type,
      workspaceId: mapping.openRoad.workspaceId
    },
    status: mapping.status
  };
}

export function sanitizeIntegrationSyncEvent(event: IntegrationSyncEvent): IntegrationSyncEvent {
  return {
    createdAt: event.createdAt,
    deliveryId: event.deliveryId,
    event: event.event,
    id: event.id,
    ...(event.installationId ? { installationId: event.installationId } : {}),
    provider: event.provider,
    result: event.result,
    summary: event.summary,
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {})
  };
}

function upsertInstallationByKey(
  items: IntegrationInstallation[],
  nextItem: IntegrationInstallation
) {
  const nextKey = createInstallationKey(nextItem);
  const nextItems = items.filter((item) => createInstallationKey(item) !== nextKey);
  return [cloneValue(nextItem), ...nextItems];
}

function createInstallationKey(installation: IntegrationInstallation) {
  return [installation.provider, installation.workspaceId, installation.id].join(":");
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const nextItems = items.filter((item) => item.id !== nextItem.id);
  return [cloneValue(nextItem), ...nextItems];
}

function isIntegrationInstallation(value: unknown): value is IntegrationInstallation {
  return (
    isRecord(value) &&
    typeof value.createdAt === "string" &&
    typeof value.id === "string" &&
    Array.isArray(value.permissions) &&
    value.permissions.every(isIntegrationPermission) &&
    integrationProviders.includes(value.provider as IntegrationInstallation["provider"]) &&
    typeof value.providerAccountId === "string" &&
    typeof value.providerAccountName === "string" &&
    (value.status === "active" ||
      value.status === "disconnected" ||
      value.status === "suspended") &&
    typeof value.workspaceId === "string"
  );
}

function isMapping(value: unknown): value is ExternalObjectMapping {
  return (
    isRecord(value) &&
    typeof value.connectedAt === "string" &&
    (value.disconnectedAt === undefined || typeof value.disconnectedAt === "string") &&
    isExternalObjectRef(value.external) &&
    typeof value.id === "string" &&
    typeof value.installationId === "string" &&
    (value.lastSyncedAt === undefined || typeof value.lastSyncedAt === "string") &&
    isOpenRoadObjectRef(value.openRoad) &&
    (value.status === "active" || value.status === "disconnected" || value.status === "conflicted")
  );
}

function isSyncEvent(value: unknown): value is IntegrationSyncEvent {
  return (
    isRecord(value) &&
    typeof value.createdAt === "string" &&
    typeof value.deliveryId === "string" &&
    typeof value.event === "string" &&
    typeof value.id === "string" &&
    (value.installationId === undefined || typeof value.installationId === "string") &&
    integrationProviders.includes(value.provider as IntegrationProvider) &&
    (value.result === "accepted" ||
      value.result === "duplicate" ||
      value.result === "ignored" ||
      value.result === "synced") &&
    typeof value.summary === "string" &&
    (value.workspaceId === undefined || typeof value.workspaceId === "string")
  );
}

function isExternalObjectRef(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.key === undefined || typeof value.key === "string") &&
    integrationProviders.includes(value.provider as IntegrationInstallation["provider"]) &&
    externalObjectTypes.includes(value.type as ExternalObjectMapping["external"]["type"]) &&
    (value.url === undefined || typeof value.url === "string")
  );
}

function isOpenRoadObjectRef(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    openRoadObjectTypes.includes(value.type as ExternalObjectMapping["openRoad"]["type"]) &&
    typeof value.workspaceId === "string"
  );
}

function isIntegrationPermission(value: unknown): value is IntegrationPermission {
  return integrationPermissions.includes(value as IntegrationPermission);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
