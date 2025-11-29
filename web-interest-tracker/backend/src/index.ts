import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import trackedItemsRouter from "./routes/trackedItems";
import path from "path";


dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

// middlewares
app.use(cors());
app.use(express.json());

// serve static files (dashboard, etc.)
app.use(express.static(path.join(__dirname, "..", "public")));


// health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// tracked items routes
app.use("/tracked-items", trackedItemsRouter(prisma));

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
