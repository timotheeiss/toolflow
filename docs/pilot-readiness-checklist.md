# Pilot readiness checklist

- [ ] Record the chosen cloud region and verify PostgreSQL, object storage, audit, and managed-data residency.
- [ ] Configure WorkOS organization SSO and test login, logout, rotation, deactivation, and final-admin protection.
- [ ] Store the trusted-pilot envelope-encryption key only in Vercel environment variables, record the accepted risk, and schedule KMS-backed encryption before onboarding untrusted builders.
- [ ] Create the `toolflow-production` Cloudflare dispatch namespace, deploy the dispatch and outbound Workers, and scope the publisher token to Workers Scripts Write.
- [ ] Provision wildcard DNS/TLS for the configured app base host and verify exact persisted route-key hostnames plus suffix-confusion denial.
- [ ] Confirm the build project contains only its database, R2, and build-service credentials; cap builds at 220 seconds and do not onboard untrusted builders.
- [ ] Configure R2 storage with encryption, conditional-write permissions, and no delete permission for application identities.
- [ ] Enable PostgreSQL encrypted PITR and complete the recovery drill in `docs/runbooks/recovery.md`.
- [ ] Set 365-day audit and 30-day telemetry/build-log retention policies.
- [ ] Configure edge rate limiting in addition to application actor/organization limits.
- [ ] Run `pnpm check`, database integration tests, the MCP lifecycle integration, and browser verification for every required admin page.
- [ ] Run the current and previous Chrome, Firefox, and Safari matrix and attach WCAG 2.1 AA audit results.
- [ ] Rerun the automated authorization matrix in `docs/security/authorization-test-matrix.md` against the provisioned pilot and attach the environment-specific evidence.
- [ ] Confirm the admin app detail exposes metadata only and no source contents, artifact object keys, credentials, tokens, query values, or app records.
- [ ] Enroll pilot admins/builders, assign app ownership, document support and incident contacts, and capture explicit go-live approval.
- [ ] Complete dependency/build-image scanning and an independent pilot-scope security review with no unresolved high or critical finding.
