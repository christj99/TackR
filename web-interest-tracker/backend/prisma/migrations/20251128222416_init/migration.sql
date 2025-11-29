-- CreateTable
CREATE TABLE "TrackedItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "selector" TEXT NOT NULL,
    "sampleText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackedItemId" INTEGER NOT NULL,
    "valueRaw" TEXT NOT NULL,
    "valueNumeric" REAL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Snapshot_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
