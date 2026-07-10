import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import type { OpenRoadState } from "../src/domain/openroad.js";
import type { OpenRoadActor, WorkspaceRole } from "./access.js";

export const openRoadTeamSchemaVersion = 4;

const teamSchemaVersionWithInvitationDelivery = 3;
const teamSchemaVersionWithInvitations = 2;
const teamSchemaVersionWithoutInvitations = 1;
const defaultInvitationTtlMs = 1000 * 60 * 60 * 24 * 14;
const accountPasswordAlgorithm = "scrypt-v1";
const scryptAsync = promisify(scryptCallback);

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

export type TeamAccountCredential = {
  algorithm: typeof accountPasswordAlgorithm;
  createdAt: string;
  id: string;
  passwordHash: string;
  salt: string;
  updatedAt: string;
  userId: string;
};

export type TeamAccountCredentialSummary = {
  createdAt: string;
  updatedAt: string;
  userId: string;
};

export type TeamInvitationStatus = "accepted" | "expired" | "pending" | "revoked";
export type TeamInvitationDeliveryStatus = "failed" | "sent";

export type TeamInvitation = {
  acceptedAt?: string;
  acceptedByUserId?: string;
  createdAt: string;
  createdByActorId: string;
  deliveryAttemptedAt?: string;
  deliveryChannel?: string;
  deliveryError?: string;
  deliveryMessageId?: string;
  deliveryStatus?: TeamInvitationDeliveryStatus;
  email: string;
  expiresAt: string;
  id: string;
  invitedName?: string;
  revokedAt?: string;
  revokedByActorId?: string;
  role: WorkspaceRole;
  tokenHash: string;
  workspaceId: string;
};

export type TeamInvitationSummary = Omit<TeamInvitation, "tokenHash"> & {
  status: TeamInvitationStatus;
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
  credentials: TeamAccountCredential[];
  invitations: TeamInvitation[];
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
  invitationTtlMs?: number;
  ownerEmail?: string;
  ownerName?: string;
};

export type CreateTeamInvitationInput = {
  createdByActorId: string;
  email: string;
  expiresAt?: string;
  invitedName?: string;
  role: WorkspaceRole;
  workspaceId: string;
};

export type RevokeTeamInvitationInput = {
  invitationId: string;
  revokedByActorId: string;
  workspaceId: string;
};

export type AcceptTeamInvitationInput = {
  acceptedName?: string;
  token: string;
};

export type RecordTeamInvitationDeliveryInput = {
  deliveryAttemptedAt: string;
  deliveryChannel: string;
  deliveryError?: string;
  deliveryMessageId?: string;
  deliveryStatus: TeamInvitationDeliveryStatus;
  invitationId: string;
  workspaceId: string;
};

export type SetAccountPasswordInput = {
  currentPassword?: string;
  password: string;
  requireCurrentPassword?: boolean;
  userId: string;
};

export type AuthenticateAccountPasswordInput = {
  email: string;
  password: string;
  workspaceId?: string;
};

export type CreateTeamInvitationResult = {
  acceptToken: string;
  invitation: TeamInvitationSummary;
};

export type AcceptTeamInvitationResult = {
  createdMembership: boolean;
  createdUser: boolean;
  invitation: TeamInvitationSummary;
  membership: WorkspaceMembership;
  user: TeamUser;
};

export type SetAccountPasswordResult = {
  credential: TeamAccountCredentialSummary;
  user: TeamUser;
};

export type AuthenticateAccountPasswordResult = {
  membership: WorkspaceMembership;
  user: TeamUser;
};

