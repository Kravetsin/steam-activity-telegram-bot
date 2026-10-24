FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Alpine ships without timezone data, so TZ=Europe/Kyiv would silently fall back to
# UTC and the daily extraction would run at the wrong hour.
RUN apk add --no-cache tzdata

# Dependencies first: this layer is cached until package.json / lockfile change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

# The bot only talks to Postgres, so it doesn't need to run as root.
USER node

CMD ["node", "src/index.js"]
