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
