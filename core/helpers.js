const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { execFile } = require("child_process");
const TEMP_DIR = path.join(os.tmpdir(), "raganork-tg");
fs.mkdirSync(TEMP_DIR, { recursive: true });

const tmp = (name) => path.join(TEMP_DIR, `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${name}`);
const rm = (...files) => files.forEach((f) => { try { f && fs.unlinkSync(f); } catch {} });
const ffmpeg = (args) =>
  new Promise((res, rej) =>
    execFile("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 },
      (e, _o, err) => (e ? rej(new Error(err || e.message)) : res())));
async function toFile(url, name = "file") {
  const dest = tmp(name);
  const r = await axios.get(url, { responseType: "stream", timeout: 120000 });
  await new Promise((ok, no) => { const w = fs.createWriteStream(dest); r.data.pipe(w); w.on("finish", ok); w.on("error", no); });
  return dest;
}
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
module.exports = { TEMP_DIR, tmp, rm, ffmpeg, toFile, escHtml };
