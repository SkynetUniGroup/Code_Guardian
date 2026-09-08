# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack so pnpm is available without a global install
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency manifests first to leverage layer cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (dev deps needed for the build step)
RUN pnpm install --frozen-lockfile

# Copy the rest of the source
COPY . .

# VITE_API_BASE_URL defaults to /api/v1 (same-origin relative path).
# Override at build time with: docker build --build-arg VITE_API_BASE_URL=/custom/path
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm run build

# ---- Stage 2: Serve ----
FROM nginx:1.27-alpine AS runtime

# SPA routing configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
