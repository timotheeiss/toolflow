# PRD: Toolflow MVP

Status: Draft for implementation planning  
Version: 0.1  
Date: 2026-08-10  
Product owner: TBD  
Implementation status: Not started

## 1. Introduction and overview

Toolflow is an agent-first platform for creating, deploying, governing, and monitoring internal operational tools. It gives operations teams a centralized alternative to scattered, unowned, agent-generated applications and removes the need for non-technical builders to understand conventional deployment platforms.

The MVP has one primary promise:

> An operations builder can use a compatible AI agent to create, preview, and publish an authenticated internal CRUD application without handling infrastructure, credentials, or an approval queue.

The product consists of five logical systems:

1. An authenticated MCP gateway used by external AI agents.
2. A control plane for organizations, users, apps, source versions, policies, and deployments.
3. A runtime plane that executes each generated app in isolation.
4. A governed data gateway for read-only company data and writable Toolflow-managed app data.
5. A minimal admin web app for setup, governance, and monitoring.

The MVP is not an app builder. AI agents create source code using a fixed Toolflow application stack. Toolflow provides the safe infrastructure and lifecycle around that code.

## 2. Confirmed product decisions

The following decisions were explicitly selected during discovery and are requirements, not assumptions.

| Decision              | Confirmed choice                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Initial customer      | A 20–500-person technology company using Google Workspace and PostgreSQL or SaaS data tools           |
| Primary user          | An operations employee who can direct an AI coding agent but should not need infrastructure expertise |
| MVP job               | Create, deploy, and share governed internal CRUD applications                                         |
| External company data | Read-only access to explicitly approved sources                                                       |
| Writable data         | Restricted to an isolated Toolflow-managed database namespace owned by the app                        |
| Source ownership      | Toolflow-native source and version storage, edited through MCP; Git export is deferred                |
| Preview governance    | Builders may deploy previews without human approval                                                   |
| Production governance | App owners deploy directly inside active catalog guardrails; production schemas remain additive-only  |

## 3. Explicit MVP working defaults

These defaults make the PRD implementable. They remain visible so they can be changed before engineering starts.

| Topic                           | MVP working default                                                                          | Status                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| First connector                 | PostgreSQL over a public TLS endpoint or approved IP allowlist                               | Proposed default                       |
| Identity provider               | WorkOS AuthKit with Google sign-in and organization membership                               | Proposed default                       |
| Runtime                         | Cloudflare Workers for Platforms in untrusted mode                                           | Proposed default                       |
| Runtime egress                  | Deny by default; only Toolflow-owned API hostnames are allowed                               | Proposed default                       |
| Control database                | Managed PostgreSQL with organization-scoped rows                                             | Proposed default                       |
| Application URL                 | Toolflow-managed subdomain; no custom domain in MVP                                          | Proposed default                       |
| App roles                       | Owner and member only; all members have the same in-app platform access                      | Proposed default                       |
| Audit retention                 | 365 days                                                                                     | Proposed default                       |
| Operational telemetry retention | 30 days                                                                                      | Proposed default                       |
| Pilot scale                     | Up to 10 organizations, 100 apps per organization, and 1,000 users per organization          | Design target, not a contractual limit |
| Commercial pilot                | Founder-assisted paid design partnership at a recommended EUR 500 per organization per month | Pricing hypothesis                     |

No architecture decision in this table may be treated as permanent. Each must be recorded as an architecture decision record when implementation begins.

## 4. Goals

- Enable a new builder to create an app and receive a working preview URL in under 30 minutes without visiting a cloud hosting dashboard.
- Enable an app owner to deploy an exact successfully previewed build to production with one MCP call.
- Ensure every MCP mutation, deployment, permission change, app access, and data request is attributable to an actor and organization.
- Prevent generated source code from receiving raw external database credentials or Toolflow infrastructure credentials.
- Prevent deployed apps from making unapproved outbound network requests.
- Ensure every production app has an active owner, an explicit member list, an immutable deployed source version, and a rollback target.
- Let an admin disable an app or data connection within 60 seconds.
- Validate the product with at least one paid design partner before adding more frameworks or connectors.

## 5. Non-goals

The following are explicitly out of scope for the MVP:

- A visual or no-code app builder.
- Arbitrary programming languages, frameworks, package installation, or native binaries.
- GitHub, GitLab, or Bitbucket as the source of truth.
- Git synchronization or source export.
- Direct writes, migrations, or data definition changes against an external company database.
- Connectors other than PostgreSQL.
- Cached, replicated, or webhook-synchronized external data.
- Row-level mapping from source-system permissions into Toolflow apps.
- Per-record or custom business-role authorization managed by Toolflow.
- Arbitrary internet access from generated apps.
- Background jobs, cron jobs, queues, email sending, or workflow automation inside generated apps.
- File uploads or binary source assets in generated apps.
- Custom domains.
- SAML SSO, SCIM directory synchronization, or identity-provider group synchronization.
- Self-hosting, customer VPC deployment, private database networking, or data-residency selection.
- Mobile applications or native clients.
- Destructive production schema migrations, column renames, type changes, table deletion, or automated data backfills.
- Automated schema rollback after a production migration.
- Billing, usage-based invoicing, or self-service subscriptions.
- A public app marketplace or cross-organization sharing.
- Formal compliance certification such as SOC 2 or ISO 27001 during the MVP.

## 6. Personas and roles

### 6.1 Organization admin

An operations, data, IT, or security owner responsible for Toolflow within one company. An admin can manage users, branding, connections, catalog visibility, app ownership, and emergency controls.

### 6.2 Builder

An operations employee who creates and updates apps through an external AI agent. A builder can inspect approved organizational context, edit Toolflow-native source, deploy owned apps to preview and production, and manage an app's members.

### 6.3 App member

An employee granted access to a deployed app. A member can use the app but cannot edit source, deploy versions, or inspect Toolflow administration data.

### 6.4 Toolflow operator

A Toolflow team member operating the service. Operators have no standing access to customer data. Any future break-glass access must be time-bound, reason-coded, and audited; break-glass functionality is not part of the MVP.

### 6.5 Permission matrix

| Capability                         |      Admin |        Builder | App member |
| ---------------------------------- | ---------: | -------------: | ---------: |
| Read approved organization context |        Yes |            Yes |         No |
| Manage organization users          |        Yes |             No |         No |
| Manage branding                    |        Yes |             No |         No |
| Create or remove a connection      |        Yes |             No |         No |
| Curate the data catalog            |        Yes |             No |         No |
| Create an app                      |        Yes |            Yes |         No |
| Edit an owned app                  |        Yes |            Yes |         No |
| Deploy a preview                   |        Yes |            Yes |         No |
| Deploy an owned app to production  |        Yes |            Yes |         No |
| Manage app members                 |        Yes | App owner only |         No |
| Disable any app                    |        Yes |             No |         No |
| Roll back an app                   |        Yes | App owner only |         No |
| View organization-wide activity    |        Yes |             No |         No |
| View owned-app activity            |        Yes |            Yes |         No |
| Use an app                         | If granted |     If granted |        Yes |

## 7. Core user journey

