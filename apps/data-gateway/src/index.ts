import { serve } from "@hono/node-server";
import { createDataGatewayApplication } from "./bootstrap.js";

const { app, close } = createDataGatewayApplication();
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3005) });

async function shutdown() {
  server.close();
  await close();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
