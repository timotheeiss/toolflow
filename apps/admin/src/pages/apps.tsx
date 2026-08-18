import type { AdminAppSummary, AppActivity } from "@toolflow/contracts";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { controlApi } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PaginationControls,
  StatusBadge,
} from "../components.js";
import { toError, useAsync } from "../hooks.js";

export function AppsPage() {
  const state = useAsync(useCallback(() => controlApi.listApps(), []));
  const [error, setError] = useState<Error | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activity, setActivity] = useState<AppActivity | null>(null);
  const [offset, setOffset] = useState(0);
  const pageSize = 10;

  async function loadActivity(appId: string) {
    setBusyId(appId);
    setError(null);
    try {
      setActivity((await controlApi.getAppActivity(appId)).activity);
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function changeState(app: AdminAppSummary) {
    const disabled = app.lifecycle !== "disabled";
    const reason = window.prompt(
      `${disabled ? "Disable" : "Re-enable"} ${app.name}. Enter a reason:`,
    );
    if (!reason) return;
    const confirmationName = window.prompt(`Type ${app.name} to confirm:`);
    if (!confirmationName) return;
    setBusyId(app.id);
    setError(null);
    try {
      await controlApi.setAppState(app.id, { disabled, reason, confirmationName });
      state.reload();
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Registry"
        title="Apps"
        description="See every internal tool, its owner, lifecycle, deployment, and health."
      />
      {error ? (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}
      {state.status === "loading" ? <LoadingState label="Loading apps" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {state.status === "success" && state.data.apps.length === 0 ? (
        <EmptyState title="No apps yet" description="Apps created through MCP will appear here." />
      ) : null}
      {state.status === "success" && state.data.apps.length > 0 ? (
        <>
          {activity ? (
            <section className="settings-card" aria-live="polite">
              <div className="entity-heading">
                <div>
                  <div className="eyebrow">Last {activity.window}</div>
                  <h2>App activity</h2>
                </div>
                <button className="text-button" type="button" onClick={() => setActivity(null)}>
                  Close
                </button>
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>Requests</dt>
                  <dd>{activity.requestCount}</dd>
                </div>
                <div>
                  <dt>Active members</dt>
                  <dd>{activity.uniqueActiveMembers}</dd>
                </div>
                <div>
                  <dt>Error rate</dt>
                  <dd>{(activity.errorRate * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Average latency</dt>
                  <dd>{Math.round(activity.averageLatencyMs)} ms</dd>
                </div>
                <div>
                  <dt>External queries</dt>
                  <dd>{activity.externalQueryCount}</dd>
                </div>
                <div>
                  <dt>Managed writes</dt>
                  <dd>{activity.managedWriteCount}</dd>
                </div>
              </dl>
            </section>
          ) : null}
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Owner</th>
                  <th>Lifecycle</th>
                  <th>Version</th>
                  <th>Last deployment</th>
                  <th>Last activity</th>
                  <th>Members</th>
                  <th>Health</th>
                  <th>Control</th>
                </tr>
              </thead>
              <tbody>
                {state.data.apps.slice(offset, offset + pageSize).map((app) => (
                  <tr key={app.id}>
                    <td>
                      <strong>
                        <Link className="entity-link" to={`/apps/${app.id}`}>
                          {app.name}
                        </Link>
                      </strong>
                      <span>{app.description || app.slug}</span>
                    </td>
                    <td>{app.ownerNames.join(", ")}</td>
                    <td>
                      <StatusBadge value={app.lifecycle} />
                    </td>
                    <td className="mono-small">{app.activeVersion?.slice(0, 8) ?? "—"}</td>
                    <td>
                      {app.lastDeploymentAt ? new Date(app.lastDeploymentAt).toLocaleString() : "—"}
                    </td>
                    <td>
                      {app.lastActivityAt ? new Date(app.lastActivityAt).toLocaleString() : "—"}
                    </td>
                    <td>{app.memberCount}</td>
                    <td>
                      <StatusBadge value={app.health} />
                    </td>
                    <td>
                      <Link
                        aria-label={`View details for ${app.name}`}
                        className="text-button"
                        to={`/apps/${app.id}`}
                      >
                        Details
                      </Link>{" "}
                      <button
                        aria-label={`View activity for ${app.name}`}
                        className="text-button"
                        disabled={busyId === app.id}
                        type="button"
                        onClick={() => void loadActivity(app.id)}
                      >
                        Activity
                      </button>{" "}
                      <button
                        aria-label={`${app.lifecycle === "disabled" ? "Re-enable" : "Disable"} ${app.name}`}
                        className={`text-button ${app.lifecycle === "disabled" ? "" : "danger"}`}
                        disabled={busyId === app.id}
                        type="button"
                        onClick={() => void changeState(app)}
                      >
                        {app.lifecycle === "disabled" ? "Re-enable" : "Disable"}
                      </button>
                    </td>
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
