// Shared activity types used by both the frontend and backend

// Kinds of event recorded in the activity log (also stored in the Activities.type DB enum)
export enum ActivityType {
    INVITE_USER = "INVITE_USER",
    USER_JOINED = "USER_JOINED",
    USER_DEACTIVATED = "USER_DEACTIVATED",
    USER_REACTIVATED = "USER_REACTIVATED",
    USER_UPDATED = "USER_UPDATED",
    USER_DELETED = "USER_DELETED",
    PERM_GRANTED = "PERM_GRANTED",
    PERM_REVOKED = "PERM_REVOKED",
    DATASET_CREATED = "DATASET_CREATED",
    DATASET_UPDATED = "DATASET_UPDATED",
    DATASET_DELETED = "DATASET_DELETED",
    FILE_UPLOADED = "FILE_UPLOADED",
    FILE_DOWNLOADED = "FILE_DOWNLOADED",
    FILE_DELETED = "FILE_DELETED",
}

// One page of the activity list: the rows on this page and how many activities match the filters in total
export interface IActivityPage {
    rows: IActivity[];
    total: number;
}

// An activity record as stored in the Activities table
export interface IActivity {
    id: string;
    user_id: string | null; // null once the user has been deleted
    type: ActivityType;
    data: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date | null;
    deletedAt: Date | null;
}
