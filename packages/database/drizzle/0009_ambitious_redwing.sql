ALTER TABLE "app_routes" ADD COLUMN "url" text;--> statement-breakpoint
UPDATE "app_routes"
SET "url" = CASE
  WHEN "app_routes"."environment" = 'preview' THEN "apps"."preview_url"
  WHEN "app_routes"."environment" = 'production' THEN "apps"."production_url"
END
FROM "apps"
WHERE "apps"."id" = "app_routes"."app_id";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "preview_url";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "production_url";
