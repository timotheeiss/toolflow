import { serve } from "@hono/node-server";
import { createRuntimeDispatcherApplication } from "./bootstrap.js";

const { app, close } = createRuntimeDispatcherApplication();
const server = serve({ fetch: (request) => app.fetch(request), port: Number(process.env.PORT ?? 3004) });

async function shutdown() {
  server.close();
  await close();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
