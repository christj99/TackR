-- CreateTable
CREATE TABLE "TrackedItem" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "selector" TEXT NOT NULL,
    "sampleText" TEXT,
    "type" TEXT NOT NULL,
    "fingerprint" JSONB,
    "category" TEXT,
    "tags" JSONB,
    "profile" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" SERIAL NOT NULL,
    "trackedItemId" INTEGER NOT NULL,
    "valueRaw" TEXT NOT NULL,
    "valueNumeric" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" SERIAL NOT NULL,
    "trackedItemId" INTEGER NOT NULL,
    "comparison" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFiredAt" TIMESTAMP(3),

    CONSTRAINT "Trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerEvent" (
    "id" SERIAL NOT NULL,
    "triggerId" INTEGER NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardItem" (
    "id" SERIAL NOT NULL,
    "boardId" INTEGER NOT NULL,
    "trackedItemId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" SERIAL NOT NULL,
    "cartId" INTEGER NOT NULL,
    "trackedItemId" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedPrice" DOUBLE PRECISION,
    "addedValueRaw" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lastCheckedAt" TIMESTAMP(3),
    "lastPrice" DOUBLE PRECISION,
    "lastValueRaw" TEXT,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRule" (
    "id" SERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "freeShippingMin" DOUBLE PRECISION,
    "flatShipping" DOUBLE PRECISION,
    "taxRate" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardItem_boardId_trackedItemId_key" ON "BoardItem"("boardId", "trackedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_trackedItemId_key" ON "CartItem"("cartId", "trackedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRule_domain_key" ON "MerchantRule"("domain");

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trigger" ADD CONSTRAINT "Trigger_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerEvent" ADD CONSTRAINT "TriggerEvent_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "Trigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerEvent" ADD CONSTRAINT "TriggerEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
