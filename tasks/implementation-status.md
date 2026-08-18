# Toolflow MVP implementation status

This file tracks implementation evidence against the milestones in the PRD. A checked item requires code and verification evidence; it is not a statement of intent.

## Milestone 0: Foundations

- [x] Monorepo and shared checks — pnpm check passes
- [x] Shared contracts — schema tests pass
- [x] Policy engine — role, ownership, and self-service production permissions pass
- [x] Control-plane database schema and migrations — migration and database integration tests pass
- [x] Organization-aware request context — API authentication tests pass
- [x] Centralized redaction — recursive and cyclic-value tests pass
- [x] Append-only audit writer — validated writer plus database mutation-prevention trigger
- [x] Authentication provider boundary — development and JWKS/OIDC adapters compile and test

## Milestone 1: Organization administration and context

- [x] Users and organization memberships — invite, role/status change, final-admin protection, server authorization, and audit coverage
- [x] Branding — normalized accessible tokens, guidance, validated logo upload, and admin editor
- [x] PostgreSQL connections and secret references — encrypted secret envelopes, TLS policy, test/disable/remove dependency controls
- [x] Data catalog import and curation — reviewed diff/apply flow, lifecycle, sensitivity, owner, and source-of-truth metadata
- [x] Admin application navigation — overview, apps/detail, users, connections, catalog, activity, and settings

## Milestone 2: MCP and source control

- [x] MCP OAuth and transport — MCP SDK Streamable HTTP, OAuth discovery/PKCE metadata, resource/audience scopes, host/origin checks
- [x] Read tools — organization, users, branding, apps/files, connections, catalog/schema, members, deployment, and activity
- [x] App discovery and creation — duplicate-aware search and fixed governed template
- [x] Immutable source storage — full bundles, content hashes, shared conditional-write S3/R2 production store
- [x] Optimistic source updates — parent-version conflict detection, editable-path/quota policy, persistent idempotency boundary
- [x] Manifest and capability validation — strict schema plus capability and managed-schema version records

## Milestone 3: Build and preview runtime

- [x] Fixed app template and SDK — pinned React/TypeScript/Hono stack, component package, data SDK, platform-owned build config
- [ ] Sandboxed builds — asynchronous queue/worker, sanitized environment, deterministic compiler, timeout and artifact limits are implemented; production still must apply the documented container-level memory and network controls
- [x] Dispatch and outbound Workers — dynamic namespace lookup, private authorization, immutable script IDs, CPU/subrequest limits, deny-by-default outbound gateway, CSP nonce
- [x] Preview deployment — isolated schema, authenticated route, preview banner, actual post-upload Worker health probe, atomic pointer
- [x] App membership enforcement — live active-membership check on dispatch and gateway, generic denial, immediate revocation

## Milestone 4: Governed data

- [x] External read gateway — signed deployment context, secret isolation, read-only transaction, timeout, disconnect cancellation, row/byte limits
- [x] SQL policy enforcement — AST-based single-read validation, exact relation/function allowlists, system/write/DDL/COPY rejection, parameter binding
- [x] Managed app schemas and CRUD — per-app/environment schemas, declared typed values, platform-generated parameterized SQL
- [x] Additive schema planner — hash-addressed create-table/add-column/index/foreign-key plans and environment application

## Milestone 5: Production deployment

- [x] Self-service production deployment — one MCP call validates the exact previewed build, catalog guardrails, and additive schema plan
- [x] Automatic schema application — production plans are derived, hash-addressed, additive-only, and applied before activation
- [x] Deployment orchestration and health checks — isolated Cloudflare publisher, artifact re-hash, startup validation and private runtime invocation
- [x] Atomic activation and safe failure — running/failed/succeeded records; active pointer changes only after publish and health success

## Milestone 6: Pilot readiness

- [x] Activity and audit views — correlated request/trace telemetry, app/build/deployment metrics, eight-dimension filtering, pagination, current-filter CSV, 5,000-row/export-rate limit
- [x] Rollback — existing successful artifact only, current catalog validation, and additive-schema warning
- [x] App and connection disable controls — exact target confirmation, reason, audit, dependency checks, retained history/data
- [ ] Recovery runbook and drills — runbook and evidence checklist are implemented; an actual provider PITR drill requires the pilot environment
- [ ] End-to-end browser verification — `docs/browser-verification.md` records broad real-browser local coverage and the exact provider-backed stories that still require pilot evidence
- [x] Repeatable local browser suite — Playwright exercises all seven admin routes, named controls, modal keyboard behavior, user governance, branding persistence, and filtered audit export in CI
- [x] Requirement-by-requirement completion audit — `tasks/requirements-audit.md` grades all 94 functional and 28 non-functional requirements; partials and external evidence remain explicitly unclaimed
- [x] Shared public-endpoint quotas — atomic hashed PostgreSQL buckets cover control/MCP replicas and the runtime dispatch Worker enforces the trusted organization/actor quota through Cloudflare's shared binding

## External pilot gates

These are not code changes and cannot be marked complete in a local workspace:

- Select and configure the production region and data-residency boundary.
- Provision WorkOS, PostgreSQL PITR, R2/S3 versioning, Cloudflare dispatch namespaces, custom domain, and production secrets.
- Apply the build-worker container/network limits in the target orchestrator and run the restore drill.
- Provision the selected production KMS broker plus the Toolflow wildcard runtime DNS/TLS route and verify both fail-closed boundaries.
- Certify named Codex/Claude MCP clients and complete pilot-user acceptance.
