import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
//import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import trackedItemsRouter from "./routes/trackedItems";
import agentRouter from "./routes/agent";
import boardsRouter from "./routes/boards";
import cartRouter from "./routes/cart";
import triggersRouter from "./routes/triggers";
import discoverRouter from "./routes/discover";
import merchantRulesRouter from "./routes/merchantRules";




dotenv.config();

//const adapter = new PrismaBetterSqlite3({
  //url: process.env.DATABASE_URL || "file:./prisma/dev.db",
//});

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/tracked-items", trackedItemsRouter(prisma));
app.use("/agent", agentRouter(prisma));
app.use("/boards", boardsRouter(prisma));
app.use("/discover", discoverRouter(prisma));
app.use("/cart", cartRouter(prisma));
app.use("/triggers", triggersRouter(prisma));
app.use("/merchant-rules", merchantRulesRouter(prisma));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});



app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
