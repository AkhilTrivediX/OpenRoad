import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { OpenRoadActor } from "./access.js";

export const openRoadSessionSchemaVersion = 1;
export const defaultSessionTtlMs = 1000 * 60 * 60 * 24 * 7;
export const sessionCookieName = "openroad_session";

export type SessionRecord = {
  adminTokenHash: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress?: string;
  revokedAt?: string;
  tokenHash: string;
  userAgent?: string;
};

export type SessionState = {
  schemaVersion: typeof openRoadSessionSchemaVersion;
  sessions: SessionRecord[];
};

export type SessionMetadata = {
  actor: OpenRoadActor;
  createdAt: string;
  expiresAt: string;
  id: string;
};

export type SessionCreateInput = {
  adminToken: string;
  ipAddress?: string;
  now?: Date;
  userAgent?: string;
};

export type SessionCreateResult = {
  cookieValue: string;
  maxAgeSeconds: number;
  session: SessionMetadata;
};

export type SessionResolveInput = {
  adminToken?: string;
  cookieValue?: string;
  now?: Date;
};

export type SessionStoreLoadResult = {
  backupPath?: string;
  state: SessionState;
  status: "ready" | "seeded" | "migrated" | "recovered";
};

export type SessionStore = {
  createSession(input: SessionCreateInput): Promise<SessionCreateResult>;
  load(): Promise<SessionStoreLoadResult>;
  resolveSession(input: SessionResolveInput): Promise<SessionMetadata | undefined>;
  revokeSession(cookieValue: string | undefined, now?: Date): Promise<boolean>;
};

export class SessionStoreError extends Error {
  code: "future_schema" | "invalid_state";

