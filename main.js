// Raganork-compatible Module() registry (same API as the WhatsApp version)
const config = require("./config");
const Commands = [];
const esc = (s) => String(s).replace(/[\\^$.*+?()[\]{}|\/]/g, "\\$&");
const raw = config.HANDLERS;
const prefix =
  raw === "false" || raw === "" || raw === "^"
    ? "^"
    : `^(?:${Array.from(String(raw)).map(esc).join("|")})`;

function Module(info, func) {
  const valid = ["photo", "image", "text", "group-update", "message", "start"];
  const cmd = {
    fromMe: info.fromMe ?? config.isPrivate,
    desc: info.desc ?? "",
    usage: info.usage ?? "",
    use: info.use ?? "",
    function: func,
  };
  if (info.on === undefined && info.pattern === undefined) {
    cmd.on = "message";
    cmd.fromMe = false;
  } else {
    if (info.on !== undefined) {
      if (!valid.includes(info.on)) throw new Error(`Bad event type: ${info.on}`);
      cmd.on = info.on;
    }
    if (info.pattern !== undefined)
      cmd.pattern = new RegExp(`${(info.handler ?? true) ? prefix : ""}${info.pattern}`, "s");
  }
  Commands.push(cmd);
  return cmd;
}
module.exports = { Module, commands: Commands };
