FROM node:20

WORKDIR /app

RUN npm install -g pnpm@9


COPY package.json ./


RUN echo "node-linker=hoisted" > .npmrc


RUN pnpm install --ignore-scripts


COPY . .

EXPOSE 3000


CMD ["pnpm", "run", "start:dev"]