// Type declarations for the environment variables the backend expects in .env
declare global {
    namespace NodeJS {
        interface ProcessEnv {
            // Port the API server listens on
            API_PORT: string;
            // Public URL of this backend (shown in the startup banner)
            BACKEND_URL: string;
            // Public URL of the frontend (used for CORS and the startup banner)
            FRONTEND_URL: string;
            // Postgres connection settings
            DB_HOST: string;
            DB_PORT: string;
            DB_NAME: string;
            DB_USERNAME: string;
            DB_PASSWORD: string;
            // Secret used to sign login tokens, and how long they last (e.g. "8h")
            JWT_SECRET: string;
            JWT_EXPIRES_IN?: string;
        }
    }
}

// Makes this file a module so the global augmentation above applies
export {};
