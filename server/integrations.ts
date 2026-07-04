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

export const openRoadIntegrationSchemaVersion = 3;

export const integrationCredentialSecretTypes = ["access-token", "refresh-token"] as const;
export const integrationSyncJobReasons = ["manual", "scheduled", "webhook", "retry"] as const;
export const integrationSyncJobStatuses = ["queued", "running", "succeeded", "failed"] as const;

export type IntegrationCredentialSecretType = (typeof integrationCredentialSecretTypes)[number];
export type IntegrationSyncJobReason = (typeof integrationSyncJobReasons)[number];
export type IntegrationSyncJobStatus = (typeof integrationSyncJobStatuses)[number];

export type EncryptedIntegrationCredentialSecret = {
  alg: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  keyId?: string;
  tag: string;
};

export type IntegrationCredential = {
  createdAt: string;
  encryptedSecret?: EncryptedIntegrationCredentialSecret;
  expiresAt?: string;
  id: string;
  installationId: string;
  label?: string;
  permissions: IntegrationPermission[];
  provider: IntegrationProvider;
  providerScopes: string[];
  revokedAt?: string;
  secretTypes: IntegrationCredentialSecretType[];
  status: "active" | "revoked";
  tokenType?: string;
  updatedAt: string;
  workspaceId: string;
};

export type IntegrationCredentialMetadata = Omit<IntegrationCredential, "encryptedSecret">;

export type IntegrationState = {
  credentials: IntegrationCredential[];
  installations: IntegrationInstallation[];
  mappings: ExternalObjectMapping[];
  schemaVersion: typeof openRoadIntegrationSchemaVersion;
  syncEvents: IntegrationSyncEvent[];
  syncJobs: IntegrationSyncJob[];
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

export type IntegrationSyncJob = {
  attempt: number;
  claimedAt?: string;
  completedAt?: string;
  createdAt: string;
  dedupeKey: string;
  error?: string;
  id: string;
  installationId: string;
  lastRunAt?: string;
  leaseExpiresAt?: string;
  mappingId?: string;
  nextRunAt?: string;
  provider: IntegrationProvider;
  reason: IntegrationSyncJobReason;
  resultSummary?: string;
  status: IntegrationSyncJobStatus;
  updatedAt: string;
  workspaceId: string;
};

export type IntegrationStoreLoadStatus = "ready" | "seeded" | "migrated" | "recovered";

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
      const parsed = JSON.parse(raw) as unknown;
      const state = parseIntegrationState(parsed);
      const status =
        getPersistedSchemaVersion(parsed) === openRoadIntegrationSchemaVersion
          ? "ready"
          : "migrated";

      if (status === "migrated" || shouldPersistSanitizedState(parsed, state)) {
        await this.writeState(state);
      }

      return { state, status };
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
    credentials: [],
    installations: [],
    mappings: [],
    schemaVersion: openRoadIntegrationSchemaVersion,
    syncEvents: [],
    syncJobs: []
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

  const schemaVersion = getPersistedSchemaVersion(value);
  const isVersionOne = schemaVersion === 1;
  const isVersionTwo = schemaVersion === 2;
  const isCurrentVersion = schemaVersion === openRoadIntegrationSchemaVersion;
  const credentials = isVersionOne && value.credentials === undefined ? [] : value.credentials;
  const syncJobs = (isVersionOne || isVersionTwo) && value.syncJobs === undefined ? [] : value.syncJobs;

  if (
    (!isVersionOne && !isVersionTwo && !isCurrentVersion) ||
    !Array.isArray(credentials) ||
    !Array.isArray(value.installations) ||
    !Array.isArray(value.mappings) ||
    (value.syncEvents !== undefined && !Array.isArray(value.syncEvents)) ||
    !Array.isArray(syncJobs)
  ) {
    throw new IntegrationStoreError("invalid_state", "OpenRoad integration metadata is invalid.");
  }

  if (
    !credentials.every(isIntegrationCredential) ||
    !value.installations.every(isIntegrationInstallation) ||
    !value.mappings.every(isMapping) ||
    (Array.isArray(value.syncEvents) && !value.syncEvents.every(isSyncEvent)) ||
    !syncJobs.every(isIntegrationSyncJob)
  ) {
    throw new IntegrationStoreError("invalid_state", "OpenRoad integration metadata is invalid.");
  }

  return cloneValue({
    credentials: credentials.map(sanitizeIntegrationCredential),
    installations: value.installations.map(sanitizeIntegrationInstallation),
    mappings: value.mappings.map(sanitizeExternalObjectMapping),
    schemaVersion: openRoadIntegrationSchemaVersion,
    syncEvents: (value.syncEvents ?? []).map(sanitizeIntegrationSyncEvent).slice(0, 1000),
    syncJobs: trimIntegrationSyncJobs(syncJobs.map(sanitizeIntegrationSyncJob))
  });
}

