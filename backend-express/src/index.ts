import "dotenv/config";
import "reflect-metadata";
import cors from "cors";
import express, { Express, Request, Response, NextFunction } from "express";
import { sequelize } from "./database.js";

const PORT = process.env.API_PORT || 3001;

export const get = () => {
    const app: Express = express()
    app.use(express.json()); // Parses incoming JSON payloads
    app.use(express.urlencoded({ extended: true }));

    app.use(cors({ origin: process.env.FRONTEND_URL }));

    //health API call
    app.get("/health", (req: Request, res: Response) => {
        res.status(200).json({ status: "OK", timestamp: new Date() });
    });

    //centralized error handling
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error(err.stack);
        res.status(500).json({ error: "Internal Server Error" });
    });

    //OTHER ROUTERS HERE

    return app;
}

export const start = async () => {
    const app = get();

    try {
        await sequelize.authenticate();
        console.log("[database]: Connection has been established successfully.");
        await sequelize.sync();
    } catch (err) {
        console.error("[database]: Unable to connect to the database:", err);
    }

    try {
        app.listen(PORT, () => {
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
}

start();
