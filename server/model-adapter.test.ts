import { describe, expect, it, vi } from "vitest";

import {
  createInitialOpenRoadState,
  type ChangelogItem,
  type RequestItem,
  type Workspace
} from "../src/domain/openroad";
import {
  createAssistantPromptContext,
  createAssistantTriageResult,
  extractOpenAITextOutput,
  openAIResponsesConfigFromEnv,
  OpenAIResponsesModelAdapter,
  parseModelSummaryRefinement,
  type AssistantModelAdapter
} from "./model-adapter";

describe("model adapter foundation", () => {
  it("returns deterministic assistant triage when external model use is not requested", async () => {
    const workspace = createAssistantWorkspace();
    const selectedRequest = workspace.requests[0];
    const modelAdapter: AssistantModelAdapter = {
      createSummary: vi.fn(async () => ({
        nextAction: "Model action",
        problem: "Model problem"
      })),
      provider: "openai"
    };

    const result = await createAssistantTriageResult({
      allowExternalModel: false,
      consent: { shareRequesterIdentity: false, shareWorkspaceContext: false },
      modelAdapter,
      selectedRequest,
      workspace
    });

    expect(result.model).toMatchObject({
      externalUsed: false,
      fallbackReason: "external_not_requested",
      mode: "deterministic",
      provider: "deterministic"
    });
    expect(modelAdapter.createSummary).not.toHaveBeenCalled();
    expect(result.suggestion.summary.problem).toContain("API limits");
  });

  it("requires explicit workspace context consent before calling an external adapter", async () => {
    const workspace = createAssistantWorkspace();
    const selectedRequest = workspace.requests[0];
    const modelAdapter: AssistantModelAdapter = {
      createSummary: vi.fn(async () => ({
        nextAction: "Model action",
        problem: "Model problem"
      })),
      provider: "openai"
    };

    const result = await createAssistantTriageResult({
      allowExternalModel: true,
      consent: { shareRequesterIdentity: true, shareWorkspaceContext: false },
      modelAdapter,
      selectedRequest,
      workspace
    });

    expect(result.model).toMatchObject({
      externalUsed: false,
      fallbackReason: "consent_required",
      mode: "fallback",
      provider: "openai"
    });
    expect(modelAdapter.createSummary).not.toHaveBeenCalled();
  });

  it("builds bounded redacted prompt context without private-only bodies or requester identity", () => {
    const workspace = createAssistantWorkspace();
    const selectedRequest = workspace.requests[0];
    const deterministicSuggestion = {
      changelogSuggestion: {
        privateNotes: "Assistant draft; review before publishing.",
        publicSummary: "A request update may be ready.",
        reasons: ["Selected request context"],
        requestIds: [selectedRequest.id],
        roadmapItemIds: [],
        sourceKey: "manual",
        sourceType: "Manual" as const,
        title: "Review request for changelog",
        workItemIds: []
      },
      duplicates: [
        {
          reasons: ["Tag overlap: api"],
          request: workspace.requests[1],
          score: 80
        }
      ],
      summary: {
        nextAction: "Review duplicate risk before assigning.",
        problem: "Users cannot see API limits.",
        signal: "99 votes, 3 comments, 0 merged sources. Tags: api.",
        state: "New / Product / Private"
      }
    };

    const context = createAssistantPromptContext({
      consent: { shareRequesterIdentity: false, shareWorkspaceContext: true },
      deterministicSuggestion,
      selectedRequest,
      workspace
    });

    expect(context.includedSections).toEqual(
      expect.arrayContaining(["selectedRequest", "duplicateCandidates", "linkedChangelog"])
    );
    expect(context.redactionCount).toBeGreaterThan(0);
    expect(context.prompt).toContain("[redacted requester]");
    expect(context.prompt).toContain("[redacted]");
    expect(context.prompt).not.toContain("akhil@example.com");
    expect(context.prompt).not.toContain("Bearer sk-live-token");
    expect(context.prompt).not.toContain("internal escalation secret");
    expect(context.prompt).not.toContain("hidden moderation secret");
    expect(context.prompt).not.toContain("notification body secret");
    expect(context.prompt).not.toContain("private changelog secret");
  });

  it("merges model summary output while preserving deterministic duplicates and changelog suggestions", async () => {
    const workspace = createAssistantWorkspace();
    const selectedRequest = workspace.requests[0];
    const modelAdapter: AssistantModelAdapter = {
      createSummary: vi.fn(async () => ({
        nextAction: "Ask the owner to confirm rate-limit copy before roadmap planning.",
        problem: "Developers need clearer API-limit visibility before failed requests."
      })),
      provider: "openai"
    };

    const result = await createAssistantTriageResult({
      allowExternalModel: true,
      consent: { shareRequesterIdentity: false, shareWorkspaceContext: true },
      modelAdapter,
      selectedRequest,
      workspace
    });

    expect(result.model).toMatchObject({
      externalUsed: true,
      mode: "model",
      provider: "openai"
    });
    expect(result.suggestion.summary.problem).toBe(
      "Developers need clearer API-limit visibility before failed requests."
    );
    expect(result.suggestion.summary.nextAction).toBe(
      "Ask the owner to confirm rate-limit copy before roadmap planning."
    );
    expect(result.suggestion.duplicates[0].request.id).toBe("api-limit-warning");
    expect(result.suggestion.changelogSuggestion.publicSummary).toContain("Review this private draft");
  });

  it("falls back deterministically when model output is invalid", async () => {
    const workspace = createAssistantWorkspace();
    const selectedRequest = workspace.requests[0];
    const modelAdapter: AssistantModelAdapter = {
      createSummary: vi.fn(async () => {
        throw new Error("invalid JSON with token=secret-value");
      }),
      provider: "openai"
    };

    const result = await createAssistantTriageResult({
      allowExternalModel: true,
      consent: { shareRequesterIdentity: false, shareWorkspaceContext: true },
      modelAdapter,
      selectedRequest,
      workspace
    });

    expect(result.model).toMatchObject({
      externalUsed: false,
      fallbackReason: "provider_failed",
      mode: "fallback",
      provider: "openai"
    });
    expect(result.suggestion.summary.problem).toContain("API limits");
  });

  it("validates OpenAI provider configuration before constructing an adapter", () => {
    expect(openAIResponsesConfigFromEnv({}).ok).toBe(false);
    expect(
      openAIResponsesConfigFromEnv({
        OPENROAD_AI_PROVIDER: "openai",
        OPENROAD_OPENAI_API_KEY: "sk-test"
      })
    ).toMatchObject({ ok: false, reason: "missing_config" });
    expect(
      openAIResponsesConfigFromEnv({
        OPENROAD_AI_PROVIDER: "openai",
        OPENROAD_OPENAI_API_KEY: "sk-test",
        OPENROAD_OPENAI_BASE_URL: "http://api.openai.test/v1",
        OPENROAD_OPENAI_MODEL: "gpt-test"
      })
    ).toMatchObject({ ok: false, reason: "invalid_base_url" });
    expect(
      openAIResponsesConfigFromEnv({
        OPENROAD_AI_PROVIDER: "openai",
        OPENROAD_OPENAI_API_KEY: "sk-test",
        OPENROAD_OPENAI_BASE_URL: "https://user:pass@api.openai.test/v1",
        OPENROAD_OPENAI_MODEL: "gpt-test"
      })
    ).toMatchObject({ ok: false, reason: "invalid_base_url" });

    const valid = openAIResponsesConfigFromEnv({
      OPENROAD_AI_MAX_OUTPUT_TOKENS: "9999",
      OPENROAD_AI_PROVIDER: "openai",
      OPENROAD_AI_TIMEOUT_MS: "1",
      OPENROAD_OPENAI_API_KEY: "sk-test",
      OPENROAD_OPENAI_BASE_URL: "http://127.0.0.1:8765/v1",
      OPENROAD_OPENAI_MODEL: "gpt-test"
    });

    expect(valid).toMatchObject({
      config: {
        baseUrl: "http://127.0.0.1:8765/v1",
        maxOutputTokens: 1000,
        model: "gpt-test",
        timeoutMs: 1000
      },
      ok: true
    });
  });

  it("calls the OpenAI Responses API with code-managed instructions and parses nested text", async () => {
    const calls: Array<{ init: RequestInit; url: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {}, url: String(url) });
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  text: JSON.stringify({
                    nextAction: "Review owner assignment and publish no automatic changes.",
                    problem: "The request needs clearer API rate-limit guidance."
                  }),
                  type: "output_text"
                }
              ],
              role: "assistant",
              type: "message"
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const adapter = new OpenAIResponsesModelAdapter(
      {
        apiKey: "sk-test",
        baseUrl: "http://127.0.0.1:8765/v1",
        maxOutputTokens: 220,
        model: "gpt-test",
        timeoutMs: 5000
      },
      fetchImpl
    );

    const result = await adapter.createSummary({
      context: {
        includedSections: ["selectedRequest"],
        prompt: "sanitized prompt",
        promptCharacters: 16,
        redactionCount: 0
      },
      deterministicSuggestion: createDeterministicSuggestion(),
      requestId: "api-limits",
      workspaceId: "acme"
    });

    expect(result).toEqual({
      nextAction: "Review owner assignment and publish no automatic changes.",
      problem: "The request needs clearer API rate-limit guidance."
    });
    expect(calls[0].url).toBe("http://127.0.0.1:8765/v1/responses");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      input: "sanitized prompt",
      max_output_tokens: 220,
      model: "gpt-test",
      store: false
    });
    expect(JSON.parse(String(calls[0].init.body)).instructions).toContain("Return JSON only");
  });

  it("extracts OpenAI text defensively and validates JSON summary output", () => {
    expect(extractOpenAITextOutput({ output_text: "{\"problem\":\"p\",\"nextAction\":\"n\"}" })).toBe(
      "{\"problem\":\"p\",\"nextAction\":\"n\"}"
    );
    expect(
      extractOpenAITextOutput({
        output: [
          { content: [{ text: "{\"problem\":\"p\",", type: "output_text" }] },
          { content: [{ text: "\"nextAction\":\"n\"}", type: "output_text" }] }
        ]
      })
    ).toBe("{\"problem\":\"p\",\n\"nextAction\":\"n\"}");
    expect(extractOpenAITextOutput({ output: [{ type: "function_call" }] })).toBeUndefined();

    expect(
      parseModelSummaryRefinement(
        "```json\n{\"problem\":\"Bearer sk-live-token is risky\",\"nextAction\":\"Use token=secret carefully\"}\n```"
      )
    ).toEqual({
      nextAction: "Use [redacted]=[redacted] carefully",
      problem: "Bearer [redacted] is risky"
    });
    expect(() => parseModelSummaryRefinement("not json")).toThrow("Model output was not JSON");
    expect(() => parseModelSummaryRefinement("{\"problem\":\"Only one field\"}")).toThrow(
      "missing required fields"
    );
  });
});

