// Sequelize model for the Files table (columns must stay in sync with the file migration)
import { BelongsTo, Column, DataType, ForeignKey, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared file interface and file types from the commons package
import { IFile, FileTypes } from "@commons/file.ts";
import { Datasets } from "@src/models/dataset.ts";
import { Users } from "@src/models/user.ts";

export type { IFile };

// Maps this class to the "Files" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Files",
    timestamps: true,
})
export class Files extends Model<IFile> {
    // Unique file identifier, auto-generated as a UUIDv4
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
        defaultValue: DataType.UUIDV4,
    })
    declare id: string;

    // Part of the composite unique constraint: each dataset has at most one file of each type
    @Unique("Files_dataset_id_type_unique")
    @ForeignKey(() => Datasets)
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare dataset_id: string;

    // User who uploaded the file
    @ForeignKey(() => Users)
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare user_id: string;

    // Part of the composite unique constraint with dataset_id
    @Unique("Files_dataset_id_type_unique")
    @Column({
        type: DataType.ENUM(...Object.values(FileTypes)),
        allowNull: false,
    })
    declare type: FileTypes;

    // File size in bytes
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
    })
    declare sizeBytes: number;

    // Original file name as uploaded
    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    declare ogName: string;

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

    // Deleting/updating the dataset cascades to its files (matches the Files migration)
    @BelongsTo(() => Datasets, { foreignKey: "dataset_id", onDelete: "CASCADE", onUpdate: "CASCADE" })
    declare dataset?: Datasets;
}

export default Files;
