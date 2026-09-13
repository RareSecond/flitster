-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."deck_cards" (
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deck_cards_pkey" PRIMARY KEY ("code")
);
