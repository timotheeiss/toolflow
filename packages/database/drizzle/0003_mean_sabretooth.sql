ALTER TABLE "usage_events" ADD COLUMN "trace_id" text;--> statement-breakpoint
UPDATE "usage_events" SET "trace_id" = md5("request_id" || ':' || "id"::text) WHERE "trace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "trace_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_trace_idx" ON "usage_events" USING btree ("trace_id");
