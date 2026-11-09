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
            // EmailJS template for the password reset email (variables user_name, user_email, new_password); without it resets are refused
            EMAILJS_RESET_TEMPLATE_ID?: string;
            // "true" skips sending the invite email even when the EmailJS settings above are set
            EMAIL_DISABLED?: string;
            // Number of reverse proxies in front of the server (1 for the Caddy container of the production compose file); unset when there are none
            TRUST_PROXY?: string;
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
            // Where preprocessing jobs run: "local" (default: on this server), "auto" (too big for this server's memory, or out of memory here: on the
            // large-memory worker) or "remote" (always there); anything but local needs REMOTE_WORKER_TOKEN (see services/routing.ts)
            PREPROCESS_MODE?: string;
            // Memory a job may use here (a size such as 24g; default: this machine's RAM minus PREPROCESS_MEMORY_RESERVE, default 8g), and the
            // job's peak memory as a multiple of the RDS file's size (default 5): jobs that would not fit go to the worker in "auto" mode
            PREPROCESS_LOCAL_MEMORY?: string;
            PREPROCESS_MEMORY_RESERVE?: string;
            PREPROCESS_MEMORY_RATIO?: string;
            // Secret of the large-memory worker (at least 32 characters, different from the other secrets): enables the /api/worker routes
            REMOTE_WORKER_TOKEN?: string;
            // How long a worker's claim on a job lasts without a heartbeat (ms, default 15 minutes), and the largest Parquet file it may send (bytes)
            REMOTE_LEASE_MS?: string;
            REMOTE_UPLOAD_MAX_BYTES?: string;
            // Who is emailed when a dataset is waiting for the worker (comma separated; use a shared lab mailbox), and the EmailJS template for it
            NOTIFY_EMAIL_TO?: string;
            EMAILJS_NOTIFY_TEMPLATE_ID?: string;
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
