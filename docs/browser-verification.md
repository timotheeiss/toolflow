# Browser verification record

Date: 2026-08-10

This record separates behavior exercised in the real in-app browser from flows that require a provisioned identity, data, or deployment provider. A rendered page or dialog inspection is not counted as proof of an external integration.

## Verified locally

The browser loaded the complete admin navigation and the following surfaces against the live local control API:

- Overview, app registry, app detail, users, connections, data catalog, activity/audit, and organization settings.
- Generated preview and production app pages, including the preview-environment banner and the generated app health/content shell.
- App activity time-window controls for 24 hours, 7 days, and 30 days, plus preview/production environment filters and the explicit no-errors/telemetry-delay state.
- Audit filters, bounded pagination, request-ID filtering, and the filtered-export control.
- User and connection dialogs, including Escape-to-close, Tab/Shift+Tab focus containment, autofocus, and focus restoration to the invoking control.

The following reversible mutations were exercised through the rendered UI:

- An existing test user's role changed from admin to member, then builder, then back to admin.
- The same user was deactivated and reactivated; the final state was restored to `admin / active`.
- Existing branding values were submitted through the settings form without changing their persisted values.
- App activity filters were changed to 24 hours and production and reflected in the rendered state.

The accessibility inspection found no unnamed interactive controls in stored semantic snapshots for the seven admin routes, app detail, generated apps, or the user/connection dialogs. Repeated row actions include the target name, the color inputs have distinct accessible names, modal keyboard behavior was manually exercised, and brand foreground selection has automated contrast-ratio tests.

The repeatable Chromium suite in `tests/e2e/admin.spec.ts` starts the real admin and control services and verifies all seven routes, named interactive controls, modal focus containment/restoration, user invitation/role/deactivation/reactivation, branding persistence and feedback, and filtered audit export. CI installs the version-matched browser and preserves traces, screenshots, video, and the HTML report on failure.

## Corroborating non-browser evidence

- The live MCP integration suite covers immutable source updates, preview schema application, one-call production deployment with automatic additive schema application, generated-page health, managed-data isolation, app membership grant/revoke, tenant isolation, and rollback-safe records.
- The authorization matrix covers every role permission and negative cross-organization, cross-app, cross-environment, ownership, membership, route, SQL, egress, catalog-guardrail, secret, and audit-integrity boundary.

## Evidence still required before pilot completion

These UI stories remain open because the local development adapters cannot prove the external behavior:

- US-001: complete Google sign-in and deactivated-session denial through the selected WorkOS tenant.
- US-004: create, test, curate, disable, and remove a real TLS PostgreSQL connection using the pilot database role.
- US-005: review and apply a populated catalog refresh containing additions, removals, and type changes.
- US-020: publish and authenticate to a stable production URL in the provisioned Cloudflare namespace.
- US-024: execute a browser-initiated rollback against two provider-backed successful deployments.
- US-025: exercise app and connection disable/re-enable and measure propagation in every runtime location.
- NFR-022: perform the formal WCAG 2.1 AA audit with the selected audit tooling.
- NFR-023: run the user-story suite on the current and previous Chrome, Firefox, and Safari matrix.

NFR-024 therefore remains partial: local browser coverage is broad, but it is not truthful to mark every UI user story complete before these provider-backed cases run.
