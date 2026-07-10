import type { WorkspaceRole } from "./openroadInvitations";

export type WorkspaceMemberSummary = {
  accountPasswordSet: boolean;
  createdAt: string;
  email: string;
  id: string;
  isLocalOwner: boolean;
  name: string;
  role: WorkspaceRole;
  userId: string;
  workspaceId: string;
};

export type WorkspaceMemberAccess = {
  members: WorkspaceMemberSummary[];
  message?: string;
  status: "forbidden" | "ready" | "unavailable";
  workspaceId: string;
};

export type WorkspaceMemberMutationResult = {
  member?: WorkspaceMemberSummary;
  message: string;
  revokedSessions?: number;
  status: "deactivated" | "failed" | "forbidden" | "unavailable" | "updated";
};

export function createStandaloneMemberAccess(
  workspaceId: string,
  message = "Team member management is available when this workspace is connected to the OpenRoad server."
): WorkspaceMemberAccess {
  return {
    members: [],
    message,
    status: "unavailable",
    workspaceId
  };
}

export async function loadWorkspaceMembers(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceMemberAccess> {
  let response: Response;

  try {
    response = await fetchImpl(`/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
  } catch {
    return createStandaloneMemberAccess(
      workspaceId,
      "Team member metadata is unavailable in this browser session."
    );
  }

  const payload = await readJsonSafely(response);

  if (!response.ok) {
    return {
      members: [],
      message: safeMemberErrorMessage(response.status, payload),
      status: response.status === 403 ? "forbidden" : "unavailable",
      workspaceId
    };
  }

  return {
    members: parseMemberList(payload),
    status: "ready",
    workspaceId
  };
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  membershipId: string,
  role: WorkspaceRole,
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceMemberMutationResult> {
  const result = await sendMemberMutation(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(
      membershipId
    )}`,
    { role },
    "PATCH",
    fetchImpl
  );

  if (!result.ok) {
    return {
      message: safeMemberErrorMessage(result.status, result.payload),
      status: result.status === 403 ? "forbidden" : "unavailable"
    };
  }

  const member = parseMember((result.payload as { member?: unknown }).member);
  return {
    member,
    message: member ? `Updated ${member.email} to ${member.role}.` : "Member role updated.",
    revokedSessions: getRecordNumber(result.payload, "revokedSessions"),
    status: member ? "updated" : "failed"
  };
}

export async function deactivateWorkspaceMember(
  workspaceId: string,
  membershipId: string,
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceMemberMutationResult> {
  const result = await sendMemberMutation(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(
      membershipId
    )}/deactivate`,
    {},
    "POST",
    fetchImpl
  );

  if (!result.ok) {
    return {
      message: safeMemberErrorMessage(result.status, result.payload),
      status: result.status === 403 ? "forbidden" : "unavailable"
    };
  }

  const member = parseMember((result.payload as { member?: unknown }).member);
  return {
    member,
    message: member ? `Deactivated ${member.email}.` : "Member deactivated.",
    revokedSessions: getRecordNumber(result.payload, "revokedSessions"),
    status: member ? "deactivated" : "failed"
  };
}

async function sendMemberMutation(
  url: string,
  body: Record<string, unknown>,
  method: "PATCH" | "POST",
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
      method
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

function parseMemberList(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.members)) return [];
  return value.members
    .map(parseMember)
    .filter((member): member is WorkspaceMemberSummary => Boolean(member));
}

function parseMember(value: unknown): WorkspaceMemberSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = getRecordText(value, "id", 200);
  const email = getRecordText(value, "email", 254);
  const name = getRecordText(value, "name", 120);
  const role = getWorkspaceRole(value.role);
  const userId = getRecordText(value, "userId", 160);
  const workspaceId = getRecordText(value, "workspaceId", 160);
  if (!id || !email || !name || !role || !userId || !workspaceId) return undefined;

  return {
    accountPasswordSet: value.accountPasswordSet === true,
    createdAt: getRecordText(value, "createdAt", 80) ?? "",
    email,
    id,
    isLocalOwner: value.isLocalOwner === true,
    name,
    role,
    userId,
    workspaceId
  };
}

function safeMemberErrorMessage(status: number, payload: unknown) {
  if (status === 403) {
    return "Team member management requires workspace owner access in this deployment.";
  }

  if (status === 503) {
    return "Team metadata is not configured on this server.";
  }

  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return redactSensitiveText(payload.error.message).slice(0, 180);
  }

  return "Team member management is unavailable in this browser session.";
}

function getWorkspaceRole(value: unknown): WorkspaceRole | undefined {
  return value === "Owner" || value === "Maintainer" || value === "Contributor" || value === "Viewer"
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

function getRecordNumber(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "number" && Number.isFinite(next) ? next : undefined;
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
      /((?:access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .slice(0, 500);
}
