-- AlterTable
ALTER TABLE "books" ADD COLUMN     "last_read_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "books_user_id_last_read_at_idx" ON "books"("user_id", "last_read_at");
