// Routes for Users, mounted at /users in index.ts
import { Router } from "express";
import * as controller from "../controllers/user.ts";

// Express router for the user CRUD endpoints
const router = Router();

// Request flow: router -> controller (HTTP in/out) -> service (database). No requireAuth is applied to these routes

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

export default router;
