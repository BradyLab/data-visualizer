// Shared file types used by both the frontend and backend
import type { Timestamp } from "./general.ts";

// Kinds of file attached to a dataset (at most one per kind per version per dataset, and exactly one current version)
export enum FileTypes {
    COVER = "COVER",
    RDS = "RDS",
}

// A file record as stored in the Files table
export interface IFile {
    id: string;
    dataset_id: string;
    user_id: string;
    type: FileTypes;
    sizeBytes: number;
    ogName: string;
    version: number;
    updates: string | null;
    isCurrent: boolean;
    createdAt: Timestamp;
    updatedAt: Timestamp | null;
}
