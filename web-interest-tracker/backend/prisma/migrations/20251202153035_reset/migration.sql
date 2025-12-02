/*
  Warnings:

  - Added the required column `updatedAt` to the `TrackedItem` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TrackedItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "selector" TEXT NOT NULL,
    "sampleText" TEXT,
    "type" TEXT NOT NULL,
    "fingerprint" JSONB,
    "category" TEXT,
    "tags" JSONB,
    "profile" TEXT,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TrackedItem" ("category", "createdAt", "fingerprint", "id", "name", "sampleText", "selector", "tags", "type", "url") SELECT "category", "createdAt", "fingerprint", "id", "name", "sampleText", "selector", "tags", "type", "url" FROM "TrackedItem";
DROP TABLE "TrackedItem";
ALTER TABLE "new_TrackedItem" RENAME TO "TrackedItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
