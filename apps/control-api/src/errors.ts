import type { ToolflowErrorCode } from "@toolflow/contracts";

export class ControlApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503,
    readonly code: ToolflowErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ControlApiError";
  }
}
