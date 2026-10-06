// Fields the server generates itself and the client never sends
// deletedAt only exists on IActivity; Omit ignores keys a type does not have
export type ServerFields = "id" | "createdAt" | "updatedAt" | "deletedAt";

// Backend origin plus optional API path prefix; both come from Vite env vars with a local-dev fallback
export const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;

// Link to the help document, used by the HELP links in the header and footer
export const HELP_URL = "https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.h5arv6ibis4c";
