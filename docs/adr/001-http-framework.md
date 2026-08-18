# ADR-001: Hono as the HTTP framework

Status: Accepted for MVP  
Date: 2026-08-10

## Context

Toolflow needs conventional Node HTTP services for its control plane and data gateway, plus Cloudflare Worker entry points for runtime dispatch and outbound policy enforcement. Maintaining two HTTP abstractions would duplicate authorization, validation, tracing, and error handling.

## Decision

Use Hono for Toolflow HTTP services and Worker entry points. Node-hosted services use the Hono Node adapter. Shared middleware may depend only on Web Standard Request and Response APIs.

## Consequences

- Request contracts and middleware can be shared across Node and Cloudflare runtimes.
- Framework-specific features not available on Workers must remain isolated in Node service adapters.
- This decision does not require the admin UI or generated application UI to use Hono.
