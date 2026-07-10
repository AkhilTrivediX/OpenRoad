import { parseLinearIssuePayload, type LinearIssue } from "../src/integrations/linear.js";

export type LinearApiConfig = {
  apiUrl: string;
};

export type LinearApiCredential = {
  accessToken: string;
  authorizationMode?: "api-key" | "bearer";
};

export type LinearIssueGetOptions = {
  credential: LinearApiCredential;
  issueId: string;
};

export type LinearIssueUpdateOptions = LinearIssueGetOptions & {
  description: string;
  title: string;
};

export type LinearApiClient = {
  getIssue(options: LinearIssueGetOptions): Promise<LinearIssue>;
  updateIssue(options: LinearIssueUpdateOptions): Promise<void>;
};

export class LinearApiClientError extends Error {
  constructor(
    readonly code: "graphql_error" | "invalid_response" | "linear_api_error" | "not_found",
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

const linearIssueQuery = `
  query OpenRoadLinearIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      priority
      updatedAt
      state {
        id
        name
        type
      }
      team {
        id
        key
        name
      }
      assignee {
        displayName
        name
        email
      }
      creator {
        displayName
        name
        email
      }
      labels {
        nodes {
          name
        }
      }
      project {
        name
      }
    }
  }
`;

const linearIssueUpdateMutation = `
  mutation OpenRoadLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
    }
  }
`;

export class FetchLinearApiClient implements LinearApiClient {
  constructor(
    private readonly config: LinearApiConfig = linearApiConfigFromEnv(),
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getIssue(options: LinearIssueGetOptions) {
    const payload = await this.postGraphQL({
      credential: options.credential,
      query: linearIssueQuery,
      variables: {
        id: options.issueId
      }
    });
    const issue = getLinearIssueFromGraphQLPayload(payload);

    if (!issue) {
      throw new LinearApiClientError("not_found", "Linear issue was not found.", 404);
    }

    try {
      return parseLinearIssuePayload(issue);
    } catch {
      throw new LinearApiClientError("invalid_response", "Linear issue response was invalid.");
    }
  }

  async updateIssue(options: LinearIssueUpdateOptions) {
    const payload = await this.postGraphQL({
      credential: options.credential,
      query: linearIssueUpdateMutation,
      variables: {
        id: options.issueId,
        input: {
          description: options.description,
          title: options.title
        }
      }
    });
    const result = isRecord(payload.data) ? payload.data.issueUpdate : undefined;

    if (!isRecord(result) || result.success !== true) {
      throw new LinearApiClientError("invalid_response", "Linear issue update response was invalid.");
    }
  }

  private async postGraphQL({
    credential,
    query,
    variables
  }: {
    credential: LinearApiCredential;
    query: string;
    variables: Record<string, unknown>;
  }) {
    let response: Response;

    try {
      response = await this.fetchImpl(this.config.apiUrl, {
        body: JSON.stringify({ query, variables }),
        headers: {
          Authorization: createAuthorizationHeader(credential),
          "Content-Type": "application/json"
        },
        method: "POST"
      });
    } catch {
      throw new LinearApiClientError("linear_api_error", "Linear API request failed before response.");
    }

    if (!response.ok) {
      throw new LinearApiClientError(
        "linear_api_error",
        `Linear API request failed with status ${response.status}.`,
        response.status
      );
    }

    const payload = await readJson(response);
    if (!isRecord(payload)) {
      throw new LinearApiClientError("invalid_response", "Linear API response was invalid.");
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new LinearApiClientError("graphql_error", "Linear GraphQL request returned errors.");
    }

    return payload;
  }
}

export function linearApiConfigFromEnv(env = process.env): LinearApiConfig {
  return {
    apiUrl: normalizeUrl(env.OPENROAD_LINEAR_API_URL ?? "https://api.linear.app/graphql")
  };
}

function createAuthorizationHeader(credential: LinearApiCredential) {
  return credential.authorizationMode === "api-key"
    ? credential.accessToken
    : `Bearer ${credential.accessToken}`;
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new LinearApiClientError("invalid_response", "Linear API response was not valid JSON.");
  }
}

function getLinearIssueFromGraphQLPayload(value: unknown) {
  if (!isRecord(value)) {
    throw new LinearApiClientError("invalid_response", "Linear API response was invalid.");
  }

  if (Array.isArray(value.errors) && value.errors.length > 0) {
    throw new LinearApiClientError("graphql_error", "Linear GraphQL request returned errors.");
  }

  if (!isRecord(value.data)) {
    throw new LinearApiClientError("invalid_response", "Linear API response data was invalid.");
  }

  return isRecord(value.data.issue) ? value.data.issue : undefined;
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "") || "https://api.linear.app/graphql";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
