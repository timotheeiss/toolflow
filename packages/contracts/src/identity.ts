import { z } from "zod";

export const idSchema = z.string().uuid();
export const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const organizationRoleSchema = z.enum(["admin", "builder", "member"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const membershipStatusSchema = z.enum(["invited", "active", "deactivated"]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const actorTypeSchema = z.enum(["user", "service", "system"]);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const actorContextSchema = z.object({
  actorType: actorTypeSchema,
  actorId: idSchema,
  organizationId: idSchema,
  role: organizationRoleSchema.optional(),
  sessionId: z.string().min(1).max(255).optional(),
  clientId: z.string().min(1).max(255).optional(),
  requestId: z.string().min(1).max(255),
});
export type ActorContext = z.infer<typeof actorContextSchema>;
