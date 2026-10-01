// Sequelize model for the Permissions table (columns must stay in sync with the permission migration)
import { BelongsTo, Column, DataType, ForeignKey, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared permission interface and options from the commons package
import { IPermission, PermissionOptions } from "@commons/permissions.ts";
import { Users } from "./user.ts";
import { Datasets } from "./dataset.ts";

export type { IPermission };

// Maps this class to the "Permissions" table and enables createdAt/updatedAt timestamps (paranoid: true = soft deletes via deletedAt)
@Table({
    tableName: "Permissions",
    paranoid: true,
    timestamps: true,
})
export class Permissions extends Model<IPermission> {
    // Part of the composite primary key (user_id + dataset_id)
    @ForeignKey(() => Users)
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare user_id: string;

    // Other half of the composite primary key
    @ForeignKey(() => Datasets)
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare dataset_id: string;

    // Access level; values come from the PermissionOptions enum (defaults to VIEW)
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
