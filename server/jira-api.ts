import {
  parseJiraIssuePayload,
  scopeJiraIssueToCloudId,
  type JiraIssue
} from "../src/integrations/jira.js";

export type JiraApiConfig = {
  apiBaseUrl: string;
};

export type JiraApiCredential = {
  accessToken: string;
};

export type JiraIssueGetOptions = {
  cloudId: string;
  credential: JiraApiCredential;
  issueIdOrKey: string;
};

export type JiraIssueUpdateOptions = JiraIssueGetOptions & {
  description: string;
  title: string;
};

export type JiraApiClient = {
  getIssue(options: JiraIssueGetOptions): Promise<JiraIssue>;
  updateIssue(options: JiraIssueUpdateOptions): Promise<void>;
};

export class JiraApiClientError extends Error {
  constructor(
    readonly code: "invalid_response" | "jira_api_error" | "not_found",
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

const jiraIssueFields = [
  "summary",
  "description",
  "status",
  "project",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "updated"
];

export class FetchJiraApiClient implements JiraApiClient {
  constructor(
    private readonly config: JiraApiConfig = jiraApiConfigFromEnv(),
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getIssue(options: JiraIssueGetOptions) {
    let response: Response;

    try {
      response = await this.fetchImpl(createIssueUrl(this.config, options), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${options.credential.accessToken}`
        },
        method: "GET"
      });
    } catch {
      throw new JiraApiClientError("jira_api_error", "Jira API request failed before response.");
    }

    if (response.status === 404) {
      throw new JiraApiClientError("not_found", "Jira issue was not found.", 404);
    }

    if (!response.ok) {
      throw new JiraApiClientError(
        "jira_api_error",
        `Jira API request failed with status ${response.status}.`,
        response.status
      );
    }

    const payload = await readJson(response);

    try {
      return scopeJiraIssueToCloudId(parseJiraIssuePayload(payload), options.cloudId);
    } catch {
      throw new JiraApiClientError("invalid_response", "Jira issue response was invalid.");
    }
  }

  async updateIssue(options: JiraIssueUpdateOptions) {
    let response: Response;

    try {
      response = await this.fetchImpl(createIssueUpdateUrl(this.config, options), {
        body: JSON.stringify({
          fields: {
            description: createAdfDocument(options.description),
            summary: options.title
          }
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${options.credential.accessToken}`,
          "Content-Type": "application/json"
        },
        method: "PUT"
      });
    } catch {
      throw new JiraApiClientError("jira_api_error", "Jira API request failed before response.");
    }

    if (response.status === 404) {
      throw new JiraApiClientError("not_found", "Jira issue was not found.", 404);
    }

    if (!response.ok) {
      throw new JiraApiClientError(
        "jira_api_error",
        `Jira issue update failed with status ${response.status}.`,
        response.status
      );
    }
  }
}

export function jiraApiConfigFromEnv(env = process.env): JiraApiConfig {
  return {
    apiBaseUrl: normalizeBaseUrl(env.OPENROAD_JIRA_API_BASE_URL ?? "https://api.atlassian.com/ex/jira")
  };
}

function createIssueUrl(config: JiraApiConfig, options: JiraIssueGetOptions) {
  const url = new URL(
    `${encodeURIComponent(options.cloudId)}/rest/api/2/issue/${encodeURIComponent(options.issueIdOrKey)}`,
    `${config.apiBaseUrl}/`
  );
  url.searchParams.set("fields", jiraIssueFields.join(","));
  url.searchParams.set("fieldsByKeys", "false");
  return url;
}

function createIssueUpdateUrl(config: JiraApiConfig, options: JiraIssueUpdateOptions) {
  return new URL(
    `${encodeURIComponent(options.cloudId)}/rest/api/3/issue/${encodeURIComponent(options.issueIdOrKey)}`,
    `${config.apiBaseUrl}/`
  );
}

function createAdfDocument(value: string) {
  const paragraphs = value
    .split(/\r?\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 20);

  return {
    content: (paragraphs.length ? paragraphs : [""]).map((paragraph) => ({
      content: paragraph
        ? [
            {
              text: paragraph,
              type: "text"
            }
          ]
        : [],
      type: "paragraph"
    })),
    type: "doc",
    version: 1
  };
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new JiraApiClientError("invalid_response", "Jira API response was not valid JSON.");
  }
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "") || "https://api.atlassian.com/ex/jira";
}
