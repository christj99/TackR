-- CreateTable
CREATE TABLE "Trigger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackedItemId" INTEGER NOT NULL,
    "comparison" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFiredAt" DATETIME,
    CONSTRAINT "Trigger_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TriggerEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "triggerId" INTEGER NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TriggerEvent_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "Trigger" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TriggerEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
