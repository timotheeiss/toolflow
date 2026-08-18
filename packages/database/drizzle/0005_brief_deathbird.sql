ALTER TABLE "secret_envelopes" ADD COLUMN "key_provider" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_envelopes" ADD COLUMN "encrypted_data_key" text;