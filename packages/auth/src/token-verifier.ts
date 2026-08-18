import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const identityClaimsSchema = z.object({
  sub: z.string().min(1),
  org_id: z.string().min(1),
  sid: z.string().min(1).optional(),
  client_id: z.string().min(1).optional(),
  exp: z.number().int().positive().optional(),
  scope: z.string().optional(),
  scp: z.array(z.string()).optional(),
});

export interface ExternalIdentity {
  externalUserId: string;
  externalOrganizationId: string;
  sessionId?: string;
  clientId?: string;
  expiresAt?: number;
  scopes?: string[];
}

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<ExternalIdentity>;
}

export interface JwksVerifierOptions {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

export class JwksAccessTokenVerifier implements AccessTokenVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(options: JwksVerifierOptions) {
    this.#issuer = options.issuer;
    this.#audience = options.audience;
    this.#jwks = createRemoteJWKSet(new URL(options.jwksUrl));
  }

  async verify(accessToken: string): Promise<ExternalIdentity> {
    const result = await jwtVerify(accessToken, this.#jwks, {
      issuer: this.#issuer,
      audience: this.#audience,
      algorithms: ["RS256", "ES256"],
    });
    return identityFromClaims(result.payload);
  }
}

export function identityFromClaims(claims: unknown): ExternalIdentity {
  const parsed = identityClaimsSchema.parse(claims);
  return {
    externalUserId: parsed.sub,
    externalOrganizationId: parsed.org_id,
    ...(parsed.sid ? { sessionId: parsed.sid } : {}),
    ...(parsed.client_id ? { clientId: parsed.client_id } : {}),
    ...(parsed.exp ? { expiresAt: parsed.exp } : {}),
    ...((parsed.scp?.length ?? 0) > 0 || parsed.scope
      ? {
          scopes: [...(parsed.scp ?? []), ...(parsed.scope?.split(/\s+/).filter(Boolean) ?? [])],
        }
      : {}),
  };
}

export function bearerTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}
