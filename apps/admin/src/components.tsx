import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`badge badge-${value}`}>{value.replaceAll("_", " ")}</span>;
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
