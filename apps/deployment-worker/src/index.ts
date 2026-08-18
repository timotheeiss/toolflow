import { serve } from "@hono/node-server";
import { createDeploymentApplication } from "./bootstrap.js";

const app = createDeploymentApplication();
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3006) });
const shutdown = () => server.close();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
