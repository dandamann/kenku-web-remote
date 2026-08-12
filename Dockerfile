FROM node:20-alpine

WORKDIR /app

# Install production deps first so this layer caches across code changes.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

CMD ["node", "server.js"]
