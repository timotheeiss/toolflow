import type { AdminAppDetail, AdminAppSummary } from "@toolflow/contracts";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
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

function shortHash(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export function AppDetailPage() {
  const { appId = "" } = useParams();
  const [activityWindow, setActivityWindow] = useState<"24h" | "7d" | "30d">("7d");
  const [activityEnvironment, setActivityEnvironment] = useState<"" | "preview" | "production">("");
  const state = useAsync(
    useCallback(async () => {
      const [detail, activity] = await Promise.all([
        controlApi.getApp(appId),
        controlApi.getAppActivity(appId, activityWindow, activityEnvironment || undefined),
      ]);
      return { detail: detail.app, activity: activity.activity };
    }, [activityEnvironment, activityWindow, appId]),
  );
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberOffset, setMemberOffset] = useState(0);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [buildOffset, setBuildOffset] = useState(0);
  const [deploymentOffset, setDeploymentOffset] = useState(0);
  const pageSize = 10;

  async function changeState(app: AdminAppSummary) {
    const disabled = app.lifecycle !== "disabled";
    const reason = window.prompt(
      `${disabled ? "Disable" : "Re-enable"} ${app.name}. Enter a reason:`,
    );
    if (!reason) return;
    const confirmationName = window.prompt(`Type ${app.name} to confirm:`);
    if (!confirmationName) return;
    setBusy(true);
    setError(null);
    try {
      await controlApi.setAppState(app.id, { disabled, reason, confirmationName });
      state.reload();
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") return <LoadingState label="Loading app record" />;
  if (state.status === "error") return <ErrorState error={state.error} retry={state.reload} />;
  const detail: AdminAppDetail = state.data.detail;
  const app = detail.summary;

  return (
    <>
      <PageHeader
        eyebrow="App record"
        title={app.name}
        description={app.description || `Governance record for ${app.slug}.`}
        action={
          <Link className="button button-secondary" to="/apps">
            Back to apps
          </Link>
        }
      />
      {error ? (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}

      <section className="settings-card detail-section">
        <div className="entity-heading">
          <div>
            <div className="eyebrow">Current state</div>
            <h2>Overview</h2>
          </div>
          <button
            className={`button ${app.lifecycle === "disabled" ? "button-secondary" : "button-danger"}`}
            disabled={busy}
            type="button"
            onClick={() => void changeState(app)}
          >
            {app.lifecycle === "disabled" ? "Re-enable app" : "Disable app"}
          </button>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Lifecycle</dt>
            <dd>
              <StatusBadge value={app.lifecycle} />
            </dd>
          </div>
          <div>
            <dt>Health</dt>
            <dd>
              <StatusBadge value={app.health} />
            </dd>
          </div>
          <div>
            <dt>Active version</dt>
            <dd className="mono-small">{shortHash(app.activeVersion)}</dd>
          </div>
          <div>
            <dt>Last deployment</dt>
            <dd>{dateTime(app.lastDeploymentAt)}</dd>
          </div>
        </dl>
        {app.disabledReason ? (
          <p className="callout-danger">
            <strong>Disabled:</strong> {app.disabledReason}
          </p>
        ) : null}
      </section>

      <section className="settings-card detail-section">
        <div className="eyebrow">Access</div>
        <h2>Owners and members</h2>
        {detail.members.length === 0 ? (
          <EmptyState title="No app members" description="Grant access through the Toolflow MCP." />
        ) : (
          <div className="table-card inset-table">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Org role</th>
                  <th>App relationship</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.members.slice(memberOffset, memberOffset + pageSize).map((member) => (
                  <tr key={member.membershipId}>
                    <td>
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                    </td>
                    <td>{member.role}</td>
                    <td>
                      {[member.owner ? "Owner" : "", member.appAccess ? "Member" : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td>
                      <StatusBadge value={member.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationControls
              offset={memberOffset}
              pageSize={pageSize}
              total={detail.members.length}
              onChange={setMemberOffset}
            />
          </div>
        )}
      </section>

      <section className="settings-card detail-section">
        <div className="eyebrow">Last {state.data.activity.window}</div>
        <h2>Activity</h2>
        <div className="toolbar-card activity-filter" aria-label="App activity filters">
          <label>
            Time window
            <select
              value={activityWindow}
              onChange={(event) =>
                setActivityWindow(event.currentTarget.value as "24h" | "7d" | "30d")
              }
            >
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </label>
          <label>
            Environment
            <select
              value={activityEnvironment}
              onChange={(event) =>
                setActivityEnvironment(event.currentTarget.value as "" | "preview" | "production")
              }
            >
              <option value="">All environments</option>
              <option value="preview">Preview</option>
              <option value="production">Production</option>
            </select>
          </label>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Requests</dt>
            <dd>{state.data.activity.requestCount}</dd>
          </div>
          <div>
            <dt>Active members</dt>
            <dd>{state.data.activity.uniqueActiveMembers}</dd>
          </div>
          <div>
            <dt>Error rate</dt>
            <dd>{(state.data.activity.errorRate * 100).toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Average latency</dt>
            <dd>{Math.round(state.data.activity.averageLatencyMs)} ms</dd>
          </div>
          <div>
            <dt>External queries</dt>
            <dd>{state.data.activity.externalQueryCount}</dd>
          </div>
          <div>
            <dt>Managed writes</dt>
            <dd>{state.data.activity.managedWriteCount}</dd>
          </div>
          <div>
            <dt>Build outcomes</dt>
            <dd>
              {state.data.activity.buildOutcomes.succeeded} passed ·{" "}
              {state.data.activity.buildOutcomes.failed +
                state.data.activity.buildOutcomes.timedOut}{" "}
              failed
            </dd>
          </div>
          <div>
            <dt>Deployment outcomes</dt>
            <dd>
              {state.data.activity.deploymentOutcomes.succeeded} passed ·{" "}
              {state.data.activity.deploymentOutcomes.failed} failed
            </dd>
          </div>
          <div>
            <dt>Last activity</dt>
            <dd>{dateTime(state.data.activity.lastActivityAt)}</dd>
          </div>
        </dl>
        <h3>Recent errors</h3>
        {state.data.activity.recentErrors.length === 0 ? (
          <p className="detail-meta">
            No failed runtime or data requests were recorded for this selection. Telemetry may
            arrive with a short delay.
          </p>
        ) : (
          <div className="table-card inset-table">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Error</th>
                  <th>Environment</th>
                  <th>Deployment</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {state.data.activity.recentErrors.map((recentError) => (
                  <tr key={`${recentError.requestId}-${recentError.eventType}`}>
                    <td>{dateTime(recentError.occurredAt)}</td>
                    <td className="mono-small">{recentError.eventType}</td>
                    <td>{recentError.environment}</td>
                    <td className="mono-small">{shortHash(recentError.deploymentId)}</td>
                    <td>
                      <Link
                        className="entity-link mono-small"
                        to={`/activity?${new URLSearchParams({
                          appId,
                          requestId: recentError.requestId,
                        })}`}
                      >
                        {shortHash(recentError.requestId)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="settings-card detail-section">
        <div className="eyebrow">Least privilege</div>
        <h2>Declared capabilities</h2>
        {detail.declaredCapabilities ? (
          <>
            <p className="detail-meta">
              Version {shortHash(detail.declaredCapabilities.sourceVersionId)} · hash{" "}
              {shortHash(detail.declaredCapabilities.hash)}
            </p>
            {detail.declaredCapabilities.capabilities.length === 0 ? (
              <p>No data capabilities declared.</p>
            ) : (
              <ul className="capability-list">
                {detail.declaredCapabilities.capabilities.map((capability, index) => (
                  <li key={`${capability.kind}-${index}`}>
                    <strong>{capability.kind}</strong>
                    <span>
                      {"connection" in capability
                        ? `${capability.connection}.${capability.schema}.${capability.table}`
                        : capability.table}{" "}
                      · {capability.operations.join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p>No validated capability set exists yet.</p>
        )}
      </section>

      <section className="settings-card detail-section">
        <div className="eyebrow">Managed data</div>
        <h2>Declared schema</h2>
        {detail.declaredSchema ? (
          <>
            <p className="detail-meta">
              Version {shortHash(detail.declaredSchema.sourceVersionId)} · hash{" "}
              {shortHash(detail.declaredSchema.hash)}
            </p>
            <JsonBlock value={detail.declaredSchema.schema} />
          </>
        ) : (
          <p>No managed schema exists yet.</p>
        )}
      </section>

      <section className="settings-card detail-section">
        <div className="eyebrow">Immutable history</div>
        <h2>Source versions</h2>
        {detail.sourceVersions.length === 0 ? (
          <p>No source versions.</p>
        ) : (
          <div className="table-card inset-table">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Change</th>
                  <th>Files</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {detail.sourceVersions
                  .slice(sourceOffset, sourceOffset + pageSize)
                  .map((version) => (
                    <tr key={version.id}>
                      <td className="mono-small">
                        {shortHash(version.id)}
                        <span>{shortHash(version.contentHash)}</span>
                      </td>
                      <td>{version.message}</td>
                      <td>
                        {version.fileCount} · {version.sourceBytes.toLocaleString()} B
                      </td>
                      <td>{dateTime(version.createdAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <PaginationControls
              offset={sourceOffset}
              pageSize={pageSize}
              total={detail.sourceVersions.length}
              onChange={setSourceOffset}
            />
          </div>
        )}
      </section>

      <section className="settings-card detail-section">
        <div className="eyebrow">Verification</div>
        <h2>Builds</h2>
        {detail.builds.length === 0 ? (
          <p>No builds.</p>
        ) : (
          <div className="table-card inset-table">
            <table>
              <thead>
                <tr>
                  <th>Build</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Artifact</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {detail.builds.slice(buildOffset, buildOffset + pageSize).map((build) => (
                  <tr key={build.id}>
                    <td className="mono-small">{shortHash(build.id)}</td>
                    <td className="mono-small">{shortHash(build.sourceVersionId)}</td>
                    <td>
                      <StatusBadge value={build.status} />
                    </td>
                    <td className="mono-small">{shortHash(build.artifactHash)}</td>
                    <td>{dateTime(build.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationControls
              offset={buildOffset}
              pageSize={pageSize}
              total={detail.builds.length}
              onChange={setBuildOffset}
            />
          </div>
        )}
      </section>

      <section className="settings-card detail-section">
        <div className="eyebrow">Release history</div>
        <h2>Deployments</h2>
        {detail.deployments.length === 0 ? (
          <p>No deployments.</p>
        ) : (
          <div className="table-card inset-table">
            <table>
              <thead>
                <tr>
                  <th>Deployment</th>
                  <th>Environment</th>
                  <th>Status</th>
                  <th>Build</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {detail.deployments
                  .slice(deploymentOffset, deploymentOffset + pageSize)
                  .map((deployment) => (
                    <tr key={deployment.id}>
                      <td className="mono-small">
                        {shortHash(deployment.id)}
                        {deployment.active ? <span>Active</span> : null}
                      </td>
                      <td>{deployment.environment}</td>
                      <td>
                        <StatusBadge value={deployment.status} />
                      </td>
                      <td className="mono-small">{shortHash(deployment.buildId)}</td>
                      <td>{dateTime(deployment.completedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <PaginationControls
              offset={deploymentOffset}
              pageSize={pageSize}
              total={detail.deployments.length}
              onChange={setDeploymentOffset}
            />
          </div>
        )}
      </section>
    </>
  );
}
