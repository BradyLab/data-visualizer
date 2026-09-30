// This is an empty template migration; copy it as a starting point for new migrations
// Migration: up() applies schema changes, down() reverts them
"use strict";

import { DataTypes, type QueryInterface, type Sequelize } from "sequelize";
import { DatasetPlots } from "@commons/dataset.ts";
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
        await queryInterface.createTable("Datasets", { 
            id: {
                type: DataTypes.UUID,
                allowNull: false,
                primaryKey: true,
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            owner: {
                type: DataTypes.UUID,
                allowNull: false,
                references: { model: "Users", key: "id" },
            },
            url: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            description: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            doi: {
                type: DataTypes.STRING,
                allowNull: true,
                defaultValue: "",
            },
            rawDataLink: {
                type: DataTypes.STRING,
                allowNull: true,
                defaultValue: "",
            },
            treatments: {
                type: DataTypes.ARRAY(DataTypes.STRING),
                allowNull: false,
            },
            plots: {
                type: DataTypes.ARRAY(DataTypes.ENUM(...Object.values(DatasetPlots))),
                allowNull: false,
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
        await queryInterface.dropTable("Datasets")
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Export both functions as the default export for the migration runner
export default { up, down };
