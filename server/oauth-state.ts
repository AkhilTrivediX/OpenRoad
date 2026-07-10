import { createHmac, timingSafeEqual } from "node:crypto";

export type OAuthStateProvider = "jira" | "linear";

export type ProviderOAuthState = {
  createdAt: string;
  installationId?: string;
  provider: OAuthStateProvider;
  workspaceId: string;
};

export function encodeProviderOAuthState(state: ProviderOAuthState, signingSecret: string) {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${signOAuthPayload(payload, signingSecret)}`;
}

export function decodeProviderOAuthState(
  value: string,
  signingSecret: string,
  provider: OAuthStateProvider
): ProviderOAuthState {
  const [payload, signature, extra] = value.split(".");

  if (!payload || !signature || extra !== undefined) {
    throw new Error("OAuth state is invalid.");
  }

  if (!isSignatureValid(payload, signature, signingSecret)) {
    throw new Error("OAuth state signature is invalid.");
  }

  const state = parseStatePayload(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown);

  if (state.provider !== provider) {
    throw new Error("OAuth state provider is invalid.");
  }

  return state;
}

function signOAuthPayload(payload: string, signingSecret: string) {
  return createHmac("sha256", signingSecret).update(payload).digest("base64url");
}

function isSignatureValid(payload: string, signature: string, signingSecret: string) {
  const expected = Buffer.from(signOAuthPayload(payload, signingSecret), "utf8");
  const actual = Buffer.from(signature, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseStatePayload(value: unknown): ProviderOAuthState {
  if (!isRecord(value)) throw new Error("OAuth state payload is invalid.");

  const provider = value.provider === "linear" || value.provider === "jira" ? value.provider : undefined;
  const createdAt = getText(value.createdAt, 80);
  const workspaceId = getText(value.workspaceId, 120);
  const installationId = getText(value.installationId, 160);

  if (!provider || !createdAt || !workspaceId) {
    throw new Error("OAuth state payload is invalid.");
  }

  return {
    createdAt,
    ...(installationId ? { installationId } : {}),
    provider,
    workspaceId
  };
}

function getText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