  constructor(code: SessionStoreError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class FileSessionStore implements SessionStore {
  constructor(
    private readonly sessionFile: string,
    private readonly options: { ttlMs?: number; maxSessions?: number } = {}
  ) {}

  async load(): Promise<SessionStoreLoadResult> {
    let raw: string;

    try {
      raw = await readFile(this.sessionFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const state = createInitialSessionState();
        await this.writeState(state);
        return { state, status: "seeded" };
      }

      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const state = parseSessionState(parsed);
      const status =
        getPersistedSchemaVersion(parsed) === openRoadSessionSchemaVersion ? "ready" : "migrated";
      if (status === "migrated") {
        await this.writeState(state);
      }
      return { state, status };
    } catch (error) {
      if (error instanceof SessionStoreError && error.code === "future_schema") {
        throw error;
      }

      const backupPath = await this.backupCorruptState();
      const state = createInitialSessionState();
      await this.writeState(state);
      return { backupPath, state, status: "recovered" };
    }
  }

  async createSession(input: SessionCreateInput): Promise<SessionCreateResult> {
    const now = input.now ?? new Date();
    const ttlMs = this.options.ttlMs ?? defaultSessionTtlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const token = createSessionSecret();
    const id = `session-${randomUUID()}`;
    const session: SessionRecord = {
      adminTokenHash: hashSecret(input.adminToken),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      id,
      ipAddress: boundOptionalText(input.ipAddress, 120),
      tokenHash: hashSecret(token),
      userAgent: boundOptionalText(input.userAgent, 240)
    };
    const result = await this.load();
    const nextSessions = [session, ...pruneInactiveSessions(result.state.sessions, now)].slice(
      0,
      this.options.maxSessions ?? 100
    );

    await this.writeState({
      schemaVersion: openRoadSessionSchemaVersion,
      sessions: nextSessions
    });

    return {
      cookieValue: `${id}.${token}`,
      maxAgeSeconds: Math.max(1, Math.floor(ttlMs / 1000)),
      session: createSessionMetadata(session)
    };
  }

  async resolveSession(input: SessionResolveInput): Promise<SessionMetadata | undefined> {
    if (!input.adminToken || !input.cookieValue) return undefined;

    const parsed = parseSessionCookieValue(input.cookieValue);
    if (!parsed) return undefined;

    const now = input.now ?? new Date();
    const result = await this.load();
    const session = result.state.sessions.find((item) => item.id === parsed.id);

    if (!session || !isSessionActive(session, now)) return undefined;
    if (!safeEqual(session.tokenHash, hashSecret(parsed.secret))) return undefined;
    if (!safeEqual(session.adminTokenHash, hashSecret(input.adminToken))) return undefined;

    return createSessionMetadata(session);
  }

  async revokeSession(cookieValue: string | undefined, now = new Date()) {
    const parsed = parseSessionCookieValue(cookieValue);
    if (!parsed) return false;

    const result = await this.load();
    let revoked = false;
    const sessions = result.state.sessions.map((session) => {
      if (session.id !== parsed.id || session.revokedAt) return session;
      if (!safeEqual(session.tokenHash, hashSecret(parsed.secret))) return session;
      revoked = true;
      return { ...session, revokedAt: now.toISOString() };
    });

    if (revoked) {
      await this.writeState({
        schemaVersion: openRoadSessionSchemaVersion,
        sessions: pruneInactiveSessions(sessions, now)
      });
    }

    return revoked;
  }

  private async backupCorruptState() {
    const backupPath = `${this.sessionFile}.corrupt-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    await mkdir(dirname(this.sessionFile), { recursive: true });
    await rename(this.sessionFile, backupPath);
    return backupPath;
  }

  private async writeState(state: SessionState) {
    await mkdir(dirname(this.sessionFile), { recursive: true });
    const temporaryPath = `${this.sessionFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.sessionFile);
  }
}

export function createInitialSessionState(): SessionState {
  return {
    schemaVersion: openRoadSessionSchemaVersion,
    sessions: []
  };
}

export function parseSessionState(value: unknown): SessionState {
  if (!isRecord(value)) {
    throw new SessionStoreError("invalid_state", "OpenRoad session metadata is not an object.");
  }

  if (
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > openRoadSessionSchemaVersion
  ) {
    throw new SessionStoreError(
      "future_schema",
      "OpenRoad session metadata was created by a newer version."
    );
  }

  if (value.schemaVersion !== openRoadSessionSchemaVersion || !Array.isArray(value.sessions)) {
    throw new SessionStoreError("invalid_state", "OpenRoad session metadata is invalid.");
  }

  if (!value.sessions.every(isSessionRecord)) {
    throw new SessionStoreError("invalid_state", "OpenRoad session metadata is invalid.");
  }

  return cloneValue({
    schemaVersion: openRoadSessionSchemaVersion,
    sessions: value.sessions
  });
}

export function resolveOpenRoadSessionFile(env = process.env) {
  return resolve(env.OPENROAD_SESSION_FILE ?? ".openroad/openroad-sessions.json");
}

export function getSessionCookieValue(cookieHeader: string | undefined) {
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = pair.split("=");
    if (rawName.trim() !== sessionCookieName) continue;

    const value = rawValue.join("=").trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

function createSessionMetadata(session: SessionRecord): SessionMetadata {
  return {
    actor: { id: "local-owner", source: "session", type: "local-owner" },
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    id: session.id
  };
}

function parseSessionCookieValue(value: string | undefined) {
  if (!value) return undefined;
  const [id, secret, ...extra] = value.split(".");
  if (extra.length > 0 || !id?.startsWith("session-") || !secret || secret.length < 32) {
    return undefined;
  }
  return { id, secret };
}

function createSessionSecret() {
  return randomBytes(32).toString("base64url");
}

function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function pruneInactiveSessions(sessions: SessionRecord[], now: Date) {
  return sessions.filter((session) => isSessionActive(session, now));
}

function isSessionActive(session: SessionRecord, now: Date) {
  return !session.revokedAt && Date.parse(session.expiresAt) > now.getTime();
}

function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    isRecord(value) &&
    typeof value.adminTokenHash === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.id === "string" &&
    typeof value.tokenHash === "string" &&
    (value.ipAddress === undefined || typeof value.ipAddress === "string") &&
    (value.revokedAt === undefined || typeof value.revokedAt === "string") &&
    (value.userAgent === undefined || typeof value.userAgent === "string")
  );
}

function boundOptionalText(value: string | undefined, maxLength: number) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
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
