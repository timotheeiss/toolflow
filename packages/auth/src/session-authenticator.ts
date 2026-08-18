import type { MembershipIdentityRepository, Principal } from "./principal.js";
import type { RequestAuthenticator } from "./authenticator.js";

export interface RequestAuthentication {
  principal: Principal;
  setCookieHeader?: string;
}

interface WorkOsSessionResult {
  authenticated: boolean;
  reason?: string;
  sessionId?: string;
  organizationId?: string;
  user?: { id: string };
  sealedSession?: string;
}

interface WorkOsSession {
  authenticate(): Promise<WorkOsSessionResult>;
  refresh(): Promise<WorkOsSessionResult>;
}

export interface WorkOsSessionClient {
  userManagement: {
    loadSealedSession(options: { sessionData: string; cookiePassword: string }): WorkOsSession;
  };
}

export interface DetailedRequestAuthenticator extends RequestAuthenticator {
  authenticateRequest(request: Request): Promise<RequestAuthentication | null>;
}

export class WorkOsSessionAuthenticator implements DetailedRequestAuthenticator {
  constructor(
    private readonly workos: WorkOsSessionClient,
    private readonly memberships: MembershipIdentityRepository,
    private readonly cookiePassword: string,
    private readonly options: {
      cookieName?: string;
      domain?: string;
      secure?: boolean;
      maxAgeSeconds?: number;
    } = {},
  ) {}

  async authenticate(request: Request): Promise<Principal | null> {
    return (await this.authenticateRequest(request))?.principal ?? null;
  }

  async authenticateRequest(request: Request): Promise<RequestAuthentication | null> {
    const sessionData = cookieValue(request.headers.get("cookie"), this.cookieName);
    if (!sessionData) return null;
    const session = this.workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: this.cookiePassword,
    });
    let result = await session.authenticate();
    let refreshed = false;
    if (!result.authenticated && result.reason === "invalid_jwt") {
      result = await session.refresh();
      refreshed = result.authenticated;
    }
    if (!result.authenticated || !result.user?.id || !result.organizationId || !result.sessionId) {
      return null;
    }
    const membership = await this.memberships.findActiveByExternalIdentity(
      result.user.id,
      result.organizationId,
    );
    if (!membership) return null;
    return {
      principal: { ...membership, sessionId: result.sessionId },
      ...(refreshed && result.sealedSession
        ? { setCookieHeader: this.sessionCookie(result.sealedSession) }
        : {}),
    };
  }

  sessionCookie(sealedSession: string): string {
    return serializeCookie(this.cookieName, sealedSession, {
      httpOnly: true,
      secure: this.options.secure ?? true,
      sameSite: "Lax",
      path: "/",
      maxAge: this.options.maxAgeSeconds ?? 60 * 60 * 24 * 30,
      ...(this.options.domain ? { domain: this.options.domain } : {}),
    });
  }

  clearSessionCookie(): string {
    return serializeCookie(this.cookieName, "", {
      httpOnly: true,
      secure: this.options.secure ?? true,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
      ...(this.options.domain ? { domain: this.options.domain } : {}),
    });
  }

  private get cookieName() {
    return this.options.cookieName ?? "wos_session";
  }
}

export class CompositeRequestAuthenticator implements DetailedRequestAuthenticator {
  constructor(private readonly authenticators: RequestAuthenticator[]) {}

  async authenticate(request: Request): Promise<Principal | null> {
    return (await this.authenticateRequest(request))?.principal ?? null;
  }

  async authenticateRequest(request: Request): Promise<RequestAuthentication | null> {
    for (const authenticator of this.authenticators) {
      const detailed = authenticator as Partial<DetailedRequestAuthenticator>;
      const result = detailed.authenticateRequest
        ? await detailed.authenticateRequest(request)
        : await authenticator
            .authenticate(request)
            .then((principal) => (principal ? { principal } : null));
      if (result) return result;
    }
    return null;
  }
}

export async function authenticateRequest(
  authenticator: RequestAuthenticator,
  request: Request,
): Promise<RequestAuthentication | null> {
  const detailed = authenticator as Partial<DetailedRequestAuthenticator>;
  if (detailed.authenticateRequest) return detailed.authenticateRequest(request);
  const principal = await authenticator.authenticate(request);
  return principal ? { principal } : null;
}

export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax" | "Strict";
    path: string;
    maxAge: number;
    domain?: string;
  },
) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    ...(options.domain ? [`Domain=${options.domain}`] : []),
    `Max-Age=${options.maxAge}`,
    options.httpOnly ? "HttpOnly" : "",
    options.secure ? "Secure" : "",
    `SameSite=${options.sameSite}`,
  ]
    .filter(Boolean)
    .join("; ");
}
