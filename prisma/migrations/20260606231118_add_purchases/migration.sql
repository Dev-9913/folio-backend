-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gutenberg_id" INTEGER NOT NULL,
    "book_title" VARCHAR(500) NOT NULL,
    "book_author" VARCHAR(300),
    "amount_paise" INTEGER NOT NULL,
    "razorpay_order_id" VARCHAR(100),
    "razorpay_payment_id" VARCHAR(100),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "book_id" VARCHAR(16),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchases_user_id_idx" ON "purchases"("user_id");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
