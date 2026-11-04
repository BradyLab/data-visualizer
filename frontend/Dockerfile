# Production image of the website: the built frontend served by Caddy, which also terminates HTTPS (certificates from Let's Encrypt, renewed
# automatically) and routes /api, /socket.io, /shiny and /health to the backend (see Caddyfile). Build from the repository root (the code imports ../commons):
#   docker build -f frontend/Dockerfile -t data-visualizer-web .
# The build does not depend on the domain: VITE_BACKEND_URL is empty, so the app talks to the origin it was loaded from. The domain is a
# runtime setting (DOMAIN, read by the Caddyfile). Floating tags within a major version: rebuilding picks up Node and Caddy security patches.
FROM node:24-alpine AS build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci && npm cache clean --force

COPY frontend/ ./
COPY commons/ /app/commons/
# Same origin as the page; every REST call goes to /api (type-checking happens in CI)
ENV VITE_BACKEND_URL="" VITE_API_PATH=/api
RUN npm run build-only

FROM caddy:2-alpine
COPY --from=build /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443 443/udp
