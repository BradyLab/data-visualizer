// Routes for Permissions, mounted at /permissions in index.ts (identified by user id + dataset id)
import { Router } from "express";
import * as controller from "@src/controllers/permission.ts";

// Express router for the permission CRUD endpoints
const router = Router();

// Request flow: router -> controller (HTTP in/out) -> service (database). No requireAuth is applied to these routes

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:userId/:datasetId", controller.get);
router.put("/:userId/:datasetId", controller.update);
router.delete("/:userId/:datasetId", controller.remove);

export default router;
