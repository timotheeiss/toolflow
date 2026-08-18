# Toolflow MVP requirement audit

Date: 2026-08-10

This is the acceptance ledger for the PRD. “Verified” means the behavior exists in this workspace and has automated or browser evidence. “Deployment gate” means the production-capable code path exists, but a real provider/client environment must supply evidence. “Partial” identifies a concrete mismatch or missing layer; it is not counted as complete.

## Functional requirements

| Requirement | Status          | Evidence or remaining work                                                                                                                                             |
| ----------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001      | Verified        | Organization-scoped control schema, parent foreign keys, migration/schema tests.                                                                                       |
| FR-002      | Verified        | Control, MCP, runtime, and gateway principals derive from verified claims/signed context.                                                                              |
| FR-003      | Verified        | Shared policy package and server checks implement admin, builder, owner, and member roles.                                                                             |
| FR-004      | Verified        | Policy and data/runtime boundaries deny missing grants by default.                                                                                                     |
| FR-005      | Verified        | Each session/token resolves one active organization membership.                                                                                                        |
| FR-006      | Verified        | Runtime dispatcher and data gateway recheck active membership on every request.                                                                                        |
| FR-007      | Verified        | Production policy requires an active owner and ownership queries are live.                                                                                             |
| FR-008      | Verified        | Final-admin mutation protection is transactional and tested.                                                                                                           |
| FR-009      | Verified        | Official SDK Streamable HTTP endpoint performs protocol negotiation and reports protocol health.                                                                       |
| FR-010      | Deployment gate | OAuth metadata, PKCE S256, resource/audience verification, expiry, and exact configured endpoints exist; certify the named WorkOS/MCP clients.                         |
| FR-011      | Verified        | Every MCP tool has stable metadata, Zod input/output schemas, scopes, annotations, and error-code metadata.                                                            |
| FR-012      | Verified        | MCP list/search tools use opaque cursors, default 50, maximum 50.                                                                                                      |
| FR-013      | Verified        | Every mutation requires a key and replays an actor/organization/tool-scoped persistent result.                                                                         |
| FR-014      | Verified        | OAuth/HTTP and tool errors distinguish authentication, authorization, conflict, validation, rate, dependency, and internal failures.                                   |
| FR-015      | Verified        | MCP audit records tool metadata and timing only; centralized redaction excludes credentials/data.                                                                      |
| FR-016      | Verified        | All six app lifecycle states are modeled and surfaced.                                                                                                                 |
| FR-017      | Verified        | Organization/slug uniqueness persists across disabled and archived records.                                                                                            |
| FR-018      | Verified        | Full source bundles use immutable conditional-write object storage; metadata stays in PostgreSQL.                                                                      |
| FR-019      | Verified        | Source records contain the required parent, actor, time, hashes, and object reference.                                                                                 |
| FR-020      | Verified        | File updates require the current base version and return structured conflicts.                                                                                         |
| FR-021      | Verified        | Source policy enforces file/path/UTF-8/count/byte/editable-path limits before storage.                                                                                 |
| FR-022      | Verified        | Deletion writes a new full bundle; historical bundles remain readable.                                                                                                 |
| FR-023      | Verified        | Disable/archive changes lifecycle only and preserves source/history.                                                                                                   |
| FR-024      | Verified        | Platform template pins React, TypeScript, Vite, Hono, SDK, components, and tokens.                                                                                     |
| FR-025      | Verified        | Only explicit source/test/manifest/style paths are mutable.                                                                                                            |
| FR-026      | Verified        | Import policy permits relative files and the explicit platform allowlist only.                                                                                         |
| FR-027      | Verified        | Computed imports, eval/Function, WebAssembly, sockets, and subprocess APIs are rejected.                                                                               |
| FR-028      | Verified        | Runtime version records and the platform compiler own dependencies, lock/build config, and compatibility date.                                                         |
| FR-029      | Verified        | Generated artifacts expose health and consume only signed, normalized SDK context.                                                                                     |
| FR-030      | Verified        | Queue/worker implements queued, running, succeeded, failed, and timed-out jobs.                                                                                        |
| FR-031      | Verified        | A build binds one immutable source and runtime version.                                                                                                                |
| FR-032      | Verified        | Build-worker configuration contains DB/object access only; sensitive provider/runtime/connection credentials are absent and environment diagnostics are redacted.      |
| FR-033      | Verified        | Only the deployment worker accepts the scoped publication credential.                                                                                                  |
| FR-034      | Verified        | Artifacts are hash-addressed and conditional-write immutable.                                                                                                          |
| FR-035      | Verified        | Diagnostics have phase/code/message plus safe location/remediation fields where available.                                                                             |
| FR-036      | Verified        | Diagnostics are redacted and the worker clears diagnostic payloads after the default 30-day retention.                                                                 |
| FR-037      | Deployment gate | Publisher uploads one immutable user Worker per deployment; prove it in the pilot Cloudflare account.                                                                  |
| FR-038      | Deployment gate | Dispatch namespace is the only designed ingress and user scripts receive no route; verify provider route configuration.                                                |
| FR-039      | Verified        | Persisted opaque preview/production route keys map exact wildcard hostnames to organization/app/environment; authorization resolves the active deployment server-side. |
| FR-040      | Verified        | Private authorization checks identity, organization, membership, app status, and active successful deployment.                                                         |
| FR-041      | Verified        | Spoofable headers are stripped; generated code receives public context only, while gateway credentials remain outbound bindings.                                       |
| FR-042      | Verified        | Outbound Worker defaults closed and injects the short-lived deployment token only for exact gateway endpoints.                                                         |
| FR-043      | Verified        | Parsed scheme/host/port/path matching and manual redirect rejection are tested.                                                                                        |
| FR-044      | Verified        | Configurable CPU, subrequest, 8 MB output, and 30-second duration limits wrap generated execution.                                                                     |
| FR-045      | Deployment gate | Deployment adapter selects distinct preview/production namespaces; provision and inspect both namespaces.                                                              |
| FR-046      | Verified        | Connection contract and inspector support PostgreSQL only.                                                                                                             |
| FR-047      | Verified        | Opaque UUID references point to AES-GCM envelopes with provider-wrapped per-secret data keys; production refuses the local master-key backend.                         |
| FR-048      | Verified        | Browser/MCP responses expose safe metadata only and never return password or complete URI.                                                                             |
| FR-049      | Verified        | Only admin-reviewed schemas/tables enter the active catalog and query allowlist.                                                                                       |
| FR-050      | Verified        | Refresh creates a versioned diff; removal/breaking changes require explicit reviewed apply.                                                                            |
| FR-051      | Verified        | Catalog metadata includes description, owner, lifecycle, source-of-truth, and sensitivity.                                                                             |
| FR-052      | Verified        | All four sensitivity values are contracted and validated.                                                                                                              |
| FR-053      | Verified        | Restricted objects are omitted from agent search and rejected by query capability resolution.                                                                          |
| FR-054      | Verified        | Search returns structural/relational annotations and catalog version, never rows.                                                                                      |
| FR-055      | Verified        | Only a signed, deployment-bound gateway context reaches external queries.                                                                                              |
| FR-056      | Verified        | PostgreSQL statements are parsed into an AST before authorization.                                                                                                     |
| FR-057      | Verified        | One read-only SELECT/WITH statement, bound parameters, and active declared relations are enforced.                                                                     |
| FR-058      | Verified        | Writes/DDL/COPY/transactions/multiple statements/system objects/temporary and unapproved functions/schemas are rejected.                                               |
| FR-059      | Verified        | Read-only transaction, 5-second timeout, 1,000 rows, 5 MB, cursor, and disconnect cancellation are implemented.                                                        |
| FR-060      | Verified        | Results return directly to the request and no result cache exists.                                                                                                     |
| FR-061      | Verified        | Audit/usage metadata includes counts and relation names only, not rows or plaintext parameters.                                                                        |
| FR-062      | Verified        | Preview and production data spaces use separate app/environment-derived schemas.                                                                                       |
| FR-063      | Verified        | Generated apps use SDK routes; managed SQL is generated only inside the gateway.                                                                                       |
| FR-064      | Verified        | Schema identity comes from the verified deployment context; client organization/schema values are ignored.                                                             |
| FR-065      | Verified        | Planner supports create table, nullable column, index, and foreign key only.                                                                                           |
| FR-066      | Verified        | Production plans are immutable, hash-bound, additive, and automatically derived for the selected build.                                                                |
| FR-067      | Verified        | Preview has an independent schema and no production-copy operation.                                                                                                    |
| FR-068      | Deployment gate | Recovery plan covers control and production app data; enable encrypted provider PITR and execute the drill.                                                            |
| FR-069      | Verified        | Rollback reuses an artifact and never applies reverse schema operations.                                                                                               |
| FR-070      | Verified        | Preview and production are the only deployment environments.                                                                                                           |
| FR-071      | Verified        | Deployment rows bind all required immutable source/build/artifact/manifest/capability/schema/runtime/actor records.                                                    |
| FR-072      | Verified        | Preview creation is self-service while retaining ownership authorization and audit.                                                                                    |
| FR-073      | Verified        | Admins and app owners can deploy an exact successfully previewed build with one call.                                                                                  |
| FR-074      | Verified        | Production deployment derives and persists the required additive schema plan automatically.                                                                            |
| FR-075      | Verified        | External capabilities are revalidated against active connections and approved catalog relations immediately before deployment.                                         |
| FR-076      | Verified        | Destructive schemas and capabilities outside current catalog guardrails fail validation.                                                                               |
| FR-077      | Verified        | Production deployment uses ownership/admin authority without creating human approval records.                                                                          |
| FR-078      | Verified        | Deployment preflights, applies additive schema, uploads, privately probes health, then atomically activates.                                                           |
| FR-079      | Verified        | Failure records the attempt without moving the active pointer.                                                                                                         |
| FR-080      | Verified        | Rollback uses a successful existing artifact and re-runs current capability policy.                                                                                    |
| FR-081      | Verified        | Append-only security audit and operational usage are separate tables/paths.                                                                                            |
| FR-082      | Verified        | Audit contract/table contains every required identity, target, environment, request, outcome, and metadata field.                                                      |
| FR-083      | Verified        | A database trigger prevents update/delete; corrections are new events.                                                                                                 |
| FR-084      | Verified        | Authentication, admin, catalog, source/build/deploy, access, data, rollback, disable, export, and egress events are covered.                                           |
| FR-085      | Verified        | Usage carries request/trace/organization/app/environment/deployment identifiers through dispatch and gateway.                                                          |
| FR-086      | Verified        | Activity exposes requests, bounded unique users, latency/errors, queries/writes, and build/deployment outcomes.                                                        |
| FR-087      | Verified        | Raw user ID is SHA-256 scoped before analytics aggregation.                                                                                                            |
| FR-088      | Verified        | Export is admin-only, filtered, capped at 5,000 rows, separately rate-limited, and audited.                                                                            |
| FR-089      | Verified        | Routes/surfaces exist for overview, users, branding/settings, connections, catalog, apps, and activity/audit.                                                          |
| FR-090      | Verified        | App list contains every required column and controls.                                                                                                                  |
| FR-091      | Verified        | App detail contains all required histories, policy, activity, membership, and emergency sections.                                                                      |
| FR-092      | Verified        | App/connection disable and other service-impacting controls require exact target confirmation and reason.                                                              |
| FR-093      | Verified        | Admin tables provide shared loading/empty/error and bounded pagination states.                                                                                         |
| FR-094      | Verified        | Every UI operation is re-authorized in the control API/store; UI visibility is not trusted.                                                                            |

