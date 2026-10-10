FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep bash ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /redcode
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts --filter @opencode/server
RUN bun run --cwd packages/core fix-node-pty
RUN mkdir -p /lab && chown bun:bun /lab
ENV HOME=/lab/home XDG_DATA_HOME=/lab/data XDG_CONFIG_HOME=/lab/config XDG_CACHE_HOME=/lab/cache
USER bun
EXPOSE 4096
ENTRYPOINT ["bun", "run", "packages/server/test/docker-workers/worker.ts"]
