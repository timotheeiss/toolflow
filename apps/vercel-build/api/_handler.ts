import { createBuildRunnerApplication } from "../../build-worker/src/bootstrap.js";

// Vercel Hobby permits functions to run for at most 60 seconds.
export const maxDuration = 60;
const app = createBuildRunnerApplication().app;

export function handleFetchRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const toolflowPath = url.searchParams.get("__toolflow_path");
  if (toolflowPath !== null) {
    url.pathname = `/${toolflowPath}`;
    url.searchParams.delete("__toolflow_path");
  }
  return app.fetch(new Request(url, request));
}

export default handleFetchRequest;
