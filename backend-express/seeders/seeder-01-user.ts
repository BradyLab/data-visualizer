// Seeder 01: development seed data
// Seeds the Users table with a sample user for development
import { type QueryInterface, type Sequelize } from "sequelize";

// Insert the sample user (currently commented out; its fields predate the current Users schema)
export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    // Insert a sample user with a fixed id so down() can remove exactly this row
    // await queryInterface.bulkInsert(
    //     "Users",
    //     [
    //         {
    //             id: "a63324c7-73a6-4093-9475-c271173a481d",
    //             email: "john.doe@example.com",
    //             username: "johndoe",
    //             displayName: "John Doe",
    //             emailNotifs: true,
    //             role: "USER",
    //             createdAt: new Date(),
    //             updatedAt: new Date(),
    //         },
    //     ],
    //     {}
    // );
}

// Delete the sample user by its id
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    // await queryInterface.bulkDelete(
    //     "Users",
    //     {
    //         id: ["a63324c7-73a6-4093-9475-c271173a481d"],
    //     },
    //     {}
    // );
}

// Export both functions as the default export for the seeder runner
export default { up, down };
