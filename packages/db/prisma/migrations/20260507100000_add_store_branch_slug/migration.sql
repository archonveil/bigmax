-- AlterTable
ALTER TABLE "store_branches" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "store_branches_slug_key" ON "store_branches"("slug");
