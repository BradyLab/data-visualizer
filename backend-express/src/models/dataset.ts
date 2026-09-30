// Sequelize model for the Users table (columns must stay in sync with the user migration)
import { Column, DataType, ForeignKey, HasMany, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared role enum and user interface from the commons package
import { IDataset, DatasetPlots } from "@commons/dataset.ts";
import { Users } from "./user.ts"
import { Permissions } from "./permission.ts"

export type {IDataset}

// Maps this class to the "Users" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Datasets",
    paranoid: true,
    timestamps: true,
})
export class Datasets extends Model<IDataset> {
    // Unique user identifier, auto-generated as a UUIDv4
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
        defaultValue: DataType.UUIDV4,
    })
    declare id: string;

    // Dataset name
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare name: string;

    @ForeignKey(() => Users)
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare owner: string;

    @Unique
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare url: string;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare description: string;

    @Column({
        type: DataType.STRING,
        allowNull: true,
        defaultValue: "",
    })
    declare doi: string;

    @Column({
        type: DataType.STRING,
        allowNull: true,
        defaultValue: "",
    })
    declare rawDataLink: string;

    @Column({
        type: DataType.ARRAY(DataType.STRING),
        allowNull: false,
    })
    declare treatments: string[];

    @Column({
        type: DataType.ARRAY(DataType.ENUM(...Object.values(DatasetPlots))),
        allowNull: false,
    })
    declare plots: string[];

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

    // Soft-deleting a dataset (dataset.destroy()) also soft-deletes its permissions.
    // hooks: true makes Sequelize load and destroy each child row individually, which honors paranoid mode;
    // it does not apply to bulk deletes like Datasets.destroy({ where }) unless individualHooks: true is passed
    @HasMany(() => Permissions, { foreignKey: "dataset_id", onDelete: "CASCADE", onUpdate: "CASCADE", hooks: true })
    declare permissions?: Permissions[];
}

export default Datasets;
