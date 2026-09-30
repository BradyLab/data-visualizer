// Sequelize CLI configuration (used by migrations/seeders); loads .env values
import "dotenv/config";
import type { Options } from "sequelize";

// Connection options shared by every environment
const common: Options = {
    username: process.env.DB_USERNAME as string,
    password: process.env.DB_PASSWORD as string,
    database: process.env.DB_NAME as string,
    host: process.env.DB_HOST as string,
    port: Number(process.env.DB_PORT),
    dialect: "postgres",
};

// Track which seeders have run in the database so they are not re-applied
const withSeederTracking = { ...common, seederStorage: "sequelize" as const };

// Same settings are currently used for all environments
export default {
    development: withSeederTracking,
    test: withSeederTracking,
    production: withSeederTracking,
};
