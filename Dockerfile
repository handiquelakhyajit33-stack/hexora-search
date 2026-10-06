FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p dist

RUN npx vite build

RUN npx esbuild server.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --packages=external \
  --sourcemap \
  --outfile=dist/server.cjs

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
