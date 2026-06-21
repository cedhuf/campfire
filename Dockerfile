# --- build stage ---
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# --- runtime stage ---
FROM oven/bun:1-slim AS runtime
# tzdata is missing from the slim image — without it, Intl.DateTimeFormat
# can't resolve IANA timezone names (e.g. Europe/Paris) and falls back to
# UTC, causing the day/night cycle to display the wrong time.
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Europe/Paris
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["bun", "server/index.ts"]
