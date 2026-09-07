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
RUN pnpm install --frozen-lockfile --ignore-scripts

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
