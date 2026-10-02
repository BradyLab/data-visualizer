// Routes for Activities, mounted at /activities in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/activity.ts";

// Express router for the activity CRUD endpoints
const router = Router();

// Request flow: router -> controller (HTTP in/out) -> service (database). No requireAuth is applied to these routes

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);

export default router;
