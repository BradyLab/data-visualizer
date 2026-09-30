export enum PermissionOptions {
    VIEW = "VIEW",
    EDIT = "EDIT",
}

export interface IPermission {
    user_id: string;
    dataset_id: string;
    perm: PermissionOptions;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date;
}
