// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
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
    const disabled = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_FILE: "deliveries.jsonl",
      OPENROAD_INVITATION_DELIVERY_MODE: "disabled"
    });
    const invalid = createInvitationDeliveryAdapterFromEnv({
      OPENROAD_INVITATION_DELIVERY_FILE: "deliveries.jsonl",
      OPENROAD_INVITATION_DELIVERY_MODE: "smtp"
    });

    expect(adapter).toBeInstanceOf(JsonlInvitationDeliveryAdapter);
    expect(disabled).toBeUndefined();
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
