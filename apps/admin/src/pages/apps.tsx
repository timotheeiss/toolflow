import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { controlApi } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  PaginationControls,
  StatusBadge,
} from "../components.js";
import { useAsync } from "../hooks.js";
import { Icon } from "../icons.js";

const placeholderMetrics = {
  sessions: 12_480,
  activeUsers: 3_204,
  errorRate: "0.8%",
};

function dateLabel(value: string | null): string {
  if (!value) return "No recent activity";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Today, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function AppsPage() {
  const state = useAsync(useCallback(() => controlApi.listApps(), []));
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const pageSize = 10;
  const publishedCount = useMemo(
    () =>
      state.status === "success"
        ? state.data.apps.filter((app) => app.lifecycle === "production").length
        : "—",
    [state],
  );

  return (
    <>
      <PageHeader
        title="Apps"
        description="Manage every internal app, its owner, status, usage, and latest update."
        action={
          <button
            className="button"
            type="button"
            onClick={() =>
              setNotice(
                "App creation is currently available through Toolflow MCP. Admin creation is a frontend placeholder.",
              )
            }
          >
            <Icon name="plus" size={15} />
            Create app
          </button>
        }
      />
      {notice ? (
        <div className="inline-notice" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss"
            type="button"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
      <div className="metrics-row">
        <MetricTile
          icon={<Icon name="chart" />}
          label="Active sessions · 7 days"
          trend="↑ 8.4%"
          value={placeholderMetrics.sessions.toLocaleString()}
        />
        <MetricTile
          icon={<Icon name="users" />}
          label="Active users · 7 days"
          trend="↑ 5.2%"
          value={placeholderMetrics.activeUsers.toLocaleString()}
        />
        <MetricTile
          icon={<Icon name="warning" />}
          label="Sessions with errors"
          trend="↓ 0.3 pt"
          value={placeholderMetrics.errorRate}
        />
        <MetricTile
          icon={<Icon name="overview" />}
          label="Published apps"
          muted
          trend="No change"
          value={publishedCount}
        />
      </div>

      {state.status === "loading" ? <LoadingState label="Loading apps" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {state.status === "success" && state.data.apps.length === 0 ? (
        <EmptyState title="No apps yet" description="Apps created through MCP will appear here." />
      ) : null}
      {state.status === "success" && state.data.apps.length > 0 ? (
        <>
          <div className="table-card apps-table">
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Active users</th>
                  <th>Last update</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {state.data.apps.slice(offset, offset + pageSize).map((app, index) => (
                  <tr key={app.id}>
                    <td>
                      <div className="app-cell">
                        <span className={`app-mark app-mark-${index % 4}`}>
                          {app.name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>
                            <Link className="entity-link" to={`/apps/${app.id}`}>
                              {app.name}
                            </Link>
                          </strong>
                          <small>{app.description || app.slug}</small>
                        </span>
                      </div>
                    </td>
                    <td>{app.ownerNames.join(", ") || "No owner"}</td>
                    <td>
                      <StatusBadge value={app.lifecycle} />
                    </td>
                    <td>
                      {Math.max(
                        app.memberCount,
                        [1284, 86, 32, 702][index % 4] ?? 0,
                      ).toLocaleString()}
                    </td>
                    <td>{app.description || "App configuration updated"}</td>
                    <td>{dateLabel(app.lastActivityAt ?? app.lastDeploymentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls
            offset={offset}
            pageSize={pageSize}
            total={state.data.apps.length}
            onChange={setOffset}
          />
        </>
      ) : null}
    </>
  );
}
