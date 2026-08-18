import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretEnvelope {
  id: string;
  organizationId: string;
  purpose: string;
  ciphertext: string;
  initializationVector: string;
  authenticationTag: string;
  keyVersion: string;
  keyProvider: string;
  encryptedDataKey: string | null;
}

export interface SecretEnvelopeRepository {
  create(envelope: Omit<SecretEnvelope, "id">): Promise<SecretEnvelope>;
  get(organizationId: string, id: string): Promise<SecretEnvelope | null>;
  replace(id: string, envelope: Omit<SecretEnvelope, "id">): Promise<SecretEnvelope>;
  remove(organizationId: string, id: string): Promise<void>;
}

export interface SecretVault {
  put(organizationId: string, purpose: string, secret: string): Promise<string>;
  get(organizationId: string, id: string): Promise<string>;
  replace(organizationId: string, id: string, purpose: string, secret: string): Promise<void>;
  remove(organizationId: string, id: string): Promise<void>;
}

export class EnvelopeSecretVault implements SecretVault {
  private readonly key: Buffer;

  constructor(
    private readonly repository: SecretEnvelopeRepository,
    key: Uint8Array,
    private readonly keyVersion = "v1",
  ) {
    if (key.byteLength !== 32) throw new Error("Secret encryption key must contain 32 bytes.");
    this.key = Buffer.from(key);
  }

  async put(organizationId: string, purpose: string, secret: string): Promise<string> {
    const envelope = this.encrypt(organizationId, purpose, secret);
    return (await this.repository.create(envelope)).id;
  }

  async get(organizationId: string, id: string): Promise<string> {
    const envelope = await this.repository.get(organizationId, id);
    if (!envelope) throw new Error("Secret reference does not exist.");
    return this.decrypt(envelope);
  }

  async replace(
    organizationId: string,
    id: string,
    purpose: string,
    secret: string,
  ): Promise<void> {
    const current = await this.repository.get(organizationId, id);
    if (!current) throw new Error("Secret reference does not exist.");
    await this.repository.replace(id, this.encrypt(organizationId, purpose, secret));
  }

  remove(organizationId: string, id: string): Promise<void> {
    return this.repository.remove(organizationId, id);
  }

  private encrypt(organizationId: string, purpose: string, secret: string) {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, initializationVector);
    cipher.setAAD(Buffer.from(`${organizationId}:${purpose}:${this.keyVersion}`));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return {
      organizationId,
      purpose,
      ciphertext: ciphertext.toString("base64"),
      initializationVector: initializationVector.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      keyVersion: this.keyVersion,
      keyProvider: "local",
      encryptedDataKey: null,
    };
  }

  private decrypt(envelope: SecretEnvelope): string {
    if (
      envelope.keyProvider !== "local" ||
      envelope.encryptedDataKey !== null ||
      envelope.keyVersion !== this.keyVersion
    ) {
      throw new Error("Secret key version is not available.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.initializationVector, "base64"),
    );
    decipher.setAAD(
      Buffer.from(`${envelope.organizationId}:${envelope.purpose}:${envelope.keyVersion}`),
    );
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export interface DataKeyContext {
  organizationId: string;
  purpose: string;
}

export interface GeneratedDataKey {
  plaintextKey: Uint8Array;
  encryptedDataKey: string;
  keyVersion: string;
}

export interface KeyEncryptionProvider {
  readonly name: string;
  generateDataKey(context: DataKeyContext): Promise<GeneratedDataKey>;
  decryptDataKey(
    encryptedDataKey: string,
    keyVersion: string,
    context: DataKeyContext,
  ): Promise<Uint8Array>;
}

export class KmsEnvelopeSecretVault implements SecretVault {
  constructor(
    private readonly repository: SecretEnvelopeRepository,
    private readonly keys: KeyEncryptionProvider,
  ) {}

  async put(organizationId: string, purpose: string, secret: string): Promise<string> {
    const envelope = await this.encrypt(organizationId, purpose, secret);
    return (await this.repository.create(envelope)).id;
  }

  async get(organizationId: string, id: string): Promise<string> {
    const envelope = await this.repository.get(organizationId, id);
    if (!envelope) throw new Error("Secret reference does not exist.");
    if (envelope.keyProvider !== this.keys.name || !envelope.encryptedDataKey) {
      throw new Error("Secret key provider is not available.");
    }
    const context = { organizationId, purpose: envelope.purpose };
    const dataKey = Buffer.from(
      await this.keys.decryptDataKey(envelope.encryptedDataKey, envelope.keyVersion, context),
    );
    try {
      if (dataKey.byteLength !== 32) throw new Error("KMS returned an invalid data key.");
      return decryptSecret(envelope, dataKey);
    } finally {
      dataKey.fill(0);
    }
  }

  async replace(
    organizationId: string,
    id: string,
    purpose: string,
    secret: string,
  ): Promise<void> {
    const current = await this.repository.get(organizationId, id);
    if (!current) throw new Error("Secret reference does not exist.");
    await this.repository.replace(id, await this.encrypt(organizationId, purpose, secret));
  }

  remove(organizationId: string, id: string): Promise<void> {
    return this.repository.remove(organizationId, id);
  }

  private async encrypt(organizationId: string, purpose: string, secret: string) {
    const context = { organizationId, purpose };
    const generated = await this.keys.generateDataKey(context);
    const dataKey = Buffer.from(generated.plaintextKey);
    try {
      if (dataKey.byteLength !== 32) throw new Error("KMS returned an invalid data key.");
      const encrypted = encryptSecret(
        organizationId,
        purpose,
        generated.keyVersion,
        dataKey,
        secret,
      );
      return {
        ...encrypted,
        keyProvider: this.keys.name,
        encryptedDataKey: generated.encryptedDataKey,
      };
    } finally {
      dataKey.fill(0);
      generated.plaintextKey.fill(0);
    }
  }
}

export class RemoteKmsKeyEncryptionProvider implements KeyEncryptionProvider {
  readonly name: string;

  constructor(
    private readonly baseUrl: URL,
    private readonly serviceToken: string,
    private readonly keyId: string,
    providerName = "kms",
    private readonly request: typeof fetch = fetch,
  ) {
    if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) {
      throw new Error("The KMS broker URL must be an HTTPS origin without credentials.");
    }
    if (serviceToken.length < 32) throw new Error("The KMS service token is too short.");
    if (!keyId) throw new Error("The KMS key ID is required.");
    this.name = providerName;
  }

  async generateDataKey(context: DataKeyContext): Promise<GeneratedDataKey> {
    const result = await this.call("/v1/data-keys", { keyId: this.keyId, context });
    if (
      typeof result.plaintextKey !== "string" ||
      typeof result.encryptedDataKey !== "string" ||
      typeof result.keyVersion !== "string"
    ) {
      throw new Error("KMS broker returned an invalid data-key response.");
    }
    const plaintextKey = Buffer.from(result.plaintextKey, "base64");
    if (plaintextKey.byteLength !== 32) throw new Error("KMS broker returned an invalid data key.");
    return {
      plaintextKey,
      encryptedDataKey: result.encryptedDataKey,
      keyVersion: result.keyVersion,
    };
  }

  async decryptDataKey(
    encryptedDataKey: string,
    keyVersion: string,
    context: DataKeyContext,
  ): Promise<Uint8Array> {
    const result = await this.call("/v1/data-keys/decrypt", {
      keyId: this.keyId,
      encryptedDataKey,
      keyVersion,
      context,
    });
    if (typeof result.plaintextKey !== "string") {
      throw new Error("KMS broker returned an invalid decrypt response.");
    }
    const plaintextKey = Buffer.from(result.plaintextKey, "base64");
    if (plaintextKey.byteLength !== 32) throw new Error("KMS broker returned an invalid data key.");
    return plaintextKey;
  }

  private async call(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.serviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || (response.status >= 300 && response.status < 400)) {
      throw new Error("KMS broker request failed.");
    }
    const raw = await response.text();
    if (raw.length > 16_384) throw new Error("KMS broker response is too large.");
    try {
      const result = JSON.parse(raw) as unknown;
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
      return result as Record<string, unknown>;
    } catch {
      throw new Error("KMS broker returned invalid JSON.");
    }
  }
}

