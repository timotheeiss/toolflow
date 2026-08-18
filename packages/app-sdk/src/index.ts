import { Hono } from "hono";

export interface ToolflowIdentity {
  userId: string;
  name: string;
  email: string;
  appId: string;
  environment: "preview" | "production";
  dataPath: string;
}

declare global {
  interface Window {
    __TOOLFLOW_CONTEXT__?: ToolflowIdentity;
  }
}

export function currentIdentity(): ToolflowIdentity {
  const identity = globalThis.window?.__TOOLFLOW_CONTEXT__;
  if (!identity) throw new Error("Toolflow runtime identity is unavailable.");
  return identity;
}

async function request<T>(path: string, input: unknown): Promise<T> {
  const response = await fetch(`${currentIdentity().dataPath}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message ?? "Toolflow data request failed.");
  return payload;
}

export const toolflowData = {
  externalQuery: <T extends Record<string, unknown>>(input: {
    connection: string;
    sql: string;
    parameters: unknown[];
  }) => request<{ rows: T[]; rowCount: number }>("/external-query", input),
  create: <T extends Record<string, unknown>>(table: string, values: T) =>
    request<{ record: T }>("/managed/create", { table, values }),
  list: <T extends Record<string, unknown>>(
    table: string,
    options?: { limit?: number; offset?: number },
  ) => request<{ records: T[] }>("/managed/list", { table, ...options }),
  update: <T extends Record<string, unknown>>(table: string, id: string, values: Partial<T>) =>
    request<{ record: T }>("/managed/update", { table, id, values }),
  remove: (table: string, id: string) =>
    request<{ removed: boolean }>("/managed/delete", { table, id }),
};

export function createToolflowServer(options: { health: "/api/health" }) {
  const app = new Hono();
  app.get(options.health, (context) => context.json({ status: "ok" }));
  return app;
}
