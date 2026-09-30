export enum FileTypes {
    COVER = "COVER",
    RDS = "RDS",
    RAW = "RAW",
}

export interface IFile {
    id: string;
    dataset_id: string;
    type: FileTypes;
    sizeBytes: number;
    ogName: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date;
}
