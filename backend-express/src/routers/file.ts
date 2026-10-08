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
// Files are created by resumable (tus) uploads at /files/upload, mounted in index.ts (see services/tus.ts), not by POST here
// Changes need a login; EDIT access to the dataset is checked in the controller
// The current file of a type in a dataset: the bytes (also reachable with a ?token= from the route below, for browser downloads) and the token
router.get("/current/:datasetId/:type/content", optionalAuth, controller.content);
router.post("/current/:datasetId/:type/download-token", requireAuth, controller.downloadToken);
// Must be registered before "/:id" or "byDataset" would be treated as an id
router.get("/byDataset/:datasetId", optionalAuth, controller.listByDataset);
router.get("/:id", optionalAuth, controller.get);
router.put("/:id", requireAuth, controller.update);
router.delete("/:id", requireAuth, controller.remove);

export default router;
