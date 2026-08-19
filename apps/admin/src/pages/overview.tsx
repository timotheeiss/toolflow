import { useCallback } from "react";
import { controlApi } from "../api.js";
import { ErrorState, LoadingState, PageHeader } from "../components.js";
import { useAsync } from "../hooks.js";

export function OverviewPage() {
  const load = useCallback(() => controlApi.getMe(), []);
  const state = useAsync(load);
  const metrics = useAsync(useCallback(() => controlApi.getOverview(), []));

  return (
    <>
      <PageHeader
        title="Overview"
        description="A simple view of your apps, people, and data connections."
      />
      {state.status === "loading" ? <LoadingState label="Loading organization" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {state.status === "success" ? (
        <div className="overview-grid">
          <section className="hero-card">
            <div className="eyebrow">Workspace status</div>
            <h2>Everything is connected.</h2>
            <p>
              You are signed in as an <strong>{state.data.principal.role}</strong>. Toolflow is ready
              to manage this organization’s internal apps.
            </p>
          </section>
          <section className="metric-card">
            <span>Production apps</span>
            <strong>
              {metrics.status === "success" ? metrics.data.metrics.productionApps : "—"}
            </strong>
            <small>Currently published</small>
          </section>
          <section className="metric-card">
            <span>Apps requiring attention</span>
            <strong>
              {metrics.status === "success" ? metrics.data.metrics.appsRequiringAttention : "—"}
            </strong>
            <small>Disabled or missing an owner</small>
          </section>
          <section className="metric-card">
            <span>Active connections</span>
            <strong>
              {metrics.status === "success" ? metrics.data.metrics.activeConnections : "—"}
            </strong>
            <small>Read-only data sources</small>
          </section>
        </div>
      ) : null}
    </>
  );
}
