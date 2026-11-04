// Fields the server generates itself and the client never sends
// deletedAt only exists on IActivity; Omit ignores keys a type does not have
export type ServerFields = "id" | "createdAt" | "updatedAt" | "deletedAt";

// Backend origin (also where the websocket connects), from a Vite env var with a local-dev fallback. An empty VITE_BACKEND_URL means the backend
// is served from the same origin as the app (the production setup, where Caddy routes /api, /socket.io and /shiny), so one build works for any domain
const configuredOrigin = import.meta.env.VITE_BACKEND_URL;
export const baseOrigin = configuredOrigin === "" ? window.location.origin : (configuredOrigin ?? "http://localhost:3001");

// Backend origin plus optional API path prefix for REST requests
export const baseURL = `${baseOrigin}${import.meta.env.VITE_API_PATH ?? ""}`;

// Link to the help document, used by the HELP links in the header and footer
export const HELP_URL = "https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.h5arv6ibis4c";
