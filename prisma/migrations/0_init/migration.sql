-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NOT_RELEVANT');

-- CreateEnum
CREATE TYPE "Track" AS ENUM ('FEDERAL', 'CONGRESS', 'STATE', 'COURT');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('FEDERAL_REGISTER', 'REGULATIONS_GOV', 'CONGRESS_GOV', 'OPEN_STATES', 'COURTLISTENER', 'MANUAL');

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorVar" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "divisionId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "isLitigationLead" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "docket" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "unit" TEXT,
    "track" "Track" NOT NULL,
    "stage" TEXT NOT NULL,
    "stageIndex" INTEGER NOT NULL DEFAULT 0,
    "nextLabel" TEXT,
    "commentDueAt" TIMESTAMP(3),
    "isCommentPeriod" BOOLEAN NOT NULL DEFAULT false,
    "divisionId" TEXT NOT NULL,
    "ownerId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "priorityConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "position" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "standards" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draftState" TEXT,
    "publishedOn" TIMESTAMP(3),
    "source" "SourceKind" NOT NULL DEFAULT 'MANUAL',
    "sourceUrl" TEXT,
    "frCitation" TEXT,
    "lastSnapshot" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" "SourceKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "itemId" TEXT,
    "actor" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "source" "SourceKind" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Person_divisionId_idx" ON "Person"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_name_divisionId_key" ON "Person"("name", "divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_docket_key" ON "Item"("docket");

-- CreateIndex
CREATE INDEX "Item_divisionId_idx" ON "Item"("divisionId");

-- CreateIndex
CREATE INDEX "Item_track_idx" ON "Item"("track");

-- CreateIndex
CREATE INDEX "Item_commentDueAt_idx" ON "Item"("commentDueAt");

-- CreateIndex
CREATE INDEX "Item_priority_idx" ON "Item"("priority");

-- CreateIndex
CREATE INDEX "Finding_itemId_foundAt_idx" ON "Finding"("itemId", "foundAt");

-- CreateIndex
CREATE INDEX "Audit_itemId_at_idx" ON "Audit"("itemId", "at");

-- CreateIndex
CREATE INDEX "Audit_at_idx" ON "Audit"("at");

-- CreateIndex
CREATE INDEX "AgentRun_source_startedAt_idx" ON "AgentRun"("source", "startedAt");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

