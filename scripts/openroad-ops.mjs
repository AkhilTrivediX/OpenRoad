#!/usr/bin/env node
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const backupManifestVersion = 1;
const defaultWorkspaceId = "acme";

export async function createBackup(options = {}) {
  const dataFile = resolve(options.dataFile ?? process.env.OPENROAD_DATA_FILE ?? ".openroad/openroad-state.json");
  const integrationFile = resolve(
    options.integrationFile ?? process.env.OPENROAD_INTEGRATION_FILE ?? ".openroad/openroad-integrations.json"
  );
  const sessionFile = resolve(options.sessionFile ?? process.env.OPENROAD_SESSION_FILE ?? ".openroad/openroad-sessions.json");
  const teamFile = resolve(options.teamFile ?? process.env.OPENROAD_TEAM_FILE ?? ".openroad/openroad-team.json");
  const outputDir = resolve(options.outputDir ?? ".openroad/backups");
  const createdAt = new Date().toISOString();
  const backupName = options.name ?? `openroad-backup-${safeTimestamp(createdAt)}`;
  const backupDir = join(outputDir, backupName);
  const dataArchiveName = "openroad-state.json";
  const integrationArchiveName = "openroad-integrations.json";
  const sessionArchiveName = "openroad-sessions.json";
  const teamArchiveName = "openroad-team.json";

  const [dataJson, integrationSource, sessionSource, teamSourceJson, packageJson] = await Promise.all([
    readJsonFile(dataFile, "OpenRoad state file"),
    readIntegrationSource(integrationFile),
    readSessionSource(sessionFile),
    readJsonFile(teamFile, "OpenRoad team metadata file"),
    readPackageJson()
  ]);
  const integrationJson = sanitizeIntegrationState(integrationSource.json);
  const sessionJson = sanitizeSessionState(sessionSource.json);
  const teamJson = sanitizeTeamState(teamSourceJson);

  validateOpenRoadState(dataJson);

  await mkdir(outputDir, { recursive: true });
  await mkdir(backupDir, { recursive: false });
  await copyFile(dataFile, join(backupDir, dataArchiveName));
  await writeJsonFile(join(backupDir, integrationArchiveName), integrationJson);
  await writeJsonFile(join(backupDir, sessionArchiveName), sessionJson);
  await writeJsonFile(join(backupDir, teamArchiveName), teamJson);

  const dataStats = await stat(dataFile);
  const integrationSize = Buffer.byteLength(`${JSON.stringify(integrationJson, null, 2)}\n`);
  const sessionSize = Buffer.byteLength(`${JSON.stringify(sessionJson, null, 2)}\n`);
  const teamSize = Buffer.byteLength(`${JSON.stringify(teamJson, null, 2)}\n`);
  const manifest = {
    app: {
      name: stringOrFallback(packageJson.name, "openroad"),
      version: stringOrFallback(packageJson.version, "0.0.0")
    },
    createdAt,
    files: {
      data: {
        archiveName: dataArchiveName,
        schemaVersion: dataJson.schemaVersion,
        sizeBytes: dataStats.size,
        sourcePath: dataFile
      },
      integration: {
        archiveName: integrationArchiveName,
        schemaVersion: integrationJson.schemaVersion,
        sizeBytes: integrationSize,
        sourcePath: integrationFile,
        sourceStatus: integrationSource.exists ? "file" : "default-empty"
      },
      session: {
        archiveName: sessionArchiveName,
        schemaVersion: sessionJson.schemaVersion,
        sizeBytes: sessionSize,
        sourcePath: sessionFile,
        sourceStatus: sessionSource.exists ? "file" : "default-empty"
      },
      team: {
        archiveName: teamArchiveName,
        schemaVersion: teamJson.schemaVersion,
        sizeBytes: teamSize,
        sourcePath: teamFile
      }
    },
    manifestVersion: backupManifestVersion,
    type: "openroad-file-snapshot"
  };

  await writeJsonFile(join(backupDir, "manifest.json"), manifest);

  return { backupDir, manifest };
}

