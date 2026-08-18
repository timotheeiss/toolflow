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
        eyebrow="Control plane"
        title="Organization overview"
        description="See what is deployed, what needs attention, and which controls protect your internal tooling."
      />
      {state.status === "loading" ? <LoadingState label="Loading organization" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {state.status === "success" ? (
        <div className="overview-grid">
          <section className="hero-card">
            <div className="eyebrow">Signed in</div>
            <h2>Your Toolflow control plane is connected.</h2>
            <p>
              Requests are scoped to organization <code>{state.data.principal.organizationId}</code>{" "}
              and evaluated with the <strong>{state.data.principal.role}</strong> role.
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
