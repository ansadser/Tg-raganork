// Media tools via ffmpeg. Reply to a video / audio / image / sticker.
const fs = require("fs");
const { Module } = require("../main");
const config = require("../config");
const { tmp, rm, ffmpeg } = require("../core/helpers");
const fromMe = config.isPrivate;

// download replied media, run ffmpeg, send result
async function process(m, { need, out, args, send, label }) {
  const r = m.reply_message;
  if (!r || !need.some((k) => r[k])) return m.sendReply(`_Reply to a ${need.join(" / ")}_`);
  const status = await m.sendReply(`_${label}..._`);
  const input = await r.download();
  const output = tmp(`out.${out}`);
  try {
    await ffmpeg(["-i", input, ...args, output]);
    await send(output);
    await m.edit("_Done_ ✅", m.jid, status.key);
  } catch (e) {
    console.error("ffmpeg:", e.message);
    await m.edit("_Processing failed_", m.jid, status.key);
  } finally { rm(input, output); }
}
const stream = (f) => ({ stream: fs.createReadStream(f) });

Module({ pattern: "mp3", fromMe, desc: "Video / voice -> mp3", use: "convert" }, (m) =>
  process(m, { need: ["video", "audio"], out: "mp3", label: "Converting", args: ["-vn", "-c:a", "libmp3lame", "-q:a", "2"], send: (f) => m.sendReply(stream(f), "audio") }));

Module({ pattern: "bass ?(\\d*)", fromMe, desc: "Bass boost audio (.bass 10)", use: "convert" }, (m, match) =>
  process(m, { need: ["audio", "video"], out: "mp3", label: "Boosting bass", args: ["-vn", "-af", `bass=g=${Math.min(parseInt(match[1]) || 12, 30)}`], send: (f) => m.sendReply(stream(f), "audio") }));

Module({ pattern: "slow$", fromMe, desc: "Slowed audio", use: "convert" }, (m) =>
  process(m, { need: ["audio", "video"], out: "mp3", label: "Slowing", args: ["-vn", "-af", "asetrate=44100*0.8,aresample=44100"], send: (f) => m.sendReply(stream(f), "audio") }));

Module({ pattern: "sped$", fromMe, desc: "Sped-up audio", use: "convert" }, (m) =>
  process(m, { need: ["audio", "video"], out: "mp3", label: "Speeding up", args: ["-vn", "-af", "asetrate=44100*1.25,aresample=44100"], send: (f) => m.sendReply(stream(f), "audio") }));

Module({ pattern: "voice$", fromMe, desc: "Audio -> voice note", use: "convert" }, (m) =>
  process(m, { need: ["audio", "video"], out: "ogg", label: "Converting", args: ["-vn", "-c:a", "libopus", "-b:a", "48k"], send: (f) => m.sendReply(stream(f), "audio", { ptt: true }) }));

Module({ pattern: "trim ?(.*)", fromMe, desc: "Trim video/audio: .trim 00:10 00:30", use: "convert" }, (m, match) => {
  const [s, e] = (match[1] || "").trim().split(/\s+/);
  if (!s || !e) return m.sendReply("_Usage:_ `.trim 00:10 00:30` _(reply to media)_");
  const isVid = m.reply_message?.video;
  return process(m, { need: ["video", "audio"], out: isVid ? "mp4" : "mp3", label: "Trimming", args: ["-ss", s, "-to", e, "-c", "copy"],
    send: (f) => m.sendReply(stream(f), isVid ? "video" : "audio") });
});

Module({ pattern: "gif$", fromMe, desc: "Video -> animation (no sound)", use: "convert" }, (m) =>
  process(m, { need: ["video"], out: "mp4", label: "Converting", args: ["-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"], send: (f) => m.sendReply(stream(f), "gif") }));

