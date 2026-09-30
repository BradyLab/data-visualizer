// Sequelize model for the Users table (columns must stay in sync with the user migration)
import { Column, DataType, ForeignKey, Model, PrimaryKey, Table, Unique } from "sequelize-typescript";
// Shared role enum and user interface from the commons package
import { IFile, FileTypes } from "@commons/file.ts";
import { Datasets } from "./dataset.ts"

export type {IFile}

// Maps this class to the "Users" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Files",
    timestamps: true,
})
export class Files extends Model<IFile> {
    
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

    // Part of the composite unique constraint with dataset_id
    @Unique("Files_dataset_id_type_unique")
    @Column({
        type: DataType.ENUM(...Object.values(FileTypes)),
        allowNull: false,
    })
    declare type: string;

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
    })
    declare sizeBytes: number;

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
    declare updatedAt: Date;

    // Time of deletion of the row
    @Column({
        type: DataType.DATE,
        allowNull: true,
    })
    declare deletedAt: Date;
}

export default Files;
