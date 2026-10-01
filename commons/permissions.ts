// Shared permission types used by both the frontend and backend

// Access levels a user can hold on a dataset
export enum PermissionOptions {
  VIEW = "VIEW",
  EDIT = "EDIT",
}

// A permission record: grants one user an access level on one dataset
export interface IPermission {
  user_id: string;
  dataset_id: string;
  perm: PermissionOptions;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
}
