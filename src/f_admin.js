// GH-T ARENA Bot — f_admin.js: Aturan, Game & Map, Tim, Audit Log
import {
  esc, wib, UUID, rpc, sb, count, getState, setState, clearState, b, BACK, kbRows, show, getT, audit
} from './core.js';

export const H = {};
export const T = {};

const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);

// ================= ATURAN TURNAMEN =================
H.ru = async (env, chat, mid, p) => {
  const a = p[2];
  if (!a) {
    const rows = (await sb(env, 'GET', 'tournament_rule_categories?select=id,name&order=sort_order.asc')) || [];
    const kb = rows.map(r => [b(r.name, 'm:ru:v:' + r.id)]);
    kb.push([b('⬅️ Kembali', 'm:set')]);
    return show(env, chat, mid, '<b>📜 Aturan Turnamen</b>\nPilih kategori untuk melihat/mengedit aturan:', { inline_keyboard: kb });
  }
  if (a === 'v') {
    const catId = p[3];
    const cat = (await sb(env, 'GET', `tournament_rule_categories?id=eq.${catId}&select=name`))?.[0];
    const rules = (await sb(env, 'GET', `tournament_rules?category_id=eq.${catId}&select=id,text&order=sort_order.asc`)) || [];
    let text = `<b>📜 ${esc(cat?.name || 'Aturan')}</b>\n\n`;
    if (!rules.length) text += '<i>Belum ada aturan di kategori ini.</i>';
    else text += rules.map((r, i) => `${i + 1}. ${esc(r.text)}`).join('\n');
    
    const kb = [[b('➕ Tambah Aturan', 'm:ru:add:' + catId)], [b('⬅️ Kembali', 'm:ru')]];
    return show(env, chat, mid, text, { inline_keyboard: kb });
  }
  if (a === 'add') {
    const catId = p[3];
    await setState(env, chat, 'ru_txt', { catId });
    return show(env, chat, mid, '<b>➕ Tambah Aturan</b>\nKetik teks aturan baru:', { inline_keyboard: [[b('✖️ Batal', 'm:ru:v:' + catId)]] });
  }
};
T.ru_txt = async (env, chat, st, text) => {
  if (text.length < 5 || text.length > 500) return show(env, chat, null, '❌ Aturan 5 sampai 500 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:ru:v:' + st.data.catId)]] });
  const last = (await sb(env, 'GET', `tournament_rules?category_id=eq.${st.data.catId}&select=sort_order&order=sort_order.desc&limit=1`))?.[0];
  await sb(env, 'POST', 'tournament_rules', { category_id: st.data.catId, text, sort_order: (last?.sort_order || 0) + 1 }, 'return=minimal');
  await clearState(env, chat);
  return show(env, chat, null, '✅ Aturan ditambahkan.', { inline_keyboard: [[b('⬅️ Lihat Aturan', 'm:ru:v:' + st.data.catId)]] });
};