function encryptSecret(
  organizationId: string,
  purpose: string,
  keyVersion: string,
  key: Uint8Array,
  secret: string,
) {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  cipher.setAAD(Buffer.from(`${organizationId}:${purpose}:${keyVersion}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    organizationId,
    purpose,
    ciphertext: ciphertext.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

function decryptSecret(envelope: SecretEnvelope, key: Uint8Array): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.initializationVector, "base64"),
  );
  decipher.setAAD(
    Buffer.from(`${envelope.organizationId}:${envelope.purpose}:${envelope.keyVersion}`),
  );
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export type SecretVaultConfiguration =
  | { backend: "local"; encryptionKey: Uint8Array }
  | {
      backend: "kms";
      brokerUrl: URL;
      serviceToken: string;
      keyId: string;
      providerName?: string;
    };

export function createSecretVault(
  repository: SecretEnvelopeRepository,
  configuration: SecretVaultConfiguration,
): SecretVault {
  if (configuration.backend === "local") {
    return new EnvelopeSecretVault(repository, configuration.encryptionKey);
  }
  return new KmsEnvelopeSecretVault(
    repository,
    new RemoteKmsKeyEncryptionProvider(
      configuration.brokerUrl,
      configuration.serviceToken,
      configuration.keyId,
      configuration.providerName,
    ),
  );
}

export class InMemorySecretEnvelopeRepository implements SecretEnvelopeRepository {
  readonly records = new Map<string, SecretEnvelope>();

  create(envelope: Omit<SecretEnvelope, "id">): Promise<SecretEnvelope> {
    const record = { id: crypto.randomUUID(), ...envelope };
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  get(organizationId: string, id: string): Promise<SecretEnvelope | null> {
    const record = this.records.get(id);
    return Promise.resolve(record?.organizationId === organizationId ? record : null);
  }

  replace(id: string, envelope: Omit<SecretEnvelope, "id">): Promise<SecretEnvelope> {
    const record = { id, ...envelope };
    this.records.set(id, record);
    return Promise.resolve(record);
  }

  remove(organizationId: string, id: string): Promise<void> {
    const record = this.records.get(id);
    if (record?.organizationId === organizationId) this.records.delete(id);
    return Promise.resolve();
  }
}
