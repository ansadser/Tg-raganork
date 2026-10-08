#!/bin/sh
# Needs env: BOT_TOKEN, OWNER_ID, TELEGRAM_API_ID, TELEGRAM_API_HASH
if [ -z "$TELEGRAM_API_ID" ] || [ -z "$TELEGRAM_API_HASH" ]; then
  echo "TELEGRAM_API_ID / TELEGRAM_API_HASH missing"; exit 1
fi
mkdir -p /data/tgapi /data/tgapi-tmp /data/bot

telegram-bot-api --local --http-port=8081 --http-ip-address=127.0.0.1 \
  --api-id="$TELEGRAM_API_ID" --api-hash="$TELEGRAM_API_HASH" \
  --dir=/data/tgapi --temp-dir=/data/tgapi-tmp &
API_PID=$!

# wait for the API server port
i=0; until nc -z 127.0.0.1 8081 2>/dev/null; do
  i=$((i+1)); [ $i -gt 30 ] && echo "bot api server did not start" && exit 1; sleep 1
done

trap 'kill $API_PID 2>/dev/null' EXIT
exec node index.js
