# Toolflow trusted-pilot deployment

This repository is configured for one pilot environment on `toolflow.space`. It deliberately does not create cloud resources or set secrets for you.

## Provider setup

1. Register `toolflow.space` and add it to Cloudflare. Create a proxied wildcard DNS `A` record named `*.apps` with value `192.0.2.0`, then deploy the route `*.apps.toolflow.space/*` from `apps/runtime-dispatch-worker/wrangler.pilot.jsonc`.
2. Create a Supabase project in Paris. Use its transaction pooler URL for `DATABASE_URL` and its direct URL only for `DIRECT_DATABASE_URL` when running migrations/bootstrap.
3. Create the private R2 bucket `toolflow-pilot`, then create an R2 token scoped only to that bucket.
4. In WorkOS AuthKit, add `https://api.toolflow.space/auth/callback`, create the pilot organization, and invite the initial administrator.
5. Create Vercel projects rooted at `apps/admin`, `apps/vercel-api`, and `apps/vercel-build`. Attach `console`, `api`, `mcp`, `runtime-auth`, `data`, `deploy`, and `build` respectively to `toolflow.space`.

## Vercel environment variables

The two server projects (`toolflow-api` and `toolflow-build`) use `NODE_ENV=production`, `TOOLFLOW_DEPLOYMENT_TIER=trusted-pilot`, `TOOLFLOW_DATABASE_POOL_MAX=1`, and the Supabase transaction-pooler `DATABASE_URL`. The dashboard project needs only `VITE_CONTROL_API_URL=https://api.toolflow.space`.

The API project additionally receives WorkOS credentials, `TOOLFLOW_COOKIE_DOMAIN=.toolflow.space`, the 32-byte base64 `TOOLFLOW_SECRET_ENCRYPTION_KEY`, `TOOLFLOW_RUNTIME_CONTEXT_SECRET`, runtime/deployment service tokens, R2 credentials, and Cloudflare publisher credentials. Set these URLs exactly:

```text
TOOLFLOW_ADMIN_ORIGIN=https://console.toolflow.space
WORKOS_REDIRECT_URI=https://api.toolflow.space/auth/callback
TOOLFLOW_MCP_RESOURCE_URL=https://mcp.toolflow.space/mcp
TOOLFLOW_RUNTIME_BASE_URL=https://apps.toolflow.space
TOOLFLOW_DATA_GATEWAY_URL=https://data.toolflow.space
TOOLFLOW_DEPLOYMENT_SERVICE_URL=https://deploy.toolflow.space
TOOLFLOW_BUILD_SERVICE_URL=https://build.toolflow.space
TOOLFLOW_BUILD_EXECUTION=external
```

The build project receives only `DATABASE_URL`, the R2 credentials, `TOOLFLOW_BUILD_SERVICE_TOKEN`, `TOOLFLOW_BUILD_TIMEOUT_MS=50000`, and `TOOLFLOW_BUILD_MAX_ARTIFACT_BYTES`. Never add WorkOS, Cloudflare, runtime-context, deployment, or gateway secrets to it. Vercel Hobby functions have a 60-second ceiling, so the build timeout deliberately leaves time for setup and cleanup. Upgrade to Vercel Pro before raising this limit.

## First deployment

```sh
DIRECT_DATABASE_URL='...' pnpm db:migrate
DIRECT_DATABASE_URL='...' \
TOOLFLOW_INITIAL_WORKOS_ORGANIZATION_ID='org_...' \
TOOLFLOW_INITIAL_ORGANIZATION_SLUG='toolflow-pilot' \
TOOLFLOW_INITIAL_ORGANIZATION_NAME='Toolflow Pilot' \
TOOLFLOW_INITIAL_ADMIN_EMAIL='you@example.com' \
TOOLFLOW_INITIAL_ADMIN_NAME='Your Name' \
pnpm db:bootstrap:pilot
```

Deploy the two Cloudflare Workers before allowing an application publish. Then test login, invited-user access, build, preview deploy, production deploy, data request, and rollback.

This is a trusted-builder deployment: build code can read the build project's database and R2 credentials. Do not invite untrusted builders.
