import type { PostgresConnectionInput } from "@toolflow/contracts";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { controlApi } from "../api.js";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../components.js";
import { formString, toError, useAsync, useModalDialog } from "../hooks.js";

export function ConnectionsPage() {
  const state = useAsync(useCallback(() => controlApi.listConnections(), []));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const connectionDialog = useModalDialog(dialogOpen, () => setDialogOpen(false), addButton);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const approvedTables = formString(form, "approvedTables")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [schema, table] = line.split(".");
        return { schema: schema ?? "", table: table ?? "" };
      });
    const input: PostgresConnectionInput = {
      slug: formString(form, "slug"),
      name: formString(form, "name"),
      host: formString(form, "host"),
      port: Number(formString(form, "port", "5432")),
      database: formString(form, "database"),
      username: formString(form, "username"),
      password: formString(form, "password"),
      tlsMode: formString(form, "tlsMode", "verify-full") as PostgresConnectionInput["tlsMode"],
      approvedTables,
    };
    try {
      const created = await controlApi.createConnection(input);
      setDialogOpen(false);
      await controlApi.testConnection(created.connection.id);
      state.reload();
    } catch (caught) {
      setError(toError(caught));
    }
  }

  async function test(connectionId: string) {
    setBusyId(connectionId);
    setError(null);
    try {
      await controlApi.testConnection(connectionId);
      state.reload();
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(connection: { id: string; name: string; status: string }) {
    const status = connection.status === "disabled" ? "active" : "disabled";
    const reason = window.prompt(
      `${status === "disabled" ? "Disable" : "Re-enable"} ${connection.name}. Enter a reason:`,
    );
    if (!reason) return;
    const confirmationName = window.prompt(`Type ${connection.name} to confirm:`);
    if (!confirmationName) return;
    setBusyId(connection.id);
    setError(null);
    try {
      await controlApi.setConnectionState(connection.id, { status, reason, confirmationName });
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
        eyebrow="Data"
        title="Connections"
        description="Manage approved read-only sources without exposing credentials to apps."
        action={
          <button
            ref={addButton}
            className="button"
            type="button"
            onClick={() => setDialogOpen(true)}
          >
            Add connection
          </button>
        }
      />
      {error ? (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}
      {state.status === "loading" ? <LoadingState label="Loading connections" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {state.status === "success" && state.data.connections.length === 0 ? (
        <EmptyState
          title="No connections"
          description="Add a PostgreSQL source with a dedicated read-only role."
        />
      ) : null}
      {state.status === "success" && state.data.connections.length > 0 ? (
        <div className="card-list">
          {state.data.connections.map((connection) => (
            <section className="entity-card" key={connection.id}>
              <div>
                <div className="entity-heading">
                  <h2>{connection.name}</h2>
                  <StatusBadge value={connection.status} />
                </div>
                <p>
                  {connection.username}@{connection.host}:{connection.port}/{connection.database}
                </p>
                <small>
                  {connection.approvedTables.length} approved tables · TLS {connection.tlsMode}
                </small>
                {connection.lastTestResult ? (
                  <p className={connection.lastTestResult.ok ? "success-message" : "form-error"}>
                    {connection.lastTestResult.message}
                  </p>
                ) : null}
              </div>
              <div className="button-row">
                <button
                  aria-label={`Test ${connection.name}`}
                  className="button button-secondary"
                  disabled={busyId === connection.id}
                  type="button"
                  onClick={() => void test(connection.id)}
                >
                  Test
                </button>
                <button
                  aria-label={`${connection.status === "disabled" ? "Re-enable" : "Disable"} ${connection.name}`}
                  className={`button button-secondary ${connection.status === "disabled" ? "" : "danger"}`}
                  disabled={busyId === connection.id}
                  type="button"
                  onClick={() => void toggle(connection)}
                >
                  {connection.status === "disabled" ? "Re-enable" : "Disable"}
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {dialogOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setDialogOpen(false)}
        >
          <div
            ref={connectionDialog}
            className="dialog dialog-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="eyebrow">Read-only PostgreSQL</div>
            <h2 id="connection-title">Add a connection</h2>
            <form className="form-stack" onSubmit={(event) => void create(event)}>
              <div className="form-grid">
                <label>
                  Name
                  <input autoFocus name="name" required />
                </label>
                <label>
                  Slug
                  <input name="slug" pattern="[a-z0-9-]+" required />
                </label>
                <label>
                  Host
                  <input name="host" required />
                </label>
                <label>
                  Port
                  <input name="port" type="number" defaultValue="5432" required />
                </label>
                <label>
                  Database
                  <input name="database" required />
                </label>
                <label>
                  Username
                  <input name="username" required />
                </label>
                <label>
                  Password
                  <input name="password" type="password" autoComplete="new-password" required />
                </label>
                <label>
                  TLS mode
                  <select name="tlsMode" defaultValue="verify-full">
                    <option value="verify-full">Verify certificate</option>
                    <option value="require">Require (no CA verification)</option>
                    <option value="disable">Disabled (development only)</option>
                  </select>
                </label>
              </div>
              <label>
                Approved tables, one schema.table per line
                <textarea name="approvedTables" rows={5} placeholder="public.customers" required />
              </label>
              <div className="dialog-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </button>
                <button className="button" type="submit">
                  Create and test
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
