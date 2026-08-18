# Toolflow MVP threat model

## Assets and trust boundaries

The protected assets are organization identity, source bundles, artifacts, external connection credentials, catalog metadata, managed app data, active deployment pointers, and audit events. The principal boundaries are AI client → MCP, browser → control API, browser → runtime dispatch, generated Worker → outbound Worker, outbound Worker → data gateway, worker services → control database/object storage, and deployment worker → Cloudflare.

Generated source and server bundles are untrusted. MCP clients, browser input, SQL, source files, manifests, forwarded headers, and provider responses are attacker-controlled until validated. Toolflow operators have no standing customer-data access.

## Primary threats and controls

| Threat                               | Control                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-organization object access     | Organization predicates at every repository query; signed runtime context binds organization, app, deployment, user, membership, and environment; negative authorization tests.                                                                                              |
| MCP confused deputy or replay        | OAuth resource/audience and scopes, origin/host validation, role/ownership checks, required idempotency keys, stable request hashes, and serialized replay records.                                                                                                          |
| Malicious generated code             | Fixed dependency/runtime set, source/import policy, typecheck/tests/bundle validation, isolated Vercel build project, 220-second/8 MB limits, and per-dispatch Worker CPU/subrequest limits.                                                                                 |
| Credential exfiltration              | Generated Workers receive no database, R2, WorkOS, Cloudflare publisher, or runtime-context credentials. The trusted build project has database/R2 credentials and is restricted to trusted builders until sandboxing is added.                                                   |
| Egress or hostname confusion         | Exact scheme/host/port/path match, HTTPS-only production origins, redirect rejection, `connect()` disabled by outbound Worker, and redacted denied-egress audit events.                                                                                                      |
| SQL injection or data overreach      | One parsed PostgreSQL read statement, relation/function allowlists, placeholder/parameter validation, read-only transaction, timeout, disconnect cancellation, 1,000-row and 5 MB limits. Managed CRUD is platform-generated SQL only.                                       |
| Unauthorized production change       | Only an admin or app owner can deploy an exact successfully previewed build; external capabilities are revalidated against active catalog guardrails, managed-schema changes are additive-only, and activation is atomic after publication.                                  |
| Artifact/source substitution         | Immutable full source versions, pinned runtime versions, content-addressed artifacts, conditional object writes, hash verification by the deployment worker, and immutable deployment references.                                                                            |
| Route/host confusion                 | Opaque persisted preview/production route keys, exact wildcard-base hostname matching, server-side route lookup, active-pointer resolution, and suffix-confusion tests.                                                                                                      |
| Session/CSRF attack                  | WorkOS sealed HttpOnly Secure sessions, rotation, exact-origin CORS, double-submit CSRF for cookie mutations, and server-side authorization.                                                                                                                                 |
| Audit tampering or sensitive logging | Append-only database trigger, application identities without update/delete, centralized redaction, metadata-only data audits, size-limited filtered exports, export auditing, and rate limits.                                                                               |
| Denial of service                    | Shared hashed actor/organization PostgreSQL quotas, Cloudflare runtime rate-limit bindings, client ceilings, Worker CPU/subrequest limits, request/source/artifact/result size limits, statement/build/deployment timeouts, and bounded pagination.                          |

## Residual pilot risks

- The local negative coverage is indexed in `docs/security/authorization-test-matrix.md`; provider identity, routing, and edge configuration still require the independent pilot-scope security review.

- The production Cloudflare rate-limit namespace and configured quota must be inspected during pilot provisioning; application tests cannot prove provider-account configuration.
- Trusted-builder source executes in the isolated Vercel build project and can access that project's database/R2 credentials. Do not onboard untrusted builders until compilation runs in a sandbox with scoped credentials.
- Provider backup/PITR and regional residency are deployment controls and must be evidenced before real company data is connected.
- Browser and MCP compatibility is certified only for the named pilot clients. New clients require transport, OAuth, and tool-schema testing.

Review this model after any new connector, runtime API, dependency allowlist entry, deployment provider, or data operation.
