// Sequelize model for the Users table (columns must stay in sync with the user migration)
import { BelongsTo, Column, DataType, ForeignKey, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared role enum and user interface from the commons package
import { IPermission, PermissionOptions } from "@commons/permissions.ts";
import { Users } from "./user.ts"
import { Datasets } from "./dataset.ts"

export type {IPermission}

// Maps this class to the "Users" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Permissions",
    paranoid: true,
    timestamps: true,
})
export class Permissions extends Model<IPermission> {
    
    @ForeignKey(() => Users)
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare user_id: string;

    @ForeignKey(() => Datasets)
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare dataset_id: string;

    @Column({
        type: DataType.ENUM(...Object.values(PermissionOptions)),
        allowNull: false,
        defaultValue: PermissionOptions.VIEW,
    })
    declare perm: string[];

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

    // Time of deletion of the row
    @Column({
        type: DataType.DATE,
        allowNull: true,
    })
    declare deletedAt: Date;

    // Foreign keys cascade on delete/update (matches the Permissions migration)
    @BelongsTo(() => Users, { foreignKey: "user_id", onDelete: "CASCADE", onUpdate: "CASCADE" })
    declare user?: Users;

    @BelongsTo(() => Datasets, { foreignKey: "dataset_id", onDelete: "CASCADE", onUpdate: "CASCADE" })
    declare dataset?: Datasets;
}

export default Permissions;