export async function restoreBackup(options = {}) {
  if (!options.inputDir) {
    throw new OpsError("missing_input", "Restore requires --input <backup-directory>.");
  }

  const inputDir = resolve(options.inputDir);
  const dataFile = resolve(options.dataFile ?? process.env.OPENROAD_DATA_FILE ?? ".openroad/openroad-state.json");
  const integrationFile = resolve(
    options.integrationFile ?? process.env.OPENROAD_INTEGRATION_FILE ?? ".openroad/openroad-integrations.json"
  );
  const sessionFile = resolve(options.sessionFile ?? process.env.OPENROAD_SESSION_FILE ?? ".openroad/openroad-sessions.json");
  const teamFile = resolve(options.teamFile ?? process.env.OPENROAD_TEAM_FILE ?? ".openroad/openroad-team.json");
  const manifest = await readManifest(inputDir, options.force === true);
  const dataArchiveName = manifest?.files?.data?.archiveName ?? "openroad-state.json";
  const integrationArchiveName = manifest?.files?.integration?.archiveName ?? "openroad-integrations.json";
  const sessionArchiveName = manifest?.files?.session?.archiveName ?? "openroad-sessions.json";
  const teamArchiveName = manifest?.files?.team?.archiveName ?? "openroad-team.json";
  const dataSource = join(inputDir, dataArchiveName);
  const integrationSource = join(inputDir, integrationArchiveName);
  const sessionSource = join(inputDir, sessionArchiveName);
  const teamSource = join(inputDir, teamArchiveName);
  const safetyDir =
    options.safetyDir ??
    join(dirname(dataFile), "restore-safety", `openroad-pre-restore-${safeTimestamp(new Date().toISOString())}`);

  if (!options.force) {
    const [dataJson, integrationJson, sessionJson, teamJson] = await Promise.all([
      readJsonFile(dataSource, "backup OpenRoad state file"),
      readJsonFile(integrationSource, "backup OpenRoad integration metadata file"),
      readSessionSource(sessionSource).then((source) => source.json),
      readJsonFile(teamSource, "backup OpenRoad team metadata file")
    ]);
    validateOpenRoadState(dataJson);
    sanitizeIntegrationState(integrationJson);
    sanitizeSessionState(sessionJson);
    sanitizeTeamState(teamJson);
  } else {
    await assertReadable(dataSource, "backup OpenRoad state file");
    await assertReadable(integrationSource, "backup OpenRoad integration metadata file");
    await assertReadable(teamSource, "backup OpenRoad team metadata file");
  }

  await mkdir(safetyDir, { recursive: true });
  await copyIfExists(dataFile, join(safetyDir, basename(dataFile)));
  await copyIfExists(integrationFile, join(safetyDir, basename(integrationFile)));
  await copyIfExists(sessionFile, join(safetyDir, basename(sessionFile)));
  await copyIfExists(teamFile, join(safetyDir, basename(teamFile)));

  await Promise.all([
    mkdir(dirname(dataFile), { recursive: true }),
    mkdir(dirname(integrationFile), { recursive: true }),
    mkdir(dirname(sessionFile), { recursive: true }),
    mkdir(dirname(teamFile), { recursive: true })
  ]);
  await copyFile(dataSource, dataFile);
  if (options.force) {
    await copyFile(integrationSource, integrationFile);
  } else {
    await writeJsonFile(
      integrationFile,
      sanitizeIntegrationState(
        await readJsonFile(integrationSource, "backup OpenRoad integration metadata file")
      )
    );
  }
  await writeJsonFile(
    sessionFile,
    sanitizeSessionState((await readSessionSource(sessionSource)).json)
  );
  if (options.force) {
    await copyFile(teamSource, teamFile);
  } else {
    await writeJsonFile(teamFile, sanitizeTeamState(await readJsonFile(teamSource, "backup OpenRoad team metadata file")));
  }

  return {
    restored: {
      dataFile,
      integrationFile,
      sessionFile,
      teamFile
    },
    safetyDir
  };
}

