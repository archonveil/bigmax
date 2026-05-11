-- Schema-driven category attribute config (P6-T3 follow-up "professional
-- dynamic attributes"). Reversible: DROP TABLE category_attributes CASCADE.
CREATE TABLE "category_attributes" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label_ru" TEXT NOT NULL,
    "label_uz" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "help_text_ru" TEXT,
    "help_text_uz" TEXT,
    "help_text_en" TEXT,
    "options" JSONB,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "step" DOUBLE PRECISION,
    "unit_ru" TEXT,
    "unit_uz" TEXT,
    "unit_en" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_filterable" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_attributes_category_id_key_key" ON "category_attributes"("category_id", "key");
CREATE INDEX "category_attributes_category_id_order_idx" ON "category_attributes"("category_id", "order");

ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
