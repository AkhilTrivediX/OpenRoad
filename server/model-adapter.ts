import {
  createAssistantTriageSuggestion,
  type AssistantRequestSummary,
  type AssistantTriageSuggestion
} from "../src/domain/openroadAssistant.js";
import {
  roadmapLanes,
  type ChangelogItem,
  type RequestItem,
  type RoadmapItem,
  type WorkItem,
  type Workspace
} from "../src/domain/openroad.js";

export type AssistantConsent = {
  shareRequesterIdentity: boolean;
  shareWorkspaceContext: boolean;
};

export type AssistantModelProvider = "deterministic" | "openai";
export type AssistantModelMode = "deterministic" | "fallback" | "model";
export type AssistantFallbackReason =
  | "consent_required"
  | "external_not_requested"
  | "invalid_model_output"
  | "provider_failed"
  | "provider_not_configured";

export type AssistantTriageResult = {
  model: {
    context: {
      includedSections: string[];
      promptCharacters?: number;
      redactionCount: number;
    };
    externalUsed: boolean;
    fallbackReason?: AssistantFallbackReason;
    mode: AssistantModelMode;
    provider: AssistantModelProvider;
  };
  requestId: string;
  status: "suggested";
  suggestion: AssistantTriageSuggestion;
  workspaceId: string;
};

export type AssistantPromptContext = {
  includedSections: string[];
  prompt: string;
  promptCharacters: number;
  redactionCount: number;
};

export type AssistantModelInput = {
  context: AssistantPromptContext;
  deterministicSuggestion: AssistantTriageSuggestion;
  requestId: string;
  workspaceId: string;
};

export type AssistantModelAdapter = {
  createSummary(input: AssistantModelInput): Promise<AssistantRequestSummaryRefinement>;
  provider: Exclude<AssistantModelProvider, "deterministic">;
};

export type AssistantRequestSummaryRefinement = Pick<
  AssistantRequestSummary,
  "nextAction" | "problem"
>;

export type OpenAIResponsesAdapterConfig = {
  apiKey: string;
  baseUrl: string;
  maxOutputTokens: number;
  model: string;
  timeoutMs: number;
};

export type OpenAIResponsesAdapterConfigResult =
  | {
      config: OpenAIResponsesAdapterConfig;
      ok: true;
    }
  | {
      ok: false;
      reason: "invalid_base_url" | "missing_config" | "provider_disabled" | "unsupported_provider";
    };

