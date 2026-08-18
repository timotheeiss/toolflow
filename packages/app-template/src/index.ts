import type { AppManifest, SourceFile } from "@toolflow/contracts";

export const runtimeName = "toolflow-react-v1" as const;
export const manifestPath = "toolflow.manifest.json";

const manifest: AppManifest = {
  manifestVersion: 1,
  name: "New Toolflow app",
  runtime: runtimeName,
  capabilities: [],
  schema: { tables: [] },
  routes: [{ path: "/" }],
  healthcheck: "/api/health",
};

export const initialSourceFiles: readonly SourceFile[] = [
  { path: manifestPath, content: JSON.stringify(manifest, null, 2) },
  {
    path: "src/App.tsx",
    content: `import { ToolflowShell } from "@toolflow/components";

export function App() {
  return <ToolflowShell title="New internal tool"><p>Describe this workflow to your agent.</p></ToolflowShell>;
}
`,
  },
  {
    path: "src/server.ts",
    content: `import { createToolflowServer } from "@toolflow/app-sdk";

export default createToolflowServer({ health: "/api/health" });
`,
  },
  {
    path: "src/styles.css",
    content: `/* App-specific styles. Branding tokens are injected by Toolflow. */\n`,
  },
  {
    path: "src/App.test.tsx",
    content: `import { describe, expect, it } from "vitest";

describe("app", () => { it("has a starter test", () => expect(true).toBe(true)); });
`,
  },
];

const editablePatterns = [
  /^toolflow\.manifest\.json$/,
  /^src\/(?!generated\/)[a-zA-Z0-9_./-]+\.(?:ts|tsx|css|json)$/,
  /^tests\/[a-zA-Z0-9_./-]+\.(?:ts|tsx)$/,
];

export function isEditableSourcePath(path: string): boolean {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === ".." || segment === "" || segment.startsWith("."))
  ) {
    return false;
  }
  return editablePatterns.some((pattern) => pattern.test(path));
}

export const platformBuildFiles = Object.freeze({
  "package.json": JSON.stringify(
    {
      private: true,
      type: "module",
      scripts: {
        typecheck: "tsc --noEmit",
        lint: "eslint src tests",
        test: "vitest run",
        build: "vite build",
      },
      dependencies: {
        "@toolflow/app-sdk": "1.0.0",
        "@toolflow/components": "1.0.0",
        "@vitejs/plugin-react": "latest-pinned-by-runtime",
        hono: "latest-pinned-by-runtime",
        react: "latest-pinned-by-runtime",
        "react-dom": "latest-pinned-by-runtime",
        vite: "latest-pinned-by-runtime",
      },
    },
    null,
    2,
  ),
  "pnpm-lock.yaml": "# Platform-owned lockfile; supplied by runtime toolflow-react-v1\n",
  "vite.config.ts": "// Platform-owned Vite configuration.\n",
  "tsconfig.json": "// Platform-owned TypeScript configuration.\n",
});

export function forbiddenSourceConstructs(content: string): string[] {
  const checks: [RegExp, string][] = [
    [/\beval\s*\(/, "eval"],
    [/\bnew\s+Function\s*\(/, "Function constructor"],
    [/\bWebAssembly\b/, "WebAssembly"],
    [/\bfetch\s*\(/, "direct fetch (use @toolflow/app-sdk)"],
    [/\b(?:XMLHttpRequest|WebSocket|EventSource)\b/, "direct network API"],
    [/\bsendBeacon\s*\(/, "sendBeacon"],
    [/\bprocess\b/, "process global"],
    [/\b(?:child_process|node:net|node:tls|node:dgram)\b/, "forbidden Node capability"],
    [/\bimport\s*\(\s*[^'"`]/, "computed dynamic import"],
  ];
  return checks.filter(([pattern]) => pattern.test(content)).map(([, label]) => label);
}
