import {
  migrateOpenRoadState,
  openRoadSchemaVersion,
  type LoadOpenRoadResult,
  type OpenRoadState,
  type Workspace
} from "../domain/openroad";

type ServerStateResponse = {
  backupPath?: string;
  state: OpenRoadState;
  status?: string;
};

type ServerActorResponse = {
  id?: string;
  role?: string;
  source?: string;
  type?: string;
  workspaceId?: string;
};

type ServerMembershipResponse = {
  role?: string;
  workspaceId?: string;
};

type ServerSessionResponse = {
  actor?: ServerActorResponse;
  authenticated: boolean;
  loginRequired?: boolean;
  memberships?: ServerMembershipResponse[];
};

type OwnerLoginResponse = {
  authenticated: boolean;
  status: string;
};

type InvitationSessionResponse = {
  authenticated: boolean;
  status: string;
};

type AccountPasswordLoginResponse = {
  authenticated: boolean;
  status: string;
};

type AccountPasswordSetResponse = {
  status: string;
};

type AccountRecoveryRequestResponse = {
  message: string;
  status: string;
};

type AccountRecoveryConfirmResponse = {
  authenticated: boolean;
  status: string;
};

type ServerWorkspaceListResponse = {
  workspaces?: Array<{ id?: string }>;
};

type ServerWorkspaceResponse = {
  workspace?: Workspace;
};

export type ServerOpenRoadScope = "owner" | "workspace-member";
export type ServerOpenRoadLoadResult = LoadOpenRoadResult & {
  serverScope: ServerOpenRoadScope;
};

export class OpenRoadServerAuthRequiredError extends Error {
  code = "auth_required" as const;

  constructor(message = "OpenRoad server sign-in is required.") {
    super(message);
  }
}

export function isServerPersistenceEnabled() {
  if (typeof window === "undefined") return false;
  if (import.meta.env.VITE_OPENROAD_SERVER_SYNC === "off") return false;
  return import.meta.env.PROD || import.meta.env.VITE_OPENROAD_SERVER_SYNC === "on";
}

