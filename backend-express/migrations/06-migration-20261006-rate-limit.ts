// Migration 06: creates the RateLimits table (hit counters behind the login rate limiters)
// up() applies schema changes, down() reverts them
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
        // add schema changes
        await queryInterface.createTable("RateLimits", {
            // Limiter prefix + client key (an IP, an email or a user id), e.g. "login-ip:1.2.3.4"
            key: {
                type: DataTypes.STRING,
                allowNull: false,
                primaryKey: true,
            },
            // Hits counted in the current window
            hits: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            // When the current window ends; the counter starts over after this time
            reset_time: {
                type: DataTypes.DATE,
                allowNull: false,
            },
        });
        // Lets the cleanup of expired windows avoid scanning the whole table
        await queryInterface.addIndex("RateLimits", ["reset_time"]);
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Revert the migration
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // revert schema changes
        await queryInterface.dropTable("RateLimits");
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Export both functions as the default export for the migration runner
export default { up, down };
