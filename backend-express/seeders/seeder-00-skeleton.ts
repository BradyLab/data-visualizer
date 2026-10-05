// Seeder 00: skeleton; empty template seeder, copy it as a starting point for new seeders
import { DataTypes, type QueryInterface, type Sequelize } from "sequelize";

// Insert seed data
// queryInterface runs schema/data commands; sequelize is the connection (both unused in this template)
export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    /**
     * Add seed commands here.
     *
     * Example:
     * await queryInterface.bulkInsert('People', [{
     *   name: 'John Doe',
     *   isBetaMember: false
     * }], {});
     */
}

// Remove the seed data inserted by up()
export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    /**
     * Add commands to revert seed here.
     *
     * Example:
     * await queryInterface.bulkDelete('People', null, {});
     */
}

// Export both functions as the default export for the seeder runner
export default { up, down };
