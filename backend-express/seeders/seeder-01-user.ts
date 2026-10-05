// Seeder 01: development seed data
// Seeds the Users table with sample users (a lab member and an admin) for development
// Fields must match the Users migration/model; passwords are hashed before insert
import { type QueryInterface, type Sequelize } from "sequelize";
import { UserRoles, UserStatus } from "@commons/user.ts";
import { hashPassword } from "@src/utils/password.ts";

// Insert the sample users
export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    // Insert sample users with fixed ids so down() can remove exactly these rows
    await queryInterface.bulkInsert(
        "Users",
        [
            {
                // bulkInsert bypasses model defaults and hooks, so ids and createdAt must be supplied here
                id: "a63324c7-73a6-4093-9475-c271173a481d",
                email: "lizwright@ucdavis.edu",
                // Stored as salt:hash, the same format verifyPassword in services/auth.ts expects
                password: hashPassword(process.env.DEFAULT_PASSWORD),
                name: "Liz Wright",
                role: UserRoles.LAB_MEMBER,
                status: UserStatus.ACTIVE,
                createdAt: new Date(),
            },
            {
                id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
                email: "sbrady@ucdavis.edu",
                password: hashPassword(process.env.DEFAULT_PASSWORD),
                name: "Siobhan Brady",
                role: UserRoles.ADMIN,
                status: UserStatus.ACTIVE,
                createdAt: new Date(),
            },
        ],
        {}
    );
}

// Delete the sample users by id
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    await queryInterface.bulkDelete(
        "Users",
        {
            // Must list the same ids as up() so only the seeded rows are deleted
            id: ["a63324c7-73a6-4093-9475-c271173a481d", "f81d4fae-7dec-11d0-a765-00a0c91e6bf6"],
        },
        {}
    );
}

// Export both functions as the default export for the seeder runner
export default { up, down };
