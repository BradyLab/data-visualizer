// Routes for Files, mounted at /files in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/file.ts";
import { optionalAuth, requireAuth } from "@src/middleware/auth.ts";

// Express router for the file CRUD endpoints
const router = Router();

// Request flow: router (who is calling) -> controller (HTTP in/out, access checks) -> service (database)
// A file follows the access rules of its dataset (VIEW to read, EDIT to write), checked in the controller

// Reads are open to guests so files of PUBLIC datasets can be listed; listing every file (no dataset_id) is admin-only
router.get("/", optionalAuth, controller.list);
router.post("/", requireAuth, controller.create);
router.get("/byDataset/:datasetId", optionalAuth, controller.listByDataset);
router.get("/:id", optionalAuth, controller.get);
router.put("/:id", requireAuth, controller.update);
router.delete("/:id", requireAuth, controller.remove);

export default router;
