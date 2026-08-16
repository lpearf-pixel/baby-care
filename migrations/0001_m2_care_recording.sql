CREATE TYPE "public"."bottle_liquid_type" AS ENUM('expressed_breast_milk', 'formula');--> statement-breakpoint
CREATE TYPE "public"."care_action_type" AS ENUM('burping', 'spit_up', 'crying', 'bathing', 'medication');--> statement-breakpoint
CREATE TYPE "public"."care_event_status" AS ENUM('active', 'voided');--> statement-breakpoint
CREATE TYPE "public"."care_event_type" AS ENUM('feeding', 'diaper', 'sleep', 'burping', 'spit_up', 'crying', 'bathing', 'medication', 'temperature', 'weight');--> statement-breakpoint
CREATE TYPE "public"."care_revision_action" AS ENUM('edit', 'void');--> statement-breakpoint
CREATE TYPE "public"."care_source" AS ENUM('manual', 'guardian', 'device', 'import', 'ai');--> statement-breakpoint
CREATE TYPE "public"."diaper_kind" AS ENUM('urine', 'stool', 'urine_stool');--> statement-breakpoint
CREATE TYPE "public"."feeding_component_type" AS ENUM('direct_breastfeeding', 'bottle');--> statement-breakpoint
CREATE TYPE "public"."measurement_type" AS ENUM('temperature', 'weight');--> statement-breakpoint
CREATE TYPE "public"."spit_up_amount" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TABLE "care_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"baby_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_membership_id" uuid,
	"source" "care_source" NOT NULL,
	"event_type" "care_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "care_event_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"client_request_id" uuid,
	"note" text,
	"trace_id" text NOT NULL,
	CONSTRAINT "care_events_version_positive" CHECK ("care_events"."version" > 0),
	CONSTRAINT "care_events_manual_actor_required" CHECK ("care_events"."source" <> 'manual' OR ("care_events"."actor_user_id" IS NOT NULL AND "care_events"."actor_membership_id" IS NOT NULL AND "care_events"."client_request_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "feeding_sessions" (
	"event_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeding_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_event_id" uuid NOT NULL,
	"component_type" "feeding_component_type" NOT NULL,
	"liquid_type" "bottle_liquid_type",
	"amount_ml" integer,
	"duration_minutes" integer,
	"bottle_capacity_ml" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "feeding_components_shape_check" CHECK ((("feeding_components"."component_type" = 'direct_breastfeeding' AND "feeding_components"."duration_minutes" > 0 AND "feeding_components"."amount_ml" IS NULL AND "feeding_components"."liquid_type" IS NULL AND "feeding_components"."bottle_capacity_ml" IS NULL) OR ("feeding_components"."component_type" = 'bottle' AND "feeding_components"."amount_ml" > 0 AND "feeding_components"."liquid_type" IS NOT NULL AND "feeding_components"."duration_minutes" IS NULL AND ("feeding_components"."bottle_capacity_ml" IS NULL OR "feeding_components"."bottle_capacity_ml" > 0))))
);
--> statement-breakpoint
CREATE TABLE "diaper_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"kind" "diaper_kind" NOT NULL,
	"stool_color" text,
	"stool_consistency" text,
	"stool_amount" text
);
--> statement-breakpoint
CREATE TABLE "sleep_intervals" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "sleep_intervals_order_check" CHECK ("sleep_intervals"."ended_at" IS NULL OR "sleep_intervals"."ended_at" >= "sleep_intervals"."started_at")
);
--> statement-breakpoint
CREATE TABLE "care_actions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"action_type" "care_action_type" NOT NULL,
	"feeding_session_event_id" uuid,
	"spit_up_amount" "spit_up_amount",
	"crying_duration_minutes" integer,
	"medication_name" text,
	"medication_dose" numeric(12, 3),
	"medication_dose_unit" text,
	CONSTRAINT "care_actions_crying_duration_positive" CHECK ("care_actions"."crying_duration_minutes" IS NULL OR "care_actions"."crying_duration_minutes" > 0),
	CONSTRAINT "care_actions_medication_fields_check" CHECK ("care_actions"."action_type" <> 'medication' OR ("care_actions"."medication_name" IS NOT NULL AND "care_actions"."medication_dose" > 0 AND "care_actions"."medication_dose_unit" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"measurement_type" "measurement_type" NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"method" text,
	CONSTRAINT "measurements_value_positive" CHECK ("measurements"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "care_event_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"edit_actor_user_id" uuid NOT NULL,
	"edit_actor_membership_id" uuid NOT NULL,
	"revision_action" "care_revision_action" NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "family_memberships_identity_owner_idx" ON "family_memberships" USING btree ("family_id","id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "babies_family_identity_idx" ON "babies" USING btree ("family_id","id");--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_family_baby_fk" FOREIGN KEY ("family_id","baby_id") REFERENCES "public"."babies"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_actor_membership_fk" FOREIGN KEY ("family_id","actor_membership_id","actor_user_id") REFERENCES "public"."family_memberships"("family_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeding_sessions" ADD CONSTRAINT "feeding_sessions_event_id_care_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."care_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeding_components" ADD CONSTRAINT "feeding_components_session_event_id_feeding_sessions_event_id_fk" FOREIGN KEY ("session_event_id") REFERENCES "public"."feeding_sessions"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaper_events" ADD CONSTRAINT "diaper_events_event_id_care_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."care_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_intervals" ADD CONSTRAINT "sleep_intervals_event_id_care_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."care_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_actions" ADD CONSTRAINT "care_actions_event_id_care_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."care_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_actions" ADD CONSTRAINT "care_actions_feeding_session_event_id_feeding_sessions_event_id_fk" FOREIGN KEY ("feeding_session_event_id") REFERENCES "public"."feeding_sessions"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_event_id_care_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."care_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_event_revisions" ADD CONSTRAINT "care_event_revisions_event_id_care_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."care_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_event_revisions" ADD CONSTRAINT "care_event_revisions_edit_actor_user_id_users_id_fk" FOREIGN KEY ("edit_actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_event_revisions" ADD CONSTRAINT "care_event_revisions_edit_actor_membership_id_family_memberships_id_fk" FOREIGN KEY ("edit_actor_membership_id") REFERENCES "public"."family_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "care_events_idempotency_idx" ON "care_events" USING btree ("family_id","actor_user_id","client_request_id") WHERE "care_events"."client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "care_events_family_baby_occurred_idx" ON "care_events" USING btree ("family_id","baby_id","occurred_at");--> statement-breakpoint
CREATE INDEX "care_events_status_occurred_idx" ON "care_events" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX "feeding_components_session_idx" ON "feeding_components" USING btree ("session_event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "care_event_revisions_event_idx" ON "care_event_revisions" USING btree ("event_id","created_at");
