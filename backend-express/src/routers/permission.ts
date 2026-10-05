// Routes for Permissions, mounted at /permissions in index.ts (identified by user id + dataset id)
import { Router } from "express";
import * as controller from "@src/controllers/permission.ts";

// Express router for the permission CRUD endpoints
const router = Router();

// Request flow: router -> controller (HTTP in/out) -> service (database). No requireAuth is applied to these routes

router.get("/", controller.list);
// TODO: permission routes have no requireAuth or role check, so anyone can grant themselves access to any dataset
router.post("/", controller.create);
// Must be registered before "/:userId/:datasetId", which would otherwise match "/byUser/<id>" and "/byDataset/<id>"
router.get("/byUser/:userId", controller.listByUser);
router.get("/byDataset/:datasetId", controller.listByDataset);
router.get("/:userId/:datasetId", controller.get);
router.put("/:userId/:datasetId", controller.update);
router.delete("/:userId/:datasetId", controller.remove);

export default router;
