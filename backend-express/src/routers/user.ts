// Routes for Users, mounted at /users in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/user.ts";

// Express router for the user CRUD endpoints
const router = Router();

// Request flow: router -> controller (HTTP in/out) -> service (database). No requireAuth is applied to these routes

// TODO: user routes have no requireAuth or role check, so anyone can list, create, invite, edit, or delete users (including changing roles)
router.get("/", controller.list);
// Must be registered before "/:id" or "names" would be treated as an id
router.get("/names", controller.listNames);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

export default router;
