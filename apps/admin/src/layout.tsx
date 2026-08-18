import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  ["/", "Overview"],
  ["/apps", "Apps"],
  ["/users", "Users"],
  ["/connections", "Connections"],
  ["/catalog", "Data catalog"],
  ["/activity", "Activity"],
  ["/settings", "Settings"],
] as const;

export function AppLayout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          <span>Toolflow</span>
        </div>
        <nav aria-label="Primary navigation">
          {navigation.map(([to, label]) => (
            <NavLink key={to} end={to === "/"} to={to}>
              <span className="nav-dot" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar" aria-hidden="true">
            AD
          </div>
          <div>
            <strong>Organization admin</strong>
            <span>Development workspace</span>
          </div>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
