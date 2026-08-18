import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./layout.js";
import { ActivityPage } from "./pages/activity.js";
import { AppsPage } from "./pages/apps.js";
import { AppDetailPage } from "./pages/app-detail.js";
import { CatalogPage } from "./pages/catalog.js";
import { ConnectionsPage } from "./pages/connections.js";
import { OverviewPage } from "./pages/overview.js";
import { SettingsPage } from "./pages/settings.js";
import { UsersPage } from "./pages/users.js";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "apps", element: <AppsPage /> },
      { path: "apps/:appId", element: <AppDetailPage /> },
      { path: "users", element: <UsersPage /> },
      {
        path: "connections",
        element: <ConnectionsPage />,
      },
      {
        path: "catalog",
        element: <CatalogPage />,
      },
      {
        path: "activity",
        element: <ActivityPage />,
      },
      { path: "branding", element: <SettingsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