export async function loadServerOpenRoadSession() {
  const response = await fetch("/api/openroad/session", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  return (await readJsonResponse(response)) as ServerSessionResponse;
}

export async function loadServerOpenRoadState(): Promise<ServerOpenRoadLoadResult> {
  const response = await fetch("/api/openroad/state", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await readJsonPayload(response);

  if (response.ok) {
    return createLoadResult(payload as ServerStateResponse, "owner");
  }

  if (response.status !== 403 || !isForbiddenPayload(payload)) {
    throw createRequestError(response, payload);
  }

  const session = await loadServerOpenRoadSession();

  if (!isWorkspaceMemberSession(session)) {
    throw new OpenRoadServerAuthRequiredError(
      isErrorPayload(payload) && typeof payload.error.message === "string"
        ? payload.error.message
        : undefined
    );
  }

  return loadWorkspaceMemberOpenRoadState();
}

async function loadWorkspaceMemberOpenRoadState(): Promise<ServerOpenRoadLoadResult> {
  const listResponse = await fetch("/api/openroad/workspaces", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const listPayload = (await readJsonResponse(listResponse)) as ServerWorkspaceListResponse;
  const workspaceIds = Array.isArray(listPayload.workspaces)
    ? listPayload.workspaces
        .map((workspace) => workspace.id)
        .filter((workspaceId): workspaceId is string => Boolean(workspaceId))
    : [];

  if (workspaceIds.length === 0) {
    throw new Error("This member session does not have access to any OpenRoad workspaces.");
  }

  const workspacePayloads = await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      const response = await fetch(`/api/openroad/workspaces/${encodeURIComponent(workspaceId)}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      return (await readJsonResponse(response)) as ServerWorkspaceResponse;
    })
  );
  const workspaces = workspacePayloads
    .map((payload) => payload.workspace)
    .filter((workspace): workspace is Workspace => Boolean(workspace));

  return {
    state: migrateOpenRoadState({ schemaVersion: openRoadSchemaVersion, workspaces }),
    status: "ready",
    serverScope: "workspace-member"
  };
}

export async function loginOpenRoadOwner(adminToken: string) {
  const response = await fetch("/api/openroad/auth/login", {
    body: JSON.stringify({ adminToken }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await readJsonResponse(response)) as OwnerLoginResponse;
}

export async function acceptOpenRoadInvitationSession(token: string, name = "") {
  const response = await fetch("/api/openroad/invitations/session", {
    body: JSON.stringify({ name, token }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await readJsonResponse(response)) as InvitationSessionResponse;
}

export async function loginOpenRoadAccount(email: string, password: string, workspaceId = "") {
  const response = await fetch("/api/openroad/auth/password/login", {
    body: JSON.stringify({ email, password, ...(workspaceId ? { workspaceId } : {}) }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await readJsonResponse(response)) as AccountPasswordLoginResponse;
}

export async function setOpenRoadAccountPassword(password: string, currentPassword = "") {
  const response = await fetch("/api/openroad/account/password", {
    body: JSON.stringify({ password, ...(currentPassword ? { currentPassword } : {}) }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await readJsonResponse(response)) as AccountPasswordSetResponse;
}

export async function requestOpenRoadAccountRecovery(email: string, workspaceId = "") {
  const response = await fetch("/api/openroad/account/recovery/request", {
    body: JSON.stringify({ email, ...(workspaceId ? { workspaceId } : {}) }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await readJsonResponse(response)) as AccountRecoveryRequestResponse;
}

export async function confirmOpenRoadAccountRecovery(
  token: string,
  password: string,
  workspaceId = ""
) {
  const response = await fetch("/api/openroad/account/recovery/confirm", {
    body: JSON.stringify({ token, password, ...(workspaceId ? { workspaceId } : {}) }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await readJsonResponse(response)) as AccountRecoveryConfirmResponse;
}

export async function saveServerOpenRoadState(state: OpenRoadState) {
  const response = await fetch("/api/openroad/state", {
    body: JSON.stringify({ state }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "PUT"
  });
  const payload = await readJsonPayload(response);

  if (response.ok) {
    return migrateOpenRoadState((payload as ServerStateResponse).state);
  }

  if (response.status !== 403 || !isForbiddenPayload(payload) || state.workspaces.length !== 1) {
    throw createRequestError(response, payload);
  }

  const [workspace] = state.workspaces;
  const workspaceResponse = await fetch(
    `/api/openroad/workspaces/${encodeURIComponent(workspace.id)}`,
    {
      body: JSON.stringify({ workspace }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      method: "PUT"
    }
  );
  const workspacePayload = (await readJsonResponse(workspaceResponse)) as ServerWorkspaceResponse;

  return migrateOpenRoadState({
    schemaVersion: openRoadSchemaVersion,
    workspaces: [workspacePayload.workspace]
  });
}

async function readJsonResponse(response: Response) {
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw createRequestError(response, payload);
  }

  return payload;
}

async function readJsonPayload(response: Response) {
  return (await response.json()) as unknown;
}

function createLoadResult(
  payload: ServerStateResponse,
  serverScope: ServerOpenRoadScope
): ServerOpenRoadLoadResult {
  return {
    error: payload.backupPath
      ? "Server data was recovered from a corrupt state file."
      : undefined,
    state: migrateOpenRoadState(payload.state),
    status: payload.status === "recovered" ? "recovered" : "ready",
    serverScope
  };
}

function createRequestError(response: Response, payload: unknown) {
  if (response.status === 403 && isForbiddenPayload(payload)) {
    return new OpenRoadServerAuthRequiredError(payload.error.message);
  }

  const message =
    isErrorPayload(payload) && typeof payload.error.message === "string"
      ? payload.error.message
      : "OpenRoad server request failed.";
  return new Error(message);
}

export function isOpenRoadServerAuthRequiredError(
  value: unknown
): value is OpenRoadServerAuthRequiredError {
  return value instanceof OpenRoadServerAuthRequiredError;
}

function isErrorPayload(value: unknown): value is { error: { code?: string; message: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error?: unknown }).error !== null
  );
}

function isForbiddenPayload(value: unknown): value is { error: { code: "forbidden"; message: string } } {
  return isErrorPayload(value) && value.error.code === "forbidden";
}

function isWorkspaceMemberSession(session: ServerSessionResponse) {
  if (!session.authenticated || session.actor?.type !== "workspace-member") return false;
  if (typeof session.actor.workspaceId === "string" && session.actor.workspaceId.trim()) return true;
  return Boolean(
    session.memberships?.some((membership) => typeof membership.workspaceId === "string")
  );
}
