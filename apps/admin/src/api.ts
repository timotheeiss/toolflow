import type {
  AdminAppSummary,
  AdminAppDetail,
  AppActivity,
  AppStateInput,
  AuditEventView,
  CatalogObject,
  CatalogRefreshInput,
  CatalogRefreshResult,
  ConnectionStateInput,
  ConnectionTestResult,
  DataConnection,
  InviteUserInput,
  OrganizationBranding,
  OrganizationUser,
  OverviewMetrics,
  PostgresConnectionInput,
  UpdateBrandingInput,
  UpdateCatalogObjectInput,
  UpdateMembershipInput,
  UpdatePostgresConnectionInput,
} from "@toolflow/contracts";

const apiUrl = import.meta.env.VITE_CONTROL_API_URL ?? "http://localhost:3000";
let csrfToken: string | null = null;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function developmentHeaders(): Record<string, string> {
  if (import.meta.env.VITE_DEV_AUTH !== "true") return {};
  return {
    "x-toolflow-dev-user-id":
      import.meta.env.VITE_DEV_USER_ID ?? "00000000-0000-4000-8000-000000000001",
    "x-toolflow-dev-membership-id":
      import.meta.env.VITE_DEV_MEMBERSHIP_ID ?? "00000000-0000-4000-8000-000000000002",
    "x-toolflow-dev-organization-id":
      import.meta.env.VITE_DEV_ORGANIZATION_ID ?? "00000000-0000-4000-8000-000000000003",
    "x-toolflow-dev-role": import.meta.env.VITE_DEV_ROLE ?? "admin",
  };
}

function redirectToLogin(response: Response): void {
  if (response.status === 401 && import.meta.env.VITE_DEV_AUTH !== "true") {
    window.location.assign(`${apiUrl}/auth/login`);
  }
}

async function csrfHeaders(method = "GET"): Promise<Record<string, string>> {
  if (
    import.meta.env.VITE_DEV_AUTH === "true" ||
    method === "GET" ||
    method === "HEAD" ||
    method === "OPTIONS"
  ) {
    return {};
  }
  if (!csrfToken) {
    const response = await fetch(`${apiUrl}/v1/csrf`, {
      credentials: "include",
      headers: { accept: "application/json", ...developmentHeaders() },
    });
    redirectToLogin(response);
    const payload = (await response.json()) as { token?: string; message?: string };
    if (!response.ok || !payload.token) {
      throw new ApiError(response.status, payload.message ?? "CSRF initialization failed.");
    }
    csrfToken = payload.token;
  }
  return { "x-toolflow-csrf": csrfToken };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const csrf = await csrfHeaders(init?.method ?? "GET");
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...developmentHeaders(),
      ...csrf,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  redirectToLogin(response);
  const payload = (response.status === 204 ? undefined : await response.json()) as
    ({ message?: string } & T) | undefined;
  if (!response.ok) throw new ApiError(response.status, payload?.message ?? "Request failed.");
  return payload as T;
}

async function requestText(path: string): Promise<string> {
  const response = await fetch(`${apiUrl}${path}`, {
    credentials: "include",
    headers: { accept: "text/csv", ...developmentHeaders() },
  });
  redirectToLogin(response);
  if (!response.ok) {
    const payload = (await response.json()) as { message?: string };
    throw new ApiError(response.status, payload.message ?? "Request failed.");
  }
  return response.text();
}

export const controlApi = {
  getMe: () =>
    request<{
      principal: {
        userId: string;
        membershipId: string;
        organizationId: string;
        role: "admin" | "builder" | "member";
      };
    }>("/v1/me"),
  getOverview: () => request<{ metrics: OverviewMetrics }>("/v1/overview"),
  listUsers: () => request<{ users: OrganizationUser[] }>("/v1/users"),
  inviteUser: (input: InviteUserInput) =>
    request<{ user: OrganizationUser }>("/v1/users", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMembership: (membershipId: string, input: UpdateMembershipInput) =>
    request<{ user: OrganizationUser }>(`/v1/users/${membershipId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  getBranding: () => request<{ branding: OrganizationBranding }>("/v1/branding"),
  updateBranding: (input: UpdateBrandingInput) =>
    request<{ branding: OrganizationBranding }>("/v1/branding", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  uploadLogo: async (file: File) => {
    const csrf = await csrfHeaders("POST");
    const response = await fetch(`${apiUrl}/v1/branding/logo`, {
      method: "POST",
      credentials: "include",
      headers: { ...developmentHeaders(), ...csrf, "content-type": file.type },
      body: file,
    });
    redirectToLogin(response);
    const payload = (await response.json()) as {
      branding?: OrganizationBranding;
      message?: string;
    };
    if (!response.ok || !payload.branding) {
      throw new ApiError(response.status, payload.message ?? "Logo upload failed.");
    }
    return { branding: payload.branding };
  },
  listApps: () => request<{ apps: AdminAppSummary[] }>("/v1/apps"),
  getApp: (appId: string) => request<{ app: AdminAppDetail }>(`/v1/apps/${appId}`),
  getAppActivity: (
    appId: string,
    window: "24h" | "7d" | "30d" = "7d",
    environment?: "preview" | "production",
  ) => {
    const query = new URLSearchParams({ window });
    if (environment) query.set("environment", environment);
    return request<{ activity: AppActivity }>(`/v1/apps/${appId}/activity?${query}`);
  },
  setAppState: (appId: string, input: AppStateInput) =>
    request<{ app: AdminAppSummary }>(`/v1/apps/${appId}/state`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  listConnections: () => request<{ connections: DataConnection[] }>("/v1/connections"),
  createConnection: (input: PostgresConnectionInput) =>
    request<{ connection: DataConnection }>("/v1/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateConnection: (connectionId: string, input: UpdatePostgresConnectionInput) =>
    request<{ connection: DataConnection }>(`/v1/connections/${connectionId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  testConnection: (connectionId: string) =>
    request<{ result: ConnectionTestResult }>(`/v1/connections/${connectionId}/test`, {
      method: "POST",
    }),
  setConnectionState: (connectionId: string, input: ConnectionStateInput) =>
    request<{ connection: DataConnection }>(`/v1/connections/${connectionId}/state`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  removeConnection: (connectionId: string) =>
    request<void>(`/v1/connections/${connectionId}`, { method: "DELETE" }),
  listCatalog: () => request<{ objects: CatalogObject[] }>("/v1/catalog"),
  refreshCatalog: (connectionId: string, input: CatalogRefreshInput) =>
    request<{ result: CatalogRefreshResult }>(`/v1/connections/${connectionId}/catalog-refresh`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCatalogObject: (objectId: string, input: UpdateCatalogObjectInput) =>
    request<{ object: CatalogObject }>(`/v1/catalog/${objectId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  listAudit: (query = "") =>
    request<{
      events: AuditEventView[];
      pagination: { limit: number; offset: number };
    }>(`/v1/audit${query ? `?${query}` : ""}`),
  exportAudit: (query = "") => requestText(`/v1/audit/export.csv${query ? `?${query}` : ""}`),
};
