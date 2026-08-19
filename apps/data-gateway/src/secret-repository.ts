import { and, eq, secretEnvelopes, type ToolflowDatabase } from "@toolflow/database";
import type { SecretEnvelope, SecretEnvelopeRepository } from "@toolflow/secrets";

export class DatabaseSecretEnvelopeRepository implements SecretEnvelopeRepository {
  constructor(private readonly database: ToolflowDatabase["db"]) {}
  async create(envelope: Omit<SecretEnvelope, "id">) {
    const [record] = await this.database.insert(secretEnvelopes).values(envelope).returning();
    if (!record) throw new Error("Secret envelope creation failed.");
    return record;
  }
  async get(organizationId: string, id: string) {
    const rows = await this.database
      .select()
      .from(secretEnvelopes)
      .where(and(eq(secretEnvelopes.organizationId, organizationId), eq(secretEnvelopes.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }
  async replace(id: string, envelope: Omit<SecretEnvelope, "id">) {
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
    if (!record) throw new Error("Secret envelope replacement failed.");
    return record;
  }
  async remove(organizationId: string, id: string) {
    await this.database
      .delete(secretEnvelopes)
      .where(and(eq(secretEnvelopes.organizationId, organizationId), eq(secretEnvelopes.id, id)));
  }
}
