import { describe, expect, it } from "vitest";
import { initialSourceFiles } from "@toolflow/app-template";
import { compileSource } from "./compiler.js";

describe("fixed-stack compiler", () => {
  it("produces deterministic content-addressed artifacts", async () => {
    const bundle = { version: 1 as const, files: [...initialSourceFiles] };
    const first = await compileSource(bundle, "source-hash", "runtime-1");
    const second = await compileSource(bundle, "source-hash", "runtime-1");
    expect(first.diagnostics).toEqual([]);
    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.artifact?.clientJavaScript.length).toBeGreaterThan(100);
    expect(first.artifact?.serverJavaScript.length).toBeGreaterThan(100);
  }, 15_000);

  it("rejects imports and runtime escape APIs outside the fixed stack", async () => {
    const files = initialSourceFiles.map((file) =>
      file.path === "src/App.tsx"
        ? {
            ...file,
            content: 'import fs from "node:fs"; export function App(){ eval("x"); return null; }',
          }
        : file,
    );
    const result = await compileSource({ version: 1, files }, "source-hash", "runtime-1");
    expect(result.artifact).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("IMPORT_NOT_ALLOWED");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORBIDDEN_API");
  });
});
