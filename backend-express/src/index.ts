// Express server entry point: loads env vars, builds the app, connects to the DB, and starts listening
import "dotenv/config";
import "reflect-metadata";
import cors from "cors";
import express, { Express, Request, Response, NextFunction } from "express";
import { sequelize } from "@src/database.ts";

import { apis } from "@commons/general.ts";

import userRouter from "@src/routers/user.ts";
import datasetRouter from "@src/routers/dataset.ts";
import permissionRouter from "@src/routers/permission.ts";
import fileRouter from "@src/routers/file.ts";
import activityRouter from "@src/routers/activity.ts";
import authRouter from "@src/routers/auth.ts";

import { UniqueConstraintError, ValidationError, ForeignKeyConstraintError } from "sequelize";

// Port to listen on; falls back to 3001 if API_PORT is not set
const PORT = process.env.API_PORT || 3001;

// Builds and configures the Express app (kept separate from start() so it can be reused, e.g. in tests)
export const get = () => {
    const app: Express = express();
    app.use(express.json()); // Parses incoming JSON payloads
    // Parses URL-encoded form bodies
    app.use(express.urlencoded({ extended: true }));

    // Only allow cross-origin requests from the frontend
    app.use(cors({ origin: process.env.FRONTEND_URL }));

    //health API call
    app.get("/health", (req: Request, res: Response) => {
        res.status(200).json({ status: "OK", timestamp: new Date() });
    });

    // Register routers here; each mounts at /api/<name> (names come from @commons/general.ts so the frontend shares them)
    app.use(`/api/${apis.USER}`, userRouter);
    app.use(`/api/${apis.DATASET}`, datasetRouter);
    app.use(`/api/${apis.PERMISSION}`, permissionRouter);
    app.use(`/api/${apis.FILE}`, fileRouter);
    app.use(`/api/${apis.ACTIVITY}`, activityRouter);
    app.use(`/api/${apis.AUTH}`, authRouter);

    // Centralized error handling: must be registered after the routers. Express 5 forwards rejected async handlers here
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.log(`[ERROR HANDLER] ${err.name}: ${err.message}`);
        // Client-caused database errors map to 4xx instead of a generic 500
        if (err instanceof UniqueConstraintError) return res.status(409).json({ error: "Already exists" });
        if (err instanceof ValidationError || err instanceof ForeignKeyConstraintError)
            return res.status(400).json({ error: err.message });
        console.error("[ERROR HANDLER] Unhandled error:", err.stack);
        res.status(500).json({ error: "Internal Server Error" });
    });

    return app;
};

// Connects to the database and starts the HTTP server (the schema is managed by migrations, not sequelize.sync())
export const start = async () => {
    const app = get();

    try {
        await sequelize.authenticate();
        console.log("[DATABASE]: Connection has been established successfully.");
    } catch (err) {
        console.error("[DATABASE]: Unable to connect to the database:", err);
        return;
    }

    // listen() reports failures (e.g. port in use) through the server's "error" event, not by throwing,
    // so a try/catch around it would never fire
    const server = app.listen(PORT, () => {
        // Startup banner printed once the server is listening
        const box =
            `=====================================================================================\n` +
            `======================  SERVER IS NOW FULLY READY AND RUNNING  ======================\n` +
            `=                                                                                   =\n` +
            `=    Backend is live at: ${process.env.BACKEND_URL}                                      =\n` +
            `=    Frontend is accessible at: ${process.env.FRONTEND_URL}                               =\n` +
            `=                                                                                   =\n` +
            `================================= Have a great day! =================================\n` +
            `=====================================================================================`;
        console.log(box);
    });
    server.on("error", (error: Error) => {
        console.error("Error occurred: ", error.message);
    });
};

// Start the server when this module is run
start();
