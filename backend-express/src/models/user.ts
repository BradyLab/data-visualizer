// Sequelize model for the Users table (columns must stay in sync with the user migration)
import { Column, DataType, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared role enum and user interface from the commons package
import { UserRoles, IUser } from "@commons/user.ts";

// Maps this class to the "Users" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Users",
    timestamps: true,
})
export class Users extends Model<IUser> {
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

    // Optional name shown in the UI
    @Column({
        type: DataType.STRING,
        allowNull: true,
    })
    declare displayName?: string | undefined;

    // Unique handle for the user
    @Unique
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare username: string;

    // Whether the user wants to receive email notifications
    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
    })
    declare emailNotifs: boolean;

    // Access level; values come from the UserRoles enum
    @Column({
        type: DataType.ENUM(...Object.values(UserRoles)),
        allowNull: false,
    })
    declare role: string;

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
    declare updatedAt: Date;
}

export default Users;
