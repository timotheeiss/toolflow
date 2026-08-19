import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const membershipRole = pgEnum("membership_role", ["admin", "builder", "member"]);
export const membershipStatus = pgEnum("membership_status", ["invited", "active", "deactivated"]);
export const appLifecycle = pgEnum("app_lifecycle", [
  "draft",
  "preview",
  "production",
  "disabled",
  "orphaned",
  "archived",
]);
export const environment = pgEnum("environment", ["preview", "production"]);
export const buildStatus = pgEnum("build_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
]);
export const deploymentStatus = pgEnum("deployment_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export const connectionStatus = pgEnum("connection_status", ["draft", "active", "disabled"]);
export const catalogLifecycle = pgEnum("catalog_lifecycle", ["active", "deprecated", "hidden"]);
export const sensitivity = pgEnum("sensitivity", [
  "public",
  "internal",
  "confidential",
  "restricted",
]);
export const auditOutcome = pgEnum("audit_outcome", ["succeeded", "failed", "denied"]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalIdentityId: text("external_identity_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organizations_external_identity_unique").on(table.externalIdentityId),
    uniqueIndex("organizations_slug_unique").on(table.slug),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalIdentityId: text("external_identity_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_external_identity_unique").on(table.externalIdentityId),
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    status: membershipStatus("status").notNull().default("invited"),
    invitedEmail: text("invited_email").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("memberships_organization_user_unique").on(table.organizationId, table.userId),
    index("memberships_organization_status_idx").on(table.organizationId, table.status),
  ],
);

export const organizationBranding = pgTable("organization_branding", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  logoObjectKey: text("logo_object_key"),
  primaryColor: text("primary_color").notNull().default("#2563EB"),
  designGuidance: text("design_guidance").notNull().default(""),
  ...timestamps,
});

export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    lifecycle: appLifecycle("lifecycle").notNull().default("draft"),
    disabledReason: text("disabled_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("apps_organization_slug_unique").on(table.organizationId, table.slug),
    index("apps_organization_lifecycle_idx").on(table.organizationId, table.lifecycle),
  ],
);

export const appRoutes = pgTable(
  "app_routes",
  {
    routeKey: uuid("route_key").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    environment: environment("environment").notNull(),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("app_routes_app_environment_unique").on(table.appId, table.environment),
    index("app_routes_organization_app_idx").on(table.organizationId, table.appId),
  ],
);

export const appOwners = pgTable(
  "app_owners",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.membershipId] })],
);

export const appMembers = pgTable(
  "app_members",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.membershipId] })],
);

export const runtimeVersions = pgTable(
  "runtime_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    sourceHash: text("source_hash").notNull(),
    dependencyLockHash: text("dependency_lock_hash").notNull(),
    compatibilityDate: text("compatibility_date").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("runtime_name_version_unique").on(table.name, table.version)],
);

export const sourceVersions = pgTable(
  "source_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    parentVersionId: uuid("parent_version_id"),
    actorMembershipId: uuid("actor_membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "restrict" }),
    message: text("message").notNull(),
    contentHash: text("content_hash").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    objectKey: text("object_key").notNull(),
    fileCount: integer("file_count").notNull(),
    sourceBytes: integer("source_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_versions_app_content_unique").on(table.appId, table.contentHash),
    index("source_versions_app_created_idx").on(table.appId, table.createdAt),
  ],
);

export const capabilitySets = pgTable(
  "capability_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    capabilities: jsonb("capabilities").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("capability_sets_source_unique").on(table.sourceVersionId)],
);

export const schemaVersions = pgTable(
  "schema_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    schema: jsonb("schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("schema_versions_source_unique").on(table.sourceVersionId)],
);

export const builds = pgTable(
  "builds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "restrict" }),
    runtimeVersionId: uuid("runtime_version_id")
      .notNull()
      .references(() => runtimeVersions.id, { onDelete: "restrict" }),
    status: buildStatus("status").notNull().default("queued"),
    artifactHash: text("artifact_hash"),
    artifactObjectKey: text("artifact_object_key"),
    diagnostics: jsonb("diagnostics").notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("builds_app_created_idx").on(table.appId, table.createdAt)],
);

export const dataConnections = pgTable(
  "data_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("postgresql"),
    status: connectionStatus("status").notNull().default("draft"),
    secretId: text("secret_id").notNull(),
    configuration: jsonb("configuration").notNull().default({}),
    disabledReason: text("disabled_reason"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("connections_organization_slug_unique").on(table.organizationId, table.slug),
  ],
);

