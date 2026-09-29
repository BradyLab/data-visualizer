import "dotenv/config";
import type { Options } from "sequelize";

const common: Options = {
    username: process.env.DB_USERNAME as string,
    password: process.env.DB_PASSWORD as string,
    database: process.env.DB_NAME as string,
    host: process.env.DB_HOST as string,
    port: Number(process.env.DB_PORT),
    dialect: "postgres",
};

const withSeederTracking = { ...common, seederStorage: "sequelize" as const };

export default {
    development: withSeederTracking,
    test: withSeederTracking,
    production: withSeederTracking,
};
