// E2E seeder: ACTIVE users (one per role) with a known password for the Playwright tests
// Kept apart from seeders/ because the development seed users are INVITED and would be forced through a password change on login
// Run with `npm run db:seed:e2e` against the e2e database only (see frontend/playwright.config.ts)
import { type QueryInterface, type Sequelize } from "sequelize";
import { UserRoles, UserStatus } from "@commons/user.ts";
import { hashPassword } from "@src/utils/password.ts";

// Fixed ids and emails; the Playwright side keeps the same emails in frontend/e2e/users.ts
const E2E_USERS = [
    { id: "e2e00000-0000-4000-8000-000000000001", email: "admin@e2e.test", name: "E2E Admin", role: UserRoles.ADMIN },
    { id: "e2e00000-0000-4000-8000-000000000002", email: "lab@e2e.test", name: "E2E Lab Member", role: UserRoles.LAB_MEMBER },
    { id: "e2e00000-0000-4000-8000-000000000003", email: "external@e2e.test", name: "E2E External", role: UserRoles.EXTERNAL },
];

export async function up(queryInterface: QueryInterface, sequelize: Sequelize) {
    const password = process.env.E2E_PASSWORD;
    if (!password) throw new Error("E2E_PASSWORD is not set");
    const hash = await hashPassword(password);
    await queryInterface.bulkInsert(
        "Users",
        E2E_USERS.map((user) => ({ ...user, password: hash, status: UserStatus.ACTIVE, createdAt: new Date() })),
        {}
    );
}

export async function down(queryInterface: QueryInterface, sequelize: Sequelize) {
    await queryInterface.bulkDelete("Users", { id: E2E_USERS.map((user) => user.id) }, {});
}

export default { up, down };
