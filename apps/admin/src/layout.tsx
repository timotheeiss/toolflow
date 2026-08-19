import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon, type IconName } from "./icons.js";

const navigation = [
  { to: "/", label: "Overview", icon: "overview" },
  { to: "/apps", label: "Apps", icon: "apps" },
  { to: "/users", label: "Users", icon: "users" },
  { to: "/connections", label: "Data", icon: "data" },
  { to: "/activity", label: "Activity", icon: "activity" },
  { to: "/settings", label: "Settings", icon: "settings" },
] satisfies Array<{ to: string; label: string; icon: IconName }>;

export function AppLayout() {
  const location = useLocation();
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
          {navigation.map(({ to, label, icon }) => (
            <NavLink
              className={({ isActive }) =>
                isActive || (to === "/connections" && location.pathname.startsWith("/catalog"))
                  ? "active"
                  : undefined
              }
              key={to}
              end={to === "/"}
              to={to}
            >
              <Icon name={icon} />
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
