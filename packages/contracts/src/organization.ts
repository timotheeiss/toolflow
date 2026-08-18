import { z } from "zod";
import { idSchema, membershipStatusSchema, organizationRoleSchema } from "./identity.js";

export const organizationUserSchema = z.object({
  membershipId: idSchema,
  userId: idSchema,
  name: z.string().min(1),
  email: z.string().email(),
  role: organizationRoleSchema,
  status: membershipStatusSchema,
});
export type OrganizationUser = z.infer<typeof organizationUserSchema>;

export const inviteUserInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  role: organizationRoleSchema,
});
export type InviteUserInput = z.infer<typeof inviteUserInputSchema>;

export const updateMembershipInputSchema = z
  .object({
    role: organizationRoleSchema.optional(),
    status: z.enum(["active", "deactivated"]).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "At least one membership field must be supplied.",
  });
export type UpdateMembershipInput = z.infer<typeof updateMembershipInputSchema>;

export const organizationBrandingSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  logoObjectKey: z.string().max(1_000).nullable(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  designGuidance: z.string().max(5_000),
});
export type OrganizationBranding = z.infer<typeof organizationBrandingSchema>;

export const updateBrandingInputSchema = organizationBrandingSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one branding field must be supplied.",
  });
export type UpdateBrandingInput = z.infer<typeof updateBrandingInputSchema>;
