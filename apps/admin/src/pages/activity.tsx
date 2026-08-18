import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { controlApi } from "../api.js";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../components.js";
import { useAsync } from "../hooks.js";

export function ActivityPage() {
  const [searchParams] = useSearchParams();
  const [outcome, setOutcome] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [actorType, setActorType] = useState("");
  const [appId, setAppId] = useState(() => searchParams.get("appId") ?? "");
  const [requestId, setRequestId] = useState(() => searchParams.get("requestId") ?? "");
  const [target, setTarget] = useState("");
  const [environment, setEnvironment] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const filterQuery = useMemo(
    () =>
      new URLSearchParams({
        ...(outcome ? { outcome } : {}),
        ...(action ? { action } : {}),
        ...(actor ? { actor } : {}),
        ...(actorType ? { actorType } : {}),
        ...(appId ? { appId } : {}),
        ...(requestId ? { requestId } : {}),
        ...(target ? { target } : {}),
        ...(environment ? { environment } : {}),
        ...(from ? { from: new Date(from).toISOString() } : {}),
        ...(to ? { to: new Date(to).toISOString() } : {}),
      }).toString(),
    [action, actor, actorType, appId, environment, from, outcome, requestId, target, to],
  );
  const query = useMemo(
    () =>
      new URLSearchParams({
        limit: "50",
        offset: String(offset),
        ...Object.fromEntries(new URLSearchParams(filterQuery)),
      }).toString(),
    [filterQuery, offset],
  );
  const state = useAsync(useCallback(() => controlApi.listAudit(query), [query]));
  const appsState = useAsync(useCallback(() => controlApi.listApps(), []));

  function update(setter: (value: string) => void, value: string) {
    setter(value);
    setOffset(0);
  }

  async function exportCsv() {
    const csv = await controlApi.exportAudit(filterQuery);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "toolflow-audit.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <PageHeader
        eyebrow="Observability"
        title="Activity"
        description="Trace deployments, access, data operations, and administrative changes."
        action={
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void exportCsv()}
          >
            Export CSV
          </button>
        }
      />
      <section className="toolbar-card audit-toolbar">
        <label>
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => update(setFrom, event.currentTarget.value)}
          />
        </label>
        <label>
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => update(setTo, event.currentTarget.value)}
          />
        </label>
        <label>
          Actor
          <input
            value={actor}
            placeholder="Name, email, or exact ID"
            onChange={(event) => update(setActor, event.currentTarget.value)}
          />
        </label>
        <label>
          Actor type
          <input
            value={actorType}
            placeholder="user or mcp_client"
            onChange={(event) => update(setActorType, event.currentTarget.value)}
          />
        </label>
        <label>
          App
          <select value={appId} onChange={(event) => update(setAppId, event.currentTarget.value)}>
            <option value="">All apps</option>
            {appsState.status === "success"
              ? appsState.data.apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))
              : null}
          </select>
        </label>
        <label>
          Outcome
          <select
            value={outcome}
            onChange={(event) => {
              update(setOutcome, event.currentTarget.value);
            }}
          >
            <option value="">All outcomes</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="denied">Denied</option>
          </select>
        </label>
        <label>
          Environment
          <select
            value={environment}
            onChange={(event) => update(setEnvironment, event.currentTarget.value)}
          >
            <option value="">All environments</option>
            <option value="preview">Preview</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label>
          Exact action
          <input
            value={action}
            placeholder="membership.updated"
            onChange={(event) => {
              update(setAction, event.currentTarget.value);
            }}
          />
        </label>
        <label>
          Target
          <input
            value={target}
            placeholder="Type or ID"
            onChange={(event) => update(setTarget, event.currentTarget.value)}
          />
        </label>
        <label>
          Request ID
          <input
            value={requestId}
            placeholder="Exact request ID"
            onChange={(event) => update(setRequestId, event.currentTarget.value)}
          />
        </label>
      </section>
      {state.status === "loading" ? <LoadingState label="Loading activity" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {state.status === "success" && state.data.events.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Audited control-plane events will appear here."
        />
      ) : null}
      {state.status === "success" && state.data.events.length > 0 ? (
        <>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Outcome</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {state.data.events.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.occurredAt).toLocaleString()}</td>
                    <td>{event.actorName ?? event.actorType}</td>
                    <td className="mono-small">{event.action}</td>
                    <td>
                      {event.targetType}
                      <span>
                        {event.targetId.slice(0, 18)}
                        {event.environment ? ` · ${event.environment}` : ""}
                      </span>
                    </td>
                    <td>
                      <StatusBadge value={event.outcome} />
                    </td>
                    <td className="mono-small">{event.requestId.slice(0, 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination" aria-label="Audit pagination">
            <button
              className="button button-secondary"
              disabled={offset === 0}
              type="button"
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </button>
            <span>
              {offset + 1}–{offset + state.data.events.length}
            </span>
            <button
              className="button button-secondary"
              disabled={state.data.events.length < 50}
              type="button"
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
