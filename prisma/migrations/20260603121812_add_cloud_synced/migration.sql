-- DropForeignKey
ALTER TABLE "ai_chats" DROP CONSTRAINT "ai_chats_book_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_chats" DROP CONSTRAINT "ai_chats_user_id_fkey";

-- DropForeignKey
ALTER TABLE "books" DROP CONSTRAINT "books_user_id_fkey";

-- DropForeignKey
ALTER TABLE "chapter_summaries" DROP CONSTRAINT "chapter_summaries_book_id_fkey";

-- DropForeignKey
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_session_id_fkey";

-- DropForeignKey
ALTER TABLE "chat_sessions" DROP CONSTRAINT "chat_sessions_book_id_fkey";

-- DropForeignKey
ALTER TABLE "chat_sessions" DROP CONSTRAINT "chat_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "highlights" DROP CONSTRAINT "highlights_book_id_fkey";

-- DropForeignKey
ALTER TABLE "highlights" DROP CONSTRAINT "highlights_user_id_fkey";

-- DropForeignKey
ALTER TABLE "reading_progress" DROP CONSTRAINT "reading_progress_book_id_fkey";

-- DropForeignKey
ALTER TABLE "reading_progress" DROP CONSTRAINT "reading_progress_user_id_fkey";

-- DropForeignKey
ALTER TABLE "shelf_books" DROP CONSTRAINT "shelf_books_book_id_fkey";

-- DropForeignKey
ALTER TABLE "shelf_books" DROP CONSTRAINT "shelf_books_shelf_id_fkey";

-- DropForeignKey
ALTER TABLE "shelves" DROP CONSTRAINT "shelves_user_id_fkey";

-- AlterTable
ALTER TABLE "ai_chats" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "books" ADD COLUMN     "cloudSynced" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "chapter_summaries" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "chat_messages" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "chat_sessions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "highlights" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reading_progress" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "shelf_books" ALTER COLUMN "added_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "shelves" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_summaries" ADD CONSTRAINT "chapter_summaries_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelf_books" ADD CONSTRAINT "shelf_books_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "shelves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelf_books" ADD CONSTRAINT "shelf_books_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "chapter_summaries_book_cfi_key" RENAME TO "chapter_summaries_book_id_chapter_cfi_key";

-- RenameIndex
ALTER INDEX "chat_sessions_user_book_idx" RENAME TO "chat_sessions_user_id_book_id_idx";

-- RenameIndex
ALTER INDEX "highlights_user_book_idx" RENAME TO "highlights_user_id_book_id_idx";

-- RenameIndex
ALTER INDEX "reading_progress_user_book_idx" RENAME TO "reading_progress_user_id_book_id_idx";

-- RenameIndex
ALTER INDEX "reading_progress_user_book_key" RENAME TO "reading_progress_user_id_book_id_key";
