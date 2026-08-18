import type { AuditEventInput } from "@toolflow/contracts";
import { auditEventInputSchema } from "@toolflow/contracts";
import { auditEvents, type ToolflowDatabase } from "@toolflow/database";
import { redact } from "@toolflow/observability";

export interface AuditWriter {
  append(event: AuditEventInput): Promise<void>;
}

export class DatabaseAuditWriter implements AuditWriter {
  constructor(private readonly database: ToolflowDatabase["db"]) {}

  async append(event: AuditEventInput): Promise<void> {
    const parsed = auditEventInputSchema.parse(event);
    await this.database.insert(auditEvents).values({
      ...parsed,
      metadata: redact(parsed.metadata),
    });
  }
}

export class InMemoryAuditWriter implements AuditWriter {
  readonly events: AuditEventInput[] = [];

  append(event: AuditEventInput): Promise<void> {
    const parsed = auditEventInputSchema.parse(event);
    this.events.push({
      ...parsed,
      metadata: redact(parsed.metadata) as Record<string, unknown>,
    });
    return Promise.resolve();
  }
}
