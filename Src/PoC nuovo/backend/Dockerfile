FROM node:20

WORKDIR /app

RUN npm install -g pnpm@9

# Imposta pnpm per fare l'hoisting delle dipendenze 
RUN echo "node-linker=hoisted" > .npmrc

# Copia i file fondamentali del monorepo dalla root
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copia i package.json per non far fallire la validazione del workspace
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# Installa le dipendenze in modo riproducibile filtrando solo per il backend
RUN pnpm install --filter backend... --frozen-lockfile --ignore-scripts

# Copia il sorgente del backend
COPY backend/ ./backend/

WORKDIR /app/backend

EXPOSE 3000

CMD ["pnpm", "run", "start:dev"]