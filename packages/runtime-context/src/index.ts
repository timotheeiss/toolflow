import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const runtimeContextSchema = z.object({
  organizationId: z.uuid(),
  appId: z.uuid(),
  deploymentId: z.uuid(),
  userId: z.uuid(),
  membershipId: z.uuid(),
  environment: z.enum(["preview", "production"]),
  requestId: z.string().min(1).max(255),
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
});
export type RuntimeContext = z.infer<typeof runtimeContextSchema>;

const ISSUER = "toolflow-runtime-dispatcher";
const AUDIENCE = "toolflow-data-gateway";

export class RuntimeContextSigner {
  private readonly secret: Uint8Array;

  constructor(secret: Uint8Array) {
    if (secret.byteLength < 32) throw new Error("Runtime context secret must contain 32 bytes.");
    this.secret = secret;
  }

  sign(context: RuntimeContext): Promise<string> {
    const validated = runtimeContextSchema.parse(context);
    return new SignJWT(validated)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("30s")
      .setJti(crypto.randomUUID())
      .sign(this.secret);
  }

  async verify(token: string): Promise<RuntimeContext> {
    const verified = await jwtVerify(token, this.secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
      clockTolerance: 2,
    });
    return runtimeContextSchema.parse(verified.payload);
  }
}
