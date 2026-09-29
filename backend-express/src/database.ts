import { Sequelize } from "sequelize-typescript";

const dbName = process.env.DB_NAME as string;
const dbUser = process.env.DB_USERNAME as string;
const dbHost = process.env.DB_HOST as string;
const dbPort = process.env.DB_PORT as string;
const dbPassword = process.env.DB_PASSWORD as string;

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
