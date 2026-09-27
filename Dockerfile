# syntax=docker/dockerfile:1

# ---- build: install everything, copy the OCR/PDF runtimes into public/vendor, bundle ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm test

# ---- runtime: the server has zero npm dependencies (node:http only), and everything the
# browser needs — tesseract worker, wasm core, eng+lav models, pdf.js — is in dist/.
# So the final image carries no node_modules at all.
FROM node:22-alpine
ENV NODE_ENV=production PORT=3101 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/demo/ocr/healthz" >/dev/null || exit 1
CMD ["node", "build/server/index.js"]