1. A Toolflow operator manually creates the design partner's organization.
2. An admin signs in with Google, configures branding, and invites builders and app users.
3. The admin creates a PostgreSQL connection using a dedicated read-only credential and selects the schemas and tables that Toolflow may expose.
4. Toolflow imports metadata. The admin adds descriptions, ownership, status, and sensitivity labels.
5. A builder authorizes Toolflow from a compatible AI agent using delegated OAuth.
6. The agent searches existing apps and the approved data catalog before creating anything.
7. The agent creates an app, receives the fixed template, and updates text source files through MCP.
8. The agent declares required data capabilities and the desired Toolflow-managed app schema.
9. Toolflow validates and builds the immutable source version.
10. The builder deploys a preview. Preview uses a separate app-data namespace and cannot reach production app data.
11. The builder grants organization users access and tests the preview.
12. The agent deploys the exact previewed build to production with one call.
13. Toolflow revalidates catalog capabilities, derives and applies any additive production schema plan, deploys the immutable artifact, and records the event.
14. Members open the Toolflow URL, authenticate, and use the app.
15. Admins and builders inspect activity, errors, deployments, and data-access counts.
16. If necessary, an authorized actor rolls back the source deployment or an admin disables the app immediately.

## 8. User stories

### US-001: Sign in to an organization

**Description:** As an organization user, I want to sign in with my work Google account so that Toolflow can identify my organization and role.

**Acceptance Criteria:**

- [ ] A user can authenticate through WorkOS AuthKit using Google.
- [ ] Access is rejected when the authenticated user has no active Toolflow organization membership.
- [ ] Every application session contains a stable user ID, organization ID, and Toolflow role.
- [ ] A deactivated membership is denied on the next authenticated request.
- [ ] Authentication events are audited without recording tokens.
- [ ] Typecheck, lint, and automated authentication tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-002: Manage organization users

**Description:** As an admin, I want to invite, change, and deactivate users so that organization access remains current.

**Acceptance Criteria:**

- [ ] The admin can list active, invited, and deactivated users.
- [ ] The admin can invite a user by email as admin, builder, or member.
- [ ] The system prevents removing or demoting the final active admin.
- [ ] Deactivating a user revokes Toolflow sessions and future app access.
- [ ] Apps owned only by a deactivated user are marked orphaned and cannot receive new deployments until reassigned.
- [ ] Each mutation creates an audit event with actor, target, before state, after state, and outcome.
- [ ] Typecheck, lint, and automated authorization tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-003: Configure organization branding

**Description:** As an admin, I want to define basic organization branding so that generated apps look recognizably internal.

**Acceptance Criteria:**

- [ ] The admin can set organization display name, logo, primary color, and optional written design guidance.
- [ ] Toolflow validates image type and size before storing a logo.
- [ ] Toolflow computes accessible foreground colors and falls back when the chosen color fails contrast requirements.
- [ ] The MCP organization-context response returns normalized branding tokens and guidance.
- [ ] Generated app templates consume the branding tokens without embedding organization secrets.
- [ ] Typecheck, lint, and UI tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-004: Create a read-only PostgreSQL connection

**Description:** As an admin, I want to connect an approved PostgreSQL source so that builders can use company data without receiving credentials.

**Acceptance Criteria:**

- [ ] Only admins can create, test, update, disable, or remove a connection.
- [ ] The connection requires TLS unless a development-only environment flag is enabled.
- [ ] The credential is encrypted by the secrets service and is never returned by APIs or MCP.
- [ ] The connection test reports connectivity, server version, visible schemas, and effective write privileges.
- [ ] The connection cannot be activated if the configured role has insert, update, delete, truncate, create, or temporary-object privileges on approved objects.
- [ ] An admin selects explicit schemas and tables; nothing is exposed by default.
- [ ] Removing a connection is blocked while a production app depends on it; disabling remains available.
- [ ] Typecheck, lint, connector integration tests, and secret-redaction tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-005: Curate the semantic data catalog

**Description:** As an admin, I want to document approved data objects so that agents understand which data is authoritative and safe to use.

**Acceptance Criteria:**

- [ ] Toolflow imports approved schemas, tables, columns, types, nullability, primary keys, and foreign keys.
- [ ] An admin can set descriptions, business owner, source-of-truth status, lifecycle status, and sensitivity for tables and columns.
- [ ] Lifecycle status supports active, deprecated, and hidden.
- [ ] Hidden objects are never returned to builders or generated apps.
- [ ] Deprecated objects are returned with a machine-readable warning.
- [ ] Metadata refresh shows a diff before applying removals or type changes.
- [ ] Catalog edits and refreshes are audited.
- [ ] Typecheck, lint, and catalog integration tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-006: Authorize an AI agent through MCP

**Description:** As a builder, I want to connect Toolflow to my AI workspace securely so that the agent acts with my identity and permissions.

**Acceptance Criteria:**

- [ ] Toolflow exposes one Streamable HTTP MCP endpoint.
- [ ] OAuth protected-resource metadata and authorization-server discovery work according to the supported MCP specification.
- [ ] Access tokens are audience-bound to the Toolflow MCP resource and validated on every request.
- [ ] Requested OAuth scopes are shown to the user before consent.
- [ ] The MCP server never forwards its inbound access token to another service.
- [ ] Revoking the user's Toolflow membership prevents subsequent MCP requests.
- [ ] MCP sessions, clients, tool names, request IDs, outcomes, and latency are audited without recording credentials or returned company data.
- [ ] Typecheck, lint, protocol-conformance, and authorization tests pass.

### US-007: Discover existing apps before creation

**Description:** As a builder, I want my agent to search existing apps so that the organization does not create duplicate tools unknowingly.

**Acceptance Criteria:**

- [ ] The agent can search apps by name, description, owner, status, and declared data objects.
- [ ] Results include app ID, name, description, owner, lifecycle status, production URL if present, and last deployment time.
- [ ] Source code is returned only when the requesting user may edit the app.
- [ ] Disabled and archived apps are clearly marked rather than silently omitted.
- [ ] Search results are organization-scoped.
- [ ] Typecheck, lint, and tenant-isolation tests pass.

### US-008: Read organization and schema context

**Description:** As a builder, I want my agent to retrieve concise organization and data context so that generated apps follow company conventions.

**Acceptance Criteria:**

- [ ] The agent can retrieve users, branding, existing apps, available connections, and approved schema metadata through separate paginated tools.
- [ ] User results contain only ID, name, work email, status, and Toolflow role.
- [ ] Schema search supports keywords and exact object lookup.
- [ ] Hidden connections and catalog objects are never returned.
- [ ] Responses include version identifiers so agents can detect stale context.
- [ ] Read tools return structured output with stable, documented schemas.
- [ ] Typecheck, lint, pagination, authorization, and tenant-isolation tests pass.

### US-009: Create an application

**Description:** As a builder, I want my agent to create an app from the Toolflow template so that I can start without configuring a framework.

**Acceptance Criteria:**

- [ ] Creating an app requires a unique organization-scoped slug, display name, description, and active owner.
- [ ] Toolflow creates a draft app, initial immutable source version, preview data namespace, and production data namespace record.
- [ ] The initial source contains the platform-owned React, TypeScript, Vite, Hono, component-library, and Toolflow SDK template.
- [ ] The runtime and dependency lockfile cannot be changed by the builder.
- [ ] The creating user becomes the owner.
- [ ] Creation is idempotent when the same idempotency key is reused.
- [ ] Typecheck, lint, and creation integration tests pass.

