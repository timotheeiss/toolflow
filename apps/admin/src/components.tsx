import { useId, type ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const label =
    value === "production"
      ? "Published"
      : value === "archived"
        ? "Deprecated"
        : value.replaceAll("_", " ");
  return <span className={`badge badge-${value}`}>{label}</span>;
}

export function MetricTile({
  icon,
  label,
  value,
  trend,
  muted = false,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  trend?: string;
  muted?: boolean;
}) {
  return (
    <section className="metric-tile">
      <div className="metric-label">
        <span>{label}</span>
        {icon}
      </div>
      <div className="metric-value-row">
        <strong>{value}</strong>
        {trend ? <span className={muted ? "trend trend-muted" : "trend"}>{trend}</span> : null}
      </div>
    </section>
  );
}

export function SectionTabs<T extends string>({
  active,
  items,
  onChange,
}: {
  active: T;
  items: ReadonlyArray<{ id: T; label: string; count?: number }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="section-tabs" role="tablist">
      {items.map((item) => (
        <button
          aria-selected={active === item.id}
          className={active === item.id ? "active" : undefined}
          key={item.id}
          role="tab"
          type="button"
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined ? <span>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function chartPath(values: number[], width: number, height: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 12) - 6;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function TrendChart({
  values,
  secondaryValues,
  label,
  compact = false,
}: {
  values: number[];
  secondaryValues?: number[];
  label: string;
  compact?: boolean;
}) {
  const gradientId = useId().replaceAll(":", "");
  const width = 1000;
  const height = compact ? 120 : 220;
  const primary = chartPath(values, width, height);
  const area = `${primary} L${width} ${height} L0 ${height} Z`;
  return (
    <svg
      aria-label={label}
      className={compact ? "trend-chart compact" : "trend-chart"}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3457d5" stopOpacity=".18" />
          <stop offset="100%" stopColor="#3457d5" stopOpacity="0" />
        </linearGradient>
      </defs>
      {!secondaryValues ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      {secondaryValues ? (
        <path className="trend-line secondary" d={chartPath(secondaryValues, width, height)} />
      ) : null}
      <path className="trend-line" d={primary} />
    </svg>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="state-card state-error" role="alert">
      <div>
        <strong>Something went wrong</strong>
        <p>{error.message}</p>
      </div>
      <button className="button button-secondary" type="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function PaginationControls({
  offset,
  pageSize,
  total,
  onChange,
}: {
  offset: number;
  pageSize: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="pagination" aria-label="Pagination">
      <button
        className="button button-secondary"
        disabled={offset === 0}
        type="button"
        onClick={() => onChange(Math.max(0, offset - pageSize))}
      >
        Previous
      </button>
      <span>
        {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
      </span>
      <button
        className="button button-secondary"
        disabled={offset + pageSize >= total}
        type="button"
        onClick={() => onChange(offset + pageSize)}
      >
        Next
      </button>
    </div>
  );
}

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  emptyTitle,
}: {
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState
        title={emptyTitle}
        description="This area will populate as the organization begins using Toolflow."
      />
    </>
  );
}
