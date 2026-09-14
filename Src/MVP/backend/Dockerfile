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
# No --ignore-scripts: pnpm-workspace.yaml explicitly lists in
# `allowBuilds` the packages that MUST be allowed to run their install
# script (argon2 downloads the prebuilt binary there, esbuild likewise).
# Skipping them, the image built without errors and then failed at
# runtime on the first require.
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
