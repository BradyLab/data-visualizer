// Sequelize model for the Activities table (columns must stay in sync with the activity migration)
import { Column, DataType, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
// Shared activity interface and activity types from the commons package
import { IActivity, ActivityType } from "@commons/activity.ts";
import { Users } from "./user.ts";

export type { IActivity };

// Maps this class to the "Activities" table and enables createdAt/updatedAt timestamps (paranoid: true = soft deletes via deletedAt)
@Table({
    tableName: "Activities",
    paranoid: true,
    timestamps: true,
})
export class Activities extends Model<IActivity> {
    // Unique activity identifier, auto-generated as a UUIDv4
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
        defaultValue: DataType.UUIDV4,
    })
    declare id: string;

    // User who performed the activity
    @ForeignKey(() => Users)
    @Column({
        type: DataType.UUID,
        allowNull: false,
    })
    declare user_id: string;

    // Type of activity logged
    @Column({
        type: DataType.ENUM(...Object.values(ActivityType)),
        allowNull: false,
    })
    declare type: ActivityType;

    // Free-form JSON payload describing the event; its shape depends on the activity type
    @Column({
        type: DataType.JSON,
        allowNull: false,
    })
    declare data: Record<string, unknown>;

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

export default Activities;
