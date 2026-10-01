export enum ActivityType {
    INVITE_USER = "INVITE_USER",
    USER_JOINED = "USER_JOINED",
    USER_DEACTIVATED = "USER_DEACTIVATED",
    USER_ROLE_UPDATED = "USER_ROLE_UPDATED",
    PERM_GRANTED = "PERM_GRANTED",
    PERM_REVOKED = "PERM_REVOKED",
    DATASET_CREATED = "DATASET_CREATED",
    DATASET_UPDATED = "DATASET_UPDATED",
    DATASET_DELETED = "DATASET_DELETED",
    FILE_UPLOADED = "FILE_UPLOADED",
    FILE_DOWNLOADED = "FILE_DOWNLOADED",
}

export interface IActivity {
    id: string;
    user_id: string;
    type: ActivityType;
    data: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date;
}