export async function smokeOpenRoad(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPENROAD_BASE_URL ?? "http://127.0.0.1:4173");
  const workspaceId = options.workspaceId ?? process.env.OPENROAD_SMOKE_WORKSPACE ?? defaultWorkspaceId;
  const adminToken = options.adminToken ?? process.env.OPENROAD_ADMIN_TOKEN;
  const checks = [];

  const health = await getJson(`${baseUrl}/api/health`);
  if (health.status !== 200 || health.body?.ok !== true) {
    throw new OpsError("smoke_health_failed", "Health check failed.");
  }
  checks.push("health");

  const contract = await getJson(`${baseUrl}/api/openroad/contract`);
  if (contract.status !== 200 || typeof contract.body?.contract?.version !== "string") {
    throw new OpsError("smoke_contract_failed", "API contract check failed.");
  }
  checks.push("contract");

  const portal = await getJson(`${baseUrl}/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/portal`);
  if (
    portal.status !== 200 ||
    typeof portal.body?.enabled !== "boolean" ||
    !Array.isArray(portal.body?.requests) ||
    !isRecord(portal.body?.roadmap)
  ) {
    throw new OpsError("smoke_portal_failed", `Public portal check failed for workspace "${workspaceId}".`);
  }
  checks.push("portal");

  if (adminToken) {
    const denied = await getJson(`${baseUrl}/api/openroad/ops/status`);
    if (denied.status !== 403) {
      throw new OpsError("smoke_private_auth_failed", "Expected unauthenticated private API access to be denied.");
    }
    checks.push("private-denied");

    const allowed = await getJson(`${baseUrl}/api/openroad/ops/status`, {
      authorization: `Bearer ${adminToken}`
    });
    if (allowed.status !== 200 || allowed.body?.status !== "ok" || !isRecord(allowed.body?.stores)) {
      throw new OpsError("smoke_private_token_failed", "Authenticated private API check failed.");
    }
    checks.push("private-token");
  } else {
    const allowed = await getJson(`${baseUrl}/api/openroad/ops/status`);
    if (allowed.status !== 200 || allowed.body?.status !== "ok" || !isRecord(allowed.body?.stores)) {
      throw new OpsError(
        "smoke_private_single_user_failed",
        "Private API check failed. Pass --admin-token when the server is running in token mode."
      );
    }
    checks.push("private-single-user");
  }

  return {
    baseUrl,
    checks,
    workspaceId
  };
}

export class OpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function readManifest(inputDir, force) {
  try {
    const manifest = await readJsonFile(join(inputDir, "manifest.json"), "backup manifest");
    const supportedTypes = new Set(["openroad-file-pair", "openroad-file-snapshot"]);
    if (manifest?.manifestVersion !== backupManifestVersion || !supportedTypes.has(manifest?.type)) {
      throw new OpsError("invalid_manifest", "Backup manifest is not an OpenRoad file snapshot manifest.");
    }
    return manifest;
  } catch (error) {
    if (force && isNotFound(error)) return undefined;
    throw error;
  }
}

async function getJson(url, headers = {}) {
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new OpsError("smoke_network_failed", `Could not reach ${url}: ${errorMessage(error)}`);
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  return { body, status: response.status };
}

async function readPackageJson() {
  try {
    return await readJsonFile(resolve("package.json"), "package.json");
  } catch {
    return {};
  }
}

async function readJsonFile(file, label) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      throw new OpsError("missing_file", `${label} does not exist: ${file}`);
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new OpsError("invalid_json", `${label} is not valid JSON: ${file}`);
  }
}

