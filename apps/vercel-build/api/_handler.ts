import { createBuildRunnerApplication } from "../../build-worker/src/bootstrap.js";

// Vercel Hobby permits functions to run for at most 60 seconds.
export const maxDuration = 60;
const app = createBuildRunnerApplication().app;

export default function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4);
  return app.fetch(new Request(url, request));
}
