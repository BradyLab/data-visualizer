// Shared API route segments (one per resource) so frontend requests and backend routers use the same names
// Values are used verbatim as URL path segments; the backend mounts each router at the same path in index.ts
export enum apis {
    USER = "users",
    DATASET = "datasets",
    PERMISSION = "permissions",
    FILE = "files",
    ACTIVITY = "activities",
    AUTH = "auth",
}

// Minimum length for user passwords; enforced by the backend and mirrored by the frontend form rules
export const MIN_PASSWORD_LENGTH = 8;

// Error code in the 403 body that requireAuth sends to INVITED users until they change the default password
export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";