export class AssistantModelAdapterError extends Error {
  constructor(
    readonly code: "invalid_model_output" | "provider_failed",
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

const promptInstructions = [
  "You are OpenRoad's advisory request-triage assistant.",
  "Return JSON only with exactly two string fields: problem and nextAction.",
  "Use only the provided sanitized context.",
  "Do not invent status changes, owners, roadmap commitments, duplicate merges, or changelog copy.",
  "Keep both fields concise, plain, and suitable for a maintainer reviewing one request."
].join("\n");

const defaultOpenAIBaseUrl = "https://api.openai.com/v1";
const defaultTimeoutMs = 10_000;
const defaultMaxOutputTokens = 220;
const maxProviderResponseCharacters = 24_000;
const maxModelTextCharacters = 4_000;
const maxSummaryFieldCharacters = 260;

export function createAssistantTriageResult({
  allowExternalModel,
  consent,
  modelAdapter,
  selectedRequest,
  workspace
}: {
  allowExternalModel: boolean;
  consent: AssistantConsent;
  modelAdapter?: AssistantModelAdapter;
  selectedRequest: RequestItem;
  workspace: Workspace;
}): Promise<AssistantTriageResult> {
  const deterministicSuggestion = createAssistantTriageSuggestion(
    workspace,
    selectedRequest,
    flattenRoadmap(workspace.roadmap)
  );

  return createAssistantTriageResultFromDeterministic({
    allowExternalModel,
    consent,
    deterministicSuggestion,
    modelAdapter,
    selectedRequest,
    workspace
  });
}

export async function createAssistantTriageResultFromDeterministic({
  allowExternalModel,
  consent,
  deterministicSuggestion,
  modelAdapter,
  selectedRequest,
  workspace
}: {
  allowExternalModel: boolean;
  consent: AssistantConsent;
  deterministicSuggestion: AssistantTriageSuggestion;
  modelAdapter?: AssistantModelAdapter;
  selectedRequest: RequestItem;
  workspace: Workspace;
}): Promise<AssistantTriageResult> {
  const baseResult = createResult({
    fallbackReason: "external_not_requested",
    mode: "deterministic",
    provider: "deterministic",
    requestId: selectedRequest.id,
    suggestion: deterministicSuggestion,
    workspaceId: workspace.id
  });

  if (!allowExternalModel) return baseResult;

  if (!consent.shareWorkspaceContext) {
    return createResult({
      fallbackReason: "consent_required",
      mode: "fallback",
      provider: modelAdapter?.provider ?? "deterministic",
      requestId: selectedRequest.id,
      suggestion: deterministicSuggestion,
      workspaceId: workspace.id
    });
  }

  if (!modelAdapter) {
    return createResult({
      fallbackReason: "provider_not_configured",
      mode: "fallback",
      provider: "deterministic",
      requestId: selectedRequest.id,
      suggestion: deterministicSuggestion,
      workspaceId: workspace.id
    });
  }

  const context = createAssistantPromptContext({
    consent,
    deterministicSuggestion,
    selectedRequest,
    workspace
  });

  try {
    const refinement = await modelAdapter.createSummary({
      context,
      deterministicSuggestion,
      requestId: selectedRequest.id,
      workspaceId: workspace.id
    });

    return createResult({
      context,
      mode: "model",
      provider: modelAdapter.provider,
      requestId: selectedRequest.id,
      suggestion: {
        ...deterministicSuggestion,
        summary: {
          ...deterministicSuggestion.summary,
          nextAction: refinement.nextAction,
          problem: refinement.problem
        }
      },
      workspaceId: workspace.id
    });
  } catch (error) {
    const fallbackReason =
      error instanceof AssistantModelAdapterError && error.code === "invalid_model_output"
        ? "invalid_model_output"
        : "provider_failed";

    return createResult({
      context,
      fallbackReason,
      mode: "fallback",
      provider: modelAdapter.provider,
      requestId: selectedRequest.id,
      suggestion: deterministicSuggestion,
      workspaceId: workspace.id
    });
  }
}

export function createAssistantPromptContext({
  consent,
  deterministicSuggestion,
  selectedRequest,
  workspace
}: {
  consent: AssistantConsent;
  deterministicSuggestion: AssistantTriageSuggestion;
  selectedRequest: RequestItem;
  workspace: Workspace;
}): AssistantPromptContext {
  const redaction = { count: 0 };
  const sanitize = (value: string, maxLength: number) =>
    sanitizeContextText(value, maxLength, redaction, {
      redactIdentity: !consent.shareRequesterIdentity
    });
  const linkedRoadmap = flattenRoadmap(workspace.roadmap)
    .filter((item) => item.requestIds.includes(selectedRequest.id))
    .slice(0, 5)
    .map((item) => sanitizeRoadmapItem(item, sanitize));
  const linkedWork = workspace.workItems
    .filter((item) => item.requestIds.includes(selectedRequest.id))
    .slice(0, 5)
    .map((item) => sanitizeWorkItem(item, sanitize));
  const linkedChangelog = workspace.changelog
    .filter((item) => item.requestIds.includes(selectedRequest.id))
    .slice(0, 5)
    .map((item) => sanitizeChangelogItem(item, sanitize));

  const context = {
    deterministicSummary: {
      nextAction: sanitize(deterministicSuggestion.summary.nextAction, 260),
      problem: sanitize(deterministicSuggestion.summary.problem, 260),
      signal: sanitize(deterministicSuggestion.summary.signal, 220),
      state: sanitize(deterministicSuggestion.summary.state, 160)
    },
    duplicateCandidates: deterministicSuggestion.duplicates.map((suggestion) => ({
      id: sanitize(suggestion.request.id, 120),
      reasons: suggestion.reasons.map((reason) => sanitize(reason, 160)).slice(0, 5),
      score: suggestion.score,
      status: suggestion.request.status,
      tags: suggestion.request.tags.map((tag) => sanitize(tag, 40)).slice(0, 8),
      title: sanitize(suggestion.request.title, 160),
      votes: suggestion.request.votes
    })),
    linkedChangelog,
    linkedRoadmap,
    linkedWork,
    selectedRequest: {
      age: sanitize(selectedRequest.age, 80),
      archived: selectedRequest.archived,
      commentCounts: countCommentsByVisibility(selectedRequest),
      description: sanitize(selectedRequest.description, 420),
      id: sanitize(selectedRequest.id, 120),
      mergedSourceCount: selectedRequest.mergedSources.length,
      owner: selectedRequest.owner,
      requester: consent.shareRequesterIdentity
        ? sanitize(selectedRequest.requester, 160)
        : redactRequester(selectedRequest.requester, redaction),
      source: sanitize(selectedRequest.source, 160),
      status: selectedRequest.status,
      tags: selectedRequest.tags.map((tag) => sanitize(tag, 40)).slice(0, 12),
      title: sanitize(selectedRequest.title, 180),
      visibility: selectedRequest.visibility,
      votes: selectedRequest.votes
    },
    workspace: {
      id: sanitize(workspace.id, 120),
      name: sanitize(workspace.name, 160),
      plan: sanitize(workspace.plan, 80)
    }
  };
  const includedSections = [
    "workspace",
    "selectedRequest",
    "deterministicSummary",
    ...(context.duplicateCandidates.length ? ["duplicateCandidates"] : []),
    ...(linkedRoadmap.length ? ["linkedRoadmap"] : []),
    ...(linkedWork.length ? ["linkedWork"] : []),
    ...(linkedChangelog.length ? ["linkedChangelog"] : [])
  ];
  const prompt = [
    "Use this sanitized OpenRoad context to refine only the selected request problem and next action.",
    "Respond as JSON: {\"problem\":\"...\",\"nextAction\":\"...\"}.",
    JSON.stringify(context, null, 2)
  ].join("\n\n");

  return {
    includedSections,
    prompt,
    promptCharacters: prompt.length,
    redactionCount: redaction.count
  };
}

export function openAIResponsesConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OpenAIResponsesAdapterConfigResult {
  const provider = (env.OPENROAD_AI_PROVIDER ?? "deterministic").trim().toLowerCase();
  if (!provider || provider === "deterministic" || provider === "disabled") {
    return { ok: false, reason: "provider_disabled" };
  }
  if (provider !== "openai") {
    return { ok: false, reason: "unsupported_provider" };
  }

  const apiKey = env.OPENROAD_OPENAI_API_KEY?.trim();
  const model = env.OPENROAD_OPENAI_MODEL?.trim();
  if (!apiKey || !model) {
    return { ok: false, reason: "missing_config" };
  }

  const baseUrl = parseProviderBaseUrl(env.OPENROAD_OPENAI_BASE_URL ?? defaultOpenAIBaseUrl);
  if (!baseUrl) {
    return { ok: false, reason: "invalid_base_url" };
  }

  return {
    config: {
      apiKey,
      baseUrl,
      maxOutputTokens: boundedInteger(
        env.OPENROAD_AI_MAX_OUTPUT_TOKENS,
        defaultMaxOutputTokens,
        32,
        1_000
      ),
      model,
      timeoutMs: boundedInteger(env.OPENROAD_AI_TIMEOUT_MS, defaultTimeoutMs, 1_000, 60_000)
    },
    ok: true
  };
}

export function createModelAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): AssistantModelAdapter | undefined {
  const config = openAIResponsesConfigFromEnv(env);
  if (!config.ok) return undefined;
  return new OpenAIResponsesModelAdapter(config.config, fetchImpl);
}

export class OpenAIResponsesModelAdapter implements AssistantModelAdapter {
  readonly provider = "openai" as const;