async function readIntegrationSource(file) {
  try {
    return {
      exists: true,
      json: await readJsonFile(file, "OpenRoad integration metadata file")
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return {
      exists: false,
      json: createEmptyIntegrationState()
    };
  }
}

async function readSessionSource(file) {
  try {
    return {
      exists: true,
      json: await readJsonFile(file, "OpenRoad session metadata file")
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return {
      exists: false,
      json: createEmptySessionState()
    };
  }
}

async function writeJsonFile(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertReadable(file, label) {
  try {
    await stat(file);
  } catch (error) {
    if (isNotFound(error)) {
      throw new OpsError("missing_file", `${label} does not exist: ${file}`);
    }
    throw error;
  }
}

async function copyIfExists(source, destination) {
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function validateOpenRoadState(value) {
  if (!isRecord(value) || typeof value.schemaVersion !== "number" || !Array.isArray(value.workspaces)) {
    throw new OpsError("invalid_state", "OpenRoad state backup is missing schemaVersion or workspaces.");
  }
}

function validateTeamState(value) {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== "number" ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.auditEvents) ||
    (value.schemaVersion >= 2 && !Array.isArray(value.invitations)) ||
    (value.schemaVersion >= 4 && !Array.isArray(value.credentials)) ||
    (value.schemaVersion >= 5 && !Array.isArray(value.accountRecoveryRequests)) ||
    (value.schemaVersion >= 6 && !Array.isArray(value.operationalEvents))
  ) {
    throw new OpsError("invalid_team_state", "OpenRoad team metadata backup is missing required collections.");
  }
}

function validateIntegrationState(value) {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== "number" ||
    !Array.isArray(value.installations) ||
    !Array.isArray(value.mappings) ||
    (value.schemaVersion >= 2 && !Array.isArray(value.credentials)) ||
    (value.syncEvents !== undefined && !Array.isArray(value.syncEvents)) ||
    (value.schemaVersion >= 3 && !Array.isArray(value.syncJobs)) ||
    (value.schemaVersion >= 4 && !Array.isArray(value.webhookRegistrations))
  ) {
    throw new OpsError(
      "invalid_integration_state",
      "OpenRoad integration metadata backup is missing required collections."
    );
  }
}

function validateSessionState(value) {
  if (!isRecord(value) || typeof value.schemaVersion !== "number" || !Array.isArray(value.sessions)) {
    throw new OpsError("invalid_session_state", "OpenRoad session metadata backup is missing sessions.");
  }
}

function sanitizeIntegrationState(value) {
  validateIntegrationState(value);

  return {
    ...(value.schemaVersion >= 2
      ? { credentials: value.credentials.map(sanitizeIntegrationCredential) }
      : {}),
    installations: value.installations.map(sanitizeIntegrationInstallation),
    mappings: value.mappings.map(sanitizeExternalObjectMapping),
    schemaVersion: value.schemaVersion,
    syncEvents: (value.syncEvents ?? []).map(sanitizeIntegrationSyncEvent),
    ...(value.schemaVersion >= 3
      ? { syncJobs: value.syncJobs.map(sanitizeIntegrationSyncJob) }
      : {}),
    ...(value.schemaVersion >= 4
      ? { webhookRegistrations: value.webhookRegistrations.map(sanitizeIntegrationWebhookRegistration) }
      : {})
  };
}

function sanitizeSessionState(value) {
  validateSessionState(value);

  return {
    schemaVersion: value.schemaVersion,
    sessions: value.sessions.map(sanitizeSessionRecord)
  };
}

function sanitizeTeamState(value) {
  validateTeamState(value);

  return {
    ...(value.schemaVersion >= 5
      ? { accountRecoveryRequests: value.accountRecoveryRequests.map(sanitizeTeamAccountRecoveryRequest) }
      : {}),
    auditEvents: value.auditEvents.map(sanitizeAuditEvent),
    ...(value.schemaVersion >= 4 ? { credentials: value.credentials.map(sanitizeTeamCredential) } : {}),
    ...(value.schemaVersion >= 2 ? { invitations: value.invitations.map(sanitizeTeamInvitation) } : {}),
    memberships: value.memberships.map(sanitizeWorkspaceMembership),
    ...(value.schemaVersion >= 6
      ? { operationalEvents: value.operationalEvents.map(sanitizeOperationalEvent) }
      : {}),
    schemaVersion: value.schemaVersion,
    users: value.users.map(sanitizeTeamUser)
  };
}

function sanitizeTeamUser(user) {
  if (!isRecord(user)) return user;

  return {
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
    name: user.name
  };
}

function sanitizeWorkspaceMembership(membership) {
  if (!isRecord(membership)) return membership;

  return {
    createdAt: membership.createdAt,
    id: membership.id,
    role: membership.role,
    userId: membership.userId,
    workspaceId: membership.workspaceId
  };
}

function sanitizeAuditEvent(event) {
  if (!isRecord(event)) return event;

  return {
    actorId: event.actorId,
    actorType: event.actorType,
    createdAt: event.createdAt,
    id: event.id,
    requestId: event.requestId,
    summary: redactSensitiveText(String(event.summary ?? "").slice(0, 500)),
    type: event.type,
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {})
  };
}

