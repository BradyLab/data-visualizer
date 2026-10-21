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
            // Password given to seeded users until they change it (invited users get a random temporary password instead)
            DEFAULT_PASSWORD: string;
            // EmailJS settings for the invite email (service and template IDs, public key, and the private key that allows server-side calls);
            // invites are still created, but no email is sent, unless all four are set
            EMAILJS_SERVICE_ID?: string;
            EMAILJS_TEMPLATE_ID?: string;
            EMAILJS_PUBLIC_KEY?: string;
            EMAILJS_PRIVATE_KEY?: string;
            // "true" skips sending the invite email even when the EmailJS settings above are set
            EMAIL_DISABLED?: string;
            // Secret used to sign login tokens, and how long they last (e.g. "8h")
            JWT_SECRET: string;
            JWT_EXPIRES_IN?: string;
            // Folder for uploaded files (rds/ and cover/ are created inside it)
            UPLOAD_DIR: string;
            // Largest accepted upload in bytes (default 30 GiB)
            UPLOAD_MAX_BYTES?: string;
            // Internal URL of the Shiny server that /shiny proxies to (e.g. http://shiny:3838); the viewer is disabled when unset
            SHINY_URL?: string;
            // Secret shared with the Shiny app (SHINY_SECRET there too) to sign the viewer context it trusts; the viewer is disabled when unset
            SHINY_SECRET?: string;
            // Lifetime of the viewer ticket and of the viewer cookie session (e.g. "60s", "1h")
            VIEWER_TICKET_EXPIRES_IN?: string;
            VIEWER_SESSION_EXPIRES_IN?: string;
            // Where the Shiny plot data (one Parquet folder per dataset) is kept; a "parquet" folder next to UPLOAD_DIR (/data/parquet) unless set
            PARQUET_DIR?: string;
            // Program and script of the preprocessing job (defaults: Rscript and shiny/preprocess/preprocess.R) and its time limit in ms
            PREPROCESS_COMMAND?: string;
            PREPROCESS_SCRIPT?: string;
            PREPROCESS_TIMEOUT_MS?: string;
            // Shared folder for handing jobs to a worker container instead of running R here (see services/processingSpool.ts)
            PREPROCESS_SPOOL_DIR?: string;
            // Spool mode: how long a job may wait for a worker, and how often the backend checks on it (ms)
            PREPROCESS_PICKUP_TIMEOUT_MS?: string;
            PREPROCESS_POLL_MS?: string;
        }
    }
}

// Makes this file a module so the global augmentation above applies
export {};