export type TeamStore = {
  acceptInvitation(
    openRoadState: OpenRoadState,
    input: AcceptTeamInvitationInput
  ): Promise<AcceptTeamInvitationResult>;
  authenticateAccountPassword(
    openRoadState: OpenRoadState,
    input: AuthenticateAccountPasswordInput
  ): Promise<AuthenticateAccountPasswordResult>;
  createInvitation(
    openRoadState: OpenRoadState,
    input: CreateTeamInvitationInput
  ): Promise<CreateTeamInvitationResult>;
  listInvitations(
    openRoadState: OpenRoadState,
    workspaceId: string
  ): Promise<TeamInvitationSummary[]>;
  load(openRoadState: OpenRoadState): Promise<TeamStoreLoadResult>;
  recordInvitationDelivery(
    openRoadState: OpenRoadState,
    input: RecordTeamInvitationDeliveryInput
  ): Promise<TeamInvitationSummary>;
  recordAuditEvent(
    openRoadState: OpenRoadState,
    event: Omit<AuditEvent, "createdAt" | "id">
  ): Promise<AuditEvent>;
  revokeInvitation(
    openRoadState: OpenRoadState,
    input: RevokeTeamInvitationInput
  ): Promise<TeamInvitationSummary>;
  setAccountPassword(
    openRoadState: OpenRoadState,
    input: SetAccountPasswordInput
  ): Promise<SetAccountPasswordResult>;
};

export class TeamStoreError extends Error {
  code: "corrupt_state" | "future_schema" | "invalid_request" | "invalid_state" | "not_found";

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

  async createInvitation(
    openRoadState: OpenRoadState,
    input: CreateTeamInvitationInput
  ): Promise<CreateTeamInvitationResult> {
    assertWorkspaceExists(openRoadState, input.workspaceId);

    const result = await this.load(openRoadState);
    const now = new Date();
    const email = normalizeEmail(input.email);
    const acceptToken = createInvitationToken();
    const invitation: TeamInvitation = {
      createdAt: now.toISOString(),
      createdByActorId: boundText(input.createdByActorId, 160) ?? "unknown-actor",
      email,
      expiresAt: normalizeFutureIsoDate(
        input.expiresAt,
        new Date(now.getTime() + getInvitationTtlMs(this.seedOptions)).toISOString()
      ),
      id: `invitation-${randomUUID()}`,
      ...(normalizeOptionalText(input.invitedName, 120)
        ? { invitedName: normalizeOptionalText(input.invitedName, 120) }
        : {}),
      role: normalizeWorkspaceRole(input.role),
      tokenHash: hashSecret(acceptToken),
      workspaceId: input.workspaceId
    };
    const state = {
      ...result.state,
      invitations: [invitation, ...result.state.invitations].slice(0, 1000)
    };

    await this.writeState(state);

    return {
      acceptToken,
      invitation: summarizeInvitation(invitation, now)
    };
  }

  async setAccountPassword(
    openRoadState: OpenRoadState,
    input: SetAccountPasswordInput
  ): Promise<SetAccountPasswordResult> {
    const result = await this.load(openRoadState);
    const now = new Date().toISOString();
    const user = result.state.users.find((item) => item.id === input.userId);
    if (!user) {
      throw new TeamStoreError("not_found", "OpenRoad user was not found.");
    }

    const password = normalizeAccountPassword(input.password);
    const existingCredential = result.state.credentials.find(
      (credential) => credential.userId === user.id
    );

    const shouldRequireCurrentPassword =
      Boolean(existingCredential) && input.requireCurrentPassword !== false;

    if (shouldRequireCurrentPassword) {
      let currentPassword: string;
      try {
        currentPassword = normalizeAccountPassword(input.currentPassword);
      } catch {
        throw new TeamStoreError("invalid_request", "Current password is invalid.");
      }

      if (!existingCredential) {
        throw new TeamStoreError("invalid_request", "Current password is invalid.");
      }

      if (!(await verifyAccountPassword(currentPassword, existingCredential))) {
        throw new TeamStoreError("invalid_request", "Current password is invalid.");
      }
    }

    const hashed = await createAccountCredential({
      createdAt: existingCredential?.createdAt ?? now,
      id: existingCredential?.id ?? `credential-${randomUUID()}`,
      password,
      updatedAt: now,
      userId: user.id
    });
    const credentials = existingCredential
      ? result.state.credentials.map((credential) =>
          credential.id === existingCredential.id ? hashed : credential
        )
      : [hashed, ...result.state.credentials];

    await this.writeState({ ...result.state, credentials });
    return {
      credential: summarizeAccountCredential(hashed),
      user
    };
  }

