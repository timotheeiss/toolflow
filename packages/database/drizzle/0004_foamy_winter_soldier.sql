CREATE TABLE "app_routes" (
	"route_key" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_routes" ADD CONSTRAINT "app_routes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_routes" ADD CONSTRAINT "app_routes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "app_routes" ("route_key", "organization_id", "app_id", "environment")
SELECT gen_random_uuid(), "apps"."organization_id", "apps"."id", "routes"."environment"::"environment"
FROM "apps"
CROSS JOIN (VALUES ('preview'), ('production')) AS "routes"("environment");--> statement-breakpoint
CREATE UNIQUE INDEX "app_routes_app_environment_unique" ON "app_routes" USING btree ("app_id","environment");--> statement-breakpoint
CREATE INDEX "app_routes_organization_app_idx" ON "app_routes" USING btree ("organization_id","app_id");