## Non-functional requirements

| Requirement | Status          | Evidence or remaining work                                                                                                                                                                                                          |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001     | Deployment gate | Production config rejects insecure platform origins/TLS modes; verify certificates and provider-only HTTPS routes.                                                                                                                  |
| NFR-002     | Verified        | AES-GCM/KMS data-key envelopes, production fail-closed configuration, zeroization, and credential exclusion/redaction are tested.                                                                                                   |
| NFR-003     | Verified        | Preview/production namespaces and data spaces are distinct; generated code receives no production secret.                                                                                                                           |
| NFR-004     | Verified        | The executable authorization matrix covers every role permission plus cross-organization, cross-app, cross-environment, ownership, membership/revocation, runtime-route, SQL, egress, catalog, secret, and audit-integrity denials. |
| NFR-005     | Verified        | Cookie-authenticated mutations use exact-origin CORS and double-submit CSRF.                                                                                                                                                        |
| NFR-006     | Verified        | WorkOS sealed cookies are Secure/HttpOnly/SameSite and rotate on refresh/authentication.                                                                                                                                            |
| NFR-007     | Verified        | Control and MCP use atomic shared PostgreSQL quotas keyed by hashed organization/actor identity; runtime dispatch uses a tested Cloudflare shared rate-limit binding before generated execution.                                    |
| NFR-008     | Partial         | CI is configured for a high/critical dependency audit and Dependabot; execute it in the authorized repository and scan the selected fixed build-container image before release.                                                     |
| NFR-009     | Verified        | Central recursive structured redaction is tested and used at sensitive boundaries.                                                                                                                                                  |
| NFR-010     | Deployment gate | Configure encrypted backups and pass the documented restore drill before company data.                                                                                                                                              |
| NFR-011     | Deployment gate | 99.5% is documented as a service objective; configure production probes/alerts and collect a monthly report.                                                                                                                        |
| NFR-012     | Deployment gate | Select providers and prove at least seven days of PITR.                                                                                                                                                                             |
| NFR-013     | Verified        | Queue claims, mutation records, publication jobs, and active-pointer operations are retry-safe/idempotent.                                                                                                                          |
| NFR-014     | Verified        | State transitions preserve active production on build/migration/deploy/rollback failure.                                                                                                                                            |
| NFR-015     | Deployment gate | Recovery procedures cover all five scenarios; execute and attach provider drill evidence.                                                                                                                                           |
| NFR-016     | Deployment gate | Bounded/indexed reads are designed for the target; obtain p95 control-plane load evidence.                                                                                                                                          |
| NFR-017     | Deployment gate | MCP reads are bounded/paginated; obtain named-client p95 evidence.                                                                                                                                                                  |
| NFR-018     | Deployment gate | Five-minute hard build limit exists; obtain build/preview p95 evidence in the production worker.                                                                                                                                    |
| NFR-019     | Deployment gate | Private authorization and one dispatch hop are implemented; obtain production p95 evidence under load.                                                                                                                              |
| NFR-020     | Verified        | Automated policy/gateway code enforces 5 seconds, 1,000 rows, and 5 MB.                                                                                                                                                             |
| NFR-021     | Verified        | CPU/subrequest/output/duration defaults are enforced and recorded in ADR-002.                                                                                                                                                       |
| NFR-022     | Partial         | Semantic snapshots have no unnamed controls; modal focus trap/return and brand contrast are browser/unit verified. Complete the formal WCAG 2.1 AA audit recorded in `docs/browser-verification.md`.                                |
| NFR-023     | Deployment gate | Run the browser suite on current/previous Chrome, Firefox, and Safari for the pilot matrix.                                                                                                                                         |
| NFR-024     | Partial         | `docs/browser-verification.md` records all locally exercised routes, dialogs, generated apps, reversible mutations, and accessibility checks; seven provider-backed UI stories still require pilot evidence.                        |
| NFR-025     | Deployment gate | 365-day policy is documented; configure provider partition/archive retention and prove it.                                                                                                                                          |
| NFR-026     | Deployment gate | Build diagnostics self-expire at 30 days; configure 30-day log/trace/raw-usage provider retention.                                                                                                                                  |
| NFR-027     | Verified        | Telemetry/audit paths exclude rows, app records, passwords, tokens, and complete bodies.                                                                                                                                            |
| NFR-028     | Verified        | Founder-assisted export, retention, deletion, backup-expiry, and verification checklist is documented.                                                                                                                              |

## Acceptance conclusion

The local implementation is feature-complete for the pilot workflow. Provider-backed and empirical requirements remain deployment gates; they cannot be truthfully closed from a local workspace.

Go-live remains blocked until every item in `docs/pilot-readiness-checklist.md` has named evidence and the PRD definition-of-done drills/client/browser/security review have passed.