### US-010: Update Toolflow-native source

**Description:** As a builder, I want my agent to update app files so that the application can be developed entirely through MCP.

**Acceptance Criteria:**

- [ ] The agent can list, read, create, update, and delete permitted UTF-8 text files.
- [ ] Source mutation requires the current base source-version ID.
- [ ] A stale base version returns a conflict containing the latest version ID and no partial writes.
- [ ] Each successful mutation creates a new immutable source version with actor, timestamp, parent, message, and content hash.
- [ ] Platform-owned configuration, dependency locks, build scripts, and SDK code cannot be changed.
- [ ] Binary files, path traversal, symbolic links, generated build output, and files outside allowed paths are rejected.
- [ ] One source version is limited to 200 files and 5 MB of UTF-8 source.
- [ ] A single MCP mutation is limited to 100 files and 2 MB.
- [ ] Typecheck, lint, conflict, quota, and path-validation tests pass.

### US-011: Declare app capabilities and schema

**Description:** As a builder, I want my agent to declare data needs explicitly so that Toolflow can review and enforce them.

**Acceptance Criteria:**

- [ ] Each source version contains a validated Toolflow manifest.
- [ ] External capabilities identify a connection plus explicit schema, table, and read operation.
- [ ] Managed app-data capabilities identify the app's own tables and read or write operations.
- [ ] The manifest declares desired tables, columns, indexes, and foreign keys for Toolflow-managed data.
- [ ] A source version cannot reference an undeclared capability.
- [ ] Capability increases are distinguished from equal or reduced access.
- [ ] Manifest validation returns structured error codes, file locations, and remediation text.
- [ ] Typecheck, lint, schema-validation, and capability-diff tests pass.

### US-012: Validate and build an app version

**Description:** As a builder, I want deterministic validation before deployment so that unsafe or broken versions cannot run.

**Acceptance Criteria:**

- [ ] A build uses a pinned runtime image, dependency set, lockfile, and platform-owned build configuration.
- [ ] The build runs in an ephemeral sandbox without customer credentials or unrestricted network access.
- [ ] Validation includes manifest schema, import allowlist, forbidden API analysis, typecheck, lint, unit tests, and production bundling.
- [ ] User code cannot change the build configuration or execute package-install scripts.
- [ ] Build output records source hash, artifact hash, runtime version, status, timestamps, and structured diagnostics.
- [ ] The same source version and runtime version produce the same artifact hash, excluding documented non-deterministic metadata.
- [ ] Failed builds never replace an active deployment.
- [ ] Builds time out after five minutes and enforce memory and output-size limits.
- [ ] Typecheck, lint, sandbox-escape, deterministic-build, and failure-isolation tests pass.

### US-013: Deploy a preview

**Description:** As a builder, I want a preview URL without admin approval so that I can test an app quickly.

**Acceptance Criteria:**

- [ ] Only a successful build can be deployed.
- [ ] Preview uses an isolated preview app-data namespace and cannot read production app data.
- [ ] Preview can use approved external read-only capabilities declared by the version.
- [ ] Preview access is limited to the owner and explicitly granted organization users.
- [ ] Preview receives a stable Toolflow URL and visible preview banner.
- [ ] Incoming requests pass through the Toolflow authentication dispatcher before reaching generated code.
- [ ] Outbound requests pass through a deny-by-default egress policy.
- [ ] The deployment reaches a terminal success or failure state within five minutes.
- [ ] Typecheck, lint, deployment, authentication, isolation, and egress tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-014: Manage app members

**Description:** As an app owner, I want to grant and revoke access for organization users so that only the intended team can use the app.

**Acceptance Criteria:**

- [ ] An owner can search active organization users and add or remove app members.
- [ ] A non-member receives a generic access-denied response and no app metadata.
- [ ] Revocation takes effect on the next request and invalidates app-specific cached authorization.
- [ ] Deactivated organization users cannot be granted access.
- [ ] An app must retain at least one active owner before a production deployment can proceed.
- [ ] Membership changes are audited.
- [ ] Typecheck, lint, revocation, authorization, and tenant-isolation tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-015: Query approved external data

**Description:** As an app member, I want the app to read approved company data so that the tool is useful without duplicating the source of truth.

**Acceptance Criteria:**

- [ ] Generated code accesses external data only through the Toolflow data SDK and gateway.
- [ ] The runtime receives a short-lived app/deployment identity, never the external credential.
- [ ] The gateway accepts one parameterized PostgreSQL read statement per request.
- [ ] The gateway parses the statement and rejects DDL, DML, multiple statements, unapproved relations, and disallowed functions.
- [ ] The query executes in a read-only transaction with a five-second statement timeout.
- [ ] Results are limited to 1,000 rows and 5 MB.
- [ ] Connection disablement blocks new queries immediately.
- [ ] Audit metadata includes actor, app, deployment, connection, referenced relations, duration, row count, byte count, and outcome; result values and sensitive parameters are not logged.
- [ ] Typecheck, lint, SQL-policy, timeout, limit, credential-isolation, and audit-redaction tests pass.

### US-016: Use Toolflow-managed app data

**Description:** As an app member, I want the app to store workflow-specific records safely so that it can support operational CRUD use cases.

**Acceptance Criteria:**

- [ ] Each app has logically separate preview and production schemas in managed PostgreSQL.
- [ ] Generated code accesses only its own app schemas through the Toolflow data SDK.
- [ ] The gateway derives organization, app, environment, deployment, and user identity from signed runtime context rather than client parameters.
- [ ] The SDK supports parameterized create, read, update, and delete operations on declared tables.
- [ ] Cross-app, cross-environment, and cross-organization references are rejected.
- [ ] Every write records actor, app, deployment, table, operation, affected-row count, and outcome without copying full records into the audit log.
- [ ] Typecheck, lint, CRUD, authorization, and isolation tests pass.

### US-017: Plan and apply safe schema changes

**Description:** As a builder, I want my agent to evolve app-owned tables safely so that common CRUD requirements do not require a database administrator.

**Acceptance Criteria:**

- [ ] The agent can request a schema plan for create-table, add-nullable-column, add-index, and add-foreign-key operations.
- [ ] Rename, drop, non-null column without default, type change, raw SQL, and destructive operations are rejected.
- [ ] The plan includes exact operations, lock-risk classification, and estimated affected objects.
- [ ] Preview schema changes may be applied by the owner.
- [ ] Production deployment automatically derives and applies the immutable plan for the selected build.
- [ ] Production changes run before the corresponding code deployment and are additive so the prior code version remains valid.
- [ ] A failed schema operation stops deployment and does not mark the version active.
- [ ] Source rollback does not claim to reverse schema changes.
- [ ] Typecheck, lint, migration-policy, automatic-plan, and failure-recovery tests pass.

### US-018: Deploy to production

**Description:** As a builder, I want my agent to deploy an exact tested build with one call so that shipping improvements does not depend on an approval queue.

**Acceptance Criteria:**

