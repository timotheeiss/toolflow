# ADR-003: Trusted runtime routes and KMS-backed connection secrets

Status: Accepted for MVP  
Date: 2026-08-10

## Context

An app URL must not be authoritative for organization, app, or environment identity. External PostgreSQL passwords also need a production encryption boundary whose root key is not an application environment variable.

## Decision: runtime routes

Each app receives two immutable `app_routes` records, one for preview and one for production. The record contains an opaque UUID route key and organization/app/environment foreign keys. Existing apps are backfilled during migration.

Production URLs use `https://{route-key}.{application-base-host}/`. The application base host is a Toolflow-controlled wildcard DNS/TLS zone. The dispatch Worker accepts only an exact UUID label followed by the configured base host; suffix-confusion hosts and path-supplied organization/app/environment values are rejected. The private authorization service resolves the route key to its organization, app, environment, active deployment, and live membership before issuing a 30-second runtime context.

Local development retains the explicit `/apps/{organization}/{slug}/{environment}/` path so loopback testing does not require wildcard DNS. This path is implemented by the trusted local dispatcher and is not the production Workers for Platforms route.

## Decision: connection secrets

Development may use the local AES-256-GCM vault. Production refuses this backend and requires the KMS backend.

For every create or rotation, the KMS backend:

1. Requests a fresh 256-bit data key from the configured KMS broker.
2. Encrypts the password with AES-256-GCM and organization/purpose/key-version authenticated data.
3. Immediately zeroes the plaintext data key.
4. Stores only ciphertext, IV, authentication tag, provider name, key version, and provider-wrapped data key behind an opaque UUID.

For reads, the gateway sends the wrapped key and exact organization/purpose context to the KMS broker, decrypts in memory, and zeroes the data key. Generated apps, build workers, browsers, MCP responses, and control database roles never receive the KMS service token or root key.

The broker contract is:

- `POST /v1/data-keys` with `{ keyId, context }`, returning `{ plaintextKey, encryptedDataKey, keyVersion }`.
- `POST /v1/data-keys/decrypt` with `{ keyId, encryptedDataKey, keyVersion, context }`, returning `{ plaintextKey }`.

Keys are base64-encoded 32-byte values. The broker URL must be HTTPS without URL credentials; calls use a dedicated bearer service credential, a five-second deadline, manual redirects, and a 16 KB response cap. Provider authorization must restrict the configured identity to generate/decrypt on the single connection-secret key and bind encryption context where supported.

## Consequences

- Wildcard DNS/TLS and the selected KMS broker remain deployment evidence, not application-code assumptions.
- A missing route, KMS configuration, wrong provider name, invalid data key, redirect, or unavailable broker fails closed.
- Existing local-key secrets must be rotated through an admin connection update before production switches to KMS; the local master key is never accepted by production as a fallback.
