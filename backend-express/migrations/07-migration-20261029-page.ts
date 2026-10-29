// Migration 07: creates the Pages table (Markdown content of the editable pages, e.g. About)
// up() applies schema changes, down() reverts them
"use strict";

import { PageSlug } from "@commons/page.ts";
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
        await queryInterface.createTable("Pages", {
            // Primary key: which page this is (a PageSlug value, e.g. "about")
            slug: {
                type: DataTypes.ENUM(...Object.values(PageSlug)),
                allowNull: false,
                primaryKey: true,
            },
            // The page's Markdown text
            content: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            // Timestamps
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
        await queryInterface.dropTable("Pages");
        await (queryInterface as any).dropEnum("enum_Pages_slug");
    } catch (error) {
        migrationLogger.error(error);
        throw error;
    }
}

// Export both functions as the default export for the migration runner
export default { up, down };