- [ ] Production deployment is allowed only for an exact successful previewed build owned by the actor or managed by an admin.
- [ ] External capabilities are revalidated against active admin-curated connections and catalog relations immediately before deployment.
- [ ] Toolflow automatically derives and applies an additive managed-schema plan when the target schema differs.
- [ ] First production, capability increases inside existing catalog guardrails, and additive schema changes deploy without human approval.
- [ ] Duplicate calls using the same idempotency key return the existing deployment result.
- [ ] Typecheck, lint, ownership, catalog-policy, schema-policy, and idempotency tests pass.

### US-020: Publish a production deployment

**Description:** As an app owner, I want a validated version published to a stable URL so that colleagues can use it without deployment expertise.

**Acceptance Criteria:**

- [ ] Toolflow verifies exact-preview, ownership, and catalog policy immediately before production mutation.
- [ ] Automatically planned additive schema changes complete before traffic switches to the new artifact.
- [ ] A health check succeeds before the deployment becomes active.
- [ ] Traffic switches atomically from the previous active version to the new version.
- [ ] Failure leaves the prior deployment active and reports a structured error.
- [ ] The production URL is stable across versions.
- [ ] Only app members can access the production app.
- [ ] Deployment events include actor, versions, artifact hash, schema plan/version, timing, and outcome.
- [ ] Typecheck, lint, deployment, health-check, atomicity, and failure-recovery tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-021: Enforce runtime isolation and egress

**Description:** As an admin, I want generated code isolated and unable to exfiltrate data so that agent-generated apps are governable.

**Acceptance Criteria:**

- [ ] Apps execute as untrusted user Workers in an organization-aware dispatch namespace.
- [ ] The dispatch layer authenticates the member, resolves the exact active deployment, removes spoofable identity headers, and injects normalized user context from trusted claims.
- [ ] User Workers have no customer secrets, control-plane credentials, shared cache, filesystem, raw sockets, or direct database bindings.
- [ ] An outbound Worker intercepts generated-code fetch requests and permits only documented Toolflow API hosts.
- [ ] Denied egress attempts return a stable error and emit a security audit event.
- [ ] CPU, subrequest, response-size, and execution limits are enforced per app request.
- [ ] Generated code cannot address another user Worker directly.
- [ ] The outbound policy receives trusted dispatch metadata and adds the short-lived data-gateway credential without exposing that credential to generated source code.
- [ ] Typecheck, lint, isolation, header-spoofing, cross-app routing, credential-exposure, egress, and resource-limit tests pass.

### US-022: View app activity

**Description:** As an owner or admin, I want concise app activity and health information so that I can understand adoption and failures.

**Acceptance Criteria:**

- [ ] The app page displays deployment status, request count, unique active members, error rate, latency, external-query count, managed-data write count, and last activity time.
- [ ] Owners see only apps they own; admins can see all organization apps.
- [ ] Filters support environment and the last 24 hours, 7 days, and 30 days.
- [ ] Metrics do not expose query results, request bodies, access tokens, or stored app records.
- [ ] The UI links errors to a request ID and deployment version.
- [ ] Empty, loading, partial-data, and telemetry-delay states are explicit.
- [ ] Typecheck, lint, aggregation, authorization, and redaction tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-023: Inspect the audit trail

**Description:** As an admin, I want a searchable audit trail so that important actions can be attributed and investigated.

**Acceptance Criteria:**

- [ ] Admins can filter by time, actor, actor type, app, action, target, environment, and outcome.
- [ ] Audit events are append-only to application identities.
- [ ] Events contain organization, actor, MCP client or web session, action, target, request ID, timestamp, outcome, and redacted metadata.
- [ ] Sensitive values are never stored in before/after snapshots.
- [ ] The UI can export the current filtered results as CSV up to a documented limit.
- [ ] Builders can inspect audit events only for apps they own and cannot export organization-wide events.
- [ ] Typecheck, lint, immutability, filtering, authorization, export, and redaction tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-024: Roll back a deployment

**Description:** As an app owner, I want to restore the previous working code version so that an incident can be mitigated quickly.

**Acceptance Criteria:**

- [ ] The owner can select a previously successful production artifact whose required capabilities remain approved.
- [ ] Rollback revalidates the target capabilities against current catalog guardrails and proceeds without human approval when valid.
- [ ] Toolflow warns that additive schema migrations are not reversed.
- [ ] A health check succeeds before traffic switches.
- [ ] A failed rollback leaves the current deployment active.
- [ ] Rollback records initiator, source deployment, target deployment, reason, and outcome.
- [ ] Typecheck, lint, policy, health-check, and failure-recovery tests pass.
- [ ] Verify in browser using the browser-control skill.

### US-025: Disable an app or connection

**Description:** As an admin, I want an emergency stop control so that I can contain a security or operational incident.

**Acceptance Criteria:**

- [ ] An admin can disable an app or connection after entering a reason and confirming the target.
- [ ] A disabled app rejects new requests at the dispatch layer without invoking generated code.
- [ ] A disabled connection rejects new gateway queries.
- [ ] Disablement takes effect within 60 seconds across all runtime locations.
- [ ] Re-enablement requires an admin and creates a separate audit event.
- [ ] Disabling does not delete source, deployments, app data, or audit records.
- [ ] Typecheck, lint, propagation, authorization, and recovery tests pass.
- [ ] Verify in browser using the browser-control skill.

## 9. Functional requirements

### 9.1 Identity, tenancy, and authorization

- **FR-001:** Every persisted customer-owned record must contain an organization ID or be reachable only through an organization-scoped parent with an enforced foreign key.
- **FR-002:** Server authorization must derive organization and user identity from verified session or access-token claims, never from a client-supplied organization ID alone.
- **FR-003:** Toolflow must implement the admin, builder, owner, and member permissions defined in Section 6.5.
- **FR-004:** The system must deny by default when a role, ownership, membership, or capability decision is missing.
- **FR-005:** A user may belong to multiple organizations, but every request and MCP session must operate in exactly one selected organization.
- **FR-006:** Removing an organization membership must revoke Toolflow access and app membership authorization on the next request.
- **FR-007:** Every production app must have at least one active owner.
- **FR-008:** Toolflow must prevent deletion or demotion of the final organization admin.

### 9.2 MCP interface

- **FR-009:** Toolflow must expose a versioned Streamable HTTP MCP endpoint and advertise its supported MCP protocol versions.
- **FR-010:** MCP authorization must use delegated OAuth with protected-resource metadata, authorization-server metadata, PKCE support, exact redirect validation, audience-bound tokens, and short-lived access tokens.
- **FR-011:** Each tool must declare a stable name, description, JSON input schema, structured output schema, required OAuth scopes, and documented error codes.
- **FR-012:** MCP list and search tools must use cursor pagination and default to a maximum of 50 records per response.
- **FR-013:** MCP mutation tools must require an idempotency key and return the existing result when the same actor, organization, tool, and key are replayed.
- **FR-014:** MCP errors must distinguish authentication, authorization, conflict, validation, rate-limit, dependency, and internal failures.
- **FR-015:** Toolflow must not include raw credentials, access tokens, company-data rows, or app-data records in MCP audit logs.

### 9.3 Required MCP tools

