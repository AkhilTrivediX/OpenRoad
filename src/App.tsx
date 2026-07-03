import {
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Command,
  Globe2,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Plus,
  RadioTower,
  Search,
  Settings,
  Waypoints
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

type NavItem = {
  label: "Inbox" | "Roadmap" | "Changelog" | "Portal" | "Settings";
  count?: number;
  icon: typeof Inbox;
};

type Workspace = {
  id: string;
  name: string;
  plan: string;
  summary: string;
  inboxCount: number;
  requests: RequestItem[];
  roadmap: Record<"Now" | "Next" | "Later", string[]>;
  changelog: ChangelogItem[];
  integrations: IntegrationChip[];
};

type RequestItem = {
  id: string;
  title: string;
  requester: string;
  source: string;
  votes: number;
  status: "New" | "Needs decision" | "Planned" | "Shipping soon";
  age: string;
};

type ChangelogItem = {
  title: string;
  state: "Draft" | "Ready";
  detail: string;
};

type IntegrationChip = {
  label: string;
  state: "Optional" | "Linked";
};

const navItems: NavItem[] = [
  { label: "Inbox", count: 23, icon: Inbox },
  { label: "Roadmap", icon: Waypoints },
  { label: "Changelog", icon: BookOpen },
  { label: "Portal", icon: Globe2 },
  { label: "Settings", icon: Settings }
];

const initialWorkspaces: Workspace[] = [
  {
    id: "acme",
    name: "Acme OSS",
    plan: "Demo workspace",
    summary: "Standalone feedback loop with optional delivery links.",
    inboxCount: 23,
    requests: [
      {
        id: "api-rate-limit-visibility",
        title: "API rate limit visibility",
        requester: "CLI user",
        source: "Portal",
        votes: 142,
        status: "Needs decision",
        age: "2h ago"
      },
      {
        id: "bulk-export-csv",
        title: "Support bulk export to CSV",
        requester: "Success team",
        source: "Email",
        votes: 97,
        status: "Planned",
        age: "5h ago"
      },
      {
        id: "dark-mode-docs",
        title: "Dark mode for docs site",
        requester: "Docs feedback",
        source: "Portal",
        votes: 89,
        status: "New",
        age: "1d ago"
      },
      {
        id: "webhook-retry-controls",
        title: "Webhook retry controls",
        requester: "Maintainer note",
        source: "Manual",
        votes: 76,
        status: "Shipping soon",
        age: "1d ago"
      }
    ],
    roadmap: {
      Now: ["API rate limit visibility", "Webhook retry controls"],
      Next: ["Bulk export to CSV", "Saved feedback views"],
      Later: ["Custom request fields", "Public roadmap RSS"]
    },
    changelog: [
      {
        title: "Inline markdown in comments",
        state: "Ready",
        detail: "Linked to 18 requesters"
      },
      {
        title: "Email digest improvements",
        state: "Draft",
        detail: "Needs public wording"
      }
    ],
    integrations: [
      { label: "GitHub", state: "Optional" },
      { label: "Jira", state: "Optional" },
      { label: "Linear", state: "Optional" }
    ]
  },
  {
    id: "maintainer",
    name: "Maintainer Lab",
    plan: "Community workspace",
    summary: "A smaller project using OpenRoad without external trackers.",
    inboxCount: 8,
    requests: [
      {
        id: "contributor-guide-checklist",
        title: "Contributor guide checklist",
        requester: "First-time contributor",
        source: "Portal",
        votes: 34,
        status: "New",
        age: "3h ago"
      },
      {
        id: "release-notes-rss",
        title: "Release notes RSS",
        requester: "Maintainer",
        source: "Manual",
        votes: 21,
        status: "Planned",
        age: "1d ago"
      },
      {
        id: "issue-template-cleanup",
        title: "Issue template cleanup",
        requester: "Community moderator",
        source: "Manual",
        votes: 19,
        status: "Needs decision",
        age: "2d ago"
      }
    ],
    roadmap: {
      Now: ["Contributor guide checklist"],
      Next: ["Release notes RSS"],
      Later: ["Issue template cleanup"]
    },
    changelog: [
      {
        title: "New maintainer queue",
        state: "Draft",
        detail: "Standalone work item"
      }
    ],
    integrations: [
      { label: "GitHub", state: "Optional" },
      { label: "Jira", state: "Optional" },
      { label: "Linear", state: "Optional" }
    ]
  }
];

function statusTone(status: RequestItem["status"] | ChangelogItem["state"]) {
  if (status === "Planned" || status === "Ready") return "success";
  if (status === "Shipping soon") return "info";
  if (status === "Needs decision" || status === "Draft") return "warning";
  return "neutral";
}

export function App() {
  const [workspaceList, setWorkspaceList] = useState(initialWorkspaces);
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaces[0].id);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isAddingRequest, setIsAddingRequest] = useState(false);
  const [newRequestTitle, setNewRequestTitle] = useState("");
  const [selectedRequestIdByWorkspace, setSelectedRequestIdByWorkspace] = useState<
    Record<string, string | undefined>
  >({});
  const workspace = useMemo(
    () => workspaceList.find((item) => item.id === workspaceId) ?? workspaceList[0],
    [workspaceId, workspaceList]
  );
  const selectedRequest = useMemo(() => {
    const selectedRequestId = selectedRequestIdByWorkspace[workspace.id];
    return (
      workspace.requests.find((request) => request.id === selectedRequestId) ??
      workspace.requests[0]
    );
  }, [selectedRequestIdByWorkspace, workspace.id, workspace.requests]);

  function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (!name) return;

    const createdWorkspace: Workspace = {
      id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      name,
      plan: "Standalone workspace",
      summary: "Ready for requests, roadmap, and changelog work.",
      inboxCount: 0,
      requests: [],
      roadmap: {
        Now: [],
        Next: [],
        Later: []
      },
      changelog: [],
      integrations: [
        { label: "GitHub", state: "Optional" },
        { label: "Jira", state: "Optional" },
        { label: "Linear", state: "Optional" }
      ]
    };

    setWorkspaceList((items) => [...items, createdWorkspace]);
    setWorkspaceId(createdWorkspace.id);
    setNewWorkspaceName("");
    setIsCreatingWorkspace(false);
    setIsAddingRequest(false);
  }

  function addRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newRequestTitle.trim();
    if (!title) return;

    const createdRequest: RequestItem = {
      id: `manual-${Date.now()}`,
      title,
      requester: "Manual capture",
      source: "Manual",
      votes: 0,
      status: "New",
      age: "just now"
    };

    setWorkspaceList((items) =>
      items.map((item) =>
        item.id === workspace.id
          ? {
              ...item,
              inboxCount: item.inboxCount + 1,
              requests: [createdRequest, ...item.requests]
            }
          : item
      )
    );
    setSelectedRequestIdByWorkspace((items) => ({
      ...items,
      [workspace.id]: createdRequest.id
    }));
    setNewRequestTitle("");
    setIsAddingRequest(false);
  }

  return (
    <main className="app-shell" aria-label="OpenRoad workspace shell">
      <aside className="route-index" aria-label="Primary navigation">
        <div className="brand" aria-label="OpenRoad">
          <span className="brand-mark" aria-hidden="true">
            <RouteGlyph />
          </span>
          <span className="brand-copy">
            <strong>OpenRoad</strong>
            <small>route room</small>
          </span>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                aria-current={item.label === "Inbox" ? "page" : undefined}
                className={item.label === "Inbox" ? "nav-item active" : "nav-item"}
                href={`#${item.label.toLowerCase()}`}
                key={item.label}
              >
                <Icon aria-hidden="true" size={17} strokeWidth={1.75} />
                <span>{item.label}</span>
                {item.count ? <strong>{workspace.inboxCount}</strong> : null}
              </a>
            );
          })}
        </nav>

        <section className="workspace-plate" aria-label="Workspace status">
          <span>{workspace.plan}</span>
          <strong>{workspace.name}</strong>
          <p>{workspace.summary}</p>
        </section>
      </aside>

      <section className="operations-deck">
        <header className="command-deck">
          <label className="workspace-switcher">
            <span className="sr-only">Workspace</span>
            <LayoutDashboard aria-hidden="true" size={16} />
            <select
              aria-label="Workspace"
              onChange={(event) => {
                setWorkspaceId(event.target.value);
                setIsAddingRequest(false);
              }}
              value={workspaceId}
            >
              {workspaceList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" size={14} />
          </label>

          <div className="command-bar" role="search">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Search requests, roadmap items, and changelog entries"
              placeholder="Search requests, roadmap, changelog..."
              type="search"
            />
            <kbd>
              <Command aria-hidden="true" size={12} />K
            </kbd>
          </div>

          <div className="top-actions">
            <button
              className="secondary-action compact"
              onClick={() => setIsCreatingWorkspace((value) => !value)}
              type="button"
            >
              New workspace
            </button>
            <button className="icon-button" aria-label="Notifications">
              <Bell aria-hidden="true" size={16} />
            </button>
            <span className="avatar" aria-label="Current user Akhil">
              AT
            </span>
          </div>
        </header>

        {isCreatingWorkspace ? (
          <form className="workspace-form" onSubmit={createWorkspace}>
            <label>
              <span>Workspace name</span>
              <input
                autoFocus
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                placeholder="e.g. Mobile Platform"
                value={newWorkspaceName}
              />
            </label>
            <button className="primary-action" type="submit">
              Create workspace
            </button>
          </form>
        ) : null}

        <section className="brief-plate" id="portal" aria-label="Standalone workflow">
          <div className="brief-copy">
            <span className="section-label">Standalone first</span>
            <h1>Turn requests into roadmap and changelog updates.</h1>
            <p>
              Start in OpenRoad today. Connect GitHub, Jira, or Linear later when
              delivery sync is useful.
            </p>
          </div>

          <div className="brief-instruments" aria-label="Workspace instruments">
            <span>
              <small>Requests</small>
              <strong>{workspace.inboxCount}</strong>
            </span>
            <span>
              <small>Mode</small>
              <strong>Standalone</strong>
            </span>
          </div>

          {isAddingRequest ? null : (
            <button
              aria-controls="request-composer"
              className="primary-action"
              onClick={() => setIsAddingRequest(true)}
              type="button"
            >
              <Plus aria-hidden="true" size={16} />
              Add request
            </button>
          )}
        </section>

        {isAddingRequest ? (
          <form
            aria-label="Add request"
            className="request-composer"
            id="request-composer"
            onSubmit={addRequest}
          >
            <label>
              <span>Request title</span>
              <input
                autoFocus
                onChange={(event) => setNewRequestTitle(event.target.value)}
                placeholder="e.g. Export customer list"
                value={newRequestTitle}
              />
            </label>
            <div className="composer-actions">
              <button className="primary-action" type="submit">
                Capture request
              </button>
              <button
                className="secondary-action"
                onClick={() => {
                  setIsAddingRequest(false);
                  setNewRequestTitle("");
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        <section className="map-board">
          <section className="panel intake-panel" id="inbox" aria-labelledby="inbox-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Inbox</span>
                <h2 id="inbox-title">Requests needing attention</h2>
              </div>
              <button className="secondary-action" type="button">
                View all
              </button>
            </div>

            <div className="route-protocol" aria-label="Activation steps">
              {[
                ["Capture request", "Add feedback from users"],
                ["Move to roadmap", "Choose what to build next"],
                ["Draft changelog", "Close the loop when shipped"]
              ].map(([title, detail], index) => (
                <span className="protocol-step" key={title}>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <strong>{title}</strong>
                  <em>{detail}</em>
                </span>
              ))}
            </div>

            {workspace.requests.length ? (
              <div className="request-list">
                {workspace.requests.map((request, index) => (
                  <button
                    aria-pressed={selectedRequest?.id === request.id}
                    className={
                      selectedRequest?.id === request.id
                        ? "request-row active"
                        : "request-row"
                    }
                    key={request.id}
                    onClick={() =>
                      setSelectedRequestIdByWorkspace((items) => ({
                        ...items,
                        [workspace.id]: request.id
                      }))
                    }
                    type="button"
                  >
                    <span className="route-node" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="request-main">
                      <strong>{request.title}</strong>
                      <small>
                        {request.requester} / {request.source} / {request.age}
                      </small>
                    </span>
                    <span className="vote-count">{request.votes}</span>
                    <span className={`status-badge ${statusTone(request.status)}`}>
                      {request.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No requests yet</strong>
                <p>Capture the first user request here. You can connect sources later.</p>
                <button
                  aria-controls="request-composer"
                  className="secondary-action"
                  onClick={() => setIsAddingRequest(true)}
                  type="button"
                >
                  Add request
                </button>
              </div>
            )}
          </section>

          <aside className="panel inspector" aria-labelledby="inspector-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Selected request</span>
                <h2 id="inspector-title">
                  {selectedRequest ? selectedRequest.title : "No request selected"}
                </h2>
              </div>
              {selectedRequest ? (
                <span className={`status-badge ${statusTone(selectedRequest.status)}`}>
                  {selectedRequest.status}
                </span>
              ) : null}
            </div>

            {selectedRequest ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>Requested by</dt>
                    <dd>{selectedRequest.requester}</dd>
                  </div>
                  <div>
                    <dt>Votes</dt>
                    <dd>{selectedRequest.votes}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{selectedRequest.source}</dd>
                  </div>
                </dl>

                <div className="inspector-block">
                  <strong>Why it matters</strong>
                  <p>
                    Users cannot tell when they are close to hitting API limits. This
                    blocks debugging and creates repeated support requests.
                  </p>
                </div>
              </>
            ) : (
              <div className="empty-state compact-empty">
                <strong>Select a request</strong>
                <p>Request details, evidence, and optional work links will appear here.</p>
              </div>
            )}

            <div className="integration-chips" id="settings" aria-label="Optional integrations">
              {workspace.integrations.map((integration) => (
                <span className="integration-chip" key={integration.label}>
                  <RadioTower aria-hidden="true" size={13} />
                  {integration.label}
                  <small>{integration.state}</small>
                </span>
              ))}
            </div>
          </aside>

          <section className="panel route-map-panel" id="roadmap" aria-labelledby="roadmap-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Roadmap preview</span>
                <h2 id="roadmap-title">Now / Next / Later</h2>
              </div>
              <a href="#roadmap">Open Roadmap</a>
            </div>
            <div className="roadmap-lanes">
              {Object.entries(workspace.roadmap).map(([lane, items]) => (
                <div className="lane" key={lane}>
                  <strong>{lane}</strong>
                  <ul>
                    {items.length ? (
                      items.map((item) => (
                        <li key={item}>
                          <CircleDot aria-hidden="true" size={12} />
                          <span>{item}</span>
                        </li>
                      ))
                    ) : (
                      <li>
                        <CircleDot aria-hidden="true" size={12} />
                        <span>Nothing placed yet</span>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="panel release-panel" id="changelog" aria-labelledby="changelog-title">
            <div className="panel-header">
              <div>
                <span className="section-label">Changelog</span>
                <h2 id="changelog-title">Draft queue</h2>
              </div>
              <a href="#changelog">Open Changelog</a>
            </div>
            <div className="changelog-list">
              {workspace.changelog.length ? (
                workspace.changelog.map((item) => (
                  <article className="changelog-item" key={item.title}>
                    <span className={`status-badge ${statusTone(item.state)}`}>
                      {item.state}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))
              ) : (
                <div className="empty-state compact-empty">
                  <strong>No changelog drafts</strong>
                  <p>Draft updates from shipped roadmap items when work starts landing.</p>
                </div>
              )}
            </div>
          </section>
        </section>
      </section>

      <div className="bottom-status" aria-label="System status">
        <span>
          <CheckCircle2 aria-hidden="true" size={14} />
          Standalone mode ready
        </span>
        <span>
          <MessageSquareText aria-hidden="true" size={14} />
          {workspace.inboxCount} {workspace.inboxCount === 1 ? "request" : "requests"}
        </span>
      </div>
    </main>
  );
}

function RouteGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 5h7a7 7 0 0 1 7 7v7" />
      <path d="M5 5v14h14" />
      <path d="M9 9h3a3 3 0 0 1 3 3v3" />
    </svg>
  );
}
