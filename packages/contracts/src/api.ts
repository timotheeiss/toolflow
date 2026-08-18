import { z } from "zod";

export const cursorPageInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorPageInput = z.infer<typeof cursorPageInputSchema>;

export const toolflowErrorCodeSchema = z.enum([
  "AUTHENTICATION_REQUIRED",
  "AUTHORIZATION_DENIED",
  "CONFLICT",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "DEPENDENCY_FAILED",
  "NOT_FOUND",
  "INTERNAL_ERROR",
]);
export type ToolflowErrorCode = z.infer<typeof toolflowErrorCodeSchema>;

export const toolflowErrorSchema = z.object({
  code: toolflowErrorCodeSchema,
  message: z.string(),
  requestId: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ToolflowError = z.infer<typeof toolflowErrorSchema>;
