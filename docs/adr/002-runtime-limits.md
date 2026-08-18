# ADR-002: Runtime isolation and request limits

Status: Accepted for MVP  
Date: 2026-08-10

## Context

Generated application code is untrusted. Static source validation is useful feedback, but the security boundary must be enforced while the code executes and while it attempts outbound requests.

## Decision

Run every immutable deployment as its own Cloudflare Workers for Platforms user Worker. All public traffic enters an environment-specific Toolflow dispatch namespace; user Workers have no public routes. All generated-code fetches pass through the Toolflow outbound Worker, which only permits exact HTTPS Toolflow data-gateway endpoints and rejects redirects.

The pilot defaults are:

| Limit                            |          Default | Enforcement point                         |
| -------------------------------- | ---------------: | ----------------------------------------- |
| CPU time                         |    50 ms/request | dispatch namespace invocation             |
| Generated-code subrequests       |       10/request | dispatch namespace invocation             |
| Health-check subrequests         |        1/request | dispatch namespace invocation             |
| Data request body                |             1 MB | dispatch and outbound Workers             |
| Authorization response           |            16 KB | dispatch Worker                           |
| App response body                |             8 MB | dispatch Worker and edge configuration    |
| Total generated-app request time |       30 seconds | dispatch Worker and edge configuration    |
| Runtime request rate             | 600/minute/actor | Cloudflare shared rate-limit binding      |
| External query time              |        5 seconds | data gateway/PostgreSQL statement timeout |
| External query rows              |            1,000 | data gateway cursor                       |
| External query response          |             5 MB | data gateway cursor                       |

Production may lower these limits per namespace. Raising them requires a threat-model review and updated load evidence. CPU and subrequest values are passed explicitly to the Workers for Platforms dispatch binding. The dispatch Worker consumes a Cloudflare shared rate-limit counter only after trusted authorization, keyed by organization ID plus the organization-scoped actor hash, and does not invoke generated code after denial. Response-size and duration limits are also configured at the Toolflow edge so termination does not depend on generated code cooperating.

Authenticated control API and MCP requests use atomic fixed-window buckets in PostgreSQL. The bucket key is a SHA-256 digest of organization plus actor identity, so all service replicas share the same quota without persisting those identifiers in the rate-limit table. Unauthenticated control-plane traffic also has a client-level abuse ceiling before authentication.

Preview and production use separate dispatch namespaces. The deployment service owns the only narrowly scoped publication credential; generated code, the build worker, and the runtime dispatcher never receive it.

## Consequences

- A generated app cannot add bindings, expose a bypass route, or select its own outbound Worker.
- A request may fail with a generic availability or limit error even if generated code could eventually have completed.
- Provider namespace configuration is part of the pilot evidence and must match this ADR.