Module({ pattern: "compress$", fromMe, desc: "Compress video", use: "convert" }, (m) =>
  process(m, { need: ["video"], out: "mp4", label: "Compressing", args: ["-vf", "scale='min(854,iw)':-2", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k"], send: (f) => m.sendReply(stream(f), "video") }));

Module({ pattern: "slowmo$", fromMe, desc: "Slow-motion video", use: "convert" }, (m) =>
  process(m, { need: ["video"], out: "mp4", label: "Slowing video", args: ["-filter_complex", "[0:v]setpts=2*PTS[v];[0:a]atempo=0.5[a]", "-map", "[v]", "-map", "[a]"], send: (f) => m.sendReply(stream(f), "video") }));

Module({ pattern: "rotate ?(.*)", fromMe, desc: "Rotate video: .rotate left/right/180", use: "convert" }, (m, match) => {
  const vf = { left: "transpose=2", right: "transpose=1", "180": "transpose=1,transpose=1" }[(match[1] || "right").trim()];
  if (!vf) return m.sendReply("_Use:_ `.rotate left|right|180`");
  return process(m, { need: ["video"], out: "mp4", label: "Rotating", args: ["-vf", vf, "-c:a", "copy"], send: (f) => m.sendReply(stream(f), "video") });
});

Module({ pattern: "black$", fromMe, desc: "Audio -> video with black screen", use: "convert" }, async (m) => {
  const r = m.reply_message;
  if (!r?.audio) return m.sendReply("_Reply to an audio_");
  const input = await r.download(), out = tmp("black.mp4");
  try {
    await ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=480x480:r=10", "-i", input, "-shortest", "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-c:a", "aac", out]);
    await m.sendReply(stream(out), "video");
  } finally { rm(input, out); }
});

// sticker: image -> webp (static). video -> webm video sticker
Module({ pattern: "sticker$", fromMe, desc: "Image/video -> sticker", use: "convert" }, async (m) => {
  const r = m.reply_message;
  if (!r || !(r.image || r.video || (r.document))) return m.sendReply("_Reply to an image or short video_");
  const input = await r.download(), isVid = r.video;
  const out = tmp(isVid ? "s.webm" : "s.webp");
  try {
    const scale = "scale=512:512:force_original_aspect_ratio=decrease";
    if (isVid) await ffmpeg(["-i", input, "-t", "3", "-an", "-vf", `${scale},fps=30`, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "400k", out]);
    else await ffmpeg(["-i", input, "-vf", scale, out]);
    await m.sendReply(stream(out), "sticker");
  } catch (e) { await m.sendReply("_Couldn't make the sticker_"); }
  finally { rm(input, out); }
});
Module({ pattern: "img$", fromMe, desc: "Sticker -> image", use: "convert" }, async (m) => {
  const r = m.reply_message;
  if (!r?.sticker) return m.sendReply("_Reply to a (static) sticker_");
  const input = await r.download(), out = tmp("s.png");
  try { await ffmpeg(["-i", input, out]); await m.sendReply(stream(out), "image"); }
  catch { await m.sendReply("_Only static stickers can be converted_"); }
  finally { rm(input, out); }
});

// text to speech (google-tts-api): .tts ml നമസ്കാരം   |  .tts hello
Module({ pattern: "tts ?(.*)", fromMe, desc: "Text to speech: .tts ml <text>", use: "convert" }, async (m, match) => {
  let [lang, ...rest] = (match[1] || m.reply_message?.text || "").trim().split(/\s+/);
  let text = rest.join(" ");
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang || "")) { text = [lang, ...rest].join(" ").trim(); lang = "en"; }
  if (!text) return m.sendReply("_Usage:_ `.tts ml നമസ്കാരം` _or_ `.tts hello`");
  const tts = require("google-tts-api");
  const parts = await tts.getAllAudioBase64(text, { lang, slow: false, splitPunct: ",.?!" });
  const buf = Buffer.concat(parts.map((p) => Buffer.from(p.base64, "base64")));
  await m.sendReply(buf, "audio", { ptt: true });
});
