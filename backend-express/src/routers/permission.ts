// Routes for Permissions, mounted at /permissions in index.ts (identified by user id + dataset id)
import { Router } from "express";
import * as controller from "../controllers/permission.ts";

const router = Router();

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:userId/:datasetId", controller.get);
router.put("/:userId/:datasetId", controller.update);
router.delete("/:userId/:datasetId", controller.remove);

export default router;
