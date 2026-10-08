// Telegram engine: wraps Telegraf and exposes the Raganork "message" API to plugins.
const fs = require("fs");
const path = require("path");
const { Telegraf } = require("telegraf");
const config = require("../config");
const db = require("./db");
const { commands } = require("../main");
const { tmp, rm, toFile, ffmpeg } = require("./helpers");

const bot = new Telegraf(config.BOT_TOKEN || "0:invalid", {
  handlerTimeout: 30 * 60 * 1000,
  telegram: config.BOT_API_ROOT ? { apiRoot: config.BOT_API_ROOT } : {},
});

// text we sent (with our markdown) so "reply to bot message" plugins can read it back
const sentText = new Map();
const remember = (chat, id, text) => {
  sentText.set(`${chat}:${id}`, text);
  if (sentText.size > 3000) sentText.delete(sentText.keys().next().value);
};

// ---------- sending helpers ----------
const chunks = (s, n = 4000) => { const o = []; for (let i = 0; i < s.length; i += n) o.push(s.slice(i, i + n)); return o.length ? o : [""]; };
const isFmtErr = (e) => /can't parse entities|can't find end/i.test(e?.description || e?.message || "");

async function withFallback(fn, extra) {
  try { return await fn({ ...extra, parse_mode: extra.parse_mode ?? "Markdown" }); }
  catch (e) { if (!isFmtErr(e)) throw e; const { parse_mode, ...rest } = extra; return await fn(rest); }
}

