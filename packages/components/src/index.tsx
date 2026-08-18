import type { ReactNode } from "react";

export interface ToolflowShellProps {
  title: string;
  children: ReactNode;
}

export function ToolflowShell({ title, children }: ToolflowShellProps) {
  return (
    <div className="tf-shell">
      <header className="tf-header">
        <span className="tf-mark" aria-hidden="true">
          T
        </span>
        <strong>{title}</strong>
      </header>
      <main className="tf-main">{children}</main>
    </div>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="tf-table-wrap">
      <table className="tf-table">{children}</table>
    </div>
  );
}

export function Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="tf-button" {...props}>
      {children}
    </button>
  );
}