| Tool                        | Mutation | Minimum role       | Guardrail behavior                                   |
| --------------------------- | -------: | ------------------ | ---------------------------------------------------- |
| get_current_user            |       No | Any active user    | None                                                 |
| list_organization_users     |       No | Admin or builder   | None                                                 |
| get_organization_branding   |       No | Admin or builder   | None                                                 |
| search_apps                 |       No | Admin or builder   | None                                                 |
| get_app                     |       No | Admin or app owner | None                                                 |
| list_data_connections       |       No | Admin or builder   | Returns metadata only                                |
| search_data_catalog         |       No | Admin or builder   | None                                                 |
| get_schema_context          |       No | Admin or builder   | None                                                 |
| get_app_activity            |       No | Admin or app owner | None                                                 |
| get_deployment_status       |       No | Admin or app owner | None                                                 |
| create_app                  |      Yes | Admin or builder   | None                                                 |
| update_app_files            |      Yes | Admin or app owner | None                                                 |
| validate_app                |      Yes | Admin or app owner | None                                                 |
| create_preview              |      Yes | Admin or app owner | None                                                 |
| plan_app_schema_change      |      Yes | Admin or app owner | Planning only                                        |
| apply_preview_schema_change |      Yes | Admin or app owner | Preview only                                         |
| deploy_to_production        |      Yes | Admin or app owner | Exact preview, active catalog, additive schema only  |
| grant_app_access            |      Yes | Admin or app owner | Active organization users only                       |
| revoke_app_access           |      Yes | Admin or app owner | None                                                 |
| rollback_app                |      Yes | Admin or app owner | Target capabilities must pass current catalog policy |
| disable_app                 |      Yes | Admin              | Reason and confirmation required                     |

### 9.4 App registry and source management

- **FR-016:** App lifecycle states must be draft, preview, production, disabled, orphaned, and archived.
- **FR-017:** App slugs must be unique within an organization and remain reserved while an app is disabled or archived.
- **FR-018:** Toolflow must store immutable full source bundles in object storage and source metadata in the control database.
- **FR-019:** Each source version must contain app ID, organization ID, parent version, actor, timestamp, message, content hash, manifest hash, and object-storage key.
- **FR-020:** Source edits must use optimistic concurrency against the current source-version ID.
- **FR-021:** The platform must enforce file-count, byte-size, path, encoding, and mutable-path restrictions before persisting a source version.
- **FR-022:** Source deletion must create a new version omitting the file; prior versions remain recoverable.
- **FR-023:** Archived or disabled apps retain source and version history.

### 9.5 Fixed application stack

- **FR-024:** Generated apps must use the platform-owned React, TypeScript, Vite, Hono, Toolflow SDK, component library, and CSS-token template.
- **FR-025:** Builders may edit only designated application source, test, manifest, and style paths.
- **FR-026:** Imports must resolve to relative application files or an explicit platform package allowlist.
- **FR-027:** Dynamic imports from computed values, eval, Function constructors, WebAssembly, raw sockets, and subprocess APIs must be rejected.
- **FR-028:** The platform must own and pin the dependency lockfile, compiler, bundler, runtime compatibility date, and build configuration.
- **FR-029:** Generated apps must expose a platform-defined health endpoint and consume signed runtime identity through the Toolflow SDK.

### 9.6 Build and artifact management

- **FR-030:** Builds must be asynchronous jobs with queued, running, succeeded, failed, and timed-out states.
- **FR-031:** A build must consume one immutable source version and one immutable runtime version.
- **FR-032:** Build workers must not receive production credentials, connection credentials, WorkOS secrets, or Cloudflare control credentials.
- **FR-033:** Only a deployment service may receive the narrowly scoped credential required to publish an already-built artifact.
- **FR-034:** Artifacts must be content-addressed and stored immutably.
- **FR-035:** Build diagnostics must be structured by phase and include safe file, line, column, error code, and remediation fields where available.
- **FR-036:** Build logs must redact environment variables and be retained for 30 days.

### 9.7 Runtime and routing

- **FR-037:** Each deployed app artifact must run as a separate untrusted user Worker in Workers for Platforms.
- **FR-038:** All app traffic must enter through a Toolflow dispatch Worker; a user Worker must not have a public bypass route.
- **FR-039:** The dispatcher must resolve organization, app, environment, and active deployment from a trusted hostname mapping.
- **FR-040:** The dispatcher must authenticate the user and check active organization membership, app membership, app status, and deployment status before invocation.
- **FR-041:** The dispatcher must remove inbound Toolflow identity headers and inject normalized user context derived from verified claims; generated code must not receive a reusable Toolflow session or data-gateway credential.
- **FR-042:** An outbound Worker must intercept generated-code fetch calls, deny every destination except the exact Toolflow data and telemetry APIs required by the runtime, and add any deployment-bound gateway credential from trusted dispatch metadata rather than user-Worker input.
- **FR-043:** Egress policy must match parsed URL scheme and hostname, not string prefixes, and must reject redirects to unapproved hosts.
- **FR-044:** Per-request CPU, subrequest, response-size, and duration limits must be configurable by the dispatch layer.
- **FR-045:** Preview and production must use separate dispatch namespaces or equally strong environment isolation.

### 9.8 External connections and data catalog

- **FR-046:** The MVP must support PostgreSQL connections only.
- **FR-047:** Connection credentials must be stored in a dedicated secrets manager and referenced by opaque secret ID.
- **FR-048:** Connection APIs must never return a stored password or complete connection URI after creation.
- **FR-049:** Admins must explicitly approve schemas and tables before metadata or queries are exposed.
- **FR-050:** Catalog refresh must be non-destructive by default and present breaking metadata changes for admin confirmation.
- **FR-051:** Catalog objects must support description, owner, lifecycle status, source-of-truth status, and sensitivity classification.
- **FR-052:** Supported sensitivity values must be public, internal, confidential, and restricted.
- **FR-053:** Restricted objects must be hidden from builders and unavailable to apps in the MVP.
- **FR-054:** Data-catalog search must return connection, schema, table, column, type, key relationships, annotations, and catalog version without returning data rows.

### 9.9 Governed external queries

- **FR-055:** External queries must execute only through the Toolflow data gateway using a deployment-bound capability token.
- **FR-056:** The gateway must parse PostgreSQL SQL into an abstract syntax tree before execution.
- **FR-057:** The gateway must accept only a single parameterized SELECT or read-only WITH statement that references approved relations declared by the active deployment.
- **FR-058:** The gateway must reject DDL, DML, COPY, transaction control, multiple statements, unapproved functions, system catalogs, temporary objects, and unapproved schemas.
- **FR-059:** Every external query must run in a read-only transaction with statement timeout, row limit, byte limit, and cancellation on client disconnect where supported.
- **FR-060:** Query results must be returned only to the invoking app request and must not be cached in the MVP.
- **FR-061:** The gateway must not log result values or plaintext sensitive parameters.

### 9.10 Managed app database

- **FR-062:** Every app must receive separate logical preview and production PostgreSQL schemas owned operationally by Toolflow.
- **FR-063:** Apps must access managed data only through the Toolflow SDK and data gateway.
- **FR-064:** The gateway must compute the schema from signed deployment context and must ignore any client-supplied schema or organization identifier.
- **FR-065:** The schema API must support create table, add nullable column, add index, and add foreign key only.
- **FR-066:** Production schema plans must be immutable, hash-addressed, additive, and automatically derived for the selected build.
- **FR-067:** Preview schemas must not contain production records by default.
- **FR-068:** Database backups and provider point-in-time recovery must cover control data and production app data.
- **FR-069:** Source rollback must not automatically execute reverse database migrations.

