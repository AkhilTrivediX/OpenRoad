import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import {
  createPublicPortalSnapshot,
  openRoadReducer,
  openRoadSchemaVersion,
  type OpenRoadAction
} from "../src/domain/openroad.js";
import {
  OpenRoadStoreError,
  parseOpenRoadState,
  type OpenRoadStore
} from "./store.js";

type CreateOpenRoadServerOptions = {
  distDir?: string;
  logger?: Pick<Console, "error" | "log">;
  store: OpenRoadStore;
};

type ApiErrorCode =
  | "corrupt_state"
  | "invalid_json"
  | "invalid_method"
  | "invalid_state"
  | "future_schema"
  | "not_found"
  | "payload_too_large"
  | "server_error";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};

const staticMimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

const openRoadActionTypes = new Set([
  "create-workspace",
  "create-request",
  "replace-request",
  "create-work-item",
  "replace-work-item",
  "create-roadmap-item",
  "replace-roadmap-item",
  "delete-roadmap-item",
  "create-changelog-item",
  "replace-changelog-item",
  "delete-changelog-item",
  "replace-portal-settings",
  "replace-workspace",
  "replace-state"
]);

export function createOpenRoadServer({
  distDir = resolve("dist"),
  logger = console,
  store
}: CreateOpenRoadServerOptions): Server {
  const resolvedDistDir = resolve(distDir);

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://openroad.local");

      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApiRequest(request, response, requestUrl, store);
        return;
      }

      await serveStaticAsset(request, response, requestUrl, resolvedDistDir);
    } catch (error) {
      logger.error(error);
      writeApiError(response, 500, "server_error", "OpenRoad server failed to handle the request.");
    }
  });
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  store: OpenRoadStore
) {
  if (requestUrl.pathname === "/api/health") {
    if (request.method !== "GET") {
      writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.");
      return;
    }

    writeJson(response, 200, {
      ok: true,
      schemaVersion: openRoadSchemaVersion
    });
    return;
  }

  if (requestUrl.pathname === "/api/openroad/state") {
    await handleStateRequest(request, response, store);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/actions") {
    await handleActionRequest(request, response, store);
    return;
  }

  const portalMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/portal$/
  );

  if (portalMatch) {
    await handlePortalRequest(request, response, requestUrl, store, portalMatch[1]);
    return;
  }

  writeApiError(response, 404, "not_found", "OpenRoad API route was not found.");
}

async function handleStateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore
) {
  if (request.method === "GET") {
    const result = await store.load();
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "PUT") {
    try {
      const payload = await readJsonBody(request);
      const statePayload = getStatePayload(payload);
      const state = await store.replaceState(statePayload);
      writeJson(response, 200, { state, status: "saved" });
    } catch (error) {
      writeKnownApiError(response, error);
    }
    return;
  }

  writeApiError(response, 405, "invalid_method", "This endpoint only supports GET and PUT.");
}

async function handleActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.");
    return;
  }

  try {
    const payload = await readJsonBody(request);

    if (!isOpenRoadActionPayload(payload)) {
      writeApiError(response, 400, "invalid_state", "Request must include an OpenRoad action.");
      return;
    }

    const current = await store.load();
    let nextState;

    try {
      nextState = parseOpenRoadState(openRoadReducer(current.state, payload.action));
    } catch (error) {
      if (error instanceof OpenRoadStoreError) throw error;
      throw new OpenRoadStoreError("invalid_state", "OpenRoad action could not be applied.");
    }

    const state = await store.replaceState(nextState);
    writeJson(response, 200, { state, status: "saved" });
  } catch (error) {
    writeKnownApiError(response, error);
  }
}

async function handlePortalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  store: OpenRoadStore,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.");
    return;
  }

  const result = await store.load();
  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const workspace = result.state.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    writeApiError(response, 404, "not_found", "Workspace was not found.");
    return;
  }

  writeJson(
    response,
    200,
    createPublicPortalSnapshot(workspace, requestUrl.searchParams.get("query") ?? "")
  );
}

async function serveStaticAsset(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  distDir: string
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    writeApiError(response, 405, "invalid_method", "Static assets only support GET and HEAD.");
    return;
  }

  const pathname = decodeURIComponent(requestUrl.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const assetPath = resolve(join(distDir, requestedPath));

  if (!isPathInside(assetPath, distDir)) {
    writeApiError(response, 403, "not_found", "Static asset was not found.");
    return;
  }

  const resolvedAssetPath = await resolveStaticPath(assetPath, distDir);

  if (!resolvedAssetPath) {
    writeApiError(response, 404, "not_found", "Static asset was not found.");
    return;
  }

  const contentType = staticMimeTypes[extname(resolvedAssetPath)] ?? "application/octet-stream";
  const cacheControl = resolvedAssetPath.includes(`${sep}assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  response.writeHead(200, {
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(resolvedAssetPath).pipe(response);
}

async function resolveStaticPath(assetPath: string, distDir: string) {
  try {
    const assetStats = await stat(assetPath);
    if (assetStats.isFile()) return assetPath;
  } catch {
    // Fall through to app-route fallback.
  }

  const indexPath = resolve(join(distDir, "index.html"));
  if (!isPathInside(indexPath, distDir)) return undefined;

  try {
    const indexStats = await stat(indexPath);
    return indexStats.isFile() ? indexPath : undefined;
  } catch {
    return undefined;
  }
}

function getStatePayload(payload: unknown) {
  if (isRecord(payload) && "state" in payload) {
    return payload.state;
  }

  return payload;
}

async function readJsonBody(request: IncomingMessage, maxBytes = 2_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxBytes) {
      throw new ApiBodyError("payload_too_large", "Request body is too large.");
    }

    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiBodyError("invalid_json", "Request body must be valid JSON.");
  }
}

function writeKnownApiError(response: ServerResponse, error: unknown) {
  if (error instanceof ApiBodyError) {
    const status = error.code === "payload_too_large" ? 413 : 400;
    writeApiError(response, status, error.code, error.message);
    return;
  }

  if (error instanceof OpenRoadStoreError) {
    const status = error.code === "future_schema" ? 409 : 422;
    writeApiError(response, status, error.code, error.message);
    return;
  }

  throw error;
}

function writeJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(payload));
}

function writeApiError(
  response: ServerResponse,
  status: number,
  code: ApiErrorCode,
  message: string
) {
  writeJson(response, status, {
    error: {
      code,
      message
    }
  });
}

function isPathInside(targetPath: string, parentPath: string) {
  const relativePath = targetPath.slice(parentPath.length);
  return targetPath === parentPath || (targetPath.startsWith(parentPath) && relativePath.startsWith(sep));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpenRoadActionPayload(value: unknown): value is { action: OpenRoadAction } {
  return (
    isRecord(value) &&
    isRecord(value.action) &&
    typeof value.action.type === "string" &&
    openRoadActionTypes.has(value.action.type)
  );
}

class ApiBodyError extends Error {
  constructor(
    readonly code: Extract<ApiErrorCode, "invalid_json" | "payload_too_large">,
    message: string
  ) {
    super(message);
  }
}
