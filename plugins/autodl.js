// Auto-download: post a supported link in an enabled chat and the bot downloads it.
// .autodl on|off (this chat)   |   owner: .autodl groups on|off , .autodl dms on|off
const fs = require("fs");
const { Module } = require("../main");
const config = require("../config");
const db = require("../core/db");
const { rm } = require("../core/helpers");
const { ytdlp, IMG, AUD, VID } = require("./social");
const { getVideoInfo, downloadVideo, downloadAudio, convertM4aToMp3, downloadSpotifyTrack } = require("./utils/yt");

const URL_PATTERNS = {
  instagram: /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?(?:\?.*)?$/i,
  youtube: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&].*)?$/i,
  spotify: /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+(?:\?.*)?$/i,
  tiktok: /^https?:\/\/(?:www\.|vm\.|vt\.|v\.)?tiktok\.com\/\S+$/i,
  pinterest: /^https?:\/\/(?:www\.)?(?:pinterest\.com\/pin\/\d+\S*|pin\.it\/\S+)$/i,
  twitter: /^https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+\S*$/i,
  facebook: /^https?:\/\/(?:www\.|m\.)?(?:fb\.watch\/\S+|facebook\.com\/\S*(?:video|watch|reel|posts)\S*)$/i,
};
const urlsOf = (t) => (t.match(/https?:\/\/\S+/gi) || []).map((u) => u.replace(/[)\].,!?>]*$/, ""));
const platformOf = (u) => Object.keys(URL_PATTERNS).find((p) => URL_PATTERNS[p].test(u));
const fmt = (b) => (b / 1048576).toFixed(1) + " MB";

function enabled(m) {
  if (db.get("autodl", m.jid)) return true;
  if (m.isGroup && (process.env.AUTODL_ALL_GROUPS === "true" || db.get("autodl", "_groups"))) return true;
  if (!m.isGroup && (process.env.AUTODL_ALL_DMS === "true" || db.get("autodl", "_dms"))) return true;
  return false;
}

Module({ pattern: "autodl ?(.*)", fromMe: false, desc: "Auto download links in this chat: .autodl on/off", use: "download" }, async (m, match) => {
  const [a, b] = (match[1] || "").trim().toLowerCase().split(/\s+/);
  if (a === "groups" || a === "dms") {
    if (!m.fromMe) return m.sendReply("_Owner only_");
    db.set("autodl", "_" + a, b === "on");
    return m.sendReply(`_Autodl for all ${a}: ${b === "on" ? "on" : "off"}_`);
  }
  if (a === "on" || a === "off") {
    if (m.isGroup && !m.fromMe && !(await m.isAdmin())) return m.sendReply("_Only group admins can use this_");
    db.set("autodl", m.jid, a === "on");
    return m.sendReply(`_Autodl ${a === "on" ? "enabled" : "disabled"} in this chat_`);
  }
  await m.sendReply(`_Autodl is ${enabled(m) ? "on" : "off"} here._\nUse \`.autodl on\` / \`.autodl off\`\n_Owner:_ \`.autodl groups on\`, \`.autodl dms on\`\n_Tip: add the word_ audio _or_ mp3 _with a YouTube link to get mp3._`);
});

async function sendFile(m, f, caption) {
  const size = fs.statSync(f).size;
  if (size > config.MAX_UPLOAD) return m.sendReply(`_File is ${fmt(size)}, over the upload limit_`);
  const kind = IMG.test(f) ? "image" : AUD.test(f) ? "audio" : VID.test(f) ? "video" : "document";
  return m.sendReply({ stream: fs.createReadStream(f) }, kind, caption ? { caption } : {});
}

async function handle(m, platform, url, wantAudio) {
  const files = [];
  try {
    if (platform === "youtube") {
      if (wantAudio) {
        const r = await downloadAudio(url);
        const mp3 = await convertM4aToMp3(r.path, { title: r.title, artist: r.info?.channel?.name, thumbnail: r.info?.thumbnail });
        files.push(mp3);
        return await m.sendReply({ stream: fs.createReadStream(mp3) }, "audio", { title: r.title, performer: r.info?.channel?.name });
      }
      const info = await getVideoInfo(url);
      const q = info.formats.filter((f) => f.type === "video" && f.quality)
        .map((f) => ({ q: f.quality, n: parseInt(f.quality) || 0 })).filter((x) => x.n && x.n <= 720).sort((a, b) => b.n - a.n)[0];
      const r = await downloadVideo(url, q?.q);
      files.push(r.path);
      return await sendFile(m, r.path, `_*${r.title}*_`);
    }
    if (platform === "spotify") {
      const r = await downloadSpotifyTrack(url);
      files.push(r.path);
      return await m.sendReply({ stream: fs.createReadStream(r.path) }, "audio", { title: r.title, performer: r.info?.channel?.name });
    }
    const got = await ytdlp(url);
    files.push(...got);
    for (const f of got) await sendFile(m, f);
  } catch (e) {
    console.error(`[autodl ${platform}]`, e.message);
    await m.sendReply("_Auto download failed for this link_");
  } finally { rm(...files); }
}

Module({ on: "text", fromMe: false }, async (m) => {
  if (m.data.from?.is_bot || /^[./]\w/.test(m.text) || !enabled(m)) return;
  const found = [...new Set(urlsOf(m.text))].map((u) => [platformOf(u), u]).filter(([p]) => p).slice(0, 3);
  if (!found.length) return;
  await m.react("👀");
  const wantAudio = /\b(audio|mp3)\b/i.test(m.text);
  for (const [p, u] of found) await handle(m, p, u, wantAudio);
});
