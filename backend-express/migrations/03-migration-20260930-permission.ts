// This is an empty template migration; copy it as a starting point for new migrations
// Migration: up() applies schema changes, down() reverts them
"use strict";

import { DataTypes, type QueryInterface, type Sequelize } from "sequelize";
import { PermissionOptions } from "@commons/permissions.ts";
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
        await queryInterface.createTable("Permissions", { 
            user_id: {
                type: DataTypes.UUID,
                allowNull: false,
                primaryKey: true,
                references: { model: "Users", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            dataset_id: {
                type: DataTypes.UUID,
                allowNull: false,
                primaryKey: true,
                references: { model: "Datasets", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            perm: {
                type: DataTypes.ENUM(...Object.values(PermissionOptions)),
                allowNull: false,
                defaultValue: PermissionOptions.VIEW,
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
        })
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Revert the migration
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // revert schema changes
        await queryInterface.dropTable("Permissions")
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Export both functions as the default export for the migration runner
export default { up, down };
