import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, type BuildFailure, type Message } from "esbuild";
import {
  appManifestSchema,
  sourceBundleSchema,
  type AppManifest,
  type SourceBundle,
} from "@toolflow/contracts";
import { forbiddenSourceConstructs, manifestPath } from "@toolflow/app-template";
// These fixed-runtime packages are resolved dynamically below for each isolated
// app build. Keep static imports so Vercel's file tracer includes them in the
// serverless function bundle.
import "@toolflow/app-sdk";
import "@toolflow/components";
import "react-dom";
import "react-dom/client";
import ts from "typescript";

export interface BuildDiagnostic {
  phase: "manifest" | "policy" | "typecheck" | "bundle" | "test";
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  remediation?: string;
}

export interface ToolflowArtifact {
  version: 1;
  sourceHash: string;
  runtimeVersion: string;
  manifest: AppManifest;
  html: string;
  clientJavaScript: string;
  clientCss: string;
  serverJavaScript: string;
}

export interface CompileResult {
  artifact: ToolflowArtifact | null;
  artifactHash: string | null;
  diagnostics: BuildDiagnostic[];
}

const allowedPackages = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "@toolflow/components",
  "@toolflow/app-sdk",
  "hono",
  "vitest",
]);
const runtimeRequire = createRequire(import.meta.url);
const runtimePackages = [
  "@toolflow/app-sdk",
  "@toolflow/components",
  "hono",
  "react",
  "react-dom",
  "typescript",
] as const;
const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const runtimeTypePackageRoots = new Map([
  ["@types/react", dirname(fileURLToPath(new URL("../node_modules/@types/react/package.json", import.meta.url)))],
  ["@types/react-dom", dirname(fileURLToPath(new URL("../node_modules/@types/react-dom/package.json", import.meta.url)))],
  ["vitest", dirname(vitestCli)],
] as const);
// Resolve every package independently. Serverless providers trace and relocate
// application files, so inferring one shared node_modules directory from the
// compiler's source path (or from pnpm's realpath) is not reliable.
const execFileAsync = promisify(execFile);

export async function compileSource(
  rawBundle: unknown,
  sourceHash: string,
  runtimeVersion: string,
): Promise<CompileResult> {
  const parsed = sourceBundleSchema.safeParse(rawBundle);
  if (!parsed.success) {
    return {
      artifact: null,
      artifactHash: null,
      diagnostics: [
        { phase: "manifest", code: "INVALID_SOURCE_BUNDLE", message: parsed.error.message },
      ],
    };
  }
  const bundle = parsed.data;
  const diagnostics = validateSourcePolicy(bundle);
  const manifestFile = bundle.files.find((file) => file.path === manifestPath);
  let manifest: AppManifest;
  try {
    manifest = appManifestSchema.parse(JSON.parse(manifestFile?.content ?? ""));
  } catch (error) {
    diagnostics.push({
      phase: "manifest",
      code: "INVALID_MANIFEST",
      message: error instanceof Error ? error.message : "Manifest is invalid.",
      file: manifestPath,
      remediation: "Fix toolflow.manifest.json using the documented schema.",
    });
    return { artifact: null, artifactHash: null, diagnostics };
  }
  if (diagnostics.length) return { artifact: null, artifactHash: null, diagnostics };
  const directory = await mkdtemp(join(tmpdir(), "toolflow-build-"));
  try {
    for (const file of bundle.files) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, { encoding: "utf8", mode: 0o600 });
    }
    await linkRuntimePackages(directory, resolveRuntimePackageRoots());
    const typeDiagnostics = typecheckSource(bundle, directory);
    if (typeDiagnostics.length) {
      return { artifact: null, artifactHash: null, diagnostics: typeDiagnostics };
    }
    const testDiagnostics = await runUnitTests(directory, vitestCli);
    if (testDiagnostics.length) {
      return { artifact: null, artifactHash: null, diagnostics: testDiagnostics };
    }
    const browserEntry = join(directory, "__toolflow_browser.tsx");
    await writeFile(
      browserEntry,
      `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport { App } from "./src/App";\nimport "./src/styles.css";\ncreateRoot(document.getElementById("root")!).render(React.createElement(App));\n`,
      { mode: 0o600 },
    );
    const [browser, server] = await Promise.all([
      build({
        entryPoints: [browserEntry],
        absWorkingDir: directory,
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        jsx: "automatic",
        target: "es2022",
        minify: true,
        sourcemap: false,
        metafile: false,
        logLevel: "silent",
        entryNames: "artifact",
        outdir: join(directory, "dist"),
        conditions: ["browser", "import", "default"],
        nodePaths: [join(directory, "node_modules")],
      }),
      build({
        entryPoints: [join(directory, "src/server.ts")],
        absWorkingDir: directory,
        outfile: join(directory, "dist/server.js"),
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        minify: true,
        sourcemap: false,
        logLevel: "silent",
        external: ["node:*"],
        conditions: ["import", "default"],
        nodePaths: [join(directory, "node_modules")],
      }),
    ]);
    const js = browser.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = browser.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    const serverJs = server.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    if (!js || !serverJs) {
      return {
        artifact: null,
        artifactHash: null,
        diagnostics: [
          {
            phase: "bundle",
            code: "EMPTY_BUNDLE",
            message: "The browser or server bundle was empty.",
          },
        ],
      };
    }
    const artifact: ToolflowArtifact = {
      version: 1,
      sourceHash,
      runtimeVersion,
      manifest,
      html: '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./artifact.css"></head><body><div id="root"></div><script type="module" src="./artifact.js"></script></body></html>',
      clientJavaScript: js,
      clientCss: css,
      serverJavaScript: serverJs,
    };
    const artifactHash = createHash("sha256").update(stableJson(artifact)).digest("hex");
    return { artifact, artifactHash, diagnostics: [] };
  } catch (error) {
    return { artifact: null, artifactHash: null, diagnostics: buildDiagnostics(error) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function typecheckSource(bundle: SourceBundle, directory: string): BuildDiagnostic[] {
  const roots = bundle.files
    .filter((file) => /\.(?:ts|tsx)$/.test(file.path))
    .map((file) => join(directory, file.path));
  const options: ts.CompilerOptions = {
    allowJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    baseUrl: directory,
    paths: {
      "@toolflow/app-sdk": [
        join(directory, "node_modules", "@toolflow", "app-sdk", "dist", "index.d.ts"),
      ],
      "@toolflow/components": [
        join(directory, "node_modules", "@toolflow", "components", "dist", "index.d.ts"),
      ],
    },
  };
  // Vercel's function tracer can omit TypeScript's data-only lib/*.d.ts files.
  // Do not turn that hosting packaging gap into thousands of false app errors;
  // esbuild still validates and bundles the app below. Complete runtimes retain
  // the stricter TypeScript pass.
  if (!existsSync(ts.getDefaultLibFilePath(options))) return [];
  return ts
    .getPreEmitDiagnostics(ts.createProgram(roots, options))
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => {
      const position =
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : null;
      return {
        phase: "typecheck" as const,
        code: `TS${diagnostic.code}`,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        ...(diagnostic.file ? { file: relative(directory, diagnostic.file.fileName) } : {}),
        ...(position ? { line: position.line + 1, column: position.character + 1 } : {}),
        remediation: "Correct the TypeScript error and validate a new immutable version.",
      };
    });
}

function resolveRuntimePackageRoot(packageName: (typeof runtimePackages)[number]): string {
  try {
    return dirname(runtimeRequire.resolve(`${packageName}/package.json`));
  } catch {
    // Toolflow packages intentionally hide package.json behind their export map.
    return dirname(dirname(runtimeRequire.resolve(packageName)));
  }
}

function resolveRuntimePackageRoots(): Map<string, string> {
  return new Map([
    ...runtimePackages.map((name): [string, string] => [name, resolveRuntimePackageRoot(name)]),
    ...runtimeTypePackageRoots,
  ]);
}

async function linkRuntimePackages(
  directory: string,
  runtimePackageRoots: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [packageName, source] of runtimePackageRoots) {
    const destination = join(directory, "node_modules", packageName);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(source, destination, "dir");
  }
}

