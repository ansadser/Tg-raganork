const { Module } = require("../main");
const config = require("../config");
const { commands } = require("../main");

Module({ pattern: "start$", fromMe: false }, async (m) => {
  await m.sendMessage("*Raganork Telegram* 🤖\n_Send_ `/menu` _to see the commands._");
});
Module({ pattern: "ping$", fromMe: false, desc: "Check bot speed" }, async (m) => {
  const t = Date.now(); const r = await m.sendReply("_Pong..._");
  await m.edit(`_Pong!_ \`${Date.now() - t}ms\``, m.jid, r.key);
});
Module({ pattern: "alive$", fromMe: false, desc: "Is the bot alive?" }, async (m) => {
  const s = process.uptime(), h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60);
  await m.sendReply(`_I'm alive!_ ✅\n_Uptime:_ ${h}h ${mi}m\n_Mode:_ ${config.MODE}`);
});
Module({ pattern: "(?:menu|help)$", fromMe: false, desc: "List commands" }, async (m) => {
  const groups = {};
  for (const c of commands) {
    if (!c.pattern || !c.desc) continue;
    const name = c.pattern.source.replace(/^\^\(\?:[^)]*\)/, "").replace(/ \?\(.*$/, "").replace(/\$$/, "").replace(/^\(\?:/, "").replace(/\)$/, "");
    (groups[c.use || "other"] ||= []).push(`• \`${name}\` — ${c.desc}`);
  }
  let out = "*Commands* (prefix `/` or `.`)\n";
  for (const [g, l] of Object.entries(groups)) out += `\n*${g.toUpperCase()}*\n${l.join("\n")}\n`;
  await m.sendMessage(out);
});
Module({ pattern: "restart$", fromMe: true, desc: "Restart the bot (needs pm2/docker restart policy)" }, async (m) => {
  await m.sendReply("_Restarting..._"); setTimeout(() => process.exit(0), 500);
});
