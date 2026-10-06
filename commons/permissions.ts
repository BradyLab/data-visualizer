// Shared permission types used by both the frontend and backend

// Access levels a user can hold on a dataset, from least to most; each level includes the ones before it:
// VIEW reads the dataset, DOWNLOAD also downloads its RDS file, EDIT also changes the dataset and its files,
// OWNER also changes its visibility, deletes it and manages who it is shared with
export enum PermissionOptions {
    VIEW = "VIEW",
    DOWNLOAD = "DOWNLOAD",
    EDIT = "EDIT",
    OWNER = "OWNER",
}

// A permission record: grants one user an access level on one dataset
// No separate id: (user_id, dataset_id) is the composite primary key
export interface IPermission {
    user_id: string;
    dataset_id: string;
    perm: PermissionOptions;
    createdAt: Date;
    updatedAt: Date | null;
}
