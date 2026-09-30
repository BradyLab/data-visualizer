declare global {
    namespace NodeJS {
        interface ProcessEnv {
            API_PORT: string;
            BACKEND_URL: string;
            FRONTEND_URL: string;
            DB_HOST: string;
            DB_PORT: string;
            DB_NAME: string;
            DB_USERNAME: string;
            DB_PASSWORD: string;
        }
    }
}

export {};
