if (require("fs").existsSync(".env")) require("dotenv").config();
const list = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const MODE = (process.env.MODE || "private").toLowerCase();
module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OWNER_IDS: list(process.env.OWNER_ID).map(String),
  MODE,
  isPrivate: MODE !== "public",
  HANDLERS: process.env.HANDLERS ?? "./",
  WARN_LIMIT: parseInt(process.env.WARN_LIMIT) || 3,
  BOT_API_ROOT: process.env.BOT_API_ROOT || undefined,
  // cloud Bot API: 50MB upload / 20MB download. Local Bot API: 2GB.
  MAX_UPLOAD: process.env.BOT_API_ROOT ? 2000 * 1024 * 1024 : 50 * 1024 * 1024,
  YTDLP_COOKIES: process.env.YTDLP_COOKIES,
  DATA_DIR: process.env.DATA_DIR || require("path").join(__dirname, "data"),
};
