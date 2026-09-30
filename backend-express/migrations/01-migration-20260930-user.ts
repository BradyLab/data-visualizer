// Migration: up() applies schema changes, down() reverts them
"use strict";

import { UserRoles, UserStatus } from "@commons/user.ts";
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

// Creates the Users and Passwords tables
export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // Users: core account information
        await queryInterface.createTable("Users", {
            id: {
                type: DataTypes.UUID,
                allowNull: false,
                primaryKey: true,
            },
            email: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            role: {
                // Allowed roles; keep in sync with the UserRoles enum
                type: DataTypes.ENUM(...Object.values(UserRoles)),
                allowNull: false,
                defaultValue: UserRoles.GUEST,
            },
            status: {
                // Allowed roles; keep in sync with the UserRoles enum
                type: DataTypes.ENUM(...Object.values(UserStatus)),
                allowNull: false,
                defaultValue: UserStatus.INVITED,
            },
            createdAt: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            updatedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            deletedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        });
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Drops both tables
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        await queryInterface.dropTable("Users");
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Export both functions as the default export for the migration runner
export default { up, down };
