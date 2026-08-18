import { serve } from "@hono/node-server";
import { createControlApiApplication } from "./bootstrap.js";

const { app, close } = createControlApiApplication();

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });

async function shutdown(): Promise<void> {
  server.close();
  await close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
