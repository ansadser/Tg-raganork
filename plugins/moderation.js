// warn, antilink, antiword, filters, afk, welcome/goodbye  (per-group settings in data/db.json)
const { Module } = require("../main");
const config = require("../config");
const db = require("../core/db");
const { escHtml } = require("../core/helpers");

const cfg = (jid) => db.get("chat", jid, {});
const setCfg = (jid, patch) => db.set("chat", jid, { ...cfg(jid), ...patch });
const html = { parse_mode: "HTML" };
const mention = (u) => `<a href="tg://user?id=${u.id}">${escHtml(u.first_name || u.id)}</a>`;

async function adminOnly(m) {
  if (!m.isGroup) { await m.sendReply("_Groups only_"); return false; }
  if (m.fromMe || (await m.isAdmin())) return true;
  await m.sendReply("_Only group admins can use this_");
  return false;
}
const onOff = (s) => ({ on: true, off: false })[(s || "").trim().toLowerCase()];

// ---------------- warns ----------------
Module({ pattern: "warn ?(.*)", fromMe: false, desc: "Warn a user (kicked at the limit)", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const id = m.resolveTarget(match[1]);
  if (!id) return m.sendReply("_Reply to a user_");
  if (await m.isAdmin(id)) return m.sendReply("_Can't warn an admin_");
  const key = `${m.jid}:${id}`;
  const list = [...db.get("warns", key, []), match[1].replace(/@\w+|\d{6,}/g, "").trim() || "No reason"];
  const limit = cfg(m.jid).warnLimit || config.WARN_LIMIT;
  if (list.length >= limit) {
    db.del("warns", key);
    try { await m.telegram.banChatMember(m.chatId, Number(id)); await m.telegram.unbanChatMember(m.chatId, Number(id)); }
    catch { return m.sendReply("_Limit reached but I couldn't remove the user (am I admin?)_"); }
    return m.sendReply(`_Warn limit reached (${limit}). User removed_ 🚫`);
  }
  db.set("warns", key, list);
  await m.sendReply(`⚠️ _Warning ${list.length}/${limit}_\n_Reason: ${list[list.length - 1]}_`);
});
Module({ pattern: "(?:warns|warnlist) ?(.*)", fromMe: false, desc: "Show warnings of a user", use: "group" }, async (m, match) => {
  if (!m.isGroup) return;
  const id = m.resolveTarget(match[1]) || m.sender;
  const l = db.get("warns", `${m.jid}:${id}`, []);
  await m.sendReply(l.length ? `*Warnings (${l.length}/${cfg(m.jid).warnLimit || config.WARN_LIMIT})*\n` + l.map((r, i) => `${i + 1}. ${r}`).join("\n") : "_No warnings_");
});
Module({ pattern: "resetwarn ?(.*)", fromMe: false, desc: "Clear warnings of a user", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const id = m.resolveTarget(match[1]);
  if (!id) return m.sendReply("_Reply to a user_");
  db.del("warns", `${m.jid}:${id}`); await m.sendReply("_Warnings cleared_ ✅");
});
Module({ pattern: "warnlimit ?(\\d*)", fromMe: false, desc: "Set warn limit for this group", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const n = parseInt(match[1]);
  if (!n) return m.sendReply(`_Current limit: ${cfg(m.jid).warnLimit || config.WARN_LIMIT}. Use .warnlimit 5_`);
  setCfg(m.jid, { warnLimit: n }); await m.sendReply(`_Warn limit set to ${n}_`);
});

// ---------------- antilink / antiword ----------------
Module({ pattern: "antilink ?(.*)", fromMe: false, desc: "Delete links from non-admins: .antilink on/off", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const v = onOff(match[1]);
  if (v === undefined) return m.sendReply(`_Antilink is ${cfg(m.jid).antilink ? "on" : "off"}. Use .antilink on/off_`);
  setCfg(m.jid, { antilink: v }); await m.sendReply(`_Antilink ${v ? "enabled" : "disabled"}_`);
});
Module({ pattern: "antiword ?(.*)", fromMe: false, desc: "Delete messages with words: .antiword add bad / del bad / list", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const [op, ...rest] = (match[1] || "").trim().split(/\s+/);
  const w = rest.join(" ").toLowerCase();
  const words = cfg(m.jid).antiwords || [];
  if (op === "add" && w) { setCfg(m.jid, { antiwords: [...new Set([...words, w])] }); return m.sendReply(`_Added:_ ${w}`); }
  if (op === "del" && w) { setCfg(m.jid, { antiwords: words.filter((x) => x !== w) }); return m.sendReply(`_Removed:_ ${w}`); }
  await m.sendReply(words.length ? "*Blocked words*\n" + words.map((x) => `• ${x}`).join("\n") : "_Usage:_ `.antiword add word` | `.antiword del word`");
});

Module({ on: "message", fromMe: false }, async (m) => {
  if (!m.isGroup || m.fromMe || !m.text) return;
  const c = cfg(m.jid);
  const bad = (c.antilink && /(https?:\/\/|t\.me\/|www\.)\S+/i.test(m.text)) ||
    (c.antiwords || []).some((w) => m.text.toLowerCase().includes(w));
  if (!bad || (await m.isAdmin())) return;
  if (!(await m.isBotAdmin())) return;
  await m.delete();
  const n = await m.telegram.sendMessage(m.chatId, `⚠️ ${mention(m.data.from)}, that is not allowed here.`, html);
  setTimeout(() => m.delete(n.message_id), 5000);
});

