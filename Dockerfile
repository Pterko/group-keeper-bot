FROM node:20-bookworm AS build

WORKDIR /usr/src/app/new-bot

COPY new-bot/package.json new-bot/package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --no-audit --no-fund

COPY new-bot/tsconfig.json ./
COPY new-bot/src ./src
RUN npm run build && npm test && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

RUN curl -fL --retry 5 --retry-all-errors \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

FROM node:20-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
      libjpeg62-turbo libgif7 librsvg2-2 && \
    rm -rf /var/lib/apt/lists/*

ENV YTDLP_PATH=/usr/local/bin/yt-dlp

WORKDIR /usr/src/app/new-bot

COPY --from=build /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=build /usr/src/app/new-bot/node_modules ./node_modules
COPY --from=build /usr/src/app/new-bot/build ./build
COPY new-bot/package.json ./
COPY new-bot/locales ./locales
COPY haarcascade_frontalcatface_extended.xml ../haarcascade_frontalcatface_extended.xml

# Catch missing native libraries and runtime tools during the image build.
RUN node -e "const { createCanvas } = require('canvas'); if (createCanvas(1, 1).width !== 1) process.exit(1)" && \
    node --input-type=module -e "const { i18n } = await import('#root/bot/i18n.js'); if (!i18n.locales.includes('ru')) process.exit(1)" && \
    ffmpeg -hide_banner -version >/dev/null && \
    ffprobe -hide_banner -version >/dev/null && \
    yt-dlp --version >/dev/null && \
    test -s locales/ru.ftl && \
    test -s ../haarcascade_frontalcatface_extended.xml

EXPOSE 3000

CMD ["node", "-r", "dotenv/config", "-r", "newrelic", "build/src/main.js"]
