import { describe, expect, it } from "vitest";
import {
  bearerTokenFromRequest,
  DevelopmentHeaderAuthenticator,
  identityFromClaims,
} from "./index.js";

describe("identityFromClaims", () => {
  it("maps audience-bound token identity claims", () => {
    expect(identityFromClaims({ sub: "user_1", org_id: "org_1", sid: "session_1" })).toEqual({
      externalUserId: "user_1",
      externalOrganizationId: "org_1",
      sessionId: "session_1",
    });
  });

  it("rejects a token without organization scope", () => {
    expect(() => identityFromClaims({ sub: "user_1" })).toThrow();
  });
});

describe("request authentication helpers", () => {
  it("accepts only an exact Bearer header", () => {
    expect(
      bearerTokenFromRequest(
        new Request("https://toolflow.test", { headers: { authorization: "Bearer abc" } }),
      ),
    ).toBe("abc");
    expect(
      bearerTokenFromRequest(
        new Request("https://toolflow.test", { headers: { authorization: "Basic abc" } }),
      ),
    ).toBeNull();
  });

  it("resolves development headers without trusting invalid roles", async () => {
    const authenticator = new DevelopmentHeaderAuthenticator();
    const principal = await authenticator.authenticate(
      new Request("https://toolflow.test", {
        headers: {
          "x-toolflow-dev-user-id": "user-id",
          "x-toolflow-dev-membership-id": "membership-id",
          "x-toolflow-dev-organization-id": "organization-id",
          "x-toolflow-dev-role": "builder",
        },
      }),
    );

    expect(principal?.role).toBe("builder");
  });
});
