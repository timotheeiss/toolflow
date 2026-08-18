import { randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationUrl = process.env.MCP_INTEGRATION_URL;
const controlApiUrl = process.env.CONTROL_API_URL ?? "http://127.0.0.1:3000";
const organizationId = "00000000-0000-4000-8000-000000000003";
const primaryAdminHeaders = {
  "content-type": "application/json",
  "x-toolflow-dev-user-id": "00000000-0000-4000-8000-000000000001",
  "x-toolflow-dev-membership-id": "00000000-0000-4000-8000-000000000002",
  "x-toolflow-dev-organization-id": organizationId,
  "x-toolflow-dev-role": "admin",
};

describe.skipIf(!integrationUrl)("Toolflow MCP protocol", () => {
  const client = new Client(
    { name: "toolflow-integration-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );

  beforeAll(async () => {
    const transport = new StreamableHTTPClientTransport(new URL(integrationUrl!), {
      authProvider: { token: () => Promise.resolve("development-token") },
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("advertises stable tools and returns structured organization context", async () => {
    const listing = await client.listTools();
    expect(listing.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "get_current_user",
        "list_organization_users",
        "get_organization_branding",
        "search_apps",
        "list_data_connections",
        "search_data_catalog",
        "create_app",
        "update_app_files",
        "plan_app_schema_change",
        "apply_preview_schema_change",
        "deploy_to_production",
        "grant_app_access",
        "revoke_app_access",
        "rollback_app",
        "disable_app",
      ]),
    );
    expect(listing.tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining([
        "request_production_deployment",
        "deploy_approved_version",
        "approve_production_deployment",
        "reject_production_deployment",
      ]),
    );

    const current = await client.callTool({ name: "get_current_user", arguments: {} });
    expect(current.isError).not.toBe(true);
    expect(current.structuredContent).toMatchObject({
      result: { role: "admin", email: "admin@toolflow.local" },
    });
  });

  it("creates immutable source idempotently and rejects stale updates", async () => {
    const users = await client.callTool({
      name: "list_organization_users",
      arguments: { limit: 10 },
    });
    const userPage = users.structuredContent as {
      items: { membershipId: string; status: string }[];
    };
    const owner = userPage.items.find((user) => user.status === "active")!;
    const suffix = Date.now().toString(36);
    const createArguments = {
      slug: `mcp-smoke-${suffix}`,
      name: `MCP Smoke ${suffix}`,
      description: "Protocol integration test app",
      ownerMembershipId: owner.membershipId,
      idempotencyKey: `create-${suffix}`,
    };
    const created = await client.callTool({ name: "create_app", arguments: createArguments });
    expect(created.isError).not.toBe(true);
    const first = (
      created.structuredContent as { result: { appId: string; sourceVersionId: string } }
    ).result;

    const replay = await client.callTool({ name: "create_app", arguments: createArguments });
    expect(replay.structuredContent).toMatchObject({ result: first });

    const isolatedApp = await client.callTool({
      name: "create_app",
      arguments: {
        ...createArguments,
        slug: `mcp-isolation-${suffix}`,
        name: `MCP Isolation ${suffix}`,
        idempotencyKey: `create-isolation-${suffix}`,
      },
    });
    expect(isolatedApp.isError).not.toBe(true);
    const isolatedAppId = (isolatedApp.structuredContent as { result: { appId: string } }).result
      .appId;
    const crossAppRead = await client.callTool({
      name: "read_app_file",
      arguments: {
        appId: isolatedAppId,
        versionId: first.sourceVersionId,
        path: "toolflow.manifest.json",
      },
    });
    expect(crossAppRead.isError).toBe(true);
    expect(JSON.stringify(crossAppRead.content)).not.toContain("ToolflowShell");

    const crossOrganization = await fetch(`${controlApiUrl}/v1/apps/${first.appId}`, {
      headers: {
        ...primaryAdminHeaders,
        "x-toolflow-dev-organization-id": randomUUID(),
      },
    });
    expect(crossOrganization.status).toBe(404);
    expect(JSON.stringify(await crossOrganization.json())).not.toContain(first.appId);

    const updated = await client.callTool({
      name: "update_app_files",
      arguments: {
        appId: first.appId,
        baseVersionId: first.sourceVersionId,
        files: [{ path: "src/styles.css", content: ":root { color-scheme: light; }\n" }],
        deletedPaths: [],
        message: "Add base visual style",
        idempotencyKey: `update-${suffix}`,
      },
    });
    expect(updated.isError).not.toBe(true);
    const updatedVersion = (updated.structuredContent as { result: { sourceVersionId: string } })
      .result.sourceVersionId;

    const manifestFile = await client.callTool({
      name: "read_app_file",
      arguments: {
        appId: first.appId,
        path: "toolflow.manifest.json",
        versionId: updatedVersion,
      },
    });
    const manifestResult = (manifestFile.structuredContent as { result: { content: string } })
      .result;
    const manifest = JSON.parse(manifestResult.content) as Record<string, unknown>;
    manifest.capabilities = [
      {
        kind: "app_data",
        table: "requests",
        operations: ["create", "read", "update", "delete"],
      },
    ];
    manifest.schema = {
      tables: [
        {
          name: "requests",
          columns: [
            { name: "id", type: "uuid", nullable: false },
            { name: "title", type: "text", nullable: false },
          ],
          primaryKey: ["id"],
          indexes: [["title"]],
          foreignKeys: [],
        },
      ],
    };
    const dataUpdate = await client.callTool({
      name: "update_app_files",
      arguments: {
        appId: first.appId,
        baseVersionId: updatedVersion,
        files: [
          {
            path: "toolflow.manifest.json",
            content: JSON.stringify(manifest, null, 2),
          },
        ],
        deletedPaths: [],
        message: "Declare isolated managed data",
        idempotencyKey: `data-${suffix}`,
      },
    });
    expect(dataUpdate.isError).not.toBe(true);
    const dataVersion = (dataUpdate.structuredContent as { result: { sourceVersionId: string } })
      .result.sourceVersionId;

    const planned = await client.callTool({
      name: "plan_app_schema_change",
      arguments: {
        appId: first.appId,
        sourceVersionId: dataVersion,
        environment: "preview",
        idempotencyKey: `preview-plan-${suffix}`,
      },
    });
    expect(planned.isError).not.toBe(true);
    const planId = (planned.structuredContent as { result: { id: string } }).result.id;
    const applied = await client.callTool({
      name: "apply_preview_schema_change",
      arguments: { planId, idempotencyKey: `preview-schema-${suffix}` },
    });
    expect(applied.isError).not.toBe(true);
    expect(applied.structuredContent).toMatchObject({ result: { applied: true } });

    const validated = await client.callTool({
      name: "validate_app",
      arguments: {
        appId: first.appId,
        sourceVersionId: dataVersion,
        idempotencyKey: `validate-${suffix}`,
      },
    });
    expect(validated.isError).not.toBe(true);
    expect(validated.structuredContent).toMatchObject({
      result: { status: "succeeded", sourceVersionId: dataVersion },
    });
    const buildId = (validated.structuredContent as { result: { id: string } }).result.id;
    const productionWithoutPreview = await client.callTool({
      name: "deploy_to_production",
      arguments: {
        appId: first.appId,
        buildId,
        idempotencyKey: `production-without-preview-${suffix}`,
      },
    });
    expect(productionWithoutPreview.isError).toBe(true);
    expect(JSON.stringify(productionWithoutPreview.content)).toContain(
      "A successful preview of this exact build is required",
    );
    const preview = await client.callTool({
      name: "create_preview",
      arguments: {
        appId: first.appId,
        buildId,
        idempotencyKey: `preview-${suffix}`,
      },
    });
    expect(preview.isError).not.toBe(true);
    const previewResult = (preview.structuredContent as { result: { status: string; url: string } })
      .result;
    expect(previewResult.status).toBe("succeeded");
    const previewPage = await fetch(previewResult.url);
    expect(previewPage.status).toBe(200);
    expect(await previewPage.text()).toContain("Preview environment");
    const health = await fetch(new URL("api/health", previewResult.url));
    expect(await health.json()).toMatchObject({ status: "ok" });
    const createdRecord = await fetch(
      new URL("__toolflow/data/managed/create", previewResult.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          table: "requests",
          values: {
            id: "00000000-0000-4000-8000-000000000099",
            title: "Verify governed data",
          },
        }),
      },
    );
    expect(createdRecord.status).toBe(200);
    expect(await createdRecord.json()).toMatchObject({
      record: { title: "Verify governed data" },
    });
    const listedRecords = await fetch(new URL("__toolflow/data/managed/list", previewResult.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ table: "requests", limit: 10, offset: 0 }),
    });
    expect(listedRecords.status).toBe(200);
    const listedPayload = (await listedRecords.json()) as {
      records: { id: string; title: string }[];
    };
    expect(listedPayload.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Verify governed data" })]),
    );

    const production = await client.callTool({
      name: "deploy_to_production",
      arguments: {
        appId: first.appId,
        buildId,
        idempotencyKey: `production-${suffix}`,
      },
    });
    expect(production.isError, JSON.stringify(production.content)).not.toBe(true);
    const productionResult = (
      production.structuredContent as {
        result: { id: string; status: string; url: string; schemaPlanId: string | null };
      }
    ).result;
    expect(productionResult.status).toBe("succeeded");
    expect(productionResult.schemaPlanId).not.toBeNull();
    const productionReplay = await client.callTool({
      name: "deploy_to_production",
      arguments: {
        appId: first.appId,
        buildId,
        idempotencyKey: `production-${suffix}`,
      },
    });
    expect(productionReplay.structuredContent).toMatchObject({
      result: { id: productionResult.id },
    });

    const invited = await fetch(`${controlApiUrl}/v1/users`, {
      method: "POST",
      headers: primaryAdminHeaders,
      body: JSON.stringify({ email: `app-member-${suffix}@example.test`, role: "member" }),
    });
    expect(invited.status).toBe(201);
    const invitedUser = (await invited.json()) as {
      user: { userId: string; membershipId: string };
    };
    const activated = await fetch(`${controlApiUrl}/v1/users/${invitedUser.user.membershipId}`, {
      method: "PATCH",
      headers: primaryAdminHeaders,
      body: JSON.stringify({ status: "active" }),
    });
    expect(activated.status).toBe(200);
    const appMemberHeaders = {
      "content-type": "application/json",
      "x-toolflow-dev-user-id": invitedUser.user.userId,
      "x-toolflow-dev-membership-id": invitedUser.user.membershipId,
      "x-toolflow-dev-organization-id": organizationId,
      "x-toolflow-dev-role": "member",
    };
    expect((await fetch(productionResult.url)).status).toBe(200);
    const productionCreate = await fetch(
      new URL("__toolflow/data/managed/create", productionResult.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          table: "requests",
          values: {
            id: "00000000-0000-4000-8000-000000000100",
            title: "Production record",
          },
        }),
      },
    );
    expect(productionCreate.status).toBe(200);
    const previewAfterProduction = await fetch(
      new URL("__toolflow/data/managed/list", previewResult.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table: "requests", limit: 10, offset: 0 }),
      },
    );
    const previewAfterProductionPayload = (await previewAfterProduction.json()) as {
      records: { title: string }[];
    };
    expect(previewAfterProductionPayload.records.map((record) => record.title)).not.toContain(
      "Production record",
    );
    const productionRecords = await fetch(
      new URL("__toolflow/data/managed/list", productionResult.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table: "requests", limit: 10, offset: 0 }),
      },
    );
    const productionRecordsPayload = (await productionRecords.json()) as {
      records: { title: string }[];
    };
    expect(productionRecordsPayload.records.map((record) => record.title)).toContain(
      "Production record",
    );
    expect(productionRecordsPayload.records.map((record) => record.title)).not.toContain(
      "Verify governed data",
    );

    expect((await fetch(productionResult.url, { headers: appMemberHeaders })).status).toBe(404);
    const granted = await client.callTool({
      name: "grant_app_access",
      arguments: {
        appId: first.appId,
        membershipId: invitedUser.user.membershipId,
        idempotencyKey: `grant-${suffix}`,
      },
    });
    expect(granted.isError).not.toBe(true);
    expect((await fetch(productionResult.url, { headers: appMemberHeaders })).status).toBe(200);
    const revoked = await client.callTool({
      name: "revoke_app_access",
      arguments: {
        appId: first.appId,
        membershipId: invitedUser.user.membershipId,
        idempotencyKey: `revoke-${suffix}`,
      },
    });
    expect(revoked.isError).not.toBe(true);
    expect((await fetch(productionResult.url, { headers: appMemberHeaders })).status).toBe(404);

    const secondSource = await client.callTool({
      name: "update_app_files",
      arguments: {
        appId: first.appId,
        baseVersionId: dataVersion,
        files: [
          {
            path: "src/App.tsx",
            content:
              'import { ToolflowShell } from "@toolflow/components";\nexport function App(){ return <ToolflowShell title="Second production"><p>Code-only release.</p></ToolflowShell>; }\n',
          },
        ],
        deletedPaths: [],
        message: "Code-only production release",
        idempotencyKey: `second-source-${suffix}`,
      },
    });
    expect(secondSource.isError).not.toBe(true);
    const secondVersion = (
      secondSource.structuredContent as { result: { sourceVersionId: string } }
    ).result.sourceVersionId;
    const secondPreviewPlan = await client.callTool({
      name: "plan_app_schema_change",
      arguments: {
        appId: first.appId,
        sourceVersionId: secondVersion,
        environment: "preview",
        idempotencyKey: `second-preview-plan-${suffix}`,
      },
    });
    const secondPreviewPlanId = (secondPreviewPlan.structuredContent as { result: { id: string } })
      .result.id;
    expect(
      (
        await client.callTool({
          name: "apply_preview_schema_change",
          arguments: {
            planId: secondPreviewPlanId,
            idempotencyKey: `second-preview-schema-${suffix}`,
          },
        })
      ).isError,
    ).not.toBe(true);
    const secondBuild = await client.callTool({
      name: "validate_app",
      arguments: {
        appId: first.appId,
        sourceVersionId: secondVersion,
        idempotencyKey: `second-validate-${suffix}`,
      },
    });
    const secondBuildId = (secondBuild.structuredContent as { result: { id: string } }).result.id;
    expect(
      (
        await client.callTool({
          name: "create_preview",
          arguments: {
            appId: first.appId,
            buildId: secondBuildId,
            idempotencyKey: `second-preview-${suffix}`,
          },
        })
      ).isError,
    ).not.toBe(true);
    const secondProduction = await client.callTool({
      name: "deploy_to_production",
      arguments: {
        appId: first.appId,
        buildId: secondBuildId,
        idempotencyKey: `second-production-${suffix}`,
      },
    });
    expect(secondProduction.isError, JSON.stringify(secondProduction.content)).not.toBe(true);
    const secondProductionId = (secondProduction.structuredContent as { result: { id: string } })
      .result.id;
    const rollback = await client.callTool({
      name: "rollback_app",
      arguments: {
        appId: first.appId,
        targetDeploymentId: productionResult.id,
        reason: "Verify immutable artifact rollback",
        idempotencyKey: `rollback-${suffix}`,
      },
    });
    expect(rollback.isError, JSON.stringify(rollback.content)).not.toBe(true);
    expect(rollback.structuredContent).toMatchObject({
      result: {
        status: "succeeded",
        sourceDeploymentId: secondProductionId,
        targetDeploymentId: productionResult.id,
      },
    });
    const afterRollbackCreate = await fetch(
      new URL("__toolflow/data/managed/create", productionResult.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          table: "requests",
          values: {
            id: "00000000-0000-4000-8000-000000000101",
            title: "Record after rollback",
          },
        }),
      },
    );
    expect(afterRollbackCreate.status).toBe(200);

    const stale = await client.callTool({
      name: "update_app_files",
      arguments: {
        appId: first.appId,
        baseVersionId: first.sourceVersionId,
        files: [{ path: "src/styles.css", content: "body { margin: 0; }\n" }],
        deletedPaths: [],
        message: "Stale update",
        idempotencyKey: `stale-${suffix}`,
      },
    });
    expect(stale.isError).toBe(true);
    expect(stale.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(stale.content)).toContain("latestVersionId");
  });
});
