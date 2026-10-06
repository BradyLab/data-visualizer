// Sequelize model for the Datasets table (columns must stay in sync with the dataset migration)
import { Column, DataType, ForeignKey, HasMany, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared dataset interface and plot types from the commons package
import { IDataset, DatasetPlots, DatasetVisibility, datasetUrlError } from "@commons/dataset.ts";
import { Users } from "@src/models/user.ts";
import { Permissions } from "@src/models/permission.ts";
import { Files } from "@src/models/file.ts";

export type { IDataset };

// Maps this class to the "Datasets" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Datasets",
    timestamps: true,
})
export class Datasets extends Model<IDataset> {
    // Unique dataset identifier, auto-generated as a UUIDv4
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

    // User who owns the dataset
    @ForeignKey(() => Users)
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare owner: string;

    // Unique URL/slug for the dataset; must be a clean slug and not a reserved word (a failure becomes a 400)
    @Unique
    @Column({
        type: DataType.STRING,
        allowNull: false,
        validate: {
            isValidSlug(value: string) {
                const problem = datasetUrlError(value);
                if (problem) throw new Error(problem);
            },
        },
    })
    declare url: string;

    // Free-text description
    @Column({
        type: DataType.TEXT,
        allowNull: false,
    })
    declare description: string;

    // Optional DOI of the associated publication
    @Column({
        type: DataType.STRING,
        allowNull: false,
        defaultValue: "",
    })
    declare doi: string;

    // Optional link to the raw data
    @Column({
        type: DataType.STRING,
        allowNull: false,
        defaultValue: "",
    })
    declare rawDataLink: string;

    // Treatment names used in the dataset
    @Column({
        type: DataType.ARRAY(DataType.STRING),
        allowNull: false,
    })
    declare treatments: string[];

    // Plot types to display; values come from the DatasetPlots enum
    @Column({
        type: DataType.ARRAY(DataType.ENUM(...Object.values(DatasetPlots))),
        allowNull: false,
    })
    declare plots: DatasetPlots[];

    // Who may see the dataset; defaults to PRIVATE (not enforced anywhere in the API yet)
    @Column({
        type: DataType.ENUM(...Object.values(DatasetVisibility)),
        allowNull: false,
        defaultValue: DatasetVisibility.PRIVATE,
    })
    declare visibility: DatasetVisibility;

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

    // Deleting a dataset (dataset.destroy()) also deletes its permissions (hard delete, Permissions is not paranoid).
    // hooks: true makes Sequelize load and destroy each child row individually;
    // it does not apply to bulk deletes like Datasets.destroy({ where }) unless individualHooks: true is passed
    @HasMany(() => Permissions, { foreignKey: "dataset_id", onDelete: "CASCADE", onUpdate: "CASCADE", hooks: true })
    declare permissions?: Permissions[];

    // Deleting a dataset also deletes its files (Files is not paranoid, so these rows are removed outright)
    @HasMany(() => Files, { foreignKey: "dataset_id", onDelete: "CASCADE", onUpdate: "CASCADE", hooks: true })
    declare files?: Files[];
}

export default Datasets;
