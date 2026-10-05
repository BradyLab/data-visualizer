// Migration 03: creates the Permissions join table (per-user access to datasets)
// up() applies schema changes, down() reverts them
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
            // Composite primary key (user_id, dataset_id): one permission row per user per dataset
            // user_id is a foreign key to Users.id; deleting/updating the user cascades
            user_id: {
                type: DataTypes.UUID,
                allowNull: false,
                primaryKey: true,
                references: { model: "Users", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            // dataset_id is a foreign key to Datasets.id; deleting/updating the dataset cascades
            dataset_id: {
                type: DataTypes.UUID,
                allowNull: false,
                primaryKey: true,
                references: { model: "Datasets", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            // Access level granted to the user; defaults to read-only (VIEW)
            perm: {
                type: DataTypes.ENUM(...Object.values(PermissionOptions)),
                allowNull: false,
                defaultValue: PermissionOptions.VIEW,
            },
            // Timestamps; deletedAt is set for soft deletes (paranoid models)
            createdAt: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            updatedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        });
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Revert the migration
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    try {
        // revert schema changes
        await queryInterface.dropTable("Permissions");
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Export both functions as the default export for the migration runner
export default { up, down };