async function runUnitTests(directory: string, vitestCli: string): Promise<BuildDiagnostic[]> {
  try {
    await execFileAsync(
      process.execPath,
      [
        vitestCli,
        "run",
        "--passWithNoTests",
        "--maxWorkers=1",
        "--minWorkers=1",
      ],
      {
        cwd: directory,
        timeout: 10_000,
        maxBuffer: 1_000_000,
        env: {
          NODE_ENV: "test",
          NO_COLOR: "1",
          PATH: process.env.PATH ?? "",
          TMPDIR: tmpdir(),
        },
      },
    );
    return [];
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; killed?: boolean };
    return [
      {
        phase: "test",
        code: failure.killed ? "TEST_TIMEOUT" : "TEST_FAILED",
        message: truncate(failure.stderr || failure.stdout || failure.message, 4_000),
        remediation: "Fix failing app tests; tests run with no Toolflow or customer credentials.",
      },
    ];
  }
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}

function validateSourcePolicy(bundle: SourceBundle): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
  for (const file of bundle.files) {
    for (const forbidden of forbiddenSourceConstructs(file.content))
      diagnostics.push({
        phase: "policy",
        code: "FORBIDDEN_API",
        message: `${forbidden} is not available in Toolflow apps.`,
        file: file.path,
        remediation: "Use the Toolflow SDK and fixed runtime APIs.",
      });
    for (const match of file.content.matchAll(importPattern)) {
      const specifier = match[1]!;
      if (!specifier.startsWith(".") && !allowedPackages.has(specifier))
        diagnostics.push({
          phase: "policy",
          code: "IMPORT_NOT_ALLOWED",
          message: `Import is not allowlisted: ${specifier}`,
          file: file.path,
          remediation:
            "Use relative app modules or a package provided by the fixed Toolflow runtime.",
        });
    }
  }
  return diagnostics;
}

function buildDiagnostics(error: unknown): BuildDiagnostic[] {
  const failure = error as Partial<BuildFailure>;
  if (!Array.isArray(failure.errors))
    return [
      {
        phase: "bundle",
        code: "BUILD_FAILED",
        message: error instanceof Error ? error.message : "Build failed.",
      },
    ];
  return failure.errors.map((message: Message) => ({
    phase: "bundle",
    code: "BUILD_FAILED",
    message: message.text,
    ...(message.location
      ? {
          file: message.location.file,
          line: message.location.line,
          column: message.location.column,
        }
      : {}),
    remediation: "Correct the source error and validate a new immutable version.",
  }));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
