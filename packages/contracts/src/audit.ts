import { z } from "zod";
import { actorTypeSchema, idSchema } from "./identity.js";

export const auditOutcomeSchema = z.enum(["succeeded", "failed", "denied"]);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const auditEventInputSchema = z.object({
  organizationId: idSchema,
  actorType: actorTypeSchema,
  actorId: idSchema,
  sessionId: z.string().max(255).optional(),
  clientId: z.string().max(255).optional(),
  action: z.string().min(1).max(160),
  targetType: z.string().min(1).max(100),
  targetId: z.string().min(1).max(255),
  environment: z.enum(["preview", "production"]).optional(),
  requestId: z.string().min(1).max(255),
  outcome: auditOutcomeSchema,
  metadata: z.record(z.unknown()).default({}),
});
export type AuditEventInput = z.infer<typeof auditEventInputSchema>;
