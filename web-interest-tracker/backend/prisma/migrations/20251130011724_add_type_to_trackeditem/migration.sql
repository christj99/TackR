-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TrackedItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "selector" TEXT NOT NULL,
    "sampleText" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_TrackedItem" ("createdAt", "id", "name", "sampleText", "selector", "url") SELECT "createdAt", "id", "name", "sampleText", "selector", "url" FROM "TrackedItem";
DROP TABLE "TrackedItem";
ALTER TABLE "new_TrackedItem" RENAME TO "TrackedItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
