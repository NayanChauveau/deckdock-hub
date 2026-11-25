import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."_locales" AS ENUM('fr', 'en');
  CREATE TYPE "public"."enum_users_role" AS ENUM('admin');
  CREATE TYPE "public"."enum_orders_payment_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded');
  CREATE TYPE "public"."enum_orders_fulfillment_status" AS ENUM('awaiting_payment', 'queued', 'in_progress', 'ready', 'shipped', 'cancelled');
  CREATE TYPE "public"."enum_orders_customer_country" AS ENUM('FR', 'BE');
  CREATE TYPE "public"."enum_orders_locale" AS ENUM('fr', 'en');
  CREATE TYPE "public"."enum_email_outbox_kind" AS ENUM('confirmation', 'shipped', 'owner_new_order', 'cancelled', 'refunded');
  CREATE TYPE "public"."enum_email_outbox_status" AS ENUM('pending', 'sent', 'simulated', 'failed');
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'commerce-maintenance');
  CREATE TYPE "public"."enum_payload_jobs_log_state" AS ENUM('failed', 'succeeded');
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'commerce-maintenance');
  CREATE TYPE "public"."enum_order_settings_countries" AS ENUM('FR', 'BE');
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"role" "enum_users_role" DEFAULT 'admin' NOT NULL,
  	"totp_secret" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_thumbnail_url" varchar,
  	"sizes_thumbnail_width" numeric,
  	"sizes_thumbnail_height" numeric,
  	"sizes_thumbnail_mime_type" varchar,
  	"sizes_thumbnail_filesize" numeric,
  	"sizes_thumbnail_filename" varchar
  );
  
  CREATE TABLE "media_locales" (
  	"alt" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "orders" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"payment_status" "enum_orders_payment_status" DEFAULT 'pending' NOT NULL,
  	"fulfillment_status" "enum_orders_fulfillment_status" DEFAULT 'awaiting_payment' NOT NULL,
  	"tracking_number" varchar,
  	"customer_comment" varchar,
  	"internal_note" varchar,
  	"customer_name" varchar NOT NULL,
  	"customer_email" varchar NOT NULL,
  	"customer_address" varchar NOT NULL,
  	"customer_address2" varchar,
  	"customer_postal_code" varchar NOT NULL,
  	"customer_city" varchar NOT NULL,
  	"customer_country" "enum_orders_customer_country" NOT NULL,
  	"shipped_at" timestamp(3) with time zone,
  	"reference" varchar NOT NULL,
  	"attempt_id" varchar NOT NULL,
  	"locale" "enum_orders_locale" NOT NULL,
  	"kind" varchar NOT NULL,
  	"lines" jsonb NOT NULL,
  	"items_cents" numeric,
  	"shipping_cents" numeric,
  	"total_cents" numeric,
  	"currency" varchar DEFAULT 'EUR' NOT NULL,
  	"payment_session_id" varchar,
  	"payment_id" varchar,
  	"payment_expires_at" timestamp(3) with time zone,
  	"paid_at" timestamp(3) with time zone,
  	"terms_version" varchar,
  	"terms_accepted_at" timestamp(3) with time zone,
  	"history" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payment_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" varchar NOT NULL,
  	"event_type" varchar NOT NULL,
  	"order_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "email_outbox" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"order_id" integer NOT NULL,
  	"kind" "enum_email_outbox_kind" NOT NULL,
  	"status" "enum_email_outbox_status" DEFAULT 'pending' NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"next_attempt_at" timestamp(3) with time zone NOT NULL,
  	"subject" varchar,
  	"body" varchar,
  	"sent_at" timestamp(3) with time zone,
  	"last_error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "commerce_rate_limits" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"count" numeric NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "customer_photos" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "totp_attempts" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_jobs_log" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"executed_at" timestamp(3) with time zone NOT NULL,
  	"completed_at" timestamp(3) with time zone NOT NULL,
  	"task_slug" "enum_payload_jobs_log_task_slug" NOT NULL,
  	"task_i_d" varchar NOT NULL,
  	"input" jsonb,
  	"output" jsonb,
  	"state" "enum_payload_jobs_log_state" NOT NULL,
  	"error" jsonb
  );
  
  CREATE TABLE "payload_jobs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"input" jsonb,
  	"completed_at" timestamp(3) with time zone,
  	"total_tried" numeric DEFAULT 0,
  	"has_error" boolean DEFAULT false,
  	"error" jsonb,
  	"task_slug" "enum_payload_jobs_task_slug",
  	"queue" varchar DEFAULT 'default',
  	"wait_until" timestamp(3) with time zone,
  	"processing" boolean DEFAULT false,
  	"meta" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"media_id" integer,
  	"orders_id" integer,
  	"payment_events_id" integer,
  	"email_outbox_id" integer,
  	"commerce_rate_limits_id" integer,
  	"customer_photos_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "site_content" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_image_id" integer,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "site_content_locales" (
  	"title" varchar NOT NULL,
  	"description" varchar NOT NULL,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "order_settings_countries" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_order_settings_countries",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "order_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"enabled" boolean DEFAULT false,
  	"owner_email" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"maintenance" boolean DEFAULT true,
  	"site_name" varchar NOT NULL,
  	"contact_email" varchar,
  	"favicon_id" integer,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "site_settings_locales" (
  	"footer_text" varchar,
  	"price_mention" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "legal_pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"terms_version" varchar DEFAULT 'brouillon' NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "legal_pages_locales" (
  	"legal_notice_title" varchar NOT NULL,
  	"legal_notice_body" jsonb,
  	"terms_title" varchar NOT NULL,
  	"terms_body" jsonb,
  	"privacy_title" varchar NOT NULL,
  	"privacy_body" jsonb,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "payload_jobs_stats" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stats" jsonb,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media_locales" ADD CONSTRAINT "media_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_jobs_log" ADD CONSTRAINT "payload_jobs_log_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."payload_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_orders_fk" FOREIGN KEY ("orders_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_payment_events_fk" FOREIGN KEY ("payment_events_id") REFERENCES "public"."payment_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_email_outbox_fk" FOREIGN KEY ("email_outbox_id") REFERENCES "public"."email_outbox"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_commerce_rate_limits_fk" FOREIGN KEY ("commerce_rate_limits_id") REFERENCES "public"."commerce_rate_limits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customer_photos_fk" FOREIGN KEY ("customer_photos_id") REFERENCES "public"."customer_photos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_content" ADD CONSTRAINT "site_content_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_content" ADD CONSTRAINT "site_content_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_content_locales" ADD CONSTRAINT "site_content_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "order_settings_countries" ADD CONSTRAINT "order_settings_countries_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."order_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_favicon_id_media_id_fk" FOREIGN KEY ("favicon_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings_locales" ADD CONSTRAINT "site_settings_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "legal_pages_locales" ADD CONSTRAINT "legal_pages_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."legal_pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "media" USING btree ("sizes_thumbnail_filename");
  CREATE UNIQUE INDEX "media_locales_locale_parent_id_unique" ON "media_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "orders_reference_idx" ON "orders" USING btree ("reference");
  CREATE UNIQUE INDEX "orders_attempt_id_idx" ON "orders" USING btree ("attempt_id");
  CREATE INDEX "orders_updated_at_idx" ON "orders" USING btree ("updated_at");
  CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
  CREATE UNIQUE INDEX "payment_events_event_id_idx" ON "payment_events" USING btree ("event_id");
  CREATE INDEX "payment_events_order_idx" ON "payment_events" USING btree ("order_id");
  CREATE INDEX "payment_events_updated_at_idx" ON "payment_events" USING btree ("updated_at");
  CREATE INDEX "payment_events_created_at_idx" ON "payment_events" USING btree ("created_at");
  CREATE UNIQUE INDEX "email_outbox_key_idx" ON "email_outbox" USING btree ("key");
  CREATE INDEX "email_outbox_order_idx" ON "email_outbox" USING btree ("order_id");
  CREATE INDEX "email_outbox_next_attempt_at_idx" ON "email_outbox" USING btree ("next_attempt_at");
  CREATE INDEX "email_outbox_updated_at_idx" ON "email_outbox" USING btree ("updated_at");
  CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox" USING btree ("created_at");
  CREATE UNIQUE INDEX "commerce_rate_limits_key_idx" ON "commerce_rate_limits" USING btree ("key");
  CREATE INDEX "commerce_rate_limits_expires_at_idx" ON "commerce_rate_limits" USING btree ("expires_at");
  CREATE INDEX "commerce_rate_limits_updated_at_idx" ON "commerce_rate_limits" USING btree ("updated_at");
  CREATE INDEX "commerce_rate_limits_created_at_idx" ON "commerce_rate_limits" USING btree ("created_at");
  CREATE INDEX "customer_photos_expires_at_idx" ON "customer_photos" USING btree ("expires_at");
  CREATE INDEX "customer_photos_updated_at_idx" ON "customer_photos" USING btree ("updated_at");
  CREATE INDEX "customer_photos_created_at_idx" ON "customer_photos" USING btree ("created_at");
  CREATE UNIQUE INDEX "customer_photos_filename_idx" ON "customer_photos" USING btree ("filename");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_jobs_log_order_idx" ON "payload_jobs_log" USING btree ("_order");
  CREATE INDEX "payload_jobs_log_parent_id_idx" ON "payload_jobs_log" USING btree ("_parent_id");
  CREATE INDEX "payload_jobs_completed_at_idx" ON "payload_jobs" USING btree ("completed_at");
  CREATE INDEX "payload_jobs_total_tried_idx" ON "payload_jobs" USING btree ("total_tried");
  CREATE INDEX "payload_jobs_has_error_idx" ON "payload_jobs" USING btree ("has_error");
  CREATE INDEX "payload_jobs_task_slug_idx" ON "payload_jobs" USING btree ("task_slug");
  CREATE INDEX "payload_jobs_queue_idx" ON "payload_jobs" USING btree ("queue");
  CREATE INDEX "payload_jobs_wait_until_idx" ON "payload_jobs" USING btree ("wait_until");
  CREATE INDEX "payload_jobs_processing_idx" ON "payload_jobs" USING btree ("processing");
  CREATE INDEX "payload_jobs_updated_at_idx" ON "payload_jobs" USING btree ("updated_at");
  CREATE INDEX "payload_jobs_created_at_idx" ON "payload_jobs" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_orders_id_idx" ON "payload_locked_documents_rels" USING btree ("orders_id");
  CREATE INDEX "payload_locked_documents_rels_payment_events_id_idx" ON "payload_locked_documents_rels" USING btree ("payment_events_id");
  CREATE INDEX "payload_locked_documents_rels_email_outbox_id_idx" ON "payload_locked_documents_rels" USING btree ("email_outbox_id");
  CREATE INDEX "payload_locked_documents_rels_commerce_rate_limits_id_idx" ON "payload_locked_documents_rels" USING btree ("commerce_rate_limits_id");
  CREATE INDEX "payload_locked_documents_rels_customer_photos_id_idx" ON "payload_locked_documents_rels" USING btree ("customer_photos_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");
  CREATE INDEX "site_content_hero_image_idx" ON "site_content" USING btree ("hero_image_id");
  CREATE INDEX "site_content_seo_image_idx" ON "site_content" USING btree ("seo_image_id");
  CREATE UNIQUE INDEX "site_content_locales_locale_parent_id_unique" ON "site_content_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "order_settings_countries_order_idx" ON "order_settings_countries" USING btree ("order");
  CREATE INDEX "order_settings_countries_parent_idx" ON "order_settings_countries" USING btree ("parent_id");
  CREATE INDEX "site_settings_favicon_idx" ON "site_settings" USING btree ("favicon_id");
  CREATE UNIQUE INDEX "site_settings_locales_locale_parent_id_unique" ON "site_settings_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "legal_pages_locales_locale_parent_id_unique" ON "legal_pages_locales" USING btree ("_locale","_parent_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "media_locales" CASCADE;
  DROP TABLE "orders" CASCADE;
  DROP TABLE "payment_events" CASCADE;
  DROP TABLE "email_outbox" CASCADE;
  DROP TABLE "commerce_rate_limits" CASCADE;
  DROP TABLE "customer_photos" CASCADE;
  DROP TABLE "totp_attempts" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_jobs_log" CASCADE;
  DROP TABLE "payload_jobs" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "site_content" CASCADE;
  DROP TABLE "site_content_locales" CASCADE;
  DROP TABLE "order_settings_countries" CASCADE;
  DROP TABLE "order_settings" CASCADE;
  DROP TABLE "site_settings" CASCADE;
  DROP TABLE "site_settings_locales" CASCADE;
  DROP TABLE "legal_pages" CASCADE;
  DROP TABLE "legal_pages_locales" CASCADE;
  DROP TABLE "payload_jobs_stats" CASCADE;
  DROP TYPE "public"."_locales";
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_orders_payment_status";
  DROP TYPE "public"."enum_orders_fulfillment_status";
  DROP TYPE "public"."enum_orders_customer_country";
  DROP TYPE "public"."enum_orders_locale";
  DROP TYPE "public"."enum_email_outbox_kind";
  DROP TYPE "public"."enum_email_outbox_status";
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  DROP TYPE "public"."enum_payload_jobs_log_state";
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  DROP TYPE "public"."enum_order_settings_countries";`)
}
