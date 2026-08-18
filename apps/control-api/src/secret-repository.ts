import { secretEnvelopes, type ToolflowDatabase } from "@toolflow/database";
import type { SecretEnvelope, SecretEnvelopeRepository } from "@toolflow/secrets";
import { and, eq } from "drizzle-orm";

export class DatabaseSecretEnvelopeRepository implements SecretEnvelopeRepository {
  constructor(private readonly database: ToolflowDatabase["db"]) {}

  async create(envelope: Omit<SecretEnvelope, "id">): Promise<SecretEnvelope> {
    const [record] = await this.database.insert(secretEnvelopes).values(envelope).returning();
    if (!record) throw new Error("Secret envelope creation did not return a record.");
    return record;
  }

  async get(organizationId: string, id: string): Promise<SecretEnvelope | null> {
    const rows = await this.database
      .select()
      .from(secretEnvelopes)
      .where(and(eq(secretEnvelopes.organizationId, organizationId), eq(secretEnvelopes.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async replace(id: string, envelope: Omit<SecretEnvelope, "id">): Promise<SecretEnvelope> {
    const [record] = await this.database
      .update(secretEnvelopes)
      .set({ ...envelope, updatedAt: new Date() })
      .where(
        and(
          eq(secretEnvelopes.id, id),
          eq(secretEnvelopes.organizationId, envelope.organizationId),
        ),
      )
      .returning();
    if (!record) throw new Error("Secret envelope does not exist.");
    return record;
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.database
      .delete(secretEnvelopes)
      .where(and(eq(secretEnvelopes.organizationId, organizationId), eq(secretEnvelopes.id, id)));
  }
}
