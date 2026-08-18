import { describe, expect, it } from "vitest";
import {
  EnvelopeSecretVault,
  InMemorySecretEnvelopeRepository,
  KmsEnvelopeSecretVault,
  RemoteKmsKeyEncryptionProvider,
  type KeyEncryptionProvider,
} from "./vault.js";

describe("EnvelopeSecretVault", () => {
  it("stores only authenticated ciphertext and enforces tenant scope", async () => {
    const repository = new InMemorySecretEnvelopeRepository();
    const vault = new EnvelopeSecretVault(repository, new Uint8Array(32).fill(7));
    const id = await vault.put("org-a", "postgresql-password", "very-secret");

    expect([...repository.records.values()][0]?.ciphertext).not.toContain("very-secret");
    await expect(vault.get("org-a", id)).resolves.toBe("very-secret");
    await expect(vault.get("org-b", id)).rejects.toThrow("does not exist");
  });

  it("detects ciphertext tampering", async () => {
    const repository = new InMemorySecretEnvelopeRepository();
    const vault = new EnvelopeSecretVault(repository, new Uint8Array(32).fill(9));
    const id = await vault.put("org-a", "postgresql-password", "very-secret");
    const record = repository.records.get(id)!;
    repository.records.set(id, {
      ...record,
      ciphertext: `${record.ciphertext.startsWith("A") ? "B" : "A"}${record.ciphertext.slice(1)}`,
    });

    await expect(vault.get("org-a", id)).rejects.toThrow();
  });
});

describe("KmsEnvelopeSecretVault", () => {
  it("uses a unique KMS data key envelope and binds decrypt to tenant context", async () => {
    const repository = new InMemorySecretEnvelopeRepository();
    const key = new Uint8Array(32).fill(11);
    const provider: KeyEncryptionProvider = {
      name: "test-kms",
      generateDataKey: (context) =>
        Promise.resolve({
          plaintextKey: key.slice(),
          encryptedDataKey: `wrapped:${context.organizationId}:${context.purpose}`,
          keyVersion: "key-v7",
        }),
      decryptDataKey: (encrypted, version, context) => {
        expect(encrypted).toBe(`wrapped:${context.organizationId}:${context.purpose}`);
        expect(version).toBe("key-v7");
        return Promise.resolve(key.slice());
      },
    };
    const vault = new KmsEnvelopeSecretVault(repository, provider);
    const id = await vault.put("org-a", "postgresql-password", "kms-secret");
    const stored = repository.records.get(id)!;
    expect(stored).toMatchObject({
      keyProvider: "test-kms",
      encryptedDataKey: "wrapped:org-a:postgresql-password",
      keyVersion: "key-v7",
    });
    expect(stored.ciphertext).not.toContain("kms-secret");
    await expect(vault.get("org-a", id)).resolves.toBe("kms-secret");
    await expect(vault.get("org-b", id)).rejects.toThrow("does not exist");
  });
});

describe("RemoteKmsKeyEncryptionProvider", () => {
  it("uses bounded HTTPS broker calls without putting credentials in the URL", async () => {
    const requests: Request[] = [];
    const request: typeof fetch = (input: string | URL | Request, init?: RequestInit) => {
      const captured = new Request(input, init);
      requests.push(captured);
      return Promise.resolve(
        Response.json({
          plaintextKey: Buffer.from(new Uint8Array(32).fill(4)).toString("base64"),
          encryptedDataKey: "provider-ciphertext",
          keyVersion: "provider-v1",
        }),
      );
    };
    const provider = new RemoteKmsKeyEncryptionProvider(
      new URL("https://kms.toolflow.test"),
      "s".repeat(32),
      "projects/toolflow/keys/connections",
      "pilot-kms",
      request,
    );
    await provider.generateDataKey({ organizationId: "org-a", purpose: "postgresql-password" });
    expect(requests[0]?.url).toBe("https://kms.toolflow.test/v1/data-keys");
    expect(requests[0]?.url).not.toContain("s".repeat(32));
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${"s".repeat(32)}`);
    expect(requests[0]?.redirect).toBe("manual");
  });

  it("rejects insecure broker origins", () => {
    expect(
      () =>
        new RemoteKmsKeyEncryptionProvider(
          new URL("http://kms.toolflow.test"),
          "s".repeat(32),
          "key",
        ),
    ).toThrow("HTTPS");
  });
});
