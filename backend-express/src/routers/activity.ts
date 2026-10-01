// Routes for Activities, mounted at /activities in index.ts
import { Router } from "express";
import * as controller from "../controllers/activity.ts";

// Express router for the activity CRUD endpoints
const router = Router();

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);

export default router;
