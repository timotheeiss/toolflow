import type { SVGProps } from "react";

export type IconName =
  | "activity"
  | "apps"
  | "arrow-left"
  | "chart"
  | "close"
  | "data"
  | "external"
  | "group"
  | "overview"
  | "plus"
  | "search"
  | "settings"
  | "user-plus"
  | "users"
  | "warning";

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };

  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size} {...props}>
      {name === "overview" ? (
        <>
          <rect {...common} height="7" rx="1.5" width="7" x="3" y="3" />
          <rect {...common} height="7" rx="1.5" width="7" x="14" y="3" />
          <rect {...common} height="7" rx="1.5" width="7" x="3" y="14" />
          <rect {...common} height="7" rx="1.5" width="7" x="14" y="14" />
        </>
      ) : null}
      {name === "apps" ? (
        <>
          <rect {...common} height="15" rx="2.5" width="17" x="3.5" y="4.5" />
          <path {...common} d="M7 9h10M7 13h6" />
        </>
      ) : null}
      {name === "users" ? (
        <>
          <path {...common} d="M16 20v-1.7a4.3 4.3 0 0 0-4.3-4.3H6.3A4.3 4.3 0 0 0 2 18.3V20" />
          <circle {...common} cx="9" cy="6" r="4" />
          <path {...common} d="M22 20v-1.7a4.3 4.3 0 0 0-3.2-4.15M16.1 2.15a4 4 0 0 1 0 7.7" />
        </>
      ) : null}
      {name === "data" ? (
        <>
          <ellipse {...common} cx="12" cy="5" rx="7.5" ry="3" />
          <path {...common} d="M4.5 5v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5M4.5 12v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-7" />
        </>
      ) : null}
      {name === "activity" ? (
        <>
          <circle {...common} cx="12" cy="12" r="8.5" />
          <path {...common} d="M12 7v5l3 2" />
        </>
      ) : null}
      {name === "settings" ? (
        <>
          <circle {...common} cx="12" cy="12" r="3" />
          <path {...common} d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1H9.55a1.7 1.7 0 0 0-.4-1.1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.75 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4V9.55a1.7 1.7 0 0 0 1.1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.86-2.86.06.06A1.7 1.7 0 0 0 8.15 3a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1h4.05a1.7 1.7 0 0 0 .4 1.1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.4c.12.4.33.75.6 1 .3.27.68.4 1.1.4v4.05c-.42 0-.8.13-1.1.4-.27.25-.48.6-.6 1Z" />
        </>
      ) : null}
      {name === "plus" ? <path {...common} d="M12 5v14M5 12h14" /> : null}
      {name === "search" ? (
        <>
          <circle {...common} cx="11" cy="11" r="6.5" />
          <path {...common} d="m16 16 4 4" />
        </>
      ) : null}
      {name === "external" ? <path {...common} d="M14 5h5v5M19 5l-8 8M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /> : null}
      {name === "arrow-left" ? <path {...common} d="m15 18-6-6 6-6" /> : null}
      {name === "close" ? <path {...common} d="m6 6 12 12M18 6 6 18" /> : null}
      {name === "chart" ? <path {...common} d="M4 18V8M10 18V4M16 18v-6M22 18H2" /> : null}
      {name === "warning" ? <path {...common} d="M12 9v4M12 17h.01M10.3 3.7 2.2 17.3A2 2 0 0 0 3.9 20h16.2a2 2 0 0 0 1.7-2.7L13.7 3.7a2 2 0 0 0-3.4 0Z" /> : null}
      {name === "user-plus" ? (
        <>
          <path {...common} d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle {...common} cx="8.5" cy="7" r="4" />
          <path {...common} d="M19 8v6M16 11h6" />
        </>
      ) : null}
      {name === "group" ? (
        <>
          <circle {...common} cx="9" cy="7" r="4" />
          <path {...common} d="M3 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 8v6M14 11h6" />
        </>
      ) : null}
    </svg>
  );
}
