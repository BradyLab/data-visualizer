# Production image of the backend. Build from the repository root (the code imports ../commons):
#   docker build -f backend-express/Dockerfile -t data-visualizer-backend .
# The node tag floats within the major version on purpose: rebuilding the image (see docker-compose.prod.yml) picks up Node security patches.
# Keep the major in line with .nvmrc and the engines field in package.json.
#
# The code is run with tsx, as in development, not from tsc output: tsconfig.json only emits type declarations, and the source uses
# .ts import extensions and the @src/@commons aliases, which plain node cannot resolve. That is also why the dev dependencies
# (tsx, sequelize-cli for the migrations) stay installed.
FROM node:26-alpine

WORKDIR /app/backend-express
COPY backend-express/package.json backend-express/package-lock.json ./
RUN npm ci && npm cache clean --force

COPY backend-express/ ./
COPY commons/ /app/commons/

# Set after npm ci: with NODE_ENV=production npm would skip the dev dependencies
ENV NODE_ENV=production
# The "node" user (uid 1000) owns nothing here; it only reads the code and writes to the mounted /data (which must be writable by uid 1000)
USER node
EXPOSE 3001

# Applies pending migrations, then starts the server (exec, so signals from `docker stop` reach node). Seeders are development data and are not run
CMD ["sh", "-c", "npm run db:migrate && exec node --import tsx src/index.ts"]
