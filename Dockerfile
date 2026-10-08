# Bot + local Telegram Bot API server in one container
FROM aiogram/telegram-bot-api:latest AS api

FROM node:22-alpine
RUN apk add --no-cache ffmpeg yt-dlp libstdc++ openssl zlib
COPY --from=api /usr/local/bin/telegram-bot-api /usr/local/bin/telegram-bot-api

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV DATA_DIR=/data/bot \
    BOT_API_ROOT=http://127.0.0.1:8081
VOLUME /data
CMD ["sh", "start.sh"]
