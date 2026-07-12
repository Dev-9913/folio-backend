/*
  Warnings:

  - You are about to drop the column `gutenberg_id` on the `purchases` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "purchases" DROP COLUMN "gutenberg_id",
ADD COLUMN     "catalog_book_id" VARCHAR(300);

-- CreateTable
CREATE TABLE "catalog_books" (
    "id" VARCHAR(300) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "author" VARCHAR(300) NOT NULL,
    "cover_url" TEXT,
    "epub_url" TEXT NOT NULL,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "price_paise" INTEGER NOT NULL DEFAULT 0,
    "popularity_rank" INTEGER,
    "release_rank" INTEGER,
    "scrape_batch" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_meta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_scraped" TIMESTAMP(3) NOT NULL,
    "book_count" INTEGER NOT NULL,
    "current_batch" VARCHAR(40) NOT NULL,

    CONSTRAINT "catalog_meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_books_scrape_batch_idx" ON "catalog_books"("scrape_batch");

-- CreateIndex
CREATE INDEX "catalog_books_popularity_rank_idx" ON "catalog_books"("popularity_rank");

-- CreateIndex
CREATE INDEX "catalog_books_release_rank_idx" ON "catalog_books"("release_rank");

-- CreateIndex
CREATE INDEX "purchases_catalog_book_id_idx" ON "purchases"("catalog_book_id");
