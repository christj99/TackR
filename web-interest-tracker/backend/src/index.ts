import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import trackedItemsRouter from "./routes/trackedItems";
import agentRouter from "./routes/agent";

dotenv.config();

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});

const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/agent", agentRouter(prisma));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/tracked-items", trackedItemsRouter(prisma));

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