### 9.11 Deployment and guardrails

- **FR-070:** Deployment environments must be preview and production.
- **FR-071:** A deployment must reference immutable source, build, artifact, manifest, capability set, schema version, runtime version, and actor records.
- **FR-072:** Preview deployment must not require human approval.
- **FR-073:** An admin or app owner may deploy an exact successfully previewed build to production without human approval.
- **FR-074:** Production deployment must automatically derive and persist any required additive managed-schema plan.
- **FR-075:** External-data capabilities must be revalidated against active connections and admin-approved catalog relations immediately before deployment.
- **FR-076:** Destructive or unsupported schema changes and capabilities outside current catalog guardrails must fail validation.
- **FR-077:** Production deployment must require only app ownership or admin authority; it must not create a human approval record.
- **FR-078:** Production deployment must run preflight validation, apply additive schema changes, upload the artifact, perform a health check, and atomically update the active-deployment pointer.
- **FR-079:** Failed production deployment must retain the previously active deployment.
- **FR-080:** A source rollback must use an existing successful artifact and must pass current capability-policy validation.

### 9.12 Audit and monitoring

- **FR-081:** Security audit events must be stored separately from operational logs and metrics.
- **FR-082:** Audit events must contain event ID, timestamp, organization, actor type, actor ID, session or client ID, action, target type, target ID, environment, request ID, outcome, and redacted metadata.
- **FR-083:** Customer-facing application identities must have append-only access to audit events; correction must occur through compensating events.
- **FR-084:** Audit coverage must include authentication, membership, connection, catalog, source, build, deployment, capability, schema, app access, external query, managed-data write, rollback, disablement, and egress-denial events.
- **FR-085:** Operational telemetry must use correlated request, trace, organization, app, environment, and deployment identifiers.
- **FR-086:** Toolflow must expose request count, unique active users, latency, error rate, query counts, write counts, build outcomes, and deployment outcomes.
- **FR-087:** Metrics must not use raw user IDs as unbounded high-cardinality labels; unique-user aggregation must be performed through a bounded analytics path.
- **FR-088:** Audit exports must be rate-limited, access-controlled, size-limited, and audited.

### 9.13 Admin web app

- **FR-089:** The admin web app must provide pages for overview, users, branding, connections, catalog, apps, and audit activity.
- **FR-090:** The app list must show name, owner, lifecycle, active version, last deployment, member count, last activity, and health summary.
- **FR-091:** The app detail must show overview, members, source versions, builds, deployments, capabilities, schema, activity, and emergency controls.
- **FR-092:** Destructive or service-impacting actions must require target-specific confirmation and a reason.
- **FR-093:** All tables must provide loading, empty, error, and pagination states.
- **FR-094:** UI authorization must be enforced by server APIs; hiding a control is not sufficient authorization.

## 10. Data model

The following entities are required. Names are conceptual and may change, but their boundaries must remain explicit.

| Entity                 | Purpose                                                    | Key relationships                               |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Organization           | Customer tenant and settings                               | Has users, apps, connections, branding          |
| User                   | Global human identity                                      | Has organization memberships                    |
| OrganizationMembership | User role and lifecycle in one organization                | Belongs to organization and user                |
| OrganizationBranding   | Normalized visual tokens and written guidance              | Belongs to organization                         |
| App                    | Registry identity, ownership, slug, lifecycle              | Belongs to organization; has owners and members |
| AppOwnership           | Active app owners                                          | Joins app and membership                        |
| AppMembership          | Users allowed to run an app                                | Joins app and membership                        |
| SourceVersion          | Immutable metadata for one full source snapshot            | Belongs to app; points to source object         |
| Build                  | Validation and bundling execution                          | Belongs to source and runtime versions          |
| Artifact               | Immutable deployable bundle                                | Produced by successful build                    |
| RuntimeVersion         | Pinned template, SDK, dependencies, and compatibility date | Referenced by build and deployment              |
| DataConnection         | External source metadata and secret reference              | Belongs to organization                         |
| CatalogObject          | Approved schema, table, or column metadata                 | Belongs to connection                           |
| CatalogAnnotation      | Business meaning, ownership, lifecycle, sensitivity        | Belongs to catalog object                       |
| CapabilitySet          | Immutable data permissions requested by an app version     | Belongs to source version                       |
| AppDataSpace           | Preview or production logical database namespace           | Belongs to app and environment                  |
| SchemaVersion          | Desired managed app schema                                 | Belongs to source version and app               |
| SchemaPlan             | Immutable diff of safe database operations                 | From one schema version to another              |
| Deployment             | Immutable deployment attempt and outcome                   | Belongs to app and environment                  |
| ActiveDeployment       | Atomic pointer to one successful deployment                | One per app and environment                     |
| IdempotencyRecord      | Replay-safe mutation result                                | Scoped to organization, actor, and operation    |
| AuditEvent             | Durable security and governance history                    | Scoped to organization and optional app         |
| UsageEvent             | Operational activity input                                 | Scoped to organization, app, version, request   |

All primary keys should be opaque, globally unique identifiers. Human-readable slugs must never be authorization keys.

## 11. Technical architecture

### 11.1 Recommended repository structure

- apps/admin: React admin interface.
- apps/control-api: organization, user, app, source, deployment, and audit APIs.
- apps/mcp: remote MCP transport and tool adapters; may deploy with control-api but remains a separate module.
- apps/data-gateway: external and managed database policy enforcement.
- apps/build-worker: isolated validation and artifact production.
- apps/deployment-worker: Cloudflare publication and health-check orchestration.
- apps/runtime-dispatcher: inbound authentication and dynamic app routing.
- apps/runtime-outbound: deny-by-default outbound fetch policy.
- packages/app-sdk: generated-app data, identity, telemetry, and health APIs.
- packages/app-template: immutable fixed-stack starter.
- packages/components: approved internal UI components and branding tokens.
- packages/policy: roles, ownership rules, and deployment permissions.
- packages/contracts: versioned API, event, manifest, MCP input, and MCP output schemas.
- packages/database: control-plane schema and migrations.
- packages/observability: tracing, logging, metrics, redaction, and request IDs.

### 11.2 Technology choices

| Layer                  | MVP choice                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| Language               | TypeScript                                                                    |
| Package management     | pnpm workspaces                                                               |
| Monorepo orchestration | Turborepo                                                                     |
| Admin UI               | React, Vite, React Router                                                     |
| Control and data APIs  | Hono or Fastify; select one in ADR-001 before implementation                  |
| Validation             | Zod or equivalent shared runtime schemas                                      |
| Control database       | Managed PostgreSQL                                                            |
| Database mapping       | Drizzle ORM plus explicit SQL migrations                                      |
| Identity and OAuth     | WorkOS AuthKit and Connect                                                    |
| MCP                    | Official TypeScript MCP SDK using Streamable HTTP                             |
| App runtime            | Cloudflare Workers for Platforms, untrusted mode                              |
| Source and artifacts   | R2-compatible object storage with content hashes                              |
| Async jobs             | Managed queue with retry and dead-letter behavior                             |
| Build execution        | Ephemeral network-restricted containers with a fixed image                    |
| Secrets                | Managed secrets service or KMS-backed vault                                   |
| Telemetry              | OpenTelemetry-compatible traces, logs, and metrics                            |
| Tests                  | Vitest for unit/integration and Playwright for browser flows                  |
| Infrastructure         | Infrastructure as code after the first manual pilot environment is understood |

