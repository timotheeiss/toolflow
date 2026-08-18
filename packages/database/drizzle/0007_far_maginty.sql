ALTER TABLE "deployments" DROP CONSTRAINT "deployments_approval_request_id_approval_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN "approval_request_id";--> statement-breakpoint
DROP TABLE "approval_decisions";--> statement-breakpoint
DROP TABLE "approval_requests";--> statement-breakpoint
DROP TYPE "public"."approval_status";
