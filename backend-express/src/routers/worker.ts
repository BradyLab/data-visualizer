// Routes for the large-memory worker, mounted at /api/worker in index.ts. Not for browsers: every route needs the worker's secret
// (middleware/worker.ts), and failed attempts are rate limited
import { Router } from "express";
import * as controller from "@src/controllers/worker.ts";
import { workerAuthLimiter } from "@src/middleware/rateLimit.ts";
import { requireWorker } from "@src/middleware/worker.ts";

const router = Router();

router.use(workerAuthLimiter, requireWorker);

router.get("/waiting", controller.waiting);
router.post("/claim", controller.claim);
router.get("/jobs/:id/rds", controller.rds);
router.post("/jobs/:id/heartbeat", controller.heartbeat);
router.put("/jobs/:id/files/:name", controller.uploadFile);
router.post("/jobs/:id/complete", controller.complete);
router.post("/jobs/:id/fail", controller.fail);

export default router;
