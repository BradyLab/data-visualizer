import { Column, DataType, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
import { UserRoles, IUser } from "@commons/user.ts";

@Table({
    tableName: "Users",
    timestamps: true,
})
export class Users extends Model<IUser> {
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
        defaultValue: DataType.UUIDV4,
    })
    declare id: string;

    @Unique
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare email: string;

    @Column({
        type: DataType.STRING,
        allowNull: true,
    })
    declare displayName?: string | undefined;

    @Unique
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare username: string;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
    })
    declare emailNotifs: boolean;

    @Column({
        type: DataType.ENUM(...Object.values(UserRoles)),
        allowNull: false,
    })
    declare role: string;

    @Column({
        type: DataType.DATE,
        allowNull: false,
    })
    declare createdAt: Date;

    @Column({
        type: DataType.DATE,
        allowNull: true,
    })
    declare updatedAt: Date;
}

export default Users;
