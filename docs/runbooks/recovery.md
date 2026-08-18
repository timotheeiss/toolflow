# Toolflow recovery runbook

## Scope and objectives

This runbook covers the control PostgreSQL database, managed app-data schemas, immutable source and artifact objects, and Cloudflare deployment metadata. The pilot targets an RPO of 15 minutes and an RTO of four hours. Audit events are retained for 365 days; operational telemetry and build logs are retained for 30 days.

## Required production controls

- PostgreSQL automated backups, encrypted point-in-time recovery, deletion protection, and a replica in the selected data-residency region.
- R2/S3 object versioning and a lifecycle policy that retains source and artifact objects for at least the audit-retention period. Toolflow application identities have get, head, and conditional put permissions; they do not have delete permissions.
- Cloudflare dispatch namespace configuration and Worker scripts managed from reviewed infrastructure definitions. The narrowly scoped publication token is held only by the deployment worker.
- Secret-encryption keys held in the production secret manager, versioned, access-logged, and excluded from backups. Recovery operators retrieve them through the provider's audited break-glass process.

## Database restoration

1. Declare the incident, freeze production mutations, and record the incident ID and recovery target time.
2. Restore the most recent encrypted snapshot to an isolated PostgreSQL instance, then apply WAL/PITR to the selected target.
3. Run `pnpm db:migrate` against the isolated database. Migrations are forward-only and checked into `packages/database/drizzle`.
4. Verify organization counts, active deployment foreign keys, append-only audit triggers, active app-data schema pointers, and the most recent audit timestamp.
5. Point a non-public control API and data gateway at the restored database. Run health, authorization-denial, source-read, and managed-data isolation checks.
6. Rotate database credentials, runtime-context keys, deployment-service tokens, and WorkOS session secrets if compromise is possible.
7. Move traffic only after two operators approve the evidence. Record actual RPO/RTO and add a compensating audit event describing the restoration.

## Object restoration

1. Select an object-store version at or before the database recovery target.
2. Verify every active build's `artifactHash` against the restored artifact bytes and every referenced source object's content hash.
3. Missing active objects block traffic restoration. Do not rebuild an artifact under an old hash.
4. Restore object access policies without delete permission, then exercise a conditional immutable write and collision check.

## Deployment reconciliation

1. For each active deployment, derive the immutable Worker name `tf-{environment}-{deploymentId}`.
2. Confirm that the script exists in the correct preview or production dispatch namespace.
3. Republish the already-verified artifact through the deployment worker when a script is missing. Do not change the active pointer until publication and health validation succeed.
4. Verify the dispatch Worker denies an unauthenticated request, a non-member request, an insecure gateway origin, and an undeclared outbound destination.

## Drill cadence and evidence

Run a restore drill before pilot launch and quarterly thereafter. Preserve the backup identifier, recovery target, commands, integrity query results, negative authorization results, actual RPO/RTO, operator names, and follow-up actions in the incident system. A backup is not considered usable until this drill succeeds.