export function sanitizeIntegrationCredential(
  credential: IntegrationCredential
): IntegrationCredential {
  const sanitized: IntegrationCredential = {
    createdAt: credential.createdAt,
    ...(credential.status === "active" && credential.encryptedSecret
      ? { encryptedSecret: sanitizeEncryptedIntegrationCredentialSecret(credential.encryptedSecret) }
      : {}),
    ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
    id: credential.id,
    installationId: credential.installationId,
    ...(credential.label ? { label: credential.label } : {}),
    permissions: credential.permissions.filter(isIntegrationPermission),
    provider: credential.provider,
    providerScopes: uniqueStrings(credential.providerScopes),
    ...(credential.revokedAt ? { revokedAt: credential.revokedAt } : {}),
    secretTypes: credential.secretTypes.filter(isIntegrationCredentialSecretType),
    status: credential.status,
    ...(credential.tokenType ? { tokenType: credential.tokenType } : {}),
    updatedAt: credential.updatedAt,
    workspaceId: credential.workspaceId
  };

  if (sanitized.status === "revoked") {
    delete sanitized.encryptedSecret;
  }

  return sanitized;
}

export function sanitizeIntegrationCredentialMetadata(
  credential: IntegrationCredential
): IntegrationCredentialMetadata {
  const { encryptedSecret: _encryptedSecret, ...metadata } = sanitizeIntegrationCredential(credential);
  return metadata;
}

export function createIntegrationCredentialSecretContext(
  credential: Pick<IntegrationCredential, "id" | "installationId" | "provider" | "workspaceId">
) {
  return [
    "openroad-integration-credential",
    "v1",
    credential.provider,
    encodeURIComponent(credential.workspaceId),
    encodeURIComponent(credential.installationId),
    encodeURIComponent(credential.id)
  ].join(":");
}

export function revokeIntegrationCredential(
  credential: IntegrationCredential,
  revokedAt: string
): IntegrationCredential {
  return sanitizeIntegrationCredential({
    ...credential,
    encryptedSecret: undefined,
    revokedAt: credential.revokedAt ?? revokedAt,
    status: "revoked",
    updatedAt: revokedAt
  });
}