  constructor(
    private readonly config: OpenAIResponsesAdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async createSummary(input: AssistantModelInput): Promise<AssistantRequestSummaryRefinement> {
    const response = await this.createResponse(input.context.prompt);
    const text = extractOpenAITextOutput(response);
    if (!text || text.length > maxModelTextCharacters) {
      throw new AssistantModelAdapterError(
        "invalid_model_output",
        "Model response did not contain bounded text output."
      );
    }

    return parseModelSummaryRefinement(text);
  }

  private async createResponse(prompt: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const url = createResponsesUrl(this.config.baseUrl);

    try {
      const response = await this.fetchImpl(url, {
        body: JSON.stringify({
          input: prompt,
          instructions: promptInstructions,
          max_output_tokens: this.config.maxOutputTokens,
          model: this.config.model,
          store: false
        }),
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        method: "POST",
        redirect: "manual",
        signal: controller.signal
      });

      if (response.status >= 300 && response.status < 400) {
        throw new AssistantModelAdapterError(
          "provider_failed",
          "Model provider redirect was blocked.",
          response.status
        );
      }

      const text = await response.text();
      const bounded = text.slice(0, maxProviderResponseCharacters);

      if (!response.ok) {
        throw new AssistantModelAdapterError(
          "provider_failed",
          "Model provider returned an unsuccessful response.",
          response.status
        );
      }

      try {
        return JSON.parse(bounded);
      } catch {
        throw new AssistantModelAdapterError(
          "invalid_model_output",
          "Model provider response was not valid JSON.",
          response.status
        );
      }
    } catch (error) {
      if (error instanceof AssistantModelAdapterError) throw error;
      throw new AssistantModelAdapterError("provider_failed", "Model provider request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function extractOpenAITextOutput(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined;
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks: string[] = [];
  if (Array.isArray(response.output)) {
    for (const outputItem of response.output) {
      if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) continue;
      for (const contentItem of outputItem.content) {
        if (!isRecord(contentItem)) continue;
        if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
          chunks.push(contentItem.text);
        }
      }
    }
  }

  const text = chunks.join("\n").trim();
  return text ? text : undefined;
}

export function parseModelSummaryRefinement(text: string): AssistantRequestSummaryRefinement {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new AssistantModelAdapterError("invalid_model_output", "Model output was not JSON.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AssistantModelAdapterError("invalid_model_output", "Model output JSON was invalid.");
  }

  if (!isRecord(parsed)) {
    throw new AssistantModelAdapterError("invalid_model_output", "Model output was not an object.");
  }

  const problem = sanitizeModelOutputText(parsed.problem, maxSummaryFieldCharacters);
  const nextAction = sanitizeModelOutputText(parsed.nextAction, maxSummaryFieldCharacters);
  if (!problem || !nextAction) {
    throw new AssistantModelAdapterError(
      "invalid_model_output",
      "Model output was missing required fields."
    );
  }

  return { nextAction, problem };
}

function createResult({
  context,
  fallbackReason,
  mode,
  provider,
  requestId,
  suggestion,
  workspaceId
}: {
  context?: AssistantPromptContext;
  fallbackReason?: AssistantFallbackReason;
  mode: AssistantModelMode;
  provider: AssistantModelProvider;
  requestId: string;
  suggestion: AssistantTriageSuggestion;
  workspaceId: string;
}): AssistantTriageResult {
  return {
    model: {
      context: {
        includedSections: context?.includedSections ?? [],
        ...(context ? { promptCharacters: context.promptCharacters } : {}),
        redactionCount: context?.redactionCount ?? 0
      },
      externalUsed: mode === "model",
      ...(mode !== "model" && fallbackReason ? { fallbackReason } : {}),
      mode,
      provider
    },
    requestId,
    status: "suggested",
    suggestion,
    workspaceId
  };
}

function sanitizeRoadmapItem(
  item: RoadmapItem,
  sanitize: (value: string, maxLength: number) => string
) {
  return {
    confidence: item.confidence,
    id: sanitize(item.id, 120),
    isStale: item.isStale,
    lane: item.lane,
    title: sanitize(item.title, 180),
    visibility: item.visibility
  };
}

function sanitizeWorkItem(
  item: WorkItem,
  sanitize: (value: string, maxLength: number) => string
) {
  return {
    id: sanitize(item.id, 120),
    owner: item.owner,
    status: item.status,
    targetDate: sanitize(item.targetDate, 80),
    title: sanitize(item.title, 180)
  };
}

function sanitizeChangelogItem(
  item: ChangelogItem,
  sanitize: (value: string, maxLength: number) => string
) {
  return {
    id: sanitize(item.id, 120),
    sourceType: item.sourceType,
    state: item.state,
    title: sanitize(item.title, 180),
    visibility: item.visibility
  };
}

function countCommentsByVisibility(request: RequestItem) {
  return request.comments.reduce(
    (counts, comment) => ({
      ...counts,
      [comment.visibility]: counts[comment.visibility] + 1
    }),
    { Hidden: 0, Internal: 0, Public: 0 }
  );
}

function sanitizeContextText(
  value: string,
  maxLength: number,
  redaction: { count: number },
  options: { redactIdentity: boolean }
) {
  const bounded = limitText(value, maxLength);
  const result = redactSensitiveText(bounded, options.redactIdentity);
  redaction.count += result.redactions;
  return limitText(result.text, maxLength);
}

function redactRequester(value: string, redaction: { count: number }) {
  if (value.trim()) redaction.count += 1;
  return "[redacted requester]";
}

function sanitizeModelOutputText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const bounded = limitText(value.trim(), maxLength);
  if (!bounded) return undefined;
  const redacted = redactSensitiveText(bounded, false).text;
  return redacted ? limitText(redacted, maxLength) : undefined;
}

function redactSensitiveText(value: string, redactIdentity: boolean) {
  let text = value;
  let redactions = 0;
  const apply = (pattern: RegExp, replacement: string) => {
    const next = text.replace(pattern, replacement);
    if (next !== text) redactions += 1;
    text = next;
  };

  apply(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  apply(
    /([?&](?:api[_-]?key|access_token|refresh_token|token|jwt|secret|client_secret|authorization|password)=)[^&\s]+/gi,
    "$1[redacted]"
  );
  apply(
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|authorization|credential)\s*[:=]\s*)[^\s,;]+/gi,
    "$1[redacted]"
  );
  apply(
    /\b[\w.-]*(?:api[_-]?key|token|secret|password|credential|authorization)[\w.-]*\b/gi,
    "[redacted]"
  );
  if (redactIdentity) {
    apply(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]");
  }

  return { redactions, text };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return trimmed.slice(start, end + 1);
}

function createResponsesUrl(baseUrl: string) {
  return new URL("responses", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function parseProviderBaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    const hostname = url.hostname.toLowerCase();
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";

    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
      return undefined;
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minValue: number,
  maxValue: number
) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxValue, Math.max(minValue, parsed));
}

function flattenRoadmap(roadmap: Workspace["roadmap"]) {
  return roadmapLanes.flatMap((lane) => roadmap[lane]);
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trim()}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
