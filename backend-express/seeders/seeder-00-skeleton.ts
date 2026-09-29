import { DataTypes, type QueryInterface, type Sequelize } from "sequelize";

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

export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    /**
     * Add commands to revert seed here.
     *
     * Example:
     * await queryInterface.bulkDelete('People', null, {});
     */
}

export default { up, down };
