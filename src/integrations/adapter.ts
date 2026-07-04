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

export const integrationPermissions = [
  "read:external",
  "write:external",
  "read:openroad",
  "write:openroad",
  "webhook:receive"
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

export type IntegrationPermission = (typeof integrationPermissions)[number];

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
  const normalizedRef = normalizeExternalObjectRef(ref);

  return [
    encodeSegment(normalizedRef.provider),
    encodeSegment(normalizedRef.type),
    `id=${encodeSegment(normalizedRef.id)}`
  ].join(":");
}

export function createMappingKey(
  installationId: string,
  external: ExternalObjectRef,
  openRoad: OpenRoadObjectRef
) {
  const normalizedExternal = normalizeExternalObjectRef(external);
  const normalizedOpenRoad = normalizeOpenRoadObjectRef(openRoad);

  return [
    encodeSegment(installationId),
    createExternalObjectKey(normalizedExternal),
    encodeSegment(normalizedOpenRoad.workspaceId),
    encodeSegment(normalizedOpenRoad.type),
    encodeSegment(normalizedOpenRoad.id)
  ].join("|");
}

export function createMapping(
  installation: IntegrationInstallation,
  external: ExternalObjectRef,
  openRoad: OpenRoadObjectRef,
  connectedAt: string
): ExternalObjectMapping {
  const normalizedInstallation = normalizeInstallation(installation);
  const normalizedExternal = normalizeExternalObjectRef(external);
  const normalizedOpenRoad = normalizeOpenRoadObjectRef(openRoad);

  if (normalizedInstallation.status !== "active") {
    throw new Error("Integration installation must be active before creating mappings.");
  }

  if (normalizedInstallation.provider !== normalizedExternal.provider) {
    throw new Error("Integration installation and external object provider must match.");
  }

  if (normalizedInstallation.workspaceId !== normalizedOpenRoad.workspaceId) {
    throw new Error("Integration installation and OpenRoad object workspace must match.");
  }

  return {
    connectedAt,
    external: normalizedExternal,
    id: createMappingKey(normalizedInstallation.id, normalizedExternal, normalizedOpenRoad),
    installationId: normalizedInstallation.id,
    openRoad: normalizedOpenRoad,
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

export function assertMappingMatchesInstallation(
  installation: IntegrationInstallation,
  mapping: ExternalObjectMapping
) {
  const normalizedInstallation = normalizeInstallation(installation);

  if (mapping.installationId.trim() !== normalizedInstallation.id) {
    throw new Error("External object mapping installation id must match the installation.");
  }

  if (mapping.external.provider !== normalizedInstallation.provider) {
    throw new Error("External object mapping provider must match the installation.");
  }

  if (mapping.openRoad.workspaceId.trim() !== normalizedInstallation.workspaceId) {
    throw new Error("External object mapping workspace must match the installation.");
  }

  return mapping;
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
  const key = normalizeOptionalSegment(ref.key);

  return {
    ...ref,
    id: requireSegment(ref.id, "external object id"),
    key
  };
}

function normalizeOpenRoadObjectRef(ref: OpenRoadObjectRef): OpenRoadObjectRef {
  return {
    ...ref,
    id: requireSegment(ref.id, "OpenRoad object id"),
    workspaceId: requireSegment(ref.workspaceId, "OpenRoad workspace id")
  };
}

function normalizeInstallation(installation: IntegrationInstallation): IntegrationInstallation {
  return {
    ...installation,
    id: requireSegment(installation.id, "integration installation id"),
    providerAccountId: requireSegment(
      installation.providerAccountId,
      "integration provider account id"
    ),
    providerAccountName: requireSegment(
      installation.providerAccountName,
      "integration provider account name"
    ),
    workspaceId: requireSegment(installation.workspaceId, "integration workspace id")
  };
}

function normalizeOptionalSegment(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireSegment(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function encodeSegment(value: string) {
  return encodeURIComponent(requireSegment(value, "identity segment"));
}