function createAssistantWorkspace(): Workspace {
  const state = createInitialOpenRoadState();
  const workspace = state.workspaces[0];
  const selected: RequestItem = {
    ...workspace.requests[0],
    comments: [
      {
        age: "Today",
        author: "Internal",
        body: "internal escalation secret",
        id: "internal-comment",
        visibility: "Internal"
      },
      {
        age: "Today",
        author: "Moderator",
        body: "hidden moderation secret",
        id: "hidden-comment",
        visibility: "Hidden"
      },
      {
        age: "Today",
        author: "Customer",
        body: "public context",
        id: "public-comment",
        visibility: "Public"
      }
    ],
    description: "Users cannot see API limits before failures. Bearer sk-live-token api_key=abc123",
    id: "api-limits",
    requester: "akhil@example.com",
    source: "Portal",
    tags: ["api", "limits"],
    title: "API limits visibility",
    votes: 99
  };
  const duplicate: RequestItem = {
    ...workspace.requests[1],
    comments: [],
    description: "Warn users before API usage limits fail.",
    id: "api-limit-warning",
    requester: "another@example.com",
    source: "Portal",
    tags: ["api", "limits"],
    title: "API limit warning",
    votes: 70
  };
  const linkedChangelog: ChangelogItem = {
    ...workspace.changelog[0],
    id: "private-release",
    privateNotes: "private changelog secret",
    requestIds: [selected.id],
    title: "Release note with token=secret-value"
  };

  return {
    ...workspace,
    changelog: [linkedChangelog],
    notifications: {
      ...workspace.notifications,
      outbox: [
        {
          body: "notification body secret",
          createdAt: "Today",
          dedupeKey: "notification-secret",
          deliveryAttempts: 0,
          id: "notification-secret",
          requestId: selected.id,
          requestTitle: selected.title,
          requester: selected.requester,
          status: "queued",
          title: "Notification secret",
          type: "request-status-change"
        }
      ]
    },
    requests: [selected, duplicate, ...workspace.requests.slice(2)]
  };
}

function createDeterministicSuggestion() {
  return {
    changelogSuggestion: {
      privateNotes: "Assistant draft; review before publishing.",
      publicSummary: "A request update may be ready.",
      reasons: ["Selected request context"],
      requestIds: ["api-limits"],
      roadmapItemIds: [],
      sourceKey: "manual",
      sourceType: "Manual" as const,
      title: "Review request for changelog",
      workItemIds: []
    },
    duplicates: [],
    summary: {
      nextAction: "Review duplicate risk before assigning.",
      problem: "Users cannot see API limits.",
      signal: "99 votes.",
      state: "New / Product / Private"
    }
  };
}