export const secretEnvelopes = pgTable(
  "secret_envelopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    ciphertext: text("ciphertext").notNull(),
    initializationVector: text("initialization_vector").notNull(),
    authenticationTag: text("authentication_tag").notNull(),
    keyVersion: text("key_version").notNull(),
    keyProvider: text("key_provider").notNull().default("local"),
    encryptedDataKey: text("encrypted_data_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("secret_envelopes_organization_idx").on(table.organizationId)],
);

export const catalogObjects = pgTable(
  "catalog_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => dataConnections.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    kind: text("kind").notNull(),
    schemaName: text("schema_name").notNull(),
    objectName: text("object_name").notNull(),
    dataType: text("data_type"),
    nullable: boolean("nullable"),
    metadata: jsonb("metadata").notNull().default({}),
    lifecycle: catalogLifecycle("lifecycle").notNull().default("active"),
    sensitivity: sensitivity("sensitivity").notNull().default("internal"),
    description: text("description").notNull().default(""),
    businessOwner: text("business_owner"),
    sourceOfTruth: boolean("source_of_truth").notNull().default(false),
    catalogVersion: integer("catalog_version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("catalog_object_identity_unique").on(
      table.connectionId,
      table.kind,
      table.schemaName,
      table.objectName,
    ),
    index("catalog_organization_lifecycle_idx").on(table.organizationId, table.lifecycle),
  ],
);

export const appDataSpaces = pgTable(
  "app_data_spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    environment: environment("environment").notNull(),
    schemaName: text("schema_name").notNull(),
    activeSchemaVersionId: uuid("active_schema_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("app_data_space_environment_unique").on(table.appId, table.environment)],
);

export const schemaPlans = pgTable(
  "schema_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    environment: environment("environment").notNull(),
    fromSchemaVersionId: uuid("from_schema_version_id"),
    toSchemaVersionId: uuid("to_schema_version_id")
      .notNull()
      .references(() => schemaVersions.id, { onDelete: "restrict" }),
    hash: text("hash").notNull(),
    operations: jsonb("operations").notNull(),
    risk: text("risk").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("schema_plan_hash_unique").on(table.appId, table.environment, table.hash),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    environment: environment("environment").notNull(),
    actorMembershipId: uuid("actor_membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "restrict" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "restrict" }),
    buildId: uuid("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "restrict" }),
    capabilitySetId: uuid("capability_set_id")
      .notNull()
      .references(() => capabilitySets.id, { onDelete: "restrict" }),
    schemaVersionId: uuid("schema_version_id").references(() => schemaVersions.id, {
      onDelete: "restrict",
    }),
    runtimeVersionId: uuid("runtime_version_id")
      .notNull()
      .references(() => runtimeVersions.id, { onDelete: "restrict" }),
    artifactHash: text("artifact_hash").notNull(),
    providerDeploymentId: text("provider_deployment_id"),
    status: deploymentStatus("status").notNull().default("queued"),
    failure: jsonb("failure"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("deployment_app_environment_created_idx").on(
      table.appId,
      table.environment,
      table.createdAt,
    ),
  ],
);

export const activeDeployments = pgTable(
  "active_deployments",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    environment: environment("environment").notNull(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.environment] })],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").notNull(),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_scope_unique").on(
      table.organizationId,
      table.actorId,
      table.operation,
      table.key,
    ),
  ],
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyHash] }),
    index("rate_limit_buckets_reset_idx").on(table.resetAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id").notNull(),
    sessionId: text("session_id"),
    clientId: text("client_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    environment: environment("environment"),
    requestId: text("request_id").notNull(),
    outcome: auditOutcome("outcome").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_organization_occurred_idx").on(table.organizationId, table.occurredAt),
    index("audit_organization_target_idx").on(
      table.organizationId,
      table.targetType,
      table.targetId,
    ),
    index("audit_request_idx").on(table.requestId),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    deploymentId: uuid("deployment_id").references(() => deployments.id, { onDelete: "set null" }),
    environment: environment("environment").notNull(),
    eventType: text("event_type").notNull(),
    actorHash: text("actor_hash"),
    requestId: text("request_id").notNull(),
    traceId: text("trace_id").notNull(),
    durationMs: integer("duration_ms"),
    outcome: text("outcome").notNull(),
    dimensions: jsonb("dimensions").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_app_occurred_idx").on(table.appId, table.occurredAt),
    index("usage_trace_idx").on(table.traceId),
  ],
);
