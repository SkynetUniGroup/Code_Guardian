FROM node:26

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace configuration and package manifests
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install all workspace dependencies (including shared)
# Niente --ignore-scripts: pnpm-workspace.yaml elenca esplicitamente in
# `allowBuilds` i pacchetti che DEVONO poter eseguire il proprio script di
# install (argon2 scarica il binario precompilato la', esbuild idem).
# Saltandoli, l'immagine si costruiva senza errori e poi falliva a runtime
# al primo require.
RUN pnpm install --frozen-lockfile

# Copy source files
COPY shared/ ./shared/
COPY backend/ ./backend/

# Build the shared package first (required by backend)
RUN cd shared && pnpm run build

# Build backend for production
RUN cd backend && pnpm run build

EXPOSE 3000

# Start in development mode with hot-reload
CMD ["pnpm", "--filter", "backend", "run", "start:dev"]
