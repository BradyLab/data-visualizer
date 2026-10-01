// Routes for Files, mounted at /files in index.ts
import { Router } from "express";
import * as controller from "../controllers/file.ts";

const router = Router();

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

export default router;
