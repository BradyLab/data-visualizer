// Express server entry point: loads env vars, builds the app, connects to the DB, and starts listening
import "dotenv/config";
import "reflect-metadata";
import cors from "cors";
import express, { Express, Request, Response, NextFunction } from "express";
import { sequelize } from "./database.js";

import { apis } from "@commons/general.ts";

import userRouter from "./routers/user.ts";
import datasetRouter from "./routers/dataset.ts";
import permissionRouter from "./routers/permission.ts";
import fileRouter from "./routers/file.ts";
import activityRouter from "./routers/activity.ts";
import authRouter from "./routers/auth.ts";

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

// Connects to the database, syncs models, and starts the HTTP server
export const start = async () => {
    const app = get();

    try {
        await sequelize.authenticate();
        console.log("[DATABASE]: Connection has been established successfully.");
        // Create any tables for models that do not exist yet
        await sequelize.sync();
    } catch (err) {
        console.error("[DATABASE]: Unable to connect to the database:", err);
        return;
    }

    try {
        app.listen(PORT, () => {
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
    } catch (error: any) {
        console.error("Error occurred: ", error.message);
    }
};

// Start the server when this module is run
start();