// content -> telegraf input (+ cleanup list)
async function prepare(content, filename) {
  const cleanup = [];
  if (Buffer.isBuffer(content)) return { input: { source: content, filename }, cleanup };
  if (typeof content === "string" && !/^https?:\/\//i.test(content))
    return { input: { source: fs.createReadStream(content), filename: filename || path.basename(content) }, cleanup };
  const url = typeof content === "string" ? content : content?.url;
  if (url) {
    const f = await toFile(url, filename || "download");
    cleanup.push(f);
    return { input: { source: fs.createReadStream(f), filename: filename || path.basename(f) }, cleanup };
  }
  if (content?.stream) return { input: { source: content.stream, filename }, cleanup };
  if (content?.source) return { input: content, cleanup };
  throw new Error("Unsupported media content");
}

// file_id of whatever media a telegram message carries
function mediaOf(m) {
  if (!m) return null;
  if (m.photo?.length) return { kind: "image", id: m.photo[m.photo.length - 1].file_id, ext: "jpg" };
  if (m.video) return { kind: "video", id: m.video.file_id, ext: "mp4" };
  if (m.video_note) return { kind: "video", id: m.video_note.file_id, ext: "mp4" };
  if (m.animation) return { kind: "video", id: m.animation.file_id, ext: "mp4" };
  if (m.voice) return { kind: "audio", id: m.voice.file_id, ext: "ogg" };
  if (m.audio) return { kind: "audio", id: m.audio.file_id, ext: (m.audio.file_name || "a.mp3").split(".").pop() };
  if (m.sticker) return { kind: "sticker", id: m.sticker.file_id, ext: m.sticker.is_video ? "webm" : m.sticker.is_animated ? "tgs" : "webp" };
  if (m.document) return { kind: "document", id: m.document.file_id, ext: (m.document.file_name || "f.bin").split(".").pop() };
  return null;
}

async function downloadMedia(telegram, m, type = "file") {
  const media = mediaOf(m);
  if (!media) throw new Error("No media in this message");
  // local Bot API (--local) returns an absolute disk path as file_path
  const info = await telegram.getFile(media.id);
  const url = info.file_path?.startsWith("/") ? info.file_path : String(await telegram.getFileLink(media.id));
  if (/^https?:/.test(url)) {
    const file = await toFile(url, `media.${media.ext}`);
    if (type === "buffer") { const b = fs.readFileSync(file); rm(file); return b; }
    return file;
  }
  // local Bot API server returns an absolute path on disk
  const file = tmp(`media.${media.ext}`);
  fs.copyFileSync(url.replace(/^file:\/\//, ""), file);
  if (type === "buffer") { const b = fs.readFileSync(file); rm(file); return b; }
  return file;
}

// ---------- the Message shim ----------
class Message {
  constructor(ctx, msg) {
    this.ctx = ctx;
    this.telegram = ctx.telegram;
    this.data = msg;
    this.id = msg.message_id;
    this.chat = msg.chat;
    this.jid = String(msg.chat.id);
    this.chatId = msg.chat.id;
    this.isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    this.sender = msg.from ? String(msg.from.id) : String(msg.chat.id);
    this.pushName = msg.from?.first_name || msg.sender_chat?.title || "";
    this.username = msg.from?.username;
    this.text = msg.text || msg.caption || "";
    this.message = this.text;
    this.fromMe = config.OWNER_IDS.includes(this.sender);
    this.entities = msg.entities || msg.caption_entities || [];
    this.hasMedia = !!mediaOf(msg);
    this.mediaKind = mediaOf(msg)?.kind;
    this.client = new Client(this);
    this.quoted = msg.reply_to_message || false;
    this.reply_message = this._buildReply(msg.reply_to_message);
    // users mentioned via text_mention, plus the replied-to user
    this.mention = this.entities.filter((e) => e.type === "text_mention").map((e) => String(e.user.id));
  }

  _buildReply(r) {
    if (!r || (r.forum_topic_created && !r.text)) return false;
    const fromBot = r.from?.id === bot.botInfo?.id;
    const original = fromBot ? sentText.get(`${r.chat.id}:${r.message_id}`) : undefined;
    const text = original ?? (r.text || r.caption || "");
    const media = mediaOf(r);
    return {
      id: r.message_id,
      key: { id: r.message_id, remoteJid: this.jid },
      data: r,
      sender: String(r.from?.id ?? ""),
      pushName: r.from?.first_name,
      fromMe: fromBot,
      text, message: text,
      image: media?.kind === "image", video: media?.kind === "video",
      audio: media?.kind === "audio", sticker: media?.kind === "sticker",
      document: media?.kind === "document", hasMedia: !!media,
      download: (type = "file") => downloadMedia(this.telegram, r, type),
    };
  }

  // ----- sending -----
  async sendMessage(content, type = "text", options = {}) {
    const { quoted, caption, mimetype, fileName, ptt, thumbnail, mentions, contextInfo, ...rest } = options;
    const extra = {};
    const replyTo = quoted?.message_id || (typeof quoted === "number" ? quoted : undefined);
    if (replyTo) extra.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
    if (this.data.message_thread_id && this.isGroup && this.data.is_topic_message) extra.message_thread_id = this.data.message_thread_id;
    if (rest.parse_mode) extra.parse_mode = rest.parse_mode;
    if (rest.reply_markup) extra.reply_markup = rest.reply_markup;
    const tg = this.telegram, chat = this.chatId;
    const done = (res, kind, text) => {
      const msg = Array.isArray(res) ? res[0] : res;
      remember(chat, msg.message_id, text ?? "");
      return { ...msg, id: msg.message_id, key: { id: msg.message_id, remoteJid: this.jid, kind } };
    };

    if (type === "text") {
      const parts = chunks(String(content));
      let last;
      for (let i = 0; i < parts.length; i++) {
        const e = i === 0 ? extra : { ...extra, reply_parameters: undefined };
        last = await withFallback((x) => tg.sendMessage(chat, parts[i], x), e);
        remember(chat, last.message_id, parts[i]);
      }
      return { ...last, id: last.message_id, key: { id: last.message_id, remoteJid: this.jid, kind: "text" } };
    }

    const cap = caption ? String(caption).slice(0, 1024) : undefined;
    const { input, cleanup } = await prepare(content, fileName);
    try {
      const ex = { ...extra, ...(cap ? { caption: cap } : {}) };
      const send = (fn) => withFallback(fn, ex);
      let res;
      if (type === "image") res = await send((x) => tg.sendPhoto(chat, input, x));
      else if (type === "video") res = await send((x) => tg.sendVideo(chat, input, { ...x, supports_streaming: true }));
      else if (type === "gif" || type === "animation") res = await send((x) => tg.sendAnimation(chat, input, x));
      else if (type === "sticker") res = await tg.sendSticker(chat, input, extra);
      else if (type === "audio" && ptt) {
        const src = tmp("in.bin"), out = tmp("voice.ogg");
        const buf = input.source.pipe ? await streamToBuffer(input.source) : input.source;
        fs.writeFileSync(src, buf);
        try { await ffmpeg(["-i", src, "-c:a", "libopus", "-b:a", "48k", "-vn", out]); } finally { rm(src); }
        cleanup.push(out);
        res = await send((x) => tg.sendVoice(chat, { source: fs.createReadStream(out) }, x));
      } else if (type === "audio")
        res = await send((x) => tg.sendAudio(chat, input, { ...x, title: rest.title, performer: rest.performer }));
      else res = await send((x) => tg.sendDocument(chat, input, x)); // "document" and anything else
      return done(res, "caption", cap);
    } finally { rm(...cleanup); }
  }
  send(content, type = "text", options = {}) { return this.sendMessage(content, type, options); }
  sendReply(content, type = "text", options = {}) {
    return this.sendMessage(content, type, { ...options, quoted: options.quoted || this.data });
  }
  async edit(text = "", _jid = this.jid, key) {
    if (!key) return;
    const id = key.id ?? key.message_id ?? key;
    const chat = Number(_jid);
    try {
      if (key.kind === "caption")
        return await withFallback((x) => this.telegram.editMessageCaption(chat, id, undefined, text, x), {});
      const res = await withFallback((x) => this.telegram.editMessageText(chat, id, undefined, text, x), {});
      remember(chat, id, text);
      return res;
    } catch (e) { if (/not modified/i.test(e.description || "")) return; throw e; }
  }
  async react(emoji) {
    try { await this.telegram.setMessageReaction(this.chatId, this.id, [{ type: "emoji", emoji }]); } catch {}
  }
  async delete(id = this.id) { try { await this.telegram.deleteMessage(this.chatId, id); return true; } catch { return false; } }
  download(type = "file") { return downloadMedia(this.telegram, this.data, type); }
  typing(action = "typing") { return this.telegram.sendChatAction(this.chatId, action).catch(() => {}); }

  // ----- group helpers -----
  async isAdmin(userId = this.sender) {
    if (!this.isGroup) return false;
    const key = `${this.jid}:${userId}`;
    const hit = adminCache.get(key);
    if (hit && Date.now() - hit.t < 30000) return hit.v;
    let v = false;
    try { const m = await this.telegram.getChatMember(this.chatId, Number(userId)); v = ["creator", "administrator"].includes(m.status); } catch {}
    adminCache.set(key, { v, t: Date.now() });
    return v;
  }
  async isBotAdmin() {
    try { const m = await this.telegram.getChatMember(this.chatId, bot.botInfo.id); return m.status === "administrator"; } catch { return false; }
  }
  // user id from: reply, text_mention, numeric id or @username seen in this chat
  resolveTarget(arg = "") {
    if (this.reply_message?.sender) return this.reply_message.sender;
    if (this.mention[0]) return this.mention[0];
    const id = arg.match(/\b\d{5,}\b/)?.[0];
    if (id) return id;
    const un = arg.match(/@(\w{4,})/)?.[1]?.toLowerCase();
    if (un) return db.get("usernames", un);
    return null;
  }
}
const adminCache = new Map();
const streamToBuffer = async (s) => { const c = []; for await (const d of s) c.push(d); return Buffer.concat(c); };

// what plugins reach through message.client
class Client {
  constructor(m) { this.m = m; }
  async albumMessage(_jid, items, _quoted) {
    const media = items.slice(0, 10).map((it, i) => ({
      type: it.image ? "photo" : "video",
      media: it.image || it.video,
      caption: i === 0 ? it.caption : undefined,
    }));
    return this.m.telegram.sendMediaGroup(this.m.chatId, media.map((x) => ({ ...x, media: typeof x.media === "string" ? x.media : { source: x.media } })));
  }
}

// ---------- dispatch ----------
function track(m) {
  if (!m.isGroup || !m.data.from || m.data.from.is_bot) return;
  const k = m.jid;
  const seen = db.get("seen", k, {});
  const u = m.data.from;
  if (!seen[u.id] || seen[u.id].n !== u.first_name) { seen[u.id] = { n: u.first_name, u: u.username }; db.set("seen", k, seen); }
  if (u.username) db.set("usernames", u.username.toLowerCase(), String(u.id));
}

async function run(cmd, m, match) {
  try { await cmd.function(m, match); }
  catch (e) { console.error(`[plugin error] ${cmd.pattern || cmd.on}:`, e?.message || e); }
}

async function dispatch(ctx) {
  const msg = ctx.message;
  if (!msg) return;
  const m = new Message(ctx, msg);
  track(m);

  // service messages -> "group-update"
  if (msg.new_chat_members || msg.left_chat_member) {
    m.update = msg.new_chat_members
      ? { action: "add", users: msg.new_chat_members.filter((u) => !u.is_bot || u.id === bot.botInfo.id) }
      : { action: "remove", users: [msg.left_chat_member] };
    for (const c of commands) if (c.on === "group-update") await run(c, m, null);
    return;
  }

  const cmdText = m.text.replace(/^([.\/]\w+)@\w+/, "$1");
  const isText = !!(msg.text || msg.caption);
  for (const c of commands) {
    if (c.fromMe && !m.fromMe) continue;
    let match = null;
    if (c.on === "message") { /* always */ }
    else if (c.on === "text") { if (!isText) continue; if (c.pattern && !(match = cmdText.match(c.pattern))) continue; }
    else if (c.on === "image" || c.on === "photo") { if (!msg.photo) continue; if (c.pattern && !(match = cmdText.match(c.pattern))) continue; }
    else if (c.on === "group-update" || c.on === "start") continue;
    else if (c.pattern) { if (!isText || !(match = cmdText.match(c.pattern))) continue; }
    else continue;
    run(c, m, match);
  }
}

bot.on("message", (ctx) => { dispatch(ctx).catch((e) => console.error("dispatch:", e)); });

async function start() {
  if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN missing (see .env.example)");
  if (!config.OWNER_IDS.length) console.warn("! OWNER_ID not set: owner-only commands will not work");
  const me = await bot.telegram.getMe();
  bot.botInfo = me;
  // command menu (only simple word patterns that have a description)
  const menu = commands
    .filter((c) => c.pattern && c.desc)
    .map((c) => ({ command: (c.pattern.source.match(/\)([a-z0-9_]+)/i) || c.pattern.source.match(/^\^?\(\?:[^)]*\)([a-z0-9_]+)/i) || [])[1], description: c.desc.slice(0, 200) }))
    .filter((c) => c.command && c.command.length <= 32)
    .filter((c, i, a) => a.findIndex((x) => x.command === c.command) === i)
    .slice(0, 100);
  await bot.telegram.setMyCommands(menu).catch(() => {});
  bot.launch({ allowedUpdates: ["message", "edited_message", "callback_query", "chat_member", "my_chat_member"] });
  console.log(`@${me.username} started, ${commands.length} handlers loaded`);
}
process.once("SIGINT", () => { db.flush(); bot.stop("SIGINT"); });
process.once("SIGTERM", () => { db.flush(); bot.stop("SIGTERM"); });

module.exports = { bot, start, Message, dispatch };
