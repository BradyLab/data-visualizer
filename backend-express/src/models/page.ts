// Sequelize model for the Pages table (columns must stay in sync with the page migration)
import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";
// Shared page interface and slugs from the commons package
import { IPage, PageSlug } from "@commons/page.ts";

export type { IPage };

// Maps this class to the "Pages" table and enables createdAt/updatedAt timestamps
@Table({
    tableName: "Pages",
    timestamps: true,
})
export class Pages extends Model<IPage> {
    // Which page this is; one row per editable page
    @PrimaryKey
    @Column({
        type: DataType.ENUM(...Object.values(PageSlug)),
        allowNull: false,
    })
    declare slug: PageSlug;

    // The page's Markdown text
    @Column({
        type: DataType.TEXT,
        allowNull: false,
    })
    declare content: string;

    // Row creation time
    @Column({
        type: DataType.DATE,
        allowNull: false,
    })
    declare createdAt: Date;

    // Time of the last edit
    @Column({
        type: DataType.DATE,
        allowNull: true,
    })
    declare updatedAt: Date | null;
}

export default Pages;
