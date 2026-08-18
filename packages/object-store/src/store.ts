import { constants } from "node:fs";
import { access, link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { createHash, createHmac } from "node:crypto";

export interface ImmutableObjectStore {
  put(key: string, content: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

function validateKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,1000}$/.test(key) || key.includes("..")) {
    throw new Error("Object key is invalid.");
  }
}

export class FilesystemImmutableObjectStore implements ImmutableObjectStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, content: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    if (await this.exists(key)) {
      const existing = await readFile(path);
      if (!existing.equals(content)) throw new Error("Immutable object key collision.");
      return;
    }
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    try {
      await link(temporary, path);
    } catch (error) {
      if (!(await this.exists(key))) throw error;
      const existing = await readFile(path);
      if (!existing.equals(content)) throw new Error("Immutable object key collision.");
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private pathFor(key: string): string {
    validateKey(key);
    const path = resolve(join(this.root, key));
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error("Object path escapes the configured root.");
    }
    return path;
  }
}

export class InMemoryImmutableObjectStore implements ImmutableObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  put(key: string, content: Uint8Array): Promise<void> {
    validateKey(key);
    const existing = this.objects.get(key);
    if (existing && !Buffer.from(existing).equals(content)) {
      return Promise.reject(new Error("Immutable object key collision."));
    }
    this.objects.set(key, Uint8Array.from(content));
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array> {
    validateKey(key);
    const content = this.objects.get(key);
    if (!content) return Promise.reject(new Error("Object not found."));
    return Promise.resolve(Uint8Array.from(content));
  }

  exists(key: string): Promise<boolean> {
    validateKey(key);
    return Promise.resolve(this.objects.has(key));
  }
}

export interface S3ImmutableObjectStoreOptions {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export class S3ImmutableObjectStore implements ImmutableObjectStore {
  private readonly endpoint: URL;
  private readonly region: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: S3ImmutableObjectStoreOptions) {
    this.endpoint = new URL(options.endpoint);
    if (
      this.endpoint.username ||
      this.endpoint.password ||
      this.endpoint.search ||
      this.endpoint.hash
    ) {
      throw new Error("Object storage endpoint must not contain credentials, query, or fragment.");
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket)) {
      throw new Error("Object storage bucket is invalid.");
    }
    if (!options.accessKeyId || !options.secretAccessKey) {
      throw new Error("Object storage credentials are required.");
    }
    this.region = options.region ?? "auto";
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async put(key: string, content: Uint8Array): Promise<void> {
    validateKey(key);
    const response = await this.request("PUT", key, content, { "if-none-match": "*" });
    if (response.ok) return;
    if (response.status !== 409 && response.status !== 412) {
      throw new Error(`Immutable object write failed with status ${response.status}.`);
    }
    const existing = await this.get(key);
    if (!Buffer.from(existing).equals(content)) throw new Error("Immutable object key collision.");
  }

  async get(key: string): Promise<Uint8Array> {
    validateKey(key);
    const response = await this.request("GET", key);
    if (!response.ok) throw new Error(`Object read failed with status ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    validateKey(key);
    const response = await this.request("HEAD", key);
    if (response.status === 404) return false;
    if (!response.ok)
      throw new Error(`Object existence check failed with status ${response.status}.`);
    return true;
  }

  private request(
    method: "GET" | "HEAD" | "PUT",
    key: string,
    body?: Uint8Array,
    additionalHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const payloadHash = sha256(body ?? new Uint8Array());
    const date = this.now();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");
    const dateKey = hmac(
      new TextEncoder().encode(`AWS4${this.options.secretAccessKey}`),
      dateStamp,
    );
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = Buffer.from(hmac(signingKey, stringToSign)).toString("hex");
    const headers = new Headers({
      ...additionalHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    });
    return this.fetcher(url, {
      method,
      headers,
      ...(body ? { body: bodyBuffer(body) } : {}),
      redirect: "manual",
    });
  }

  private objectUrl(key: string): URL {
    const base = this.endpoint.href.endsWith("/") ? this.endpoint.href : `${this.endpoint.href}/`;
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return new URL(`${encodeURIComponent(this.options.bucket)}/${encodedKey}`, base);
  }
}

export function createConfiguredObjectStore(options: {
  filesystemRoot: string;
  environment: NodeJS.ProcessEnv;
  production: boolean;
}): ImmutableObjectStore {
  const endpoint = options.environment.OBJECT_STORAGE_ENDPOINT;
  const bucket = options.environment.OBJECT_STORAGE_BUCKET;
  const accessKeyId = options.environment.OBJECT_STORAGE_ACCESS_KEY;
  const secretAccessKey = options.environment.OBJECT_STORAGE_SECRET_KEY;
  const configured = endpoint && bucket && accessKeyId && secretAccessKey;
  if (configured) {
    if (options.production && !endpoint.startsWith("https://")) {
      throw new Error("Production object storage must use HTTPS.");
    }
    return new S3ImmutableObjectStore({ endpoint, bucket, accessKeyId, secretAccessKey });
  }
  if (options.production) {
    throw new Error("Production requires S3-compatible immutable object storage configuration.");
  }
  return new FilesystemImmutableObjectStore(options.filesystemRoot);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Uint8Array, value: string): Uint8Array {
  return createHmac("sha256", key).update(value).digest();
}

function bodyBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}
