// Sequelize instance used by the app to talk to Postgres
import { Sequelize } from "sequelize-typescript";
import { Users } from "./models/user.ts";
import { Datasets } from "./models/dataset.ts";
import { Permissions } from "./models/permission.ts";
import { Files } from "./models/file.ts";
import { Activities } from "./models/activity.ts";

// Read connection details from environment variables (see env.d.ts)
const dbName = process.env.DB_NAME as string;
const dbUser = process.env.DB_USERNAME as string;
const dbHost = process.env.DB_HOST as string;
const dbPort = process.env.DB_PORT as string;
const dbPassword = process.env.DB_PASSWORD as string;

// Shared Sequelize instance. Models are registered as imported classes rather than by directory path:
// path loading can create a second copy of each model class, so the classes the services import are never registered.
// New models must be added to the list below
export const sequelize = new Sequelize({
    database: dbName,
    username: dbUser,
    password: dbPassword,
    host: dbHost,
    port: Number(dbPort),
    dialect: "postgres",
    logging: false,
    models: [Users, Datasets, Permissions, Files, Activities],
});
