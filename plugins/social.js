// Social downloaders via yt-dlp (must be installed: pip install -U yt-dlp)
const fs = require("fs");
const { execFile } = require("child_process");
const { Module } = require("../main");
const config = require("../config");
const { TEMP_DIR, tmp, rm } = require("../core/helpers");
const fromMe = config.isPrivate;

const IMG = /\.(jpe?g|png|webp)$/i, VID = /\.(mp4|mkv|webm|mov)$/i, AUD = /\.(mp3|m4a|opus|ogg)$/i;
const ytdlp = (url, extra = []) => new Promise((resolve, reject) => {
  const out = `${TEMP_DIR}/${Date.now()}_%(id)s.%(ext)s`;
  const args = ["--no-playlist", "--no-warnings", "-o", out, "--print", "after_move:filepath",
    "--max-filesize", `${Math.floor(config.MAX_UPLOAD / 1024 / 1024)}M`, ...extra];
  if (config.YTDLP_COOKIES) args.push("--cookies", config.YTDLP_COOKIES);
  execFile("yt-dlp", [...args, "--", url], { timeout: 300000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
    const files = stdout.split("\n").map((s) => s.trim()).filter((f) => f && fs.existsSync(f));
    if (!files.length) return reject(new Error(stderr.split("\n").filter(Boolean).pop() || err?.message || "download failed"));
    resolve(files);
  });
});
const urlOf = (m, match) => ((match[1] || "") + " " + (m.reply_message?.text || "")).match(/https?:\/\/\S+/)?.[0];

async function download(m, match, hosts, name, extra) {
  const url = urlOf(m, match);
  if (!url) return m.sendReply(`_Send a ${name} link, or reply to one_`);
  if (hosts && !hosts.test(url)) return m.sendReply(`_That doesn't look like a ${name} link_`);
  const status = await m.sendReply("_Downloading..._");
  let files = [];
  try {
    files = await ytdlp(url, extra);
    for (const f of files) {
      const size = fs.statSync(f).size;
      if (size > config.MAX_UPLOAD) { await m.sendReply(`_File is ${(size / 1048576).toFixed(0)}MB, over the upload limit_`); continue; }
      const kind = IMG.test(f) ? "image" : AUD.test(f) ? "audio" : VID.test(f) ? "video" : "document";
      await m.sendReply({ stream: fs.createReadStream(f) }, kind);
    }
    await m.delete(status.id);
  } catch (e) {
    await m.edit(`_Failed: ${e.message.slice(0, 200)}_`, m.jid, status.key);
  } finally { rm(...files); }
}

Module({ pattern: "(?:insta|ig) ?(.*)", fromMe, desc: "Instagram post/reel downloader", use: "download" }, (m, x) => download(m, x, /instagram\.com/i, "Instagram"));
Module({ pattern: "fb ?(.*)", fromMe, desc: "Facebook video downloader", use: "download" }, (m, x) => download(m, x, /(facebook\.com|fb\.watch)/i, "Facebook"));
Module({ pattern: "tiktok ?(.*)", fromMe, desc: "TikTok downloader (no watermark)", use: "download" }, (m, x) => download(m, x, /tiktok\.com/i, "TikTok"));
Module({ pattern: "(?:tw|twitter) ?(.*)", fromMe, desc: "Twitter/X video downloader", use: "download" }, (m, x) => download(m, x, /(twitter\.com|x\.com)/i, "Twitter/X"));
Module({ pattern: "pinterest ?(.*)", fromMe, desc: "Pinterest downloader", use: "download" }, (m, x) => download(m, x, /(pinterest\.|pin\.it)/i, "Pinterest"));
Module({ pattern: "dl ?(.*)", fromMe, desc: "Download from almost any site (yt-dlp)", use: "download" }, (m, x) => download(m, x, null, "video"));
Module({ pattern: "ytaudio ?(.*)", fromMe, desc: "Any link -> mp3 (yt-dlp)", use: "download" }, (m, x) => download(m, x, null, "media", ["-x", "--audio-format", "mp3"]));