  async authenticateAccountPassword(
    openRoadState: OpenRoadState,
    input: AuthenticateAccountPasswordInput
  ): Promise<AuthenticateAccountPasswordResult> {
    const result = await this.load(openRoadState);
    const email = normalizeEmail(input.email);
    const password = normalizeAccountPassword(input.password);
    const user = result.state.users.find((item) => item.email.toLowerCase() === email);
    const credential = user
      ? result.state.credentials.find((item) => item.userId === user.id)
      : undefined;

    if (!user || !credential || !(await verifyAccountPassword(password, credential))) {
      throw new TeamStoreError("invalid_request", "Email or password is invalid.");
    }

    const activeMemberships = result.state.memberships.filter(
      (membership) =>
        membership.userId === user.id &&
        openRoadState.workspaces.some((workspace) => workspace.id === membership.workspaceId)
    );
    const membership = input.workspaceId
      ? activeMemberships.find((item) => item.workspaceId === input.workspaceId)
      : activeMemberships.length === 1
        ? activeMemberships[0]
        : undefined;

    if (!membership) {
      throw new TeamStoreError(
        "invalid_request",
        activeMemberships.length > 1
          ? "Workspace id is required for this account."
          : "Email or password is invalid."
      );
    }

    return { membership, user };
  }

  async listInvitations(openRoadState: OpenRoadState, workspaceId: string) {
    assertWorkspaceExists(openRoadState, workspaceId);

    const result = await this.load(openRoadState);
    const now = new Date();

    return result.state.invitations
      .filter((invitation) => invitation.workspaceId === workspaceId)
      .map((invitation) => summarizeInvitation(invitation, now));
  }

  async recordInvitationDelivery(
    openRoadState: OpenRoadState,
    input: RecordTeamInvitationDeliveryInput
  ): Promise<TeamInvitationSummary> {
    assertWorkspaceExists(openRoadState, input.workspaceId);

    const result = await this.load(openRoadState);
    const now = new Date();
    let recordedInvitation: TeamInvitation | undefined;
    const invitations = result.state.invitations.map((invitation) => {
      if (invitation.id !== input.invitationId || invitation.workspaceId !== input.workspaceId) {
        return invitation;
      }

      recordedInvitation = {
        ...invitation,
        deliveryAttemptedAt: normalizeIsoDate(input.deliveryAttemptedAt, now.toISOString()),
        deliveryChannel: boundText(input.deliveryChannel, 80) ?? "unknown",
        deliveryError:
          input.deliveryStatus === "failed" ? normalizeDeliveryError(input.deliveryError) : undefined,
        deliveryMessageId: boundText(input.deliveryMessageId, 240),
        deliveryStatus: normalizeInvitationDeliveryStatus(input.deliveryStatus)
      };
      return recordedInvitation;
    });

    if (!recordedInvitation) {
      throw new TeamStoreError("not_found", "OpenRoad invitation was not found.");
    }

    await this.writeState({ ...result.state, invitations });
    return summarizeInvitation(recordedInvitation, now);
  }

