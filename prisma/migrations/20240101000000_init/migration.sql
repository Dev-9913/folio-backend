-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "users" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"          VARCHAR(100) NOT NULL,
    "email"         VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id"         VARCHAR(16)  NOT NULL,
    "user_id"    UUID         NOT NULL,
    "title"      VARCHAR(500) NOT NULL,
    "author"     VARCHAR(300),
    "cover_url"  TEXT,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_progress" (
    "id"         UUID          NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID          NOT NULL,
    "book_id"    VARCHAR(16)   NOT NULL,
    "cfi"        TEXT          NOT NULL,
    "percentage" DECIMAL(5,2)  NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "highlights" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID        NOT NULL,
    "book_id"    VARCHAR(16) NOT NULL,
    "cfi"        TEXT        NOT NULL,
    "text"       TEXT        NOT NULL,
    "note"       TEXT,
    "color"      VARCHAR(20) NOT NULL DEFAULT '#E8A83866',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "highlights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chats" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     UUID        NOT NULL,
    "book_id"     VARCHAR(16),
    "cfi"         TEXT,
    "action"      VARCHAR(50),
    "query_text"  TEXT        NOT NULL,
    "response"    TEXT        NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_summaries" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "book_id"     VARCHAR(16) NOT NULL,
    "chapter_cfi" TEXT        NOT NULL,
    "summary"     TEXT        NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelves" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID         NOT NULL,
    "name"       VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelf_books" (
    "shelf_id" UUID        NOT NULL,
    "book_id"  VARCHAR(16) NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shelf_books_pkey" PRIMARY KEY ("shelf_id", "book_id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID         NOT NULL,
    "book_id"    VARCHAR(16),
    "title"      VARCHAR(200) NOT NULL DEFAULT 'New Chat',
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID        NOT NULL,
    "role"       "MessageRole" NOT NULL,
    "content"    TEXT        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key"               ON "users"("email");
CREATE UNIQUE INDEX "reading_progress_user_book_key" ON "reading_progress"("user_id", "book_id");
CREATE UNIQUE INDEX "chapter_summaries_book_cfi_key" ON "chapter_summaries"("book_id", "chapter_cfi");
CREATE INDEX "books_user_id_idx"                    ON "books"("user_id");
CREATE INDEX "reading_progress_user_book_idx"       ON "reading_progress"("user_id", "book_id");
CREATE INDEX "highlights_user_book_idx"             ON "highlights"("user_id", "book_id");
CREATE INDEX "ai_chats_user_id_idx"                 ON "ai_chats"("user_id");
CREATE INDEX "shelves_user_id_idx"                  ON "shelves"("user_id");
CREATE INDEX "chat_sessions_user_book_idx"          ON "chat_sessions"("user_id", "book_id");
CREATE INDEX "chat_messages_session_id_idx"         ON "chat_messages"("session_id");

-- AddForeignKey
ALTER TABLE "books"            ADD CONSTRAINT "books_user_id_fkey"                 FOREIGN KEY ("user_id")    REFERENCES "users"("id")         ON DELETE CASCADE;
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_fkey"      FOREIGN KEY ("user_id")    REFERENCES "users"("id")         ON DELETE CASCADE;
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_book_id_fkey"      FOREIGN KEY ("book_id")    REFERENCES "books"("id")         ON DELETE CASCADE;
ALTER TABLE "highlights"       ADD CONSTRAINT "highlights_user_id_fkey"            FOREIGN KEY ("user_id")    REFERENCES "users"("id")         ON DELETE CASCADE;
ALTER TABLE "highlights"       ADD CONSTRAINT "highlights_book_id_fkey"            FOREIGN KEY ("book_id")    REFERENCES "books"("id")         ON DELETE CASCADE;
ALTER TABLE "ai_chats"         ADD CONSTRAINT "ai_chats_user_id_fkey"              FOREIGN KEY ("user_id")    REFERENCES "users"("id")         ON DELETE CASCADE;
ALTER TABLE "ai_chats"         ADD CONSTRAINT "ai_chats_book_id_fkey"              FOREIGN KEY ("book_id")    REFERENCES "books"("id")         ON DELETE SET NULL;
ALTER TABLE "chapter_summaries"ADD CONSTRAINT "chapter_summaries_book_id_fkey"     FOREIGN KEY ("book_id")    REFERENCES "books"("id")         ON DELETE CASCADE;
ALTER TABLE "shelves"          ADD CONSTRAINT "shelves_user_id_fkey"               FOREIGN KEY ("user_id")    REFERENCES "users"("id")         ON DELETE CASCADE;
ALTER TABLE "shelf_books"      ADD CONSTRAINT "shelf_books_shelf_id_fkey"          FOREIGN KEY ("shelf_id")   REFERENCES "shelves"("id")       ON DELETE CASCADE;
ALTER TABLE "shelf_books"      ADD CONSTRAINT "shelf_books_book_id_fkey"           FOREIGN KEY ("book_id")    REFERENCES "books"("id")         ON DELETE CASCADE;
ALTER TABLE "chat_sessions"    ADD CONSTRAINT "chat_sessions_user_id_fkey"         FOREIGN KEY ("user_id")    REFERENCES "users"("id")         ON DELETE CASCADE;
ALTER TABLE "chat_sessions"    ADD CONSTRAINT "chat_sessions_book_id_fkey"         FOREIGN KEY ("book_id")    REFERENCES "books"("id")         ON DELETE SET NULL;
ALTER TABLE "chat_messages"    ADD CONSTRAINT "chat_messages_session_id_fkey"      FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE;
