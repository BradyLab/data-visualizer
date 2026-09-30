// Sequelize instance used by the app to talk to Postgres
import { Sequelize } from "sequelize-typescript";

// Read connection details from environment variables (see env.d.ts)
const dbName = process.env.DB_NAME as string;
const dbUser = process.env.DB_USERNAME as string;
const dbHost = process.env.DB_HOST as string;
const dbPort = process.env.DB_PORT as string;
const dbPassword = process.env.DB_PASSWORD as string;

// Shared Sequelize instance; models are auto-loaded from the ./models directory
export const sequelize = new Sequelize({
    database: dbName,
    username: dbUser,
    password: dbPassword,
    host: dbHost,
    port: Number(dbPort),
    dialect: "postgres",
    logging: false,
    models: [import.meta.dirname + "/models"],
});