function sanitizeTeamCredential(credential) {
  if (!isRecord(credential)) return credential;

  return {
    algorithm: credential.algorithm,
    createdAt: credential.createdAt,
    id: credential.id,
    passwordHash: credential.passwordHash,
    salt: credential.salt,
    updatedAt: credential.updatedAt,
    userId: credential.userId
  };
}

function sanitizeTeamInvitation(invitation) {
  if (!isRecord(invitation)) return invitation;

  return {
    ...(invitation.acceptedAt ? { acceptedAt: invitation.acceptedAt } : {}),
    ...(invitation.acceptedByUserId ? { acceptedByUserId: invitation.acceptedByUserId } : {}),
    createdAt: invitation.createdAt,
    createdByActorId: invitation.createdByActorId,
    ...(invitation.deliveryAttemptedAt ? { deliveryAttemptedAt: invitation.deliveryAttemptedAt } : {}),
    ...(invitation.deliveryChannel ? { deliveryChannel: invitation.deliveryChannel } : {}),
    ...(invitation.deliveryError
      ? { deliveryError: redactSensitiveText(String(invitation.deliveryError).slice(0, 500)) }
      : {}),
    ...(invitation.deliveryMessageId
      ? { deliveryMessageId: redactSensitiveText(String(invitation.deliveryMessageId).slice(0, 500)) }
      : {}),
    ...(invitation.deliveryStatus ? { deliveryStatus: invitation.deliveryStatus } : {}),
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    id: invitation.id,
    ...(invitation.invitedName ? { invitedName: invitation.invitedName } : {}),
    ...(invitation.revokedAt ? { revokedAt: invitation.revokedAt } : {}),
    ...(invitation.revokedByActorId ? { revokedByActorId: invitation.revokedByActorId } : {}),
    role: invitation.role,
    tokenHash: invitation.tokenHash,
    workspaceId: invitation.workspaceId
  };
}

function sanitizeTeamAccountRecoveryRequest(recovery) {
  if (!isRecord(recovery)) return recovery;

  return {
    ...(recovery.consumedAt ? { consumedAt: recovery.consumedAt } : {}),
    ...(recovery.consumedWorkspaceId ? { consumedWorkspaceId: recovery.consumedWorkspaceId } : {}),
    createdAt: recovery.createdAt,
    ...(recovery.deliveryAttemptedAt ? { deliveryAttemptedAt: recovery.deliveryAttemptedAt } : {}),
    ...(recovery.deliveryChannel ? { deliveryChannel: recovery.deliveryChannel } : {}),
    ...(recovery.deliveryError
      ? { deliveryError: redactSensitiveText(String(recovery.deliveryError).slice(0, 500)) }
      : {}),
    ...(recovery.deliveryMessageId
      ? { deliveryMessageId: redactSensitiveText(String(recovery.deliveryMessageId).slice(0, 500)) }
      : {}),
    ...(recovery.deliveryStatus ? { deliveryStatus: recovery.deliveryStatus } : {}),
    email: recovery.email,
    expiresAt: recovery.expiresAt,
    id: recovery.id,
    tokenHash: recovery.tokenHash,
    userId: recovery.userId,
    ...(recovery.workspaceId ? { workspaceId: recovery.workspaceId } : {})
  };
}

function sanitizeOperationalEvent(event) {
  if (!isRecord(event)) return event;

  return {
    actorId: event.actorId,
    actorType: event.actorType,
    category: event.category,
    createdAt: event.createdAt,
    id: event.id,
    ...(isRecord(event.metadata) ? { metadata: sanitizeOperationalMetadata(event.metadata) } : {}),
    ...(event.provider ? { provider: event.provider } : {}),
    requestId: event.requestId,
    severity: event.severity,
    ...(event.status ? { status: event.status } : {}),
    summary: redactSensitiveText(String(event.summary ?? "").slice(0, 500)),
    type: event.type,
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {})
  };
}

function sanitizeOperationalMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata)
      .slice(0, 20)
      .map(([key, value]) => [
        key.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 80),
        sanitizeOperationalMetadataValue(key, value)
      ])
      .filter(([key]) => key)
  );
}

