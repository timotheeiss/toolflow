import { NavLink } from "react-router-dom";

export function DataTabs() {
  return (
    <nav aria-label="Data sections" className="route-tabs">
      <NavLink end to="/connections">
        Connections
      </NavLink>
      <NavLink to="/catalog">Semantic layer</NavLink>
    </nav>
  );
}