// ---------------- filters ----------------
Module({ pattern: "filter ?(.*)", fromMe: false, desc: "Auto-reply: .filter word reply text (or reply to a message)", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const [word, ...rest] = (match[1] || "").trim().split(/\s+/);
  const reply = rest.join(" ") || m.reply_message?.text;
  if (!word || !reply) return m.sendReply("_Usage:_ `.filter hello Hi there!` _or reply to a message:_ `.filter hello`");
  const f = db.get("filters", m.jid, {}); f[word.toLowerCase()] = reply; db.set("filters", m.jid, f);
  await m.sendReply(`_Filter saved:_ ${word}`);
});
Module({ pattern: "stop ?(.*)", fromMe: false, desc: "Remove a filter", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const f = db.get("filters", m.jid, {}); const w = (match[1] || "").trim().toLowerCase();
  if (!f[w]) return m.sendReply("_No such filter_");
  delete f[w]; db.set("filters", m.jid, f); await m.sendReply("_Filter removed_");
});
Module({ pattern: "filters$", fromMe: false, desc: "List filters", use: "group" }, async (m) => {
  const f = Object.keys(db.get("filters", m.jid, {}));
  await m.sendReply(f.length ? "*Filters*\n" + f.map((x) => `• ${x}`).join("\n") : "_No filters_");
});
Module({ on: "text", fromMe: false }, async (m) => {
  if (m.data.from?.is_bot || /^[./]/.test(m.text)) return;
  const f = db.get("filters", m.jid, {}); const t = m.text.toLowerCase();
  for (const [w, r] of Object.entries(f)) if (new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`, "i").test(t)) return m.sendReply(r);
});

// ---------------- afk ----------------
Module({ pattern: "afk ?(.*)", fromMe: false, desc: "Set yourself AFK", use: "utility" }, async (m, match) => {
  db.set("afk", m.sender, { reason: match[1] || "AFK", at: Date.now(), name: m.pushName });
  await m.sendReply(`_${m.pushName} is now AFK:_ ${match[1] || "AFK"}`);
});
Module({ on: "message", fromMe: false }, async (m) => {
  if (!m.isGroup || /^[./]afk\b/i.test(m.text)) return;
  const mine = db.get("afk", m.sender);
  if (mine) { db.del("afk", m.sender); await m.sendReply(`_Welcome back ${m.pushName}!_ 👋`); }
  const ids = new Set([...(m.mention), m.reply_message?.sender].filter(Boolean));
  for (const e of m.entities) if (e.type === "mention") { const id = db.get("usernames", m.text.substr(e.offset + 1, e.length - 1).toLowerCase()); if (id) ids.add(id); }
  for (const id of ids) {
    const a = db.get("afk", id);
    if (a) await m.sendReply(`_${a.name} is AFK (${Math.round((Date.now() - a.at) / 60000)} min ago):_ ${a.reason}`);
  }
});

// ---------------- welcome / goodbye ----------------
const fill = (t, m, u) => t.replace(/{user}/g, mention(u)).replace(/{name}/g, escHtml(u.first_name || "")).replace(/{group}/g, escHtml(m.chat.title || "")).replace(/{id}/g, u.id);
Module({ pattern: "welcome ?(.*)", fromMe: false, desc: "Welcome: .welcome on/off or .welcome <text> ({user} {group})", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const v = onOff(match[1]);
  if (v !== undefined) { setCfg(m.jid, { welcome: v }); return m.sendReply(`_Welcome ${v ? "enabled" : "disabled"}_`); }
  if (match[1]) { setCfg(m.jid, { welcome: true, welcomeText: match[1] }); return m.sendReply("_Welcome message saved & enabled_"); }
  await m.sendReply(`_Welcome is ${cfg(m.jid).welcome ? "on" : "off"}. Text:_ ${cfg(m.jid).welcomeText || "(default)"}\n_Placeholders:_ {user} {name} {group}`);
});
Module({ pattern: "goodbye ?(.*)", fromMe: false, desc: "Goodbye: .goodbye on/off or .goodbye <text>", use: "group" }, async (m, match) => {
  if (!(await adminOnly(m))) return;
  const v = onOff(match[1]);
  if (v !== undefined) { setCfg(m.jid, { goodbye: v }); return m.sendReply(`_Goodbye ${v ? "enabled" : "disabled"}_`); }
  if (match[1]) { setCfg(m.jid, { goodbye: true, goodbyeText: match[1] }); return m.sendReply("_Goodbye message saved & enabled_"); }
  await m.sendReply(`_Goodbye is ${cfg(m.jid).goodbye ? "on" : "off"}. Use .goodbye on/off or .goodbye <text>_`);
});
Module({ on: "group-update", fromMe: false }, async (m) => {
  const c = cfg(m.jid);
  for (const u of m.update.users) {
    if (m.update.action === "add" && c.welcome)
      await m.sendMessage(fill(c.welcomeText || "Welcome {user} to <b>{group}</b>! 🎉", m, u), "text", html);
    if (m.update.action === "remove" && c.goodbye)
      await m.sendMessage(fill(c.goodbyeText || "Goodbye {name} 👋", m, u), "text", html);
  }
});
