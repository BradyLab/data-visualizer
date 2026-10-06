// Routes for Activities, mounted at /activities in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/activity.ts";

// Express router for the activity CRUD endpoints
const router = Router();

// Request flow: router -> controller (HTTP in/out) -> service (database). No requireAuth is applied to these routes

// TODO: activity logs (user ids, event payloads) are readable by anyone because no route is protected
router.get("/", controller.list);
router.get("/byUser/:userId", controller.listByUser);
router.get("/:id", controller.get);

export default router;
