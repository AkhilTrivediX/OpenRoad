import {
  migrateOpenRoadState,
  type LoadOpenRoadResult,
  type OpenRoadState
} from "../domain/openroad";

type ServerStateResponse = {
  backupPath?: string;
  state: OpenRoadState;
  status?: string;
};

type ServerSessionResponse = {
  authenticated: boolean;
  loginRequired: boolean;
};

type OwnerLoginResponse = {
  authenticated: boolean;
  status: string;
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

export async function loadServerOpenRoadState(): Promise<LoadOpenRoadResult> {
  const response = await fetch("/api/openroad/state", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = (await readJsonResponse(response)) as ServerStateResponse;

  return {
    error: payload.backupPath
      ? "Server data was recovered from a corrupt state file."
      : undefined,
    state: migrateOpenRoadState(payload.state),
    status: payload.status === "recovered" ? "recovered" : "ready"
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
  const payload = (await readJsonResponse(response)) as ServerStateResponse;
  return migrateOpenRoadState(payload.state);
}

async function readJsonResponse(response: Response) {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    if (response.status === 403 && isErrorPayload(payload) && payload.error.code === "forbidden") {
      throw new OpenRoadServerAuthRequiredError(payload.error.message);
    }

    const message =
      isErrorPayload(payload) && typeof payload.error.message === "string"
        ? payload.error.message
        : "OpenRoad server request failed.";
    throw new Error(message);
  }

  return payload;
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