  async revokeInvitation(
    openRoadState: OpenRoadState,
    input: RevokeTeamInvitationInput
  ): Promise<TeamInvitationSummary> {
    assertWorkspaceExists(openRoadState, input.workspaceId);

    const result = await this.load(openRoadState);
    const now = new Date();
    let revokedInvitation: TeamInvitation | undefined;
    const invitations = result.state.invitations.map((invitation) => {
      if (invitation.id !== input.invitationId || invitation.workspaceId !== input.workspaceId) {
        return invitation;
      }

      if (getInvitationStatus(invitation, now) !== "pending") {
        throw new TeamStoreError(
          "invalid_request",
          "Only pending OpenRoad invitations can be revoked."
        );
      }

      revokedInvitation = {
        ...invitation,
        revokedAt: now.toISOString(),
        revokedByActorId: boundText(input.revokedByActorId, 160) ?? "unknown-actor"
      };
      return revokedInvitation;
    });

    if (!revokedInvitation) {
      throw new TeamStoreError("not_found", "OpenRoad invitation was not found.");
    }

    await this.writeState({ ...result.state, invitations });
    return summarizeInvitation(revokedInvitation, now);
  }

  async acceptInvitation(
    openRoadState: OpenRoadState,
    input: AcceptTeamInvitationInput
  ): Promise<AcceptTeamInvitationResult> {
    const token = boundText(input.token, 512);
    if (!token) {
      throw new TeamStoreError("invalid_request", "Invitation token is required.");
    }

    const result = await this.load(openRoadState);
    const now = new Date();
    const tokenHash = hashSecret(token);
    const invitation = result.state.invitations.find((item) =>
      safeHashEqual(item.tokenHash, tokenHash)
    );

    if (!invitation || getInvitationStatus(invitation, now) !== "pending") {
      throw new TeamStoreError(
        "invalid_request",
        "Invitation token is invalid, expired, or no longer active."
      );
    }

    assertWorkspaceExists(openRoadState, invitation.workspaceId);

    const existingUser = result.state.users.find(
      (user) => user.email.toLowerCase() === invitation.email
    );
    const user: TeamUser =
      existingUser ??
      createInvitedUser({
        email: invitation.email,
        name: input.acceptedName ?? invitation.invitedName
      });
    const existingMembership = result.state.memberships.find(
      (membership) =>
        membership.userId === user.id && membership.workspaceId === invitation.workspaceId
    );
    const membership: WorkspaceMembership =
      existingMembership ??
      {
        createdAt: now.toISOString(),
        id: `membership-${user.id}-${invitation.workspaceId}`,
        role: invitation.role,
        userId: user.id,
        workspaceId: invitation.workspaceId
      };
    const acceptedInvitation: TeamInvitation = {
      ...invitation,
      acceptedAt: now.toISOString(),
      acceptedByUserId: user.id
    };
    const invitations = result.state.invitations.map((item) =>
      item.id === invitation.id ? acceptedInvitation : item
    );
    const state: TeamState = {
      ...result.state,
      invitations,
      memberships: existingMembership
        ? result.state.memberships
        : [...result.state.memberships, membership],
      users: existingUser ? result.state.users : [...result.state.users, user]
    };

    await this.writeState(state);

    return {
      createdMembership: !existingMembership,
      createdUser: !existingUser,
      invitation: summarizeInvitation(acceptedInvitation, now),
      membership,
      user
    };
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
    credentials: [],
    invitations: [],
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

  if (value.schemaVersion === teamSchemaVersionWithoutInvitations) {
    return migrateTeamStateV1(value);
  }

  if (value.schemaVersion === teamSchemaVersionWithInvitations) {
    return migrateTeamStateV2(value);
  }

  if (value.schemaVersion === teamSchemaVersionWithInvitationDelivery) {
    return migrateTeamStateV3(value);
  }

  if (
    value.schemaVersion !== openRoadTeamSchemaVersion ||
    !Array.isArray(value.credentials) ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.auditEvents) ||
    !Array.isArray(value.invitations)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  if (
    !value.credentials.every(isTeamAccountCredential) ||
    !value.users.every(isTeamUser) ||
    !value.memberships.every(isWorkspaceMembership) ||
    !value.auditEvents.every(isAuditEvent) ||
    !value.invitations.every(isTeamInvitation)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  return cloneValue({
    auditEvents: value.auditEvents,
    credentials: value.credentials,
    invitations: value.invitations,
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

function migrateTeamStateV1(value: Record<string, unknown>): TeamState {
  if (
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
    credentials: [],
    invitations: [],
    memberships: value.memberships,
    schemaVersion: openRoadTeamSchemaVersion,
    users: value.users
  });
}

function migrateTeamStateV2(value: Record<string, unknown>): TeamState {
  if (
    !Array.isArray(value.users) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.auditEvents) ||
    !Array.isArray(value.invitations)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  if (
    !value.users.every(isTeamUser) ||
    !value.memberships.every(isWorkspaceMembership) ||
    !value.auditEvents.every(isAuditEvent) ||
    !value.invitations.every(isTeamInvitation)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  return cloneValue({
    auditEvents: value.auditEvents,
    credentials: [],
    invitations: value.invitations,
    memberships: value.memberships,
    schemaVersion: openRoadTeamSchemaVersion,
    users: value.users
  });
}

function migrateTeamStateV3(value: Record<string, unknown>): TeamState {
  if (
    !Array.isArray(value.users) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.auditEvents) ||
    !Array.isArray(value.invitations)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  if (
    !value.users.every(isTeamUser) ||
    !value.memberships.every(isWorkspaceMembership) ||
    !value.auditEvents.every(isAuditEvent) ||
    !value.invitations.every(isTeamInvitation)
  ) {
    throw new TeamStoreError("invalid_state", "OpenRoad team metadata is invalid.");
  }

  return cloneValue({
    auditEvents: value.auditEvents,
    credentials: [],
    invitations: value.invitations,
    memberships: value.memberships,
    schemaVersion: openRoadTeamSchemaVersion,
    users: value.users
  });
}

function assertWorkspaceExists(openRoadState: OpenRoadState, workspaceId: string) {
  if (!openRoadState.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new TeamStoreError("not_found", "Workspace was not found.");
  }
}

function createInvitationToken() {
  return `oinv_${randomBytes(32).toString("base64url")}`;
}

function hashSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function safeHashEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function summarizeInvitation(
  invitation: TeamInvitation,
  now = new Date()
): TeamInvitationSummary {
  const { tokenHash: _tokenHash, ...safeInvitation } = invitation;
  return {
    ...safeInvitation,
    status: getInvitationStatus(invitation, now)
  };
}

function getInvitationStatus(invitation: TeamInvitation, now = new Date()): TeamInvitationStatus {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (Date.parse(invitation.expiresAt) <= now.getTime()) return "expired";
  return "pending";
}

function normalizeEmail(value: string) {
  const email = boundText(value, 254)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TeamStoreError("invalid_request", "A valid invitation email is required.");
  }
  return email;
}

function normalizeFutureIsoDate(value: string | undefined, fallback: string) {
  const candidate = boundText(value, 80) ?? fallback;
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed) || parsed <= Date.now()) {
    throw new TeamStoreError("invalid_request", "Invitation expiration must be in the future.");
  }
  return new Date(parsed).toISOString();
}

function normalizeIsoDate(value: string | undefined, fallback: string) {
  const candidate = boundText(value, 80) ?? fallback;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeWorkspaceRole(role: WorkspaceRole) {
  if (role !== "Owner" && role !== "Maintainer" && role !== "Contributor" && role !== "Viewer") {
    throw new TeamStoreError("invalid_request", "Invitation role is invalid.");
  }
  return role;
}

function normalizeInvitationDeliveryStatus(status: TeamInvitationDeliveryStatus) {
  if (status !== "failed" && status !== "sent") {
    throw new TeamStoreError("invalid_request", "Invitation delivery status is invalid.");
  }
  return status;
}

function normalizeAccountPassword(value: unknown) {
  if (typeof value !== "string") {
    throw new TeamStoreError("invalid_request", "Password is required.");
  }

  if (value.length < 12 || value.length > 256) {
    throw new TeamStoreError(
      "invalid_request",
      "Password must be between 12 and 256 characters."
    );
  }

  return value;
}

async function createAccountCredential({
  createdAt,
  id,
  password,
  updatedAt,
  userId
}: {
  createdAt: string;
  id: string;
  password: string;
  updatedAt: string;
  userId: string;
}): Promise<TeamAccountCredential> {
  const salt = randomBytes(16).toString("base64url");
  return {
    algorithm: accountPasswordAlgorithm,
    createdAt,
    id,
    passwordHash: await deriveAccountPasswordHash(password, salt),
    salt,
    updatedAt,
    userId
  };
}

async function verifyAccountPassword(password: string, credential: TeamAccountCredential) {
  if (credential.algorithm !== accountPasswordAlgorithm) return false;
  const passwordHash = await deriveAccountPasswordHash(password, credential.salt);
  return safeHashEqual(passwordHash, credential.passwordHash);
}

async function deriveAccountPasswordHash(password: string, salt: string) {
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return key.toString("base64url");
}

function summarizeAccountCredential(
  credential: TeamAccountCredential
): TeamAccountCredentialSummary {
  return {
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    userId: credential.userId
  };
}

function normalizeDeliveryError(value: unknown) {
  const text = boundText(value, 500);
  if (!text) return undefined;
  return redactSensitiveText(text).slice(0, 240);
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:access_token|refresh_token|token|jwt|secret|client_secret|authorization)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .replace(/\b[\w.-]*(?:token|secret|password|credential|authorization)[\w.-]*\b/gi, "[redacted]")
    .slice(0, 500);
}

function createInvitedUser({ email, name }: { email: string; name?: string }) {
  const normalizedName = normalizeOptionalText(name, 120) ?? email.split("@")[0] ?? email;
  return {
    createdAt: new Date().toISOString(),
    email,
    id: `user-${normalizeIdentifier(email)}`,
    name: normalizedName
  };
}

function getInvitationTtlMs(seedOptions: TeamStoreSeedOptions) {
  return seedOptions.invitationTtlMs && seedOptions.invitationTtlMs > 0
    ? seedOptions.invitationTtlMs
    : defaultInvitationTtlMs;
}

function boundText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  return boundText(value, maxLength);
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:@-]+/g, "-").slice(0, 120);
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

