-- CreateTable
CREATE TABLE "stock_logs" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT,
    "variant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_qty" INTEGER NOT NULL,
    "new_qty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT,
    "admin_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_logs_variant_id_branch_id_idx" ON "stock_logs"("variant_id", "branch_id");

-- CreateIndex
CREATE INDEX "stock_logs_stock_id_idx" ON "stock_logs"("stock_id");

-- CreateIndex
CREATE INDEX "stock_logs_created_at_idx" ON "stock_logs"("created_at");

-- AddForeignKey
ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "store_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
