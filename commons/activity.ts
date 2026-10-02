// Shared activity types used by both the frontend and backend

// Kinds of event recorded in the activity log (also stored in the Activities.type DB enum)
export enum ActivityType {
    INVITE_USER = "INVITE_USER",
    USER_JOINED = "USER_JOINED",
    USER_DEACTIVATED = "USER_DEACTIVATED",
    USER_REACTIVATED = "USER_REACTIVATED"
    USER_ROLE_UPDATED = "USER_ROLE_UPDATED",
    // USER_SIGN_IN = "USER_SIGN_IN",
    // USER_SIGN_OUT = "USER_SIGN_OUT", tracking these almost seems... dystopian?
    PERM_GRANTED = "PERM_GRANTED",
    PERM_REVOKED = "PERM_REVOKED",
    DATASET_CREATED = "DATASET_CREATED",
    DATASET_UPDATED = "DATASET_UPDATED",
    DATASET_DELETED = "DATASET_DELETED",
    FILE_UPLOADED = "FILE_UPLOADED",
    FILE_DOWNLOADED = "FILE_DOWNLOADED",
}

// An activity record as stored in the Activities table
export interface IActivity {
    id: string;
    user_id: string;
    type: ActivityType;
    data: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date | null;
    deletedAt: Date | null;
}