function sanitizeOperationalMetadataValue(key, value) {
  if (/token|secret|password|credential|authorization|ciphertext|private|client_secret/i.test(key)) {
    return "[redacted]";
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactSensitiveText(value).slice(0, 300);
  return String(value).slice(0, 120);
}

function sanitizeSessionRecord(session) {
  if (!isRecord(session)) return session;

  return {
    actor: sanitizeSessionActor(session.actor),
    ...(session.adminTokenHash ? { adminTokenHash: session.adminTokenHash } : {}),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    id: session.id,
    ...(session.ipAddress ? { ipAddress: session.ipAddress } : {}),
    ...(session.revokedAt ? { revokedAt: session.revokedAt } : {}),
    tokenHash: session.tokenHash,
    ...(session.userAgent ? { userAgent: session.userAgent } : {})
  };
}

function sanitizeSessionActor(actor) {
  if (!isRecord(actor)) return actor;

  if (actor.type === "local-owner") {
    return {
      id: actor.id,
      source: actor.source,
      type: actor.type
    };
  }

  if (actor.type === "workspace-member") {
    return {
      id: actor.id,
      role: actor.role,
      type: actor.type,
      workspaceId: actor.workspaceId
    };
  }

  return { type: actor.type };
}

function sanitizeIntegrationCredential(credential) {
  if (!isRecord(credential)) return credential;

  return {
    createdAt: credential.createdAt,
    ...(credential.status === "active" && isRecord(credential.encryptedSecret)
      ? { encryptedSecret: sanitizeEncryptedSecret(credential.encryptedSecret) }
      : {}),
    ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
    id: credential.id,
    installationId: credential.installationId,
    ...(credential.label ? { label: credential.label } : {}),
    permissions: Array.isArray(credential.permissions) ? credential.permissions : [],
    provider: credential.provider,
    providerScopes: Array.isArray(credential.providerScopes) ? credential.providerScopes : [],
    ...(credential.revokedAt ? { revokedAt: credential.revokedAt } : {}),
    secretTypes: Array.isArray(credential.secretTypes) ? credential.secretTypes : [],
    status: credential.status,
    ...(credential.tokenType ? { tokenType: credential.tokenType } : {}),
    updatedAt: credential.updatedAt,
    workspaceId: credential.workspaceId
  };
}

function sanitizeEncryptedSecret(secret) {
  return {
    alg: secret.alg,
    ciphertext: secret.ciphertext,
    iv: secret.iv,
    ...(secret.keyId ? { keyId: secret.keyId } : {}),
    tag: secret.tag
  };
}

function sanitizeIntegrationInstallation(installation) {
  if (!isRecord(installation)) return installation;

  return {
    createdAt: installation.createdAt,
    id: installation.id,
    permissions: Array.isArray(installation.permissions) ? installation.permissions : [],
    provider: installation.provider,
    providerAccountId: installation.providerAccountId,
    providerAccountName: installation.providerAccountName,
    status: installation.status,
    workspaceId: installation.workspaceId
  };
}

function sanitizeExternalObjectMapping(mapping) {
  if (!isRecord(mapping)) return mapping;

  return {
    connectedAt: mapping.connectedAt,
    ...(mapping.disconnectedAt ? { disconnectedAt: mapping.disconnectedAt } : {}),
    external: isRecord(mapping.external)
      ? {
          id: mapping.external.id,
          ...(mapping.external.key ? { key: mapping.external.key } : {}),
          provider: mapping.external.provider,
          type: mapping.external.type,
          ...(mapping.external.url ? { url: mapping.external.url } : {})
        }
      : mapping.external,
    id: mapping.id,
    installationId: mapping.installationId,
    ...(mapping.lastSyncedAt ? { lastSyncedAt: mapping.lastSyncedAt } : {}),
    openRoad: isRecord(mapping.openRoad)
      ? {
          id: mapping.openRoad.id,
          type: mapping.openRoad.type,
          workspaceId: mapping.openRoad.workspaceId
        }
      : mapping.openRoad,
    status: mapping.status
  };
}

function sanitizeIntegrationSyncEvent(event) {
  if (!isRecord(event)) return event;

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

function sanitizeIntegrationSyncJob(job) {
  if (!isRecord(job)) return job;

  return {
    attempt: job.attempt,
    ...(job.claimedAt ? { claimedAt: job.claimedAt } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    createdAt: job.createdAt,
    dedupeKey: job.dedupeKey,
    ...(job.error ? { error: redactSensitiveText(String(job.error).slice(0, 500)) } : {}),
    id: job.id,
    installationId: job.installationId,
    ...(job.lastRunAt ? { lastRunAt: job.lastRunAt } : {}),
    ...(job.leaseExpiresAt ? { leaseExpiresAt: job.leaseExpiresAt } : {}),
    ...(job.mappingId ? { mappingId: job.mappingId } : {}),
    ...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}),
    provider: job.provider,
    reason: job.reason,
    ...(job.resultSummary
      ? { resultSummary: redactSensitiveText(String(job.resultSummary).slice(0, 500)) }
      : {}),
    status: job.status,
    updatedAt: job.updatedAt,
    workspaceId: job.workspaceId
  };
}

function sanitizeIntegrationWebhookRegistration(registration) {
  if (!isRecord(registration)) return registration;

  return {
    attempt: registration.attempt,
    createdAt: registration.createdAt,
    events: Array.isArray(registration.events)
      ? registration.events.map((event) => redactSensitiveText(String(event).slice(0, 500)))
      : [],
    ...(registration.expiresAt ? { expiresAt: registration.expiresAt } : {}),
    ...(registration.externalId
      ? { externalId: redactSensitiveText(String(registration.externalId).slice(0, 500)) }
      : {}),
    id: registration.id,
    installationId: registration.installationId,
    ...(registration.lastAttemptAt ? { lastAttemptAt: registration.lastAttemptAt } : {}),
    ...(registration.lastError
      ? { lastError: redactSensitiveText(String(registration.lastError).slice(0, 500)) }
      : {}),
    provider: registration.provider,
    status: registration.status,
    targetUrl: redactSensitiveText(String(registration.targetUrl ?? "").slice(0, 500)),
    updatedAt: registration.updatedAt,
    workspaceId: registration.workspaceId
  };
}

function redactSensitiveText(value) {
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

function createEmptyIntegrationState() {
  return {
    credentials: [],
    installations: [],
    mappings: [],
    schemaVersion: 4,
    syncEvents: [],
    syncJobs: [],
    webhookRegistrations: []
  };
}

function createEmptySessionState() {
  return {
    schemaVersion: 1,
    sessions: []
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "force" || key === "json") {
      args[toCamelCase(key)] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new OpsError("invalid_args", `Missing value for --${key}.`);
    }
    args[toCamelCase(key)] = value;
    index += 1;
  }
  return args;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function stringOrFallback(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeTimestamp(value) {
  return value.replace(/[:.]/g, "-");
}

function isNotFound(error) {
  return error?.code === "ENOENT" || error?.code === "missing_file";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runCli() {
  const [command, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  let result;
  if (command === "backup") {
    result = await createBackup(args);
  } else if (command === "restore") {
    result = await restoreBackup(args);
  } else if (command === "smoke") {
    result = await smokeOpenRoad(args);
  } else {
    throw new OpsError("unknown_command", `Unknown OpenRoad ops command: ${command}`);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "backup") {
    console.log(`OpenRoad backup created: ${result.backupDir}`);
  } else if (command === "restore") {
    console.log(`OpenRoad restore complete. Safety backup: ${result.safetyDir}`);
  } else {
    console.log(`OpenRoad smoke passed: ${result.checks.join(", ")}`);
  }
}

function printHelp() {
  console.log(`OpenRoad operations

Commands:
  backup  --output-dir <dir> [--data-file <file>] [--integration-file <file>] [--session-file <file>] [--team-file <file>] [--name <name>]
  restore --input-dir <dir> [--data-file <file>] [--integration-file <file>] [--session-file <file>] [--team-file <file>] [--force]
  smoke   [--base-url <url>] [--workspace-id <id>] [--admin-token <token>]
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    const code = error?.code ?? "openroad_ops_failed";
    console.error(`OpenRoad ops failed [${code}]: ${errorMessage(error)}`);
    process.exit(1);
  });
}