export function revokeIntegrationCredentialsForInstallation(
  credentials: IntegrationCredential[],
  installation: Pick<IntegrationInstallation, "id" | "provider" | "workspaceId">,
  revokedAt: string
) {
  const revokedCredentials: IntegrationCredential[] = [];
  const nextCredentials = credentials.map((credential) => {
    if (
      credential.status === "active" &&
      credential.provider === installation.provider &&
      credential.workspaceId === installation.workspaceId &&
      credential.installationId === installation.id
    ) {
      const revoked = revokeIntegrationCredential(credential, revokedAt);
      revokedCredentials.push(revoked);
      return revoked;
    }

    return credential;
  });

  return {
    credentials: nextCredentials,
    revokedCredentials
  };
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

export function sanitizeIntegrationSyncJob(job: IntegrationSyncJob): IntegrationSyncJob {
  return {
    attempt: Math.max(0, Math.floor(job.attempt)),
    ...(job.claimedAt ? { claimedAt: job.claimedAt } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    createdAt: job.createdAt,
    dedupeKey: job.dedupeKey,
    ...(job.error ? { error: redactSensitiveText(job.error.slice(0, 500)) } : {}),
    id: job.id,
    installationId: job.installationId,
    ...(job.lastRunAt ? { lastRunAt: job.lastRunAt } : {}),
    ...(job.leaseExpiresAt ? { leaseExpiresAt: job.leaseExpiresAt } : {}),
    ...(job.mappingId ? { mappingId: job.mappingId } : {}),
    ...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}),
    provider: job.provider,
    reason: job.reason,
    ...(job.resultSummary ? { resultSummary: redactSensitiveText(job.resultSummary.slice(0, 500)) } : {}),
    status: job.status,
    updatedAt: job.updatedAt,
    workspaceId: job.workspaceId
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

function trimIntegrationSyncJobs(jobs: IntegrationSyncJob[]) {
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const historyJobs = jobs.filter((job) => job.status !== "queued" && job.status !== "running");
  return [...activeJobs, ...historyJobs].slice(0, 1000);
}

function sanitizeEncryptedIntegrationCredentialSecret(
  secret: EncryptedIntegrationCredentialSecret
): EncryptedIntegrationCredentialSecret {
  return {
    alg: "aes-256-gcm",
    ciphertext: secret.ciphertext,
    iv: secret.iv,
    ...(secret.keyId ? { keyId: secret.keyId } : {}),
    tag: secret.tag
  };
}

function isIntegrationCredential(value: unknown): value is IntegrationCredential {
  return (
    isRecord(value) &&
    typeof value.createdAt === "string" &&
    (value.encryptedSecret === undefined || isEncryptedIntegrationCredentialSecret(value.encryptedSecret)) &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string") &&
    typeof value.id === "string" &&
    typeof value.installationId === "string" &&
    (value.label === undefined || typeof value.label === "string") &&
    Array.isArray(value.permissions) &&
    value.permissions.every(isIntegrationPermission) &&
    integrationProviders.includes(value.provider as IntegrationProvider) &&
    Array.isArray(value.providerScopes) &&
    value.providerScopes.every((scope) => typeof scope === "string") &&
    (value.revokedAt === undefined || typeof value.revokedAt === "string") &&
    Array.isArray(value.secretTypes) &&
    value.secretTypes.every(isIntegrationCredentialSecretType) &&
    (value.status === "active" || value.status === "revoked") &&
    (value.status !== "active" || isEncryptedIntegrationCredentialSecret(value.encryptedSecret)) &&
    (value.tokenType === undefined || typeof value.tokenType === "string") &&
    typeof value.updatedAt === "string" &&
    typeof value.workspaceId === "string"
  );
}

function isEncryptedIntegrationCredentialSecret(
  value: unknown
): value is EncryptedIntegrationCredentialSecret {
  return (
    isRecord(value) &&
    value.alg === "aes-256-gcm" &&
    typeof value.ciphertext === "string" &&
    typeof value.iv === "string" &&
    (value.keyId === undefined || typeof value.keyId === "string") &&
    typeof value.tag === "string"
  );
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

function isIntegrationSyncJob(value: unknown): value is IntegrationSyncJob {
  return (
    isRecord(value) &&
    typeof value.attempt === "number" &&
    Number.isFinite(value.attempt) &&
    (value.claimedAt === undefined || typeof value.claimedAt === "string") &&
    (value.completedAt === undefined || typeof value.completedAt === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.dedupeKey === "string" &&
    (value.error === undefined || typeof value.error === "string") &&
    typeof value.id === "string" &&
    typeof value.installationId === "string" &&
    (value.lastRunAt === undefined || typeof value.lastRunAt === "string") &&
    (value.leaseExpiresAt === undefined || typeof value.leaseExpiresAt === "string") &&
    (value.mappingId === undefined || typeof value.mappingId === "string") &&
    (value.nextRunAt === undefined || typeof value.nextRunAt === "string") &&
    integrationProviders.includes(value.provider as IntegrationProvider) &&
    integrationSyncJobReasons.includes(value.reason as IntegrationSyncJobReason) &&
    (value.resultSummary === undefined || typeof value.resultSummary === "string") &&
    integrationSyncJobStatuses.includes(value.status as IntegrationSyncJobStatus) &&
    typeof value.updatedAt === "string" &&
    typeof value.workspaceId === "string"
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

function isIntegrationCredentialSecretType(value: unknown): value is IntegrationCredentialSecretType {
  return integrationCredentialSecretTypes.includes(value as IntegrationCredentialSecretType);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getPersistedSchemaVersion(value: unknown) {
  if (!isRecord(value)) return undefined;
  return typeof value.schemaVersion === "number" ? value.schemaVersion : undefined;
}

function shouldPersistSanitizedState(original: unknown, sanitized: IntegrationState) {
  return JSON.stringify(original) !== JSON.stringify(sanitized);
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

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:access_token|refresh_token|token|jwt|secret|client_secret|authorization)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .replace(/\b[\w.-]*(?:token|secret|password|credential|authorization)[\w.-]*\b/gi, "[redacted]")
    .slice(0, 500);
}
