// Routes for Datasets, mounted at /datasets in index.ts
import { Router } from "express";
import * as controller from "../controllers/dataset.ts";

// Express router for the dataset CRUD endpoints
const router = Router();

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get); //TODO get by userid+perms
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

export default router;
