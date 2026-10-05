// Sequelize model for the Users table (columns must stay in sync with the user migration)
import { Column, DataType, HasMany, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared role enum and user interface from the commons package
import { IUser, UserRoles, UserStatus } from "@commons/user.ts";
import { Permissions } from "@src/models/permission.ts";

// User shape from commons plus the stored (hashed) password, which is never exposed to the frontend
export interface IUserPass extends IUser {
    password: string;
}

// Maps this class to the "Users" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Users",
    timestamps: true,
})
export class Users extends Model<IUserPass> {
    // Unique user identifier, auto-generated as a UUIDv4
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
        defaultValue: DataType.UUIDV4,
    })
    declare id: string;

    // Login/contact email; must be unique
    @Unique
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare email: string;

    // Hashed password, stripped by the service
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare password: string;

    // User's name
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare name: string;

    // Access level; values come from the UserRoles enum
    @Column({
        type: DataType.ENUM(...Object.values(UserRoles)),
        allowNull: false,
        defaultValue: UserRoles.GUEST,
    })
    declare role: UserRoles;

    // User's status; values come from the UserStatus enum
    @Column({
        type: DataType.ENUM(...Object.values(UserStatus)),
        allowNull: false,
        defaultValue: UserStatus.INVITED,
    })
    declare status: UserStatus;

    // Row creation time
    @Column({
        type: DataType.DATE,
        allowNull: false,
    })
    declare createdAt: Date;

    // Time of the last update to the row
    @Column({
        type: DataType.DATE,
        allowNull: true,
    })
    declare updatedAt: Date | null;

    // Time of deletion of the row
    @Column({
        type: DataType.DATE,
        allowNull: true,
    })
    declare deletedAt: Date | null;

    // Soft-deleting a user (user.destroy()) also soft-deletes their permissions.
    // hooks: true makes Sequelize load and destroy each child row individually, which honors paranoid mode;
    // it does not apply to bulk deletes like Users.destroy({ where }) unless individualHooks: true is passed
    @HasMany(() => Permissions, { foreignKey: "user_id", onDelete: "CASCADE", onUpdate: "CASCADE", hooks: true })
    declare permissions?: Permissions[];
}

export default Users;
