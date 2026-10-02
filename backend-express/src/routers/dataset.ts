// Routes for Datasets, mounted at /datasets in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/dataset.ts";

// Express router for the dataset CRUD endpoints
const router = Router();

// Request flow: router -> controller (HTTP in/out) -> service (database). No requireAuth is applied to these routes

// TODOB11: write routes (POST/PUT/DELETE) have no requireAuth or role check, so anyone can create, modify, or delete datasets
router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

export default router;
