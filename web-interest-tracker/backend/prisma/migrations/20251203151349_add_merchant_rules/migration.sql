-- CreateTable
CREATE TABLE "MerchantRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "freeShippingMin" REAL,
    "flatShipping" REAL,
    "taxRate" REAL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRule_domain_key" ON "MerchantRule"("domain");
