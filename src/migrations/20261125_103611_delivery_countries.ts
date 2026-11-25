import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_delivery_countries_country" AS ENUM('AF', 'ZA', 'AL', 'DZ', 'DE', 'AD', 'AO', 'AI', 'AQ', 'AG', 'SA', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ', 'BS', 'BH', 'BD', 'BB', 'BE', 'BZ', 'BJ', 'BM', 'BT', 'BY', 'BO', 'BA', 'BW', 'BR', 'BN', 'BG', 'BF', 'BI', 'KH', 'CM', 'CA', 'CV', 'CL', 'CN', 'CY', 'CO', 'KM', 'CG', 'CD', 'KP', 'KR', 'CR', 'CI', 'HR', 'CU', 'CW', 'DK', 'DJ', 'DM', 'EG', 'AE', 'EC', 'ER', 'ES', 'EE', 'SZ', 'VA', 'US', 'ET', 'FJ', 'FI', 'FR', 'GA', 'GM', 'GE', 'GS', 'GH', 'GI', 'GR', 'GD', 'GL', 'GP', 'GU', 'GT', 'GG', 'GN', 'GQ', 'GW', 'GY', 'GF', 'HT', 'HN', 'HU', 'BV', 'CX', 'IM', 'NF', 'AX', 'KY', 'CC', 'CK', 'FO', 'HM', 'FK', 'MP', 'MH', 'UM', 'PN', 'SB', 'TC', 'VG', 'VI', 'IN', 'ID', 'IQ', 'IR', 'IE', 'IS', 'IL', 'IT', 'JM', 'JP', 'JE', 'JO', 'KZ', 'KE', 'KG', 'KI', 'KW', 'RE', 'LA', 'LS', 'LV', 'LB', 'LR', 'LY', 'LI', 'LT', 'LU', 'MK', 'MG', 'MY', 'MW', 'MV', 'ML', 'MT', 'MA', 'MQ', 'MU', 'MR', 'YT', 'MX', 'FM', 'MD', 'MC', 'MN', 'ME', 'MS', 'MZ', 'MM', 'NA', 'NR', 'NP', 'NI', 'NE', 'NG', 'NU', 'NO', 'NC', 'NZ', 'OM', 'UG', 'UZ', 'PK', 'PW', 'PA', 'PG', 'PY', 'NL', 'BQ', 'PE', 'PH', 'PL', 'PF', 'PR', 'PT', 'QA', 'HK', 'MO', 'CF', 'DO', 'RO', 'GB', 'RU', 'RW', 'EH', 'BL', 'KN', 'SM', 'MF', 'SX', 'PM', 'VC', 'SH', 'LC', 'SV', 'WS', 'AS', 'ST', 'SN', 'RS', 'SC', 'SL', 'SG', 'SK', 'SI', 'SO', 'SD', 'SS', 'LK', 'SE', 'CH', 'SR', 'SJ', 'SY', 'TJ', 'TW', 'TZ', 'TD', 'CZ', 'TF', 'IO', 'PS', 'TH', 'TL', 'TG', 'TK', 'TO', 'TT', 'TN', 'TM', 'TR', 'TV', 'UA', 'UY', 'VU', 'VE', 'VN', 'WF', 'YE', 'ZM', 'ZW');
  CREATE TABLE "delivery_countries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"country" "enum_delivery_countries_country" NOT NULL,
  	"open" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  -- The countries opened in the order settings (only FR and BE could be) become open records;
  -- settings never saved relied on the old default, France and Belgium, so both open then.
  INSERT INTO "delivery_countries" ("name", "country", "open")
  SELECT c."name", c."code"::"enum_delivery_countries_country", true
  FROM (VALUES (1, 'FR', 'France'), (2, 'BE', 'Belgique')) AS c("rank", "code", "name")
  WHERE NOT EXISTS (SELECT 1 FROM "order_settings_countries" WHERE "value" IS NOT NULL)
    OR c."code" IN (SELECT DISTINCT "value"::text FROM "order_settings_countries" WHERE "value" IS NOT NULL)
  ORDER BY c."rank";
  ALTER TABLE "order_settings_countries" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "order_settings_countries" CASCADE;
  ALTER TABLE "orders" ALTER COLUMN "customer_country" SET DATA TYPE varchar USING "customer_country"::text;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "delivery_countries_id" integer;
  CREATE UNIQUE INDEX "delivery_countries_country_idx" ON "delivery_countries" USING btree ("country");
  CREATE INDEX "delivery_countries_updated_at_idx" ON "delivery_countries" USING btree ("updated_at");
  CREATE INDEX "delivery_countries_created_at_idx" ON "delivery_countries" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_delivery_countries_fk" FOREIGN KEY ("delivery_countries_id") REFERENCES "public"."delivery_countries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_delivery_countries_id_idx" ON "payload_locked_documents_rels" USING btree ("delivery_countries_id");
  DROP TYPE "public"."enum_orders_customer_country";
  DROP TYPE "public"."enum_order_settings_countries";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_orders_customer_country" AS ENUM('FR', 'BE');
  CREATE TYPE "public"."enum_order_settings_countries" AS ENUM('FR', 'BE');
  CREATE TABLE "order_settings_countries" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_order_settings_countries",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "delivery_countries" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "delivery_countries" CASCADE;
  
  ALTER TABLE "orders" ALTER COLUMN "customer_country" SET DATA TYPE "public"."enum_orders_customer_country" USING "customer_country"::"public"."enum_orders_customer_country";
  ALTER TABLE "order_settings_countries" ADD CONSTRAINT "order_settings_countries_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."order_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "order_settings_countries_order_idx" ON "order_settings_countries" USING btree ("order");
  CREATE INDEX "order_settings_countries_parent_idx" ON "order_settings_countries" USING btree ("parent_id");
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "delivery_countries_id";
  DROP TYPE "public"."enum_delivery_countries_country";`)
}
