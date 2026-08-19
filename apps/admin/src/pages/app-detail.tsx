import type { AdminAppDetail, AdminAppSummary } from "@toolflow/contracts";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { controlApi } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricTile,
  PaginationControls,
  SectionTabs,
  StatusBadge,
  TrendChart,
} from "../components.js";
import { formString, toError, useAsync, useModalDialog } from "../hooks.js";
import { Icon } from "../icons.js";
import {
  placeholderApprovals,
  placeholderCompletionTrend,
  placeholderSessionTrend,
} from "../placeholders.js";

type AppTab = "overview" | "members" | "activity" | "data" | "releases" | "approvals";

function shortHash(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function scaledTrend(values: number[], total: number): number[] {
  const max = Math.max(...values);
  const scale = total > 0 ? total / max : 1;
  return values.map((value) => Math.max(0, Math.round(value * scale)));
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export function AppDetailPage() {
  const { appId = "" } = useParams();
  const [tab, setTab] = useState<AppTab>("overview");
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
  const [stateDialogOpen, setStateDialogOpen] = useState(false);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [memberOffset, setMemberOffset] = useState(0);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [buildOffset, setBuildOffset] = useState(0);
  const [deploymentOffset, setDeploymentOffset] = useState(0);
  const stateButton = useRef<HTMLButtonElement>(null);
  const stateDialog = useModalDialog(stateDialogOpen, () => setStateDialogOpen(false), stateButton);
  const pageSize = 10;

  const sessionTrend = useMemo(
    () =>
      state.status === "success"
        ? scaledTrend(placeholderSessionTrend, state.data.activity.requestCount)
        : placeholderSessionTrend,
    [state],
  );
  const completionTrend = useMemo(
    () =>
      state.status === "success"
        ? scaledTrend(
            placeholderCompletionTrend,
            Math.max(0, state.data.activity.requestCount * (1 - state.data.activity.errorRate)),
          )
        : placeholderCompletionTrend,
    [state],
  );

  async function submitStateChange(event: FormEvent<HTMLFormElement>, app: AdminAppSummary) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const disabled = app.lifecycle !== "disabled";
    setBusy(true);
    setError(null);
    try {
      await controlApi.setAppState(app.id, {
        disabled,
        reason:
          formString(form, "reason").trim() ||
          (disabled ? "Disabled from the admin console" : "Re-enabled from the admin console"),
        confirmationName: app.name,
      });
      setStateDialogOpen(false);
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
  const isDisabled = app.lifecycle === "disabled";

  return (
    <>
      <header className="app-detail-header">
        <div className="app-identity">
          <Link aria-label="Back to apps" className="back-link" to="/apps">
            <Icon name="arrow-left" size={18} />
          </Link>
          <span className="app-detail-mark">{app.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <div className="app-title-row">
              <h1>{app.name}</h1>
              <StatusBadge value={app.health} />
            </div>
            <p>{app.description || `Governance record for ${app.slug}.`}</p>
          </div>
        </div>
        <div className="button-row">
          {app.productionUrl ? (
            <a className="button" href={app.productionUrl} rel="noreferrer" target="_blank">
              Open production
              <Icon name="external" size={15} />
            </a>
          ) : null}
          {app.previewUrl ? (
            <a
              className={`button ${app.productionUrl ? "button-secondary" : ""}`}
              href={app.previewUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open preview
              <Icon name="external" size={15} />
            </a>
          ) : null}
          <button
            ref={stateButton}
            className="button button-secondary"
            type="button"
            onClick={() => setStateDialogOpen(true)}
          >
            {isDisabled ? "Re-enable app" : "Disable app"}
          </button>
        </div>
      </header>

      <SectionTabs
        active={tab}
        items={[
          { id: "overview", label: "Overview" },
          { id: "members", label: "Members" },
          { id: "activity", label: "Activity" },
          { id: "data", label: "Data" },
          { id: "releases", label: "Releases" },
          { id: "approvals", label: "Approvals" },
        ]}
        onChange={setTab}
      />

      {error ? (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}

      {tab === "overview" ? (
        <>
          <div className="overview-panels">
            <section className="panel current-state-panel">
              <div className="panel-heading">
                <h2>Current state</h2>
                <StatusBadge value={app.lifecycle} />
              </div>
              <dl className="state-list">
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{app.lifecycle}</dd>
                </div>
                <div>
                  <dt>Active version</dt>
                  <dd className="mono-small">{shortHash(app.activeVersion)}</dd>
                </div>
                <div>
                  <dt>Production URL</dt>
                  <dd>
                    {app.productionUrl ? (
                      <a
                        className="app-url"
                        href={app.productionUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open
                      </a>
                    ) : (
                      "Not deployed"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Preview URL</dt>
                  <dd>
                    {app.previewUrl ? (
                      <a className="app-url" href={app.previewUrl} rel="noreferrer" target="_blank">
                        Open
                      </a>
                    ) : (
                      "Not deployed"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last deployment</dt>
                  <dd>{dateTime(app.lastDeploymentAt)}</dd>
                </div>
                <div>
                  <dt>Owners</dt>
                  <dd>{app.ownerNames.length || "None"}</dd>
                </div>
              </dl>
              {app.disabledReason ? <p className="callout-danger">{app.disabledReason}</p> : null}
            </section>
            <section className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <h2>Sessions · last {state.data.activity.window}</h2>
                  <p>
                    {state.data.activity.requestCount.toLocaleString()} sessions ·{" "}
                    {state.data.activity.uniqueActiveMembers.toLocaleString()} active users
                  </p>
                </div>
                <span className="trend">↑ 8.4%</span>
              </div>
              <TrendChart compact label="Recent app sessions" values={sessionTrend} />
              <div className="chart-axis">
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Sat</span>
                <span>Sun</span>
              </div>
            </section>
          </div>
          <section className="members-preview">
            <div className="section-heading">
              <h2>Owners and members</h2>
              <button className="text-button" type="button" onClick={() => setTab("members")}>
                Manage members
              </button>
            </div>
            <MemberTable members={detail.members.slice(0, 4)} />
          </section>
        </>
      ) : null}

      {tab === "members" ? (
        <section className="panel section-panel">
          <div className="section-heading">
            <h2>Owners and members</h2>
            <span>{detail.members.length} people</span>
          </div>
          {detail.members.length === 0 ? (
            <EmptyState
              title="No app members"
              description="Grant access through the Toolflow MCP."
            />
          ) : (
            <>
              <MemberTable members={detail.members.slice(memberOffset, memberOffset + pageSize)} />
              <PaginationControls
                offset={memberOffset}
                pageSize={pageSize}
                total={detail.members.length}
                onChange={setMemberOffset}
              />
            </>
          )}
        </section>
      ) : null}

      {tab === "activity" ? (
        <>
          <div className="metrics-row metrics-row-three">
            <MetricTile
              label={`Sessions · ${state.data.activity.window}`}
              trend="↑ 8.4%"
              value={state.data.activity.requestCount.toLocaleString()}
            />
            <MetricTile
              label="Active users"
              trend="↑ 5.2%"
              value={state.data.activity.uniqueActiveMembers.toLocaleString()}
            />
            <MetricTile
              label="Sessions with errors"
              trend="↓ 0.3 pt"
              value={`${(state.data.activity.errorRate * 100).toFixed(1)}%`}
            />
          </div>
          <section className="panel activity-chart-panel">
            <div className="panel-heading">
              <div>
                <h2>Recent sessions</h2>
                <p>Daily sessions and successful completions</p>
              </div>
              <div className="chart-legend">
                <span>
                  <i /> Sessions
                </span>
                <span>
                  <i /> Completed
                </span>
              </div>
            </div>
            <div className="activity-filters">
              <select
                aria-label="Activity time window"
                value={activityWindow}
                onChange={(event) =>
                  setActivityWindow(event.currentTarget.value as typeof activityWindow)
                }
              >
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
              <select
                aria-label="Activity environment"
                value={activityEnvironment}
                onChange={(event) =>
                  setActivityEnvironment(event.currentTarget.value as typeof activityEnvironment)
                }
              >
                <option value="">All environments</option>
                <option value="preview">Preview</option>
                <option value="production">Production</option>
              </select>
            </div>
            <TrendChart
              label="App sessions and successful completions"
              secondaryValues={completionTrend}
              values={sessionTrend}
            />
            <div className="chart-axis">
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
              <span>Sun</span>
            </div>
          </section>
          {state.data.activity.recentErrors.length > 0 ? (
            <section className="panel section-panel">
              <h2>Recent errors</h2>
              <div className="table-card inset-table">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Error</th>
                      <th>Environment</th>
                      <th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.activity.recentErrors.map((recentError) => (
                      <tr key={`${recentError.requestId}-${recentError.eventType}`}>
                        <td>{dateTime(recentError.occurredAt)}</td>
                        <td>{recentError.eventType}</td>
                        <td>{recentError.environment}</td>
                        <td className="mono-small">{shortHash(recentError.requestId)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "data" ? (
        <div className="detail-stack">
          <section className="panel section-panel">
            <div className="section-heading">
              <div>
                <h2>Declared capabilities</h2>
                <p>Data access approved for this app.</p>
              </div>
            </div>
            {detail.declaredCapabilities?.capabilities.length ? (
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
            ) : (
              <p className="detail-meta">No validated capability set exists yet.</p>
            )}
          </section>
          <section className="panel section-panel">
            <div className="section-heading">
              <div>
                <h2>Managed schema</h2>
                <p>The current app-owned data model.</p>
              </div>
            </div>
            {detail.declaredSchema ? (
              <JsonBlock value={detail.declaredSchema.schema} />
            ) : (
              <p className="detail-meta">No managed schema exists yet.</p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "releases" ? (
        <div className="detail-stack">
          <ReleaseSection title="Source versions">
            {detail.sourceVersions.length ? (
              <div className="table-card">
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
                          <td className="mono-small">{shortHash(version.id)}</td>
                          <td>{version.message}</td>
                          <td>{version.fileCount}</td>
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
            ) : (
              <p>No source versions.</p>
            )}
          </ReleaseSection>
          <ReleaseSection title="Builds">
            {detail.builds.length ? (
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Build</th>
                      <th>Source</th>
                      <th>Status</th>
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
            ) : (
              <p>No builds.</p>
            )}
          </ReleaseSection>
          <ReleaseSection title="Deployments">
            {detail.deployments.length ? (
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Deployment</th>
                      <th>Environment</th>
                      <th>Status</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.deployments
                      .slice(deploymentOffset, deploymentOffset + pageSize)
                      .map((deployment) => (
                        <tr key={deployment.id}>
                          <td className="mono-small">{shortHash(deployment.id)}</td>
                          <td>{deployment.environment}</td>
                          <td>
                            <StatusBadge value={deployment.status} />
                          </td>
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
            ) : (
              <p>No deployments.</p>
            )}
          </ReleaseSection>
        </div>
      ) : null}

      {tab === "approvals" ? (
        <div className="detail-stack">
          <div className="placeholder-note">
            Approval requests are frontend placeholders until an app approvals API is available.
          </div>
          {placeholderApprovals.map((approval) => (
            <article className="approval-card" key={approval.id}>
              <div className="approval-heading">
                <div>
                  <h2>{approval.title}</h2>
                  <p>{approval.subtitle}</p>
                </div>
                <StatusBadge value={approvedIds.includes(approval.id) ? "succeeded" : "pending"} />
              </div>
              <dl className="approval-meta">
                <div>
                  <dt>Submitted by</dt>
                  <dd>{approval.submittedBy}</dd>
                </div>
                <div>
                  <dt>Validation</dt>
                  <dd>{approval.validation}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{approval.expires}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd className="mono-small">{approval.source}</dd>
                </div>
              </dl>
              <div className="approval-footer">
                <ul>
                  {approval.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
                <div className="button-row">
                  <button className="button button-secondary" type="button">
                    Reject
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => setApprovedIds((current) => [...current, approval.id])}
                  >
                    Approve
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {stateDialogOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setStateDialogOpen(false)}
        >
          <div
            ref={stateDialog}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="state-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-title-row">
              <div>
                <h2 id="state-dialog-title">
                  {isDisabled ? "Re-enable" : "Disable"} {app.name}?
                </h2>
                <p>
                  {isDisabled
                    ? "People will be able to open this app again."
                    : "People will no longer be able to open this app. Existing data and configuration will be kept."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                type="button"
                onClick={() => setStateDialogOpen(false)}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
            <form onSubmit={(event) => void submitStateChange(event, app)}>
              <label>
                Reason (optional)
                <textarea
                  autoFocus
                  name="reason"
                  rows={3}
                  placeholder="Add a note for other admins…"
                />
              </label>
              <div className="dialog-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setStateDialogOpen(false)}
                >
                  Cancel
                </button>
                <button className="button" disabled={busy} type="submit">
                  {busy ? "Saving…" : isDisabled ? "Re-enable app" : "Disable app"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MemberTable({ members }: { members: AdminAppDetail["members"] }) {
  return (
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
          {members.map((member, index) => (
            <tr key={member.membershipId}>
              <td>
                <div className="person-cell">
                  <span className={`avatar avatar-${index % 3}`}>
                    {member.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </span>
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.email}</small>
                  </span>
                </div>
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
    </div>
  );
}

function ReleaseSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="panel section-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
