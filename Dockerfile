# --- Compilación ---------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Imagen final --------------------------------------------------------
FROM node:24-slim
WORKDIR /app

ENV NODE_ENV=production \
    TZ=UTC \
    PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# El proceso no necesita privilegios de administrador
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
