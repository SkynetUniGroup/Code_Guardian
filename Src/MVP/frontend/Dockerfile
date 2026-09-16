# ---- Stage 1: Build ----
FROM node:26 AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace configuration and package manifests
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/

# Install all workspace dependencies (including shared)
# No --ignore-scripts: pnpm-workspace.yaml explicitly lists in
# `allowBuilds` the packages that MUST be allowed to run their install
# script (argon2 downloads the prebuilt binary there, esbuild likewise).
# Skipping them, the image built without errors and then failed at
# runtime on the first require.
RUN pnpm install --frozen-lockfile

# Copy source files
COPY shared/ ./shared/
COPY frontend/ ./frontend/

# Build the shared package first (required by frontend)
RUN cd shared && pnpm run build

# Build frontend for production
WORKDIR /app/frontend
RUN pnpm run build

# ---- Stage 2: Serve ----
FROM nginx:1.31-alpine AS runtime

# SPA routing configuration
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from the builder stage
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
