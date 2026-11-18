CREATE TABLE "endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL,
	"owner_token_hash" char(64) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"resp_status" integer DEFAULT 200 NOT NULL,
	"resp_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resp_body" text DEFAULT '' NOT NULL,
	"resp_delay_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "endpoints_slug_unique" UNIQUE("slug"),
	CONSTRAINT "endpoints_resp_status_check" CHECK ("endpoints"."resp_status" BETWEEN 100 AND 599),
	CONSTRAINT "endpoints_resp_delay_ms_check" CHECK ("endpoints"."resp_delay_ms" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "replays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"target_url" text NOT NULL,
	"req_method" varchar(16) NOT NULL,
	"req_headers" jsonb NOT NULL,
	"req_body" "bytea",
	"resp_status" integer,
	"resp_headers" jsonb,
	"resp_body" "bytea",
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replays_outcome_check" CHECK ("replays"."resp_status" IS NOT NULL OR "replays"."error" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_query" text DEFAULT '' NOT NULL,
	"headers" jsonb NOT NULL,
	"body" "bytea",
	"content_type" text,
	"size_bytes" integer NOT NULL,
	"ip" "inet",
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_size_bytes_check" CHECK ("requests"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "endpoints_expires_at_idx" ON "endpoints" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "replays_request_created_idx" ON "replays" USING btree ("request_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "requests_endpoint_received_idx" ON "requests" USING btree ("endpoint_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);