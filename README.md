# Raganork-TG (Telegram port of Raganork-MD)

Telegram bot (Node 18+, Telegraf) that keeps Raganork's plugin API:
`Module({ pattern, fromMe, desc }, async (message, match) => {})`
with `message.sendReply / sendMessage / edit / reply_message / download`.

## Setup
```
npm install
cp .env.example .env     # BOT_TOKEN from @BotFather, OWNER_ID = your Telegram id
node index.js
```
Needs `ffmpeg` and `yt-dlp` in PATH (media + social downloaders).
In @BotFather: `/setprivacy` -> Disable, so the bot sees group messages (filters, antilink, afk).
Make the bot an admin in groups for ban/kick/mute/delete etc.

## Ported
youtube (song, yts, ytv, video, yta, play, spotify – original code),
fancy, group admin (ban kick unban mute unmute promote demote pin unpin del purge lock unlock tagall admins link setname setdesc info id),
warn/warns/resetwarn/warnlimit, antilink, antiword, filter/stop/filters, afk, welcome/goodbye,
media (mp3 bass slow sped voice trim gif compress slowmo rotate black sticker img tts),
social via yt-dlp (insta fb tiktok tw pinterest dl ytaudio), ping alive menu restart.

## Not ported yet
chatbot, autodl, schedule/schedulers, mention, message-stats, take/exif, pdf, manage (sudo/ban lists),
updater, external-plugin installer, multi-session/auth (not needed on Telegram).

Original core/store/handler/auth and utils/misc.js + mediaProcessors.js are obfuscated in the source zip,
so those parts were rewritten, not converted. License: GPL-3.0 (same as upstream).
