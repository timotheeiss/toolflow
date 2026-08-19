import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AuditWriter } from "@toolflow/audit";
import type { WorkOS } from "@workos-inc/node";
import { cookieValue, serializeCookie } from "@toolflow/auth";
import type { WorkOsSessionAuthenticator } from "@toolflow/auth";
import {
  organizationMemberships,
  organizations,
  users,
  and,
  eq,
  type ToolflowDatabase,
} from "@toolflow/database";

export class AuthKitController {
  constructor(
    private readonly workos: WorkOS,
    private readonly database: ToolflowDatabase["db"],
    private readonly sessionAuthenticator: WorkOsSessionAuthenticator,
    private readonly audit: AuditWriter,
    private readonly config: {
      clientId: string;
      cookiePassword: string;
      redirectUri: string;
      applicationUrl: string;
      secure: boolean;
      cookieDomain?: string;
    },
  ) {}

  async login(): Promise<Response> {
    const { url, state, codeVerifier } =
      await this.workos.userManagement.getAuthorizationUrlWithPKCE({
        clientId: this.config.clientId,
        redirectUri: this.config.redirectUri,
        provider: "authkit",
        screenHint: "sign-in",
      });
    const headers = new Headers({ location: url, "cache-control": "no-store" });
    headers.append("set-cookie", this.transientCookie("tf_auth_state", state));
    headers.append("set-cookie", this.transientCookie("tf_auth_verifier", codeVerifier));
    return new Response(null, { status: 302, headers });
  }

  async callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = cookieValue(request.headers.get("cookie"), "tf_auth_state");
    const codeVerifier = cookieValue(request.headers.get("cookie"), "tf_auth_verifier");
    if (
      !code ||
      !state ||
      !expectedState ||
      !codeVerifier ||
      !constantEqual(state, expectedState)
    ) {
      throw new Error("AuthKit callback state is invalid or expired.");
    }
    const userAgent = request.headers.get("user-agent");
    const authentication = await this.workos.userManagement.authenticateWithCode({
      clientId: this.config.clientId,
      code,
      codeVerifier,
      session: { sealSession: true, cookiePassword: this.config.cookiePassword },
      ...(userAgent ? { userAgent } : {}),
    });
    if (!authentication.organizationId || !authentication.sealedSession) {
      throw new Error("AuthKit did not return an organization-bound sealed session.");
    }
    const principal = await this.linkInvitedMembership(
      authentication.user.id,
      authentication.user.email,
      authentication.organizationId,
    );
    await this.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "authentication.succeeded",
      targetType: "membership",
      targetId: principal.membershipId,
      requestId: crypto.randomUUID(),
      outcome: "succeeded",
      metadata: { provider: "workos_authkit" },
    });
    const headers = new Headers({
      location: this.config.applicationUrl,
      "cache-control": "no-store",
    });
    headers.append(
      "set-cookie",
      this.sessionAuthenticator.sessionCookie(authentication.sealedSession),
    );
    headers.append(
      "set-cookie",
      serializeCookie("tf_csrf", randomBytes(32).toString("base64url"), {
        httpOnly: false,
        secure: this.config.secure,
        sameSite: "Strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
      }),
    );
    headers.append("set-cookie", this.clearCookie("tf_auth_state"));
    headers.append("set-cookie", this.clearCookie("tf_auth_verifier"));
    return new Response(null, { status: 302, headers });
  }

  async logout(request: Request): Promise<Response> {
    const authentication = await this.sessionAuthenticator.authenticateRequest(request);
    if (authentication) {
      await this.audit.append({
        organizationId: authentication.principal.organizationId,
        actorType: "user",
        actorId: authentication.principal.userId,
        sessionId: authentication.principal.sessionId,
        action: "authentication.logged_out",
        targetType: "membership",
        targetId: authentication.principal.membershipId,
        requestId: crypto.randomUUID(),
        outcome: "succeeded",
        metadata: {},
      });
    }
    const headers = new Headers({
      location: this.config.applicationUrl,
      "cache-control": "no-store",
    });
    headers.append("set-cookie", this.sessionAuthenticator.clearSessionCookie());
    headers.append("set-cookie", this.clearCookie("tf_csrf"));
    return new Response(null, { status: 302, headers });
  }

  validateCsrf(request: Request): boolean {
    const cookie = cookieValue(request.headers.get("cookie"), "tf_csrf");
    const header = request.headers.get("x-toolflow-csrf");
    return Boolean(cookie && header && constantEqual(cookie, header));
  }

  csrfToken(request: Request): string | null {
    return cookieValue(request.headers.get("cookie"), "tf_csrf");
  }

  hasSessionCookie(request: Request): boolean {
    return cookieValue(request.headers.get("cookie"), "wos_session") !== null;
  }

  private async linkInvitedMembership(
    externalUserId: string,
    email: string,
    externalOrganizationId: string,
  ) {
    const rows = await this.database
      .select({ membership: organizationMemberships, user: users })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(
        and(
          eq(organizations.externalIdentityId, externalOrganizationId),
          eq(users.email, email.toLowerCase()),
        ),
      )
      .limit(1);
    const match = rows[0];
    if (!match || match.membership.status === "deactivated") {
      throw new Error("The authenticated user is not invited to this Toolflow organization.");
    }
    if (match.user.externalIdentityId && match.user.externalIdentityId !== externalUserId) {
      throw new Error("The invitation is already linked to another identity.");
    }
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ externalIdentityId: externalUserId, updatedAt: new Date() })
        .where(eq(users.id, match.user.id));
      if (match.membership.status === "invited") {
        await transaction
          .update(organizationMemberships)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(organizationMemberships.id, match.membership.id));
      }
    });
    return {
      userId: match.user.id,
      membershipId: match.membership.id,
      organizationId: match.membership.organizationId,
    };
  }

  private transientCookie(name: string, value: string) {
    return serializeCookie(name, value, {
      httpOnly: true,
      secure: this.config.secure,
      sameSite: "Lax",
      path: "/auth/callback",
      maxAge: 600,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
    });
  }

  private clearCookie(name: string) {
    return serializeCookie(name, "", {
      httpOnly: name !== "tf_csrf",
      secure: this.config.secure,
      sameSite: name === "tf_csrf" ? "Strict" : "Lax",
      path: name.startsWith("tf_auth_") ? "/auth/callback" : "/",
      maxAge: 0,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
    });
  }
}

function constantEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
