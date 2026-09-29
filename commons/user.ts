export enum UserRoles {
  ADMIN = "ADMIN",
  BETA = "BETA",
  USER = "USER",
  GUEST = "GUEST",
}

export interface IUser {
  id: string;
  email: string;
  displayName?: string | undefined;
  username: string;
  emailNotifs: boolean;
  role: UserRoles[];
  createdAt: Date;
  updatedAt: Date;
}
