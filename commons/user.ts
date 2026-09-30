export enum UserRoles {
  ADMIN = "ADMIN",
  LAB_MEMBER = "LAB_MEMBER",
  EXTERNAL = "EXTERNAL",
  GUEST = "GUEST",
}

export enum UserStatus {
  INVITED = "INVITED",
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export interface IUser {
  id: string;
  email: string;
  name: string;
  role: UserRoles;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
}
