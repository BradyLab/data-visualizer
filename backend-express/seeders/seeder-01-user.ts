// Seeder 01: development seed data
// Seeds the Users table with a sample user for development
import { type QueryInterface, type Sequelize } from "sequelize";
import { UserRoles, UserStatus } from "@commons/user.ts";
import { hashPassword } from "@src/utils/password.ts";

// Insert the sample user (currently commented out; its fields predate the current Users schema)
export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    // Insert a sample user with a fixed id so down() can remove exactly this row
    await queryInterface.bulkInsert(
        "Users",
        [
            {
                id: "a63324c7-73a6-4093-9475-c271173a481d",
                email: "lizwright@ucdavis.edu",
                password: hashPassword("l!zIs@w3s0m3"),
                name: "Liz Wright",
                role: UserRoles.LAB_MEMBER,
                status: UserStatus.ACTIVE,
                createdAt: new Date(),
            },
            {
                id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
                email: "sbrady@ucdavis.edu",
                password: hashPassword("l!zIs@w3s0m3"),
                name: "Siobhan Brady",
                role: UserRoles.ADMIN,
                status: UserStatus.ACTIVE,
                createdAt: new Date(),
            },
        ],
        {}
    );
}

// Delete the sample user by its id
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    await queryInterface.bulkDelete(
        "Users",
        {
            id: ["a63324c7-73a6-4093-9475-c271173a481d"],
            id: ["f81d4fae-7dec-11d0-a765-00a0c91e6bf6"],
        },
        {}
    );
}

// Export both functions as the default export for the seeder runner
export default { up, down };
