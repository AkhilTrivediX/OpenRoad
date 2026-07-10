// @vitest-environment node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HttpInvitationDeliveryAdapter,
  JsonlInvitationDeliveryAdapter,
  buildInvitationAcceptUrl,
  createInvitationDeliveryAdapterFromEnv,
  resolveInvitationDeliveryPublicBaseUrl
} from "./invitation-delivery";
import type { TeamInvitationSummary } from "./team";

describe("invitation delivery", () => {
  it("writes safe invitation JSONL handoff records with deliverable accept links", async () => {
    const deliveryFile = await createTempDeliveryFile();
    const adapter = new JsonlInvitationDeliveryAdapter(deliveryFile);
    const invitation = createInvitationSummary();

    const result = await adapter.deliver(invitation, {
      acceptToken: "oinv_secret-delivery-token",
      baseUrl: "https://openroad.example.com/app",
      deliveredAt: "2026-07-10T10:00:00.000Z",
      workspaceId: "acme",
      workspaceName: "Acme OSS"
    });
    const lines = (await readFile(deliveryFile, "utf8")).trim().split("\n");
    const record = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(result.messageId).toBe("jsonl:invitation-1:2026-07-10T10:00:00.000Z");
    expect(lines).toHaveLength(1);
    expect(record).toMatchObject({
      acceptToken: "oinv_secret-delivery-token",
      acceptUrl: "https://openroad.example.com/app?invite=oinv_secret-delivery-token",
      channel: "jsonl-file",
      email: "teammate@example.com",
      expiresAt: "2999-07-19T00:00:00.000Z",
      invitationId: "invitation-1",
      invitedName: "Teammate",
      role: "Contributor",
      subject: "OpenRoad invitation to Acme OSS",
      workspaceId: "acme",
      workspaceName: "Acme OSS"
    });
    expect(String(record.body)).toContain("https://openroad.example.com/app?invite=");
    expect(JSON.stringify(record)).not.toContain("tokenHash");
    expect(JSON.stringify(record)).not.toContain("admin-token");
    expect(JSON.stringify(record)).not.toContain("session");
  });

  it("creates adapters and public base URLs from environment", () => {
    const adapter = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_FILE: "deliveries.jsonl",
      OPENROAD_INVITATION_DELIVERY_MODE: "file"
    });
    const httpAdapter = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_HTTP_BEARER_TOKEN: "provider-secret",
      OPENROAD_INVITATION_DELIVERY_HTTP_TIMEOUT_MS: "2500",
      OPENROAD_INVITATION_DELIVERY_HTTP_URL: "http://127.0.0.1:43210/deliver",
      OPENROAD_INVITATION_DELIVERY_MODE: "http"
    });
    const disabled = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_FILE: "deliveries.jsonl",
      OPENROAD_INVITATION_DELIVERY_MODE: "disabled"
    });
    const insecureHttp = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_HTTP_URL: "http://mail.example.com/deliver",
      OPENROAD_INVITATION_DELIVERY_MODE: "http"
    });
    const credentialedHttp = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_HTTP_URL: "http://user:pass@127.0.0.1:43210/deliver",
      OPENROAD_INVITATION_DELIVERY_MODE: "http"
    });
    const ipv6Loopback = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_HTTP_URL: "http://[::1]:43210/deliver",
      OPENROAD_INVITATION_DELIVERY_MODE: "http"
    });
    const invalid = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_FILE: "deliveries.jsonl",
      OPENROAD_INVITATION_DELIVERY_MODE: "smtp"
    });

    expect(adapter).toBeInstanceOf(JsonlInvitationDeliveryAdapter);
    expect(httpAdapter).toBeInstanceOf(HttpInvitationDeliveryAdapter);
    expect(disabled).toBeUndefined();
    expect(insecureHttp).toBeUndefined();
    expect(credentialedHttp).toBeUndefined();
    expect(ipv6Loopback).toBeInstanceOf(HttpInvitationDeliveryAdapter);
    expect(invalid).toBeUndefined();
    expect(
      resolveInvitationDeliveryPublicBaseUrl({
        OPENROAD_PUBLIC_APP_URL: "https://openroad.example.com/"
      })
    ).toBe("https://openroad.example.com/");
    expect(
      resolveInvitationDeliveryPublicBaseUrl({
        OPENROAD_PUBLIC_APP_URL: "not a url",
        OPENROAD_INVITATION_PUBLIC_BASE_URL: "https://fallback.example.com/"
      })
    ).toBe("https://fallback.example.com/");
  });

  it("builds invitation accept URLs without dropping existing base paths", () => {
    expect(buildInvitationAcceptUrl("https://openroad.example.com/self-host", "oinv_token")).toBe(
      "https://openroad.example.com/self-host?invite=oinv_token"
    );
  });

  it("posts bounded invitation payloads to an HTTP provider with server-only bearer auth", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: IncomingMessage["headers"] }> = [];
    const provider = await createProviderServer(async (request, response) => {
      const body = await readRequestJson(request);
      received.push({ body, headers: request.headers });
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message_id: "provider-message-1" }));
    });
    const adapter = new HttpInvitationDeliveryAdapter(provider.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });

    try {
      const result = await adapter.deliver(createInvitationSummary(), {
        acceptToken: "oinv_secret-provider-token",
        baseUrl: "https://openroad.example.com/app",
        deliveredAt: "2026-07-10T10:00:00.000Z",
        workspaceId: "acme",
        workspaceName: "Acme OSS"
      });

      expect(result.messageId).toBe("provider-message-1");
      expect(received).toHaveLength(1);
      expect(received[0].headers.authorization).toBe("Bearer provider-secret-token");
      expect(received[0].body).toMatchObject({
        acceptUrl: "https://openroad.example.com/app?invite=oinv_secret-provider-token",
        channel: "http-provider",
        email: "teammate@example.com",
        expiresAt: "2999-07-19T00:00:00.000Z",
        invitationId: "invitation-1",
        invitedName: "Teammate",
        role: "Contributor",
        subject: "OpenRoad invitation to Acme OSS",
        workspaceId: "acme",
        workspaceName: "Acme OSS"
      });
      expect(JSON.stringify(received[0].body)).not.toContain("acceptToken");
      expect(JSON.stringify(received[0].body)).not.toContain("tokenHash");
      expect(JSON.stringify(received[0].body)).not.toContain("admin-token");
      expect(JSON.stringify(received[0].body)).not.toContain("session");
      expect(JSON.stringify(received[0].body)).not.toContain("provider-secret-token");
    } finally {
      await provider.close();
    }
  });

  it("sanitizes provider message ids before returning metadata", async () => {
    const cases: Array<{ body?: Record<string, unknown>; header?: string }> = [
      { body: { messageId: "Bearer provider-secret-token" } },
      { body: { message_id: "https://openroad.example.com/app?invite=oinv_secret-provider-token" } },
      { body: { id: "password=raw-password" } },
      { body: {}, header: "token=header-secret" }
    ];

    for (const item of cases) {
      const provider = await createProviderServer(async (_request, response) => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          ...(item.header ? { "x-message-id": item.header } : {})
        });
        response.end(JSON.stringify(item.body ?? {}));
      });
      const adapter = new HttpInvitationDeliveryAdapter(provider.url);

      try {
        const result = await adapter.deliver(createInvitationSummary(), {
          acceptToken: "oinv_secret-provider-token",
          baseUrl: "https://openroad.example.com/app",
          deliveredAt: "2026-07-10T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        });

        expect(result.messageId).toBe("[redacted]");
      } finally {
        await provider.close();
      }
    }
  });

  it("redacts provider failures before they can be persisted", async () => {
    const provider = await createProviderServer(async (_request, response) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(
        "failed url=https://openroad.example.com/app?invite=oinv_secret-provider-token Bearer provider-secret-token password=raw-password"
      );
    });
    const adapter = new HttpInvitationDeliveryAdapter(provider.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });

    try {
      let failureMessage = "";
      try {
        await adapter.deliver(createInvitationSummary(), {
          acceptToken: "oinv_secret-provider-token",
          baseUrl: "https://openroad.example.com/app",
          deliveredAt: "2026-07-10T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        });
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : String(error);
      }

      expect(failureMessage).toContain("Invitation provider responded 500");
      expect(failureMessage).not.toContain("oinv_secret-provider-token");
      expect(failureMessage).not.toContain("provider-secret-token");
      expect(failureMessage).not.toContain("raw-password");
      expect(failureMessage).toContain("[redacted]");
    } finally {
      await provider.close();
    }
  });

  it("blocks provider redirects so payloads and bearer auth are not resent to another host", async () => {
    let redirectedRequests = 0;
    const redirectTarget = await createProviderServer((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ messageId: "redirected" }));
    });
    const redirector = await createProviderServer((_request, response) => {
      response.writeHead(307, { Location: redirectTarget.url });
      response.end();
    });
    const adapter = new HttpInvitationDeliveryAdapter(redirector.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });

    try {
      await expect(
        adapter.deliver(createInvitationSummary(), {
          acceptToken: "oinv_secret-provider-token",
          baseUrl: "https://openroad.example.com/app",
          deliveredAt: "2026-07-10T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        })
      ).rejects.toThrow();
      expect(redirectedRequests).toBe(0);
    } finally {
      await redirector.close();
      await redirectTarget.close();
    }
  });

  it("times out hanging provider requests with a safe error", async () => {
    const provider = await createProviderServer((_request, _response) => {
      // Keep the request open so the adapter's abort path is exercised.
    });
    const adapter = new HttpInvitationDeliveryAdapter(provider.url, { timeoutMs: 1 });

    try {
      await expect(
        adapter.deliver(createInvitationSummary(), {
          acceptToken: "oinv_secret-provider-token",
          baseUrl: "https://openroad.example.com/app",
          deliveredAt: "2026-07-10T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        })
      ).rejects.toThrow("Invitation provider delivery timed out.");
    } finally {
      await provider.close();
    }
  });

  it("fails malformed success bodies and bounds oversized provider errors", async () => {
    const invalidSuccess = await createProviderServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    });
    const hugeFailure = await createProviderServer((_request, response) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(`${"x".repeat(100_000)} password=raw-password`);
    });

    try {
      const invalidAdapter = new HttpInvitationDeliveryAdapter(invalidSuccess.url);
      await expect(
        invalidAdapter.deliver(createInvitationSummary(), {
          acceptToken: "oinv_secret-provider-token",
          baseUrl: "https://openroad.example.com/app",
          deliveredAt: "2026-07-10T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        })
      ).rejects.toThrow("non-JSON success response");

      const failureAdapter = new HttpInvitationDeliveryAdapter(hugeFailure.url);
      let failureMessage = "";
      try {
        await failureAdapter.deliver(createInvitationSummary(), {
          acceptToken: "oinv_secret-provider-token",
          baseUrl: "https://openroad.example.com/app",
          deliveredAt: "2026-07-10T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        });
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : String(error);
      }

      expect(failureMessage.length).toBeLessThanOrEqual(620);
      expect(failureMessage).not.toContain("raw-password");
    } finally {
      await invalidSuccess.close();
      await hugeFailure.close();
    }
  });
});

function createInvitationSummary(overrides: Partial<TeamInvitationSummary> = {}): TeamInvitationSummary {
  return {
    createdAt: "2026-07-05T00:00:00.000Z",
    createdByActorId: "local-owner",
    email: "teammate@example.com",
    expiresAt: "2999-07-19T00:00:00.000Z",
    id: "invitation-1",
    invitedName: "Teammate",
    role: "Contributor",
    status: "pending",
    workspaceId: "acme",
    ...overrides
  };
}

async function createTempDeliveryFile() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-invitation-delivery-"));
  return join(directory, "deliveries.jsonl");
}

async function createProviderServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse
  ) => Promise<void> | void
) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Provider server did not bind to a TCP address.");
  }

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: `http://127.0.0.1:${address.port}/deliver`
  };
}

async function readRequestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