// ================= GAME & MAP =================
H.gm = async (env, chat, mid, p) => {
  const a = p[2];
  if (!a) {
    const games = (await sb(env, 'GET', 'games?select=id,name,status&order=sort_order.asc')) || [];
    const kb = games.map(g => [b(`${g.name} (${g.status})`, 'm:gm:v:' + g.id)]);
    kb.push([b('➕ Tambah Game', 'm:gm:add')], [b('⬅️ Kembali', 'm:set')]);
    return show(env, chat, mid, '<b>🎮 Game & Map</b>\nPilih game untuk mengatur map:', { inline_keyboard: kb });
  }
  if (a === 'v') {
    const gid = p[3];
    const game = (await sb(env, 'GET', `games?id=eq.${gid}&select=name`))?.[0];
    const maps = (await sb(env, 'GET', `game_maps?game_id=eq.${gid}&select=id,name,is_active&order=sort_order.asc`)) || [];
    const kb = maps.map(m => [b(`${m.is_active ? '✅' : '⛔'} ${m.name}`, 'm:gm:m:' + m.id)]);
    kb.push([b('➕ Tambah Map', 'm:gm:madd:' + gid)], [b('⬅️ Kembali', 'm:gm')]);
    return show(env, chat, mid, `<b>🎮 ${esc(game?.name)}</b>\nPilih map:`, { inline_keyboard: kb });
  }
  if (a === 'add') {
    await setState(env, chat, 'gm_gadd', {});
    return show(env, chat, mid, '<b>➕ Tambah Game</b>\nKetik nama game (contoh: Mobile Legends):', { inline_keyboard: [[b('✖️ Batal', 'm:gm')]] });
  }
  if (a === 'm') {
    const midMap = p[3];
    const m = (await sb(env, 'GET', `game_maps?id=eq.${midMap}&select=*`))?.[0];
    if (!m) throw new Error('Map tidak ditemukan');
    await sb(env, 'PATCH', `game_maps?id=eq.${midMap}`, { is_active: !m.is_active }, 'return=minimal');
    return show(env, chat, null, `✅ Map ${esc(m.name)} di ${m.is_active ? 'nonaktifkan' : 'aktifkan'}.`, { inline_keyboard: [[b('⬅️ Kembali', 'm:gm:v:' + m.game_id)]] });
  }
  if (a === 'madd') {
    await setState(env, chat, 'gm_madd', { game_id: p[3] });
    return show(env, chat, mid, '<b>➕ Tambah Map</b>\nKetik nama map baru:', { inline_keyboard: [[b('✖️ Batal', 'm:gm:v:' + p[3])]] });
  }
};
T.gm_gadd = async (env, chat, st, text) => {
  if (text.length < 2) return show(env, chat, null, '❌ Nama game terlalu pendek.', { inline_keyboard: [[b('✖️ Batal', 'm:gm')]] });
  await sb(env, 'POST', 'games', { name: text, status: 'active' }, 'return=minimal');
  await clearState(env, chat);
  return show(env, chat, null, '✅ Game ditambahkan.', { inline_keyboard: [[b('⬅️ Kembali', 'm:gm')]] });
};
T.gm_madd = async (env, chat, st, text) => {
  if (text.length < 2) return show(env, chat, null, '❌ Nama map terlalu pendek.', { inline_keyboard: [[b('✖️ Batal', 'm:gm:v:' + st.data.game_id)]] });
  await sb(env, 'POST', 'game_maps', { game_id: st.data.game_id, name: text, is_active: true }, 'return=minimal');
  await clearState(env, chat);
  return show(env, chat, null, '✅ Map ditambahkan.', { inline_keyboard: [[b('⬅️ Kembali', 'm:gm:v:' + st.data.game_id)]] });
};

// ================= MANAJEMEN TIM =================
H.tm = async (env, chat, mid, p) => {
  const a = p[2];
  if (!a || a === 's') {
    await setState(env, chat, 'tm_find', {});
    return show(env, chat, mid, '<b>👥 Cari Tim</b>\nKetik nama tim (atau sebagian):', { inline_keyboard: [[b('⬅️ Kembali', 'm:main')]] });
  }
  if (a === 'v') {
    const tid = p[3];
    const t = (await sb(env, 'GET', `teams?id=eq.${tid}&select=*`))?.[0];
    const owner = (await sb(env, 'GET', `profiles?id=eq.${t.owner_id}&select=username`))?.[0];
    const pls = (await sb(env, 'GET', `team_players?team_id=eq.${tid}&select=nickname,game_id&order=sort_order.asc`)) || [];
    let text = `<b>👥 ${esc(t.name)}</b>\nCaptain: ${esc(owner?.username || '?')}\nDeskripsi: ${esc(t.description || '-')}\n\n<b>Roster:</b>\n`;
    text += pls.map((x, i) => `${i + 1}. ${esc(x.nickname)} (${esc(x.game_id)})`).join('\n') || '<i>Kosong</i>';
    return show(env, chat, mid, text, { inline_keyboard: [[b('⬅️ Cari Lagi', 'm:tm:s')], [b('⬅️ Menu Utama', 'm:main')]] });
  }
};
T.tm_find = async (env, chat, st, text) => {
  const rows = (await sb(env, 'GET', `teams?name=ilike.*${encodeURIComponent(text)}*&select=id,name&limit=10`)) || [];
  await clearState(env, chat);
  const kb = rows.map(r => [b(r.name, 'm:tm:v:' + r.id)]);
  kb.push([b('🔎 Cari Lagi', 'm:tm:s')], [b('⬅️ Menu Utama', 'm:main')]);
  return show(env, chat, null, `<b>Hasil Pencarian (${rows.length})</b>`, { inline_keyboard: kb });
};

// ================= AUDIT LOG =================
H.al = async (env, chat, mid, p) => {
  const logs = (await sb(env, 'GET', 'audit_log?select=action,entity,reason,created_at&order=created_at.desc&limit=20')) || [];
  let text = '<b>📜 Audit Log (20 Terakhir)</b>\n\n';
  if (!logs.length) text += '<i>Belum ada log.</i>';
  else text += logs.map(l => `• ${wib(l.created_at).slice(0, 16)} · <b>${esc(l.action)}</b> (${esc(l.entity)}) - ${esc(l.reason || '-')}`).join('\n');
  return show(env, chat, mid, text, { inline_keyboard: [[b('🔄 Segarkan', 'm:al')], [b('⬅️ Kembali', 'm:mon')]] });
};
