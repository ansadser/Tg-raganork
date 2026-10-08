// Group administration, Telegram-native (replaces Baileys-based group.js)
const { Module } = require("../main");
const { escHtml } = require("../core/helpers");
const db = require("../core/db");

// admin gate: owner always passes; otherwise sender must be a group admin
async function gate(m, { needBot = false, perm } = {}) {
  if (!m.isGroup) { await m.sendReply("_This command works in groups only_"); return false; }
  if (!m.fromMe && !(await m.isAdmin())) { await m.sendReply("_Only group admins can use this_"); return false; }
  if (needBot && !(await m.isBotAdmin())) { await m.sendReply("_Make me an admin first (with the needed rights)_"); return false; }
  return true;
}
const target = async (m, match) => {
  const id = m.resolveTarget(match[1] || "");
  if (!id) await m.sendReply("_Reply to a user, or give @username / user id_");
  return id;
};
const mins = (s) => { const n = parseInt((s || "").match(/\d+/)?.[0]); return n > 0 ? n : 0; };
const mention = (id, name) => `<a href="tg://user?id=${id}">${escHtml(name || id)}</a>`;
const html = { parse_mode: "HTML" };

Module({ pattern: "ban ?(.*)", fromMe: false, desc: "Ban a user from the group", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  const id = await target(m, match); if (!id) return;
  if (await m.isAdmin(id)) return m.sendReply("_Can't ban an admin_");
  try { await m.telegram.banChatMember(m.chatId, Number(id)); await m.sendReply("_User banned_ ✅"); }
  catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "kick ?(.*)", fromMe: false, desc: "Remove a user (can rejoin)", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  const id = await target(m, match); if (!id) return;
  if (await m.isAdmin(id)) return m.sendReply("_Can't kick an admin_");
  try { await m.telegram.banChatMember(m.chatId, Number(id)); await m.telegram.unbanChatMember(m.chatId, Number(id)); await m.sendReply("_User removed_ ✅"); }
  catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "unban ?(.*)", fromMe: false, desc: "Unban a user", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  const id = await target(m, match); if (!id) return;
  try { await m.telegram.unbanChatMember(m.chatId, Number(id), { only_if_banned: true }); await m.sendReply("_User unbanned_ ✅"); }
  catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

const MUTED = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false };
const OPEN = Object.fromEntries(Object.keys(MUTED).map((k) => [k, true]));

Module({ pattern: "mute ?(.*)", fromMe: false, desc: "Mute a user (optional minutes: .mute 30)", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  const id = await target(m, match); if (!id) return;
  if (await m.isAdmin(id)) return m.sendReply("_Can't mute an admin_");
  const n = mins(match[1].replace(/@\w+|\d{6,}/g, ""));
  try {
    await m.telegram.restrictChatMember(m.chatId, Number(id), { permissions: MUTED, ...(n ? { until_date: Math.floor(Date.now() / 1000) + n * 60 } : {}) });
    await m.sendReply(n ? `_User muted for ${n} min_ 🔇` : "_User muted_ 🔇");
  } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "unmute ?(.*)", fromMe: false, desc: "Unmute a user", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  const id = await target(m, match); if (!id) return;
  try { await m.telegram.restrictChatMember(m.chatId, Number(id), { permissions: OPEN }); await m.sendReply("_User unmuted_ 🔊"); }
  catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "promote ?(.*)", fromMe: false, desc: "Make a user admin", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  const id = await target(m, match); if (!id) return;
  try {
    await m.telegram.promoteChatMember(m.chatId, Number(id), { can_delete_messages: true, can_restrict_members: true, can_pin_messages: true, can_invite_users: true, can_manage_chat: true });
    await m.sendReply("_User promoted_ 👑");
  } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "demote ?(.*)", fromMe: false, desc: "Remove admin rights", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  const id = await target(m, match); if (!id) return;
  try {
    await m.telegram.promoteChatMember(m.chatId, Number(id), { can_delete_messages: false, can_restrict_members: false, can_pin_messages: false, can_invite_users: false, can_manage_chat: false, can_promote_members: false, can_change_info: false });
    await m.sendReply("_User demoted_");
  } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "pin$", fromMe: false, desc: "Pin the replied message", use: "group" }, async (m) => {
  if (!(await gate(m, { needBot: true }))) return;
  if (!m.reply_message) return m.sendReply("_Reply to a message_");
  try { await m.telegram.pinChatMessage(m.chatId, m.reply_message.id); } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});
Module({ pattern: "unpin", fromMe: false, desc: "Unpin the replied message (or latest)", use: "group" }, async (m) => {
  if (!(await gate(m, { needBot: true }))) return;
  try { await m.telegram.unpinChatMessage(m.chatId, m.reply_message?.id); await m.sendReply("_Unpinned_"); } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "del$", fromMe: false, desc: "Delete the replied message", use: "group" }, async (m) => {
  if (!(await gate(m, { needBot: true }))) return;
  if (!m.reply_message) return m.sendReply("_Reply to a message_");
  await m.delete(m.reply_message.id); await m.delete();
});

Module({ pattern: "purge", fromMe: false, desc: "Delete messages from the replied one down to this", use: "group" }, async (m) => {
  if (!(await gate(m, { needBot: true }))) return;
  if (!m.reply_message) return m.sendReply("_Reply to the first message to delete_");
  const ids = []; for (let i = m.reply_message.id; i <= m.id; i++) ids.push(i);
  for (let i = 0; i < ids.length; i += 100) await m.telegram.deleteMessages(m.chatId, ids.slice(i, i + 100)).catch(() => {});
  const n = await m.telegram.sendMessage(m.chatId, `_Purged ${ids.length} messages_`, { parse_mode: "Markdown" });
  setTimeout(() => m.delete(n.message_id), 4000);
});

Module({ pattern: "lock$", fromMe: false, desc: "Only admins can send messages", use: "group" }, async (m) => {
  if (!(await gate(m, { needBot: true }))) return;
  try { await m.telegram.setChatPermissions(m.chatId, MUTED); await m.sendReply("_Chat locked_ 🔒"); } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});
Module({ pattern: "unlock$", fromMe: false, desc: "Let everyone send messages", use: "group" }, async (m) => {
  if (!(await gate(m, { needBot: true }))) return;
  try { await m.telegram.setChatPermissions(m.chatId, OPEN); await m.sendReply("_Chat unlocked_ 🔓"); } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "(?:tagall|tag) ?(.*)", fromMe: false, desc: "Mention admins + members I have seen", use: "group" }, async (m, match) => {
  if (!(await gate(m))) return;
  const seen = db.get("seen", m.jid, {});
  const admins = await m.telegram.getChatAdministrators(m.chatId).catch(() => []);
  const all = new Map();
  admins.forEach((a) => !a.user.is_bot && all.set(String(a.user.id), a.user.first_name));
  Object.entries(seen).forEach(([id, v]) => all.set(id, v.n));
  const list = [...all.entries()];
  const head = escHtml(match[1] || m.reply_message?.text || "Attention!");
  for (let i = 0; i < list.length; i += 20)
    await m.sendMessage(`${i === 0 ? `<b>${head}</b>\n\n` : ""}${list.slice(i, i + 20).map(([id, n]) => mention(id, n)).join(" ")}`, "text", html);
}); // Telegram can't list every member: only admins + people who have spoken since the bot joined

Module({ pattern: "admins", fromMe: false, desc: "List group admins", use: "group" }, async (m) => {
  if (!m.isGroup) return;
  const a = await m.telegram.getChatAdministrators(m.chatId);
  await m.sendMessage("<b>Admins</b>\n" + a.map((x) => `${x.status === "creator" ? "👑" : "•"} ${mention(x.user.id, x.user.first_name)}`).join("\n"), "text", html);
});

Module({ pattern: "link$", fromMe: false, desc: "Get group invite link", use: "group" }, async (m) => {
  if (!(await gate(m, { needBot: true }))) return;
  try { await m.sendReply(await m.telegram.exportChatInviteLink(m.chatId)); } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "setname ?(.*)", fromMe: false, desc: "Change group name", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  if (!match[1]) return m.sendReply("_Give a name_");
  try { await m.telegram.setChatTitle(m.chatId, match[1]); } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});
Module({ pattern: "setdesc ?(.*)", fromMe: false, desc: "Change group description", use: "group" }, async (m, match) => {
  if (!(await gate(m, { needBot: true }))) return;
  try { await m.telegram.setChatDescription(m.chatId, match[1] || ""); await m.sendReply("_Done_"); } catch (e) { await m.sendReply("_Failed: " + e.description + "_"); }
});

Module({ pattern: "(?:ginfo|info)", fromMe: false, desc: "Group / user info", use: "group" }, async (m) => {
  if (m.reply_message) {
    const u = m.reply_message.data.from;
    return m.sendMessage(`<b>User</b>\nName: ${escHtml(u.first_name)} ${escHtml(u.last_name || "")}\nUsername: ${u.username ? "@" + u.username : "-"}\nID: <code>${u.id}</code>`, "text", html);
  }
  if (!m.isGroup) return m.sendMessage(`Your ID: \`${m.sender}\``);
  const [c, n] = await Promise.all([m.telegram.getChat(m.chatId), m.telegram.getChatMembersCount(m.chatId)]);
  await m.sendMessage(`<b>${escHtml(c.title)}</b>\nID: <code>${c.id}</code>\nMembers: ${n}\n${c.description ? "\n" + escHtml(c.description) : ""}`, "text", html);
});

Module({ pattern: "id$", fromMe: false, desc: "Show chat / user id" }, async (m) => {
  await m.sendMessage(`Chat: \`${m.jid}\`\nYou: \`${m.sender}\`${m.reply_message ? `\nReplied user: \`${m.reply_message.sender}\`` : ""}`);
});

Module({ pattern: "leave", fromMe: true, desc: "Make the bot leave this group", use: "group" }, async (m) => {
  if (m.isGroup) await m.telegram.leaveChat(m.chatId);
});
