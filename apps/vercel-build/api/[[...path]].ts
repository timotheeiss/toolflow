import { createBuildRunnerApplication } from "../../build-worker/src/bootstrap.js";

export const maxDuration = 240;
const app = createBuildRunnerApplication().app;

export default function handler(request: Request): Promise<Response> {
  return app.fetch(request);
}