function isTeamAccountCredential(value: unknown): value is TeamAccountCredential {
  return (
    isRecord(value) &&
    value.algorithm === accountPasswordAlgorithm &&
    typeof value.createdAt === "string" &&
    typeof value.id === "string" &&
    typeof value.passwordHash === "string" &&
    typeof value.salt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.userId === "string"
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

function isTeamInvitation(value: unknown): value is TeamInvitation {
  return (
    isRecord(value) &&
    typeof value.createdAt === "string" &&
    typeof value.createdByActorId === "string" &&
    (value.deliveryAttemptedAt === undefined || typeof value.deliveryAttemptedAt === "string") &&
    (value.deliveryChannel === undefined || typeof value.deliveryChannel === "string") &&
    (value.deliveryError === undefined || typeof value.deliveryError === "string") &&
    (value.deliveryMessageId === undefined || typeof value.deliveryMessageId === "string") &&
    (value.deliveryStatus === undefined ||
      value.deliveryStatus === "failed" ||
      value.deliveryStatus === "sent") &&
    typeof value.email === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.id === "string" &&
    (value.invitedName === undefined || typeof value.invitedName === "string") &&
    (value.acceptedAt === undefined || typeof value.acceptedAt === "string") &&
    (value.acceptedByUserId === undefined || typeof value.acceptedByUserId === "string") &&
    (value.revokedAt === undefined || typeof value.revokedAt === "string") &&
    (value.revokedByActorId === undefined || typeof value.revokedByActorId === "string") &&
    (value.role === "Owner" ||
      value.role === "Maintainer" ||
      value.role === "Contributor" ||
      value.role === "Viewer") &&
    typeof value.tokenHash === "string" &&
    typeof value.workspaceId === "string"
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
