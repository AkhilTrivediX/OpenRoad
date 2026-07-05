export type WorkspaceRole = "Owner" | "Maintainer" | "Contributor" | "Viewer";

export type WorkspaceInvitationStatus = "accepted" | "expired" | "pending" | "revoked";

export type WorkspaceInvitationSummary = {
  acceptedAt?: string;
  acceptedByUserId?: string;
  createdAt: string;
  createdByActorId: string;
  email: string;
  expiresAt: string;
  id: string;
  invitedName?: string;
  revokedAt?: string;
  revokedByActorId?: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  workspaceId: string;
};

export type WorkspaceInvitationAccess = {
  invitations: WorkspaceInvitationSummary[];
  message?: string;
  status: "forbidden" | "ready" | "unavailable";
  workspaceId: string;
};

export type CreateWorkspaceInvitationInput = {
  email: string;
  expiresAt?: string;
  name?: string;
  role: WorkspaceRole;
};

export type CreateWorkspaceInvitationResult = {
  acceptToken?: string;
  invitation?: WorkspaceInvitationSummary;
  message: string;
  status: "created" | "failed" | "forbidden" | "unavailable";
};

export type InvitationMutationResult = {
  invitation?: WorkspaceInvitationSummary;
  message: string;
  status: "accepted" | "failed" | "forbidden" | "revoked" | "unavailable";
};

export function createStandaloneInvitationAccess(
  workspaceId: string,
  message = "Team invitations are available when this workspace is connected to the OpenRoad server."
): WorkspaceInvitationAccess {
  return {
    invitations: [],
    message,
    status: "unavailable",
    workspaceId
  };
}

export async function loadWorkspaceInvitations(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceInvitationAccess> {
  let response: Response;

  try {
    response = await fetchImpl(
      `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      }
    );
  } catch {
    return createStandaloneInvitationAccess(
      workspaceId,
      "Team invitation metadata is unavailable in this browser session."
    );
  }

  const payload = await readJsonSafely(response);

  if (!response.ok) {
    return {
      invitations: [],
      message: safeInvitationErrorMessage(response.status, payload),
      status: response.status === 403 ? "forbidden" : "unavailable",
      workspaceId
    };
  }

  return {
    invitations: parseInvitationList(payload),
    status: "ready",
    workspaceId
  };
}

export async function createWorkspaceInvitation(
  workspaceId: string,
  input: CreateWorkspaceInvitationInput,
  fetchImpl: typeof fetch = fetch
): Promise<CreateWorkspaceInvitationResult> {
  const result = await postJsonSafely(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
    input,
    fetchImpl
  );

  if (!result.ok) {
    return {
      message: safeInvitationErrorMessage(result.status, result.payload),
      status: result.status === 403 ? "forbidden" : "unavailable"
    };
  }

  const invitation = parseInvitation((result.payload as { invitation?: unknown }).invitation);
  const acceptToken = getPlainRecordText(result.payload, "acceptToken", 512);

  if (!invitation || !acceptToken) {
    return {
      message: "OpenRoad created the invitation but returned an invalid response.",
      status: "failed"
    };
  }

  return {
    acceptToken,
    invitation,
    message: `Invitation created for ${invitation.email}.`,
    status: "created"
  };
}

export async function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<InvitationMutationResult> {
  const result = await postJsonSafely(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(
      invitationId
    )}/revoke`,
    {},
    fetchImpl
  );

  if (!result.ok) {
    return {
      message: safeInvitationErrorMessage(result.status, result.payload),
      status: result.status === 403 ? "forbidden" : "unavailable"
    };
  }

  const invitation = parseInvitation((result.payload as { invitation?: unknown }).invitation);
  return {
    invitation,
    message: invitation ? `Invitation revoked for ${invitation.email}.` : "Invitation revoked.",
    status: "revoked"
  };
}

export async function acceptWorkspaceInvitationToken(
  token: string,
  name = "",
  fetchImpl: typeof fetch = fetch
): Promise<InvitationMutationResult> {
  const result = await postJsonSafely(
    "/api/openroad/invitations/accept",
    { name, token },
    fetchImpl
  );

  if (!result.ok) {
    return {
      message: safeInvitationErrorMessage(result.status, result.payload),
      status: result.status === 403 ? "forbidden" : "unavailable"
    };
  }

  const invitation = parseInvitation((result.payload as { invitation?: unknown }).invitation);
  return {
    invitation,
    message: invitation ? `Invitation accepted for ${invitation.email}.` : "Invitation accepted.",
    status: "accepted"
  };
}

async function postJsonSafely(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
) {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  } catch {
    return { ok: false, payload: undefined, status: 0 };
  }

  return {
    ok: response.ok,
    payload: await readJsonSafely(response),
    status: response.status
  };
}

async function readJsonSafely(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function parseInvitationList(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.invitations)) return [];
  return value.invitations
    .map(parseInvitation)
    .filter((invitation): invitation is WorkspaceInvitationSummary => Boolean(invitation));
}

function parseInvitation(value: unknown): WorkspaceInvitationSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = getRecordText(value, "id", 160);
  const email = getRecordText(value, "email", 254);
  const role = getWorkspaceRole(value.role);
  const status = getInvitationStatus(value.status);
  const workspaceId = getRecordText(value, "workspaceId", 160);
  if (!id || !email || !role || !status || !workspaceId) return undefined;

  return {
    acceptedAt: getRecordText(value, "acceptedAt", 80),
    acceptedByUserId: getRecordText(value, "acceptedByUserId", 160),
    createdAt: getRecordText(value, "createdAt", 80) ?? "",
    createdByActorId: getRecordText(value, "createdByActorId", 160) ?? "",
    email,
    expiresAt: getRecordText(value, "expiresAt", 80) ?? "",
    id,
    invitedName: getRecordText(value, "invitedName", 120),
    revokedAt: getRecordText(value, "revokedAt", 80),
    revokedByActorId: getRecordText(value, "revokedByActorId", 160),
    role,
    status,
    workspaceId
  };
}

function safeInvitationErrorMessage(status: number, payload: unknown) {
  if (status === 403) {
    return "Team invitations require workspace owner access in this deployment.";
  }

  if (status === 503) {
    return "Team metadata is not configured on this server.";
  }

  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return redactSensitiveText(payload.error.message).slice(0, 180);
  }

  return "Team invitations are unavailable in this browser session.";
}

function getWorkspaceRole(value: unknown): WorkspaceRole | undefined {
  return value === "Owner" || value === "Maintainer" || value === "Contributor" || value === "Viewer"
    ? value
    : undefined;
}

function getInvitationStatus(value: unknown): WorkspaceInvitationStatus | undefined {
  return value === "accepted" || value === "expired" || value === "pending" || value === "revoked"
    ? value
    : undefined;
}

function getRecordText(value: unknown, key: string, maxLength: number) {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "string" && next.trim()
    ? redactSensitiveText(next.trim()).slice(0, maxLength)
    : undefined;
}

function getPlainRecordText(value: unknown, key: string, maxLength: number) {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "string" && next.trim() ? next.trim().slice(0, maxLength) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    .slice(0, 500);
}
