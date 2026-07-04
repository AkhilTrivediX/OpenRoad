export const integrationProviders = ["github", "linear", "jira"] as const;

export const externalObjectTypes = [
  "issue",
  "pull-request",
  "project",
  "comment",
  "release"
] as const;

export const openRoadObjectTypes = [
  "request",
  "work-item",
  "roadmap-item",
  "changelog-entry"
] as const;

export const syncResultKinds = [
  "success",
  "noop",
  "retryable-error",
  "rate-limited",
  "conflict",
  "fatal-error"
] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];
export type ExternalObjectType = (typeof externalObjectTypes)[number];
export type OpenRoadObjectType = (typeof openRoadObjectTypes)[number];
export type SyncResultKind = (typeof syncResultKinds)[number];

export type IntegrationInstallation = {
  createdAt: string;
  id: string;
  permissions: IntegrationPermission[];
  provider: IntegrationProvider;
  providerAccountId: string;
  providerAccountName: string;
  status: "active" | "disconnected" | "suspended";
  workspaceId: string;
};

export type IntegrationPermission =
  | "read:external"
  | "write:external"
  | "read:openroad"
  | "write:openroad"
  | "webhook:receive";

export type ExternalObjectRef = {
  id: string;
  key?: string;
  provider: IntegrationProvider;
  type: ExternalObjectType;
  url?: string;
};

export type OpenRoadObjectRef = {
  id: string;
  type: OpenRoadObjectType;
  workspaceId: string;
};

export type ExternalObjectMapping = {
  connectedAt: string;
  disconnectedAt?: string;
  external: ExternalObjectRef;
  id: string;
  installationId: string;
  lastSyncedAt?: string;
  openRoad: OpenRoadObjectRef;
  status: "active" | "disconnected" | "conflicted";
};

export type SyncSnapshot = {
  etag?: string;
  fields: Record<string, unknown>;
  syncedAt: string;
};

export type SyncConflict = {
  base?: SyncSnapshot;
  createdAt: string;
  external: SyncSnapshot;
  id: string;
  local: SyncSnapshot;
  mappingId: string;
  resolution: "unresolved" | "prefer-openroad" | "prefer-provider" | "manual";
};

export type SyncJob = {
  attempt: number;
  id: string;
  installationId: string;
  mappingId?: string;
  nextRunAt?: string;
  provider: IntegrationProvider;
  reason: "manual" | "scheduled" | "webhook" | "retry";
  status: "queued" | "running" | "succeeded" | "failed";
  workspaceId: string;
};

export type SyncResult = {
  conflict?: SyncConflict;
  kind: SyncResultKind;
  message?: string;
  retryAfterSeconds?: number;
};

export type ProviderFixture = {
  external: ExternalObjectRef;
  fields: Record<string, unknown>;
  installation: IntegrationInstallation;
  openRoad: OpenRoadObjectRef;
};

export type ProviderAdapter = {
  importExternalObject(ref: ExternalObjectRef): Promise<SyncResult>;
  installation: IntegrationInstallation;
  name: string;
  syncMapping(mapping: ExternalObjectMapping): Promise<SyncResult>;
};

export function createExternalObjectKey(ref: ExternalObjectRef) {
  return [
    normalizeSegment(ref.provider),
    normalizeSegment(ref.type),
    normalizeSegment(ref.key ?? ref.id)
  ].join(":");
}

export function createMappingKey(
  installationId: string,
  external: ExternalObjectRef,
  openRoad: OpenRoadObjectRef
) {
  return [
    normalizeSegment(installationId),
    createExternalObjectKey(external),
    normalizeSegment(openRoad.workspaceId),
    normalizeSegment(openRoad.type),
    normalizeSegment(openRoad.id)
  ].join("|");
}

export function createMapping(
  installationId: string,
  external: ExternalObjectRef,
  openRoad: OpenRoadObjectRef,
  connectedAt: string
): ExternalObjectMapping {
  return {
    connectedAt,
    external: normalizeExternalObjectRef(external),
    id: createMappingKey(installationId, external, openRoad),
    installationId,
    openRoad,
    status: "active"
  };
}

export function disconnectMapping(
  mapping: ExternalObjectMapping,
  disconnectedAt: string
): ExternalObjectMapping {
  return {
    ...mapping,
    disconnectedAt,
    status: "disconnected"
  };
}

export function shouldRetrySync(result: SyncResult) {
  return result.kind === "retryable-error" || result.kind === "rate-limited";
}

export function validateProviderFixture(fixture: ProviderFixture) {
  if (fixture.installation.provider !== fixture.external.provider) {
    throw new Error("Provider fixture installation and external object provider must match.");
  }

  if (fixture.installation.workspaceId !== fixture.openRoad.workspaceId) {
    throw new Error("Provider fixture installation and OpenRoad object workspace must match.");
  }

  if (!fixture.installation.permissions.includes("read:external")) {
    throw new Error("Provider fixture installation must include read:external permission.");
  }

  return fixture;
}

function normalizeExternalObjectRef(ref: ExternalObjectRef): ExternalObjectRef {
  return {
    ...ref,
    id: ref.id.trim(),
    key: ref.key?.trim()
  };
}

function normalizeSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:@/-]+/g, "-");
}
