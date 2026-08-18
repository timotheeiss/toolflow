# Founder-assisted organization deletion

Organization deletion is deliberately not self-service in the MVP. A founder or Toolflow operator must use this checklist and preserve the completed record with the security audit evidence.

## Authorization and scope

- Obtain written authorization from two active organization admins, or one admin plus the contract owner if the organization has only one admin.
- Record the organization UUID, legal/customer name, requesters, operator, request ID, requested deletion date, and applicable contractual or legal hold.
- Freeze new deployments and connection changes, then confirm the exact organization target. Never select the target by display name alone.

## Export

- Export organization/users/memberships, app registry and ownership, source-version metadata and source bundles, manifests, deployments, catalog metadata, and managed app data.
- Export the complete security audit trail in bounded files and record hashes for every export object.
- Do not export external database passwords, access tokens, runtime tokens, or Toolflow infrastructure secrets.
- Provide the encrypted export through an approved customer channel and obtain receipt confirmation.

## Retention decision

- Record the agreed export expiry and deletion date. The pilot default is 30 days after confirmed receipt unless contract or law requires another period.
- Audit records remain for the contracted 365-day security-retention period unless an approved legal/privacy decision requires earlier erasure; record the legal basis and exact exception.
- Suspend deletion while a legal hold, unresolved incident, payment dispute, or recovery validation is active.

## Deletion sequence

1. Disable every app and connection and revoke all organization memberships.
2. Revoke WorkOS organization access, MCP grants, sessions, publisher jobs, and organization-scoped service credentials.
3. Remove connection secret envelopes and provider-side secret versions.
4. Delete managed preview and production schemas using exact recorded schema identifiers.
5. Delete control-plane customer records through the organization-scoped deletion procedure.
6. Expire source/artifact objects after the recorded retention period; preserve objects still referenced by another tenant only if a content-addressed shared-store policy proves no customer disclosure.
7. Queue deletion from backups according to provider expiry rather than modifying immutable backup sets.

## Verification and evidence

- Verify organization lookup, login, MCP access, app URLs, data-gateway access, and object retrieval all fail.
- Query every organization-scoped control table and confirm zero live customer records except approved retained audit/tombstone records.
- Record database transaction IDs, object deletion manifests, secret deletion receipts, provider backup-expiry date, and all verification results.
- Append a final `organization.deletion_completed` operator audit event containing only identifiers, dates, hashes, and evidence locations.
- Send completion notice to the authorized requesters and retain the signed checklist.
