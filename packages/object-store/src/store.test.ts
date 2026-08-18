import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FilesystemImmutableObjectStore,
  InMemoryImmutableObjectStore,
  S3ImmutableObjectStore,
  createConfiguredObjectStore,
} from "./store.js";

describe("immutable object stores", () => {
  it("rejects collisions and traversal", async () => {
    const store = new InMemoryImmutableObjectStore();
    await store.put("sources/abc.json", new TextEncoder().encode("one"));
    await expect(store.put("sources/abc.json", new TextEncoder().encode("two"))).rejects.toThrow(
      "collision",
    );
    expect(() => store.get("../secret")).toThrow("invalid");
  });

  it("writes private files atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "toolflow-objects-"));
    const store = new FilesystemImmutableObjectStore(root);
    await store.put("artifacts/hash.js", new TextEncoder().encode("content"));
    expect(await readFile(join(root, "artifacts/hash.js"), "utf8")).toBe("content");
  });
});

describe("S3ImmutableObjectStore", () => {
  it("signs conditional immutable writes without putting credentials in the URL", async () => {
    const requests: Request[] = [];
    const store = new S3ImmutableObjectStore({
      endpoint: "https://account.r2.cloudflarestorage.com",
      bucket: "toolflow-artifacts",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      fetcher: (input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(new Response(null, { status: 201 }));
      },
    });
    await store.put("sources/hash.json", new TextEncoder().encode("source"));
    const request = requests[0]!;
    expect(request.url).toBe(
      "https://account.r2.cloudflarestorage.com/toolflow-artifacts/sources/hash.json",
    );
    expect(request.headers.get("if-none-match")).toBe("*");
    expect(request.headers.get("authorization")).toContain(
      "AWS4-HMAC-SHA256 Credential=access-key/",
    );
    expect(request.url).not.toContain("secret-key");
  });

  it("fails closed without shared production storage", () => {
    expect(() =>
      createConfiguredObjectStore({
        filesystemRoot: "/tmp/toolflow",
        environment: {},
        production: true,
      }),
    ).toThrow("Production requires");
  });
});
