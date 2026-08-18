import { describe, expect, it } from "vitest";
import { forbiddenSourceConstructs, isEditableSourcePath } from "./index.js";

describe("fixed app template policy", () => {
  it("allows only designated text source paths", () => {
    expect(isEditableSourcePath("src/App.tsx")).toBe(true);
    expect(isEditableSourcePath("toolflow.manifest.json")).toBe(true);
    expect(isEditableSourcePath("../package.json")).toBe(false);
    expect(isEditableSourcePath("package.json")).toBe(false);
    expect(isEditableSourcePath("src/generated/sdk.ts")).toBe(false);
  });

  it("identifies forbidden runtime escape constructs", () => {
    expect(forbiddenSourceConstructs("const run = eval('x'); new Function('x')")).toEqual([
      "eval",
      "Function constructor",
    ]);
  });

  it("forces network access through the governed SDK", () => {
    expect(forbiddenSourceConstructs('fetch("https://example.com")')).toContain(
      "direct fetch (use @toolflow/app-sdk)",
    );
    expect(forbiddenSourceConstructs('new WebSocket("wss://example.com")')).toContain(
      "direct network API",
    );
  });
});
