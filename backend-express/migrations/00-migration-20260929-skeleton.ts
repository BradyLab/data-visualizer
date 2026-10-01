// Migration 00: skeleton; intentionally creates no tables
// This is an empty template migration; copy it as a starting point for new migrations
// Migration: up() applies schema changes, down() reverts them
"use strict";

import { DataTypes, type QueryInterface, type Sequelize } from "sequelize";
// Minimal logger so migration errors/info are easy to spot in console output
const migrationLogger = {
    error: (e: unknown) => {
        console.error("[Migrations]", e);
    },
    info: (...args: unknown[]) => {
        console.log("[Migrations]", ...args);
    },
};

// Apply the migration
export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // add schema changes here
        // Example: await queryInterface.createTable("users", { id: DataTypes.INTEGER })
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Revert the migration
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // revert schema changes here
        // Example: await queryInterface.dropTable("users")
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Export both functions as the default export for the migration runner
export default { up, down };
