// Fields the server generates itself and the client never sends
// deletedAt only exists on IActivity; Omit ignores keys a type does not have
export type ServerFields = "id" | "createdAt" | "updatedAt" | "deletedAt";


export const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;
