"use strict";

import { DataTypes, type QueryInterface, type Sequelize } from "sequelize";
const migrationLogger = {
    error: (e: unknown) => {
        console.error("[Migrations]", e);
    },
    info: (...args: unknown[]) => {
        console.log("[Migrations]", ...args);
    },
};

export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // add schema changes here
        // Example: await queryInterface.createTable('users', { id: DataTypes.INTEGER })
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // revert schema changes here
        // Example: await queryInterface.dropTable('users')
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

export default { up, down };