### 11.3 Trust boundaries

1. Browser to Toolflow control plane.
2. AI client to MCP resource server.
3. Control plane to identity provider.
4. Control plane to secrets store.
5. Source store to build sandbox.
6. Deployment service to Cloudflare control API.
7. End user to runtime dispatcher.
8. Runtime dispatcher to untrusted generated app Worker.
9. Generated app Worker to outbound policy Worker.
10. Generated app Worker to Toolflow data gateway.
11. Data gateway to external PostgreSQL.
12. Data gateway to Toolflow-managed PostgreSQL.

Authentication, authorization, input limits, safe logging, timeout behavior, and failure behavior must be specified and tested at every boundary.

## 12. Non-functional requirements

### 12.1 Security

- **NFR-001:** All network traffic must use TLS in production.
- **NFR-002:** Sensitive credentials must be encrypted at rest and excluded from source, artifacts, logs, traces, MCP output, and browser responses.
- **NFR-003:** Production secrets must be separable from preview secrets and inaccessible to generated code.
- **NFR-004:** All authorization checks must be covered by negative tests, including cross-organization and cross-app attempts.
- **NFR-005:** All web mutation endpoints must implement CSRF protection where cookie sessions are used.
- **NFR-006:** Session cookies must be Secure, HttpOnly, SameSite-appropriate, and rotated after authentication.
- **NFR-007:** Public endpoints must implement actor- and organization-aware rate limits.
- **NFR-008:** Dependencies and build images must be scanned for known critical vulnerabilities before release.
- **NFR-009:** Logs and telemetry must apply centralized structured redaction.
- **NFR-010:** Backups must be encrypted and restoration must be tested before the pilot handles production workflow data.

### 12.2 Reliability and recovery

- **NFR-011:** MVP service objective is 99.5% monthly availability excluding announced maintenance; no contractual SLA is offered.
- **NFR-012:** Control and app database providers must support point-in-time recovery of at least seven days.
- **NFR-013:** Queue consumers and deployment jobs must be idempotent and safe to retry.
- **NFR-014:** A failed build, preview, migration, deployment, or rollback must never silently alter the recorded active production deployment.
- **NFR-015:** The team must document and test recovery for control database loss, artifact-store loss, identity-provider outage, connection outage, and erroneous deployment.

### 12.3 Performance and limits

- **NFR-016:** Control-plane read APIs should complete within 500 ms at p95, excluding third-party calls.
- **NFR-017:** MCP read tools should return within two seconds at p95 for non-paginated pilot-scale data.
- **NFR-018:** A valid build and preview deployment should complete within five minutes at p95.
- **NFR-019:** Runtime dispatch and authorization overhead should remain below 150 ms at p95, excluding generated app and database time.
- **NFR-020:** The data gateway must enforce a five-second external query timeout, 1,000-row limit, and 5 MB response limit.
- **NFR-021:** Default runtime limits must cap CPU, subrequests, output bytes, and total request time; exact values must be recorded in the runtime ADR.

### 12.4 Accessibility and browser support

- **NFR-022:** The admin app and generated component library must target WCAG 2.1 AA for keyboard navigation, focus visibility, labels, and contrast.
- **NFR-023:** Support the current and previous major versions of Chrome, Firefox, and Safari during the pilot.
- **NFR-024:** Every UI user story must be verified in a real browser before completion.

### 12.5 Privacy and retention

- **NFR-025:** Audit events must be retained for 365 days by default.
- **NFR-026:** Operational logs, traces, and raw usage events must be retained for 30 days by default.
- **NFR-027:** Query result rows, app records, passwords, tokens, and complete request bodies must not be copied into telemetry.
- **NFR-028:** Organization deletion is founder-assisted in the MVP and must include a documented export, retention, and deletion checklist before execution.

## 13. Admin UI design considerations

The admin UI is intentionally small and utilitarian. It is not the primary app-building interface.

### 13.1 Required navigation

- Overview
- Apps
- Users
- Connections
- Data catalog
- Activity
- Organization settings

### 13.2 Design principles

- Show current state, risk, owner, and next action before secondary metadata.
- Use plain language such as “can read customer_accounts” rather than infrastructure terminology.
- Display preview and production as visually distinct environments.
- Present permission and schema changes as before/after diffs.
- Require a reason and target-specific confirmation for emergency actions.
- Never show stored secrets after initial entry.
- Use a dense but readable list-and-detail layout; no dashboards without an operational decision attached.
- The generated app template should use organization tokens but retain Toolflow's accessible component constraints.

## 14. Analytics and audit event taxonomy

The MVP must distinguish product analytics, operational telemetry, and governance audit records.

### 14.1 Product events

- organization_onboarded
- connection_activated
- catalog_curated
- mcp_connected
- app_created
- source_version_created
- build_completed
- preview_deployed
- production_deployed
- app_member_added
- app_opened
- app_used_weekly
- app_disabled

### 14.2 Required event dimensions

- Organization ID
- App ID where applicable
- Environment
- Source, build, artifact, and deployment versions where applicable
- Actor category without using raw email
- MCP client name where available
- Outcome and structured failure category
- Correlated request or trace ID
- Timestamp and duration where applicable

### 14.3 Audit integrity

The application service identity may append but not update or delete audit rows. Administrative correction must add a compensating event. A later enterprise release may add hash chaining or external log-stream export; neither is required for MVP.

## 15. Success metrics and pilot exit criteria

The MVP succeeds only if it proves repeatable customer value, not merely technical deployment.

### 15.1 Activation

- One design partner pays for the pilot.
- At least three distinct builders connect an AI agent through MCP.
- At least five non-demo apps reach production.
- Median builder time from app creation to first working preview is under 30 minutes.
- At least 80% of apps reach a successful preview within two validation/build iterations after the first complete source submission.

### 15.2 Adoption

- At least 20 employees use one or more Toolflow apps.
- At least three of the five production apps have weekly active use for four consecutive weeks.
- At least one app replaces an existing spreadsheet, manual handoff, or ungoverned internal tool.

### 15.3 Governance

- 100% of production deployments map to immutable source and artifact hashes.
- 100% of production deployments revalidate active catalog guardrails and additive schema policy.
- 100% of external queries use the data gateway; no generated app receives a connection credential.
- 100% of MCP mutations, access changes, deployments, disablements, and data operations emit the required audit event.
- Zero successful cross-organization, cross-app, preview-to-production, or unapproved-egress accesses in penetration and integration tests.

### 15.4 Reliability

- At least 95% of production deployments complete or fail safely within five minutes.
- An app can be disabled within 60 seconds in every tested runtime location.
- A previous app artifact can be restored without losing the current active version if rollback fails.

