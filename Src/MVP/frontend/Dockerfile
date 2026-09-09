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
# Niente --ignore-scripts: pnpm-workspace.yaml elenca esplicitamente in
# `allowBuilds` i pacchetti che DEVONO poter eseguire il proprio script di
# install (argon2 scarica il binario precompilato la', esbuild idem).
# Saltandoli, l'immagine si costruiva senza errori e poi falliva a runtime
# al primo require.
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
