// Shared file types used by both the frontend and backend

// Kinds of file attached to a dataset (at most one per kind per dataset)
export enum FileTypes {
    COVER = "COVER",
    RDS = "RDS",
    RAW = "RAW",
}

// A file record as stored in the Files table
export interface IFile {
    id: string;
    dataset_id: string;
    user_id: string;
    type: FileTypes;
    sizeBytes: string;
    ogName: string;
    createdAt: Date;
    updatedAt: Date | null;
}