### 15.5 Qualitative validation

- At least two builders state they would be disappointed if Toolflow were removed.
- The admin reports that the app registry, catalog controls, and deployment history are materially more governable than the prior process.
- The design partner agrees to continue paying after the assisted pilot period.

## 16. Pilot delivery model

The MVP follows a manual-to-productized progression.

### 16.1 Manual stage

- Founder manually creates the organization and production environment.
- Founder helps the admin create the dedicated read-only PostgreSQL credential.
- Founder reviews the first data catalog and first five applications.
- Founder attends the first production deployment and rollback test.
- Support occurs through a shared channel with a documented issue template.

### 16.2 Processized stage

- Turn onboarding into a checklist that another team member could execute.
- Record recurring schema annotations, policy exceptions, agent failures, and deployment failures.
- Maintain a weekly decision log of requested features and actual blockers.

### 16.3 Productized only after evidence

- Add self-service organization creation only if manual onboarding becomes the bottleneck.
- Add another connector only after at least three blocked apps need the same connector.
- Add SAML or SCIM only when a paying design partner requires it.
- Add Git export only when customers need portability or engineering collaboration.
- Add richer roles only after a real app cannot be safely served by owner/member access.

### 16.4 Feedback collection

- Conduct a 30-minute weekly interview with the admin and at least one builder.
- Ask builders to keep a lightweight diary of agent prompts, validation failures, and manual workarounds.
- Review activation, build, deployment, catalog-policy, and usage events weekly.
- Record every support request with app, workflow stage, severity, resolution, and whether product work is justified.

## 17. Implementation sequence

### Milestone 0: Foundations

- Monorepo, shared contracts, control database, organization model, AuthKit integration, request IDs, redaction, and audit-event writer.
- Completes US-001 and the backend foundation for US-002.

### Milestone 1: Organization administration and context

- Users, branding, PostgreSQL connection, catalog import and curation, admin navigation.
- Completes US-002 through US-005.

### Milestone 2: MCP and source control

- MCP OAuth, read tools, app discovery, app creation, immutable source storage, optimistic updates, manifest validation.
- Completes US-006 through US-011.

### Milestone 3: Build and preview runtime

- Build sandbox, fixed runtime, Workers for Platforms namespace, dispatcher, outbound policy, preview URLs, member authorization.
- Completes US-012 through US-014 and US-021 for preview.

### Milestone 4: Governed data

- External read gateway, SQL policy, managed app schemas, CRUD SDK, additive schema planner.
- Completes US-015 through US-017.

### Milestone 5: Production deployment

- One-call self-service deployment, automatic additive schema planning, catalog revalidation, health checks, atomic activation, and runtime policies.
- Completes US-018, US-020, and US-021 for production.

### Milestone 6: Operations and pilot readiness

- Activity views, audit search/export, rollback, disable controls, recovery runbook, browser verification, and pilot onboarding checklist.
- Completes US-022 through US-025.

No milestone should add a second framework, connector, identity provider, or deployment target.

## 18. Definition of done

The MVP is ready for a paid design partner when:

- All user stories required through Milestone 6 meet their acceptance criteria.
- Typecheck, lint, unit, integration, tenant-isolation, runtime-isolation, and browser end-to-end suites pass in CI.
- Threat modeling covers MCP authorization, source ingestion, build execution, runtime routing, egress, data gateways, secrets, deployment guardrails, and audit integrity.
- A security review finds no unresolved critical or high-severity issue in the pilot scope.
- Restore, rollback, app-disable, connection-disable, and user-deactivation drills have been executed successfully.
- Production configuration contains no development bypass for TLS, authorization, egress, catalog guardrails, or audit.
- The complete primary journey in Section 7 succeeds using at least one supported external AI agent and a fresh organization.
- The product owner has approved all open questions marked implementation blocker.

## 19. Risks and mitigations

| Risk                                                                        | Consequence                      | MVP mitigation                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| MCP clients implement authorization or tool schemas differently             | Builders cannot connect reliably | Maintain a tested compatibility matrix and certify only named clients during pilot                          |
| Source transfer through MCP is slow or exceeds client limits                | Poor build loop                  | Strict bundle limits, incremental file mutation, structured conflicts, and measured client-specific limits  |
| Generated code attempts data exfiltration                                   | Customer data exposure           | Untrusted Workers, outbound Worker denylist-by-default, no secrets, capability gateway, security tests      |
| Static source validation is mistaken for a security boundary                | Policy bypass                    | Enforce security at routing, egress, identity, and data gateways at runtime                                 |
| Read-only PostgreSQL queries invoke unsafe functions or overload the source | Side effects or outage           | Dedicated read-only role, AST validation, function policy, read-only transaction, timeout and result limits |
| Semantic metadata becomes stale                                             | Agents use wrong fields          | Versioned refresh, visible diffs, lifecycle warnings, owner annotations                                     |
| Additive migrations still create locks                                      | Production degradation           | Restricted operations, automatic plan validation, timeout, and pilot-size limits                            |
| Toolflow-native source creates lock-in concerns                             | Sales friction                   | Preserve immutable source, document format, and prioritize Git export only when validated                   |
| Owner/member authorization is too coarse                                    | Unsafe business access           | Limit pilot apps to teams where all members may see the app's approved data; defer sensitive use cases      |
| First pilot expects enterprise controls                                     | Scope explosion                  | Explicit design-partner qualification and documented non-goals                                              |
| Cloudflare-specific runtime creates platform coupling                       | Migration cost                   | Keep manifest, SDK contracts, artifacts, and deployment adapter boundaries platform-owned and versioned     |

## 20. Open questions

### Implementation blockers

1. Which named AI clients must be supported in the first pilot, and which MCP protocol versions and OAuth behaviors do they currently implement?
2. Is the first PostgreSQL source reachable over public TLS/IP allowlisting, or does the design partner require private networking?
3. Which cloud region must hold control data, source, artifacts, audit records, and managed app data?
4. Which categories of company data are acceptable for the pilot, given that source-system row-level permissions are not propagated?

### Must be decided before production pilot, but do not block initial development

6. Confirm or replace the proposed EUR 500 monthly design-partner price.
7. Confirm 365-day audit and 30-day telemetry retention.
8. Select Hono or Fastify for control and data APIs.
9. Select the managed PostgreSQL, object-storage, build-sandbox, queue, secrets, and observability vendors.
10. Choose the Toolflow-controlled application domain and email sender domain.
11. Define the permitted PostgreSQL function allowlist and treatment of views and materialized views.
12. Define exact per-app CPU, duration, subrequest, source-size, build, and monthly usage limits.
13. Determine whether preview may query approved external production data or whether preview requires a separately configured source.
14. Define founder-assisted organization export and deletion retention periods.
15. Decide whether app members may view their own activity records or only aggregate operational status.

## 21. References

- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [WorkOS AuthKit MCP authorization](https://workos.com/docs/authkit/mcp)
- [WorkOS Directory Sync](https://workos.com/docs/directory-sync)
- [Cloudflare Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)
- [Cloudflare Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/get-started/)
- [Cloudflare outbound Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/)
- [Cloudflare dynamic dispatch Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [OpenTelemetry concepts](https://opentelemetry.io/docs/concepts/)
