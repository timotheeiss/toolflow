import { serve } from "@hono/node-server";
import { createMcpApplication } from "./bootstrap.js";

const { app, close } = createMcpApplication();
const server = serve({ fetch: (request) => app.fetch(request), port: Number(process.env.PORT ?? 3001) });

async function shutdown() {
  server.close();
  await close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
