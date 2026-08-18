import { createBuildRunnerApplication } from "../../build-worker/src/bootstrap.js";

// Vercel Hobby permits functions to run for at most 60 seconds.
export const maxDuration = 60;
const app = createBuildRunnerApplication().app;

export default function handler(request: Request): Promise<Response> {
  return app.fetch(request);
}
