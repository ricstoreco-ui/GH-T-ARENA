// GH-T ARENA Bot — f_admin.js: Panel Admin Tools, Aturan, Game & Map, Tim, Audit, Live Stream, Ban, CSV, dll.
import {
  esc, wib, UUID, rpc, sb, count, getState, setState, clearState, b, BACK, kbRows, show, getT, audit, notify
} from './core.js';

export const H = {};
export const T = {};

const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);

// ================= MENU UTAMA ADMIN TOOLS =================
H.adm = async (env, chat, mid, p) => {
  const a = p[2];
  
  if (!a) {
    return show(env, chat, mid, '<b>🛠 Admin Tools</b>\nPilih alat yang ingin digunakan:', {
      inline_keyboard: [
        [b('📢 Broadcast Pesan', 'm:adm:bc'), b('📊 Export CSV', 'm:adm:csv')],
        [b('🚫 Ban Player', 'm:adm:ban'), b('📝 Template Pengumuman', 'm:adm:tmpl')],
        [b('🔴 Atur Live Stream', 'm:adm:stream'), b('🧪 Tes Notifikasi', 'm:adm:test')],
        [b('📉 Log Error Bot', 'm:adm:logs'), b('📈 Statistik Game', 'm:adm:stats')],
        [b('⬅️ Menu Utama', 'm:main')]
      ]
    });
  }

  // --- 1. BROADCAST PESAN ---
  if (a === 'bc') {
    await setState(env, chat, 'adm_bc', {});
    return show(env, chat, mid, '<b>📢 Broadcast Pesan</b>\nKetik pesan yang ingin dikirim ke SEMUA Captain (maks 1000 karakter):', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  }

  // --- 2. EXPORT CSV ---
  if (a === 'csv') {
    const ts = (await sb(env, 'GET', 'tournaments?select=id,name,status&order=created_at.desc&limit=10')) || [];
    const kb = ts.map(t => [b(`${t.name} (${t.status})`, 'm:adm:csv:t:' + t.id)]);
    kb.push([b('⬅️ Kembali', 'm:adm')]);
    return show(env, chat, mid, '<b>📊 Export CSV</b>\nPilih turnamen:', { inline_keyboard: kb });
  }
  if (a === 'csv' && p[3] === 't') {
    const tid = p[4];
    const t = await getT(env, tid);
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&select=id,team_name,status,fee_amount,created_at&order=created_at.asc`)) || [];
    if (!regs.length) return show(env, chat, mid, '❌ Belum ada pendaftar.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:csv')]] });

    let csv = 'No,Team Name,Status,Fee,Tanggal Daftar\n';
    regs.forEach((r, i) => {
      csv += `${i + 1},"${r.team_name}","${r.status}",${r.fee_amount},"${wib(r.created_at)}"\n`;
    });

    try {
      const blob = new Blob([csv], { type: 'text/csv' });
      const formData = new FormData();
      formData.append('chat_id', chat);
      formData.append('caption', `Data Peserta: ${t.name}`);
      formData.append('document', blob, `Peserta_${t.name.replace(/[^a-z0-9]/gi, '_')}.csv`);
      
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
        method: 'POST', body: formData
      });
      return show(env, chat, mid, '✅ File CSV berhasil dikirim.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm')]] });
    } catch (e) {
      return show(env, chat, mid, '❌ Gagal mengirim file: ' + e.message, { inline_keyboard: [[b('⬅️ Kembali', 'm:adm')]] });
    }
  }

  // --- 3. BAN PLAYER ---
  if (a === 'ban') {
    await setState(env, chat, 'adm_ban_find', {});
    return show(env, chat, mid, '<b>🚫 Ban Player</b>\nKetik nama tim (atau sebagian) yang ingin dicari:', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  }
  if (a === 'ban_t') {
    const tid = p[3];
    const t = (await sb(env, 'GET', `teams?id=eq.${tid}&select=*`))?.[0];
    const players = (await sb(env, 'GET', `team_players?team_id=eq.${tid}&select=id,nickname,game_uid,status&order=sort_order.asc`)) || [];
    const kb = players.map(pl => [b(`${pl.status === 'banned' ? '⛔' : '✅'} ${pl.nickname} (${pl.game_uid})`, 'm:adm:ban_v:' + pl.id)]);
    kb.push([b('⬅️ Kembali', 'm:adm:ban')]);
    return show(env, chat, mid, `<b>🚫 Roster: ${esc(t.name)}</b>\nPilih pemain untuk di-ban / unban:`, { inline_keyboard: kb });
  }
  if (a === 'ban_v') {
    const pid = p[3];
    const pl = (await sb(env, 'GET', `team_players?id=eq.${pid}&select=*`))?.[0];
    if (!pl) throw new Error('Pemain tidak ditemukan');
    const newStat = pl.status === 'banned' ? 'aktif' : 'banned';
    await sb(env, 'PATCH', `team_players?id=eq.${pid}`, { status: newStat }, 'return=minimal');
    await audit(env, newStat === 'banned' ? 'ban_player' : 'unban_player', 'team_players', pl.nickname, pid);
    return show(env, chat, mid, `✅ Pemain <b>${esc(pl.nickname)}</b> berhasil di-${newStat === 'banned' ? 'BANNED' : 'AKTIFKAN'}.`, { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:ban_t:' + pl.team_id)]] });
  }

  // --- 4. TEMPLATE PENGUMUMAN ---
  if (a === 'tmpl') {
    const rows = (await sb(env, 'GET', 'announcement_templates?select=id,title&order=created_at.desc')) || [];
    const kb = rows.map(r => [b(r.title, 'm:adm:tmpl_v:' + r.id)]);
    kb.push([b('➕ Tambah Template', 'm:adm:tmpl_add')]);
    kb.push([b('⬅️ Kembali', 'm:adm')]);
    return show(env, chat, mid, '<b>📝 Template Pengumuman</b>\nPilih template:', { inline_keyboard: kb });
  }
  if (a === 'tmpl_add') {
    await setState(env, chat, 'adm_tmpl_t', {});
    return show(env, chat, mid, 'Ketik <b>judul</b> template (maks 50 karakter):', { inline_keyboard: [[b('✖️ Batal', 'm:adm:tmpl')]] });
  }
  if (a === 'tmpl_v') {
    const id = p[3];
    const t = (await sb(env, 'GET', `announcement_templates?id=eq.${id}&select=*`))?.[0];
    if (!t) throw new Error('Template tidak ditemukan');
    return show(env, chat, mid, `<b>📝 ${esc(t.title)}</b>\n\n${esc(t.body)}`, {
      inline_keyboard: [
        [b('🗑 Hapus', 'm:adm:tmpl_del:' + id)],
        [b('⬅️ Kembali', 'm:adm:tmpl')]
      ]
    });
  }
  if (a === 'tmpl_del') {
    const id = p[3];
    await sb(env, 'DELETE', `announcement_templates?id=eq.${id}`);
    return show(env, chat, mid, '✅ Template dihapus.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:tmpl')]] });
  }

  // --- 5. ATUR LIVE STREAM ---
  if (a === 'stream') {
    const ts = (await sb(env, 'GET', 'tournaments?select=id,name,status&order=created_at.desc&limit=10')) || [];
    const kb = ts.map(t => [b(`${t.name} (${t.status})`, 'm:adm:stream_t:' + t.id)]);
    kb.push([b('⬅️ Kembali', 'm:adm')]);
    return show(env, chat, mid, '<b>🔴 Atur Live Stream</b>\nPilih turnamen:', { inline_keyboard: kb });
  }
  if (a === 'stream_t') {
    const tid = p[3];
    const t = await getT(env, tid);
    await setState(env, chat, 'adm_stream_u', { tid });
    return show(env, chat, mid, `<b>🔴 Live Stream: ${esc(t.name)}</b>\nLink saat ini: ${esc(t.stream_url || 'Belum diatur')}\n\nKetik link YouTube (contoh: https://youtube.com/live/xxx). Ketik - untuk menghapus.`, { inline_keyboard: [[b('✖️ Batal', 'm:adm:stream')]] });
  }

  // --- 6. TES NOTIFIKASI ---
  if (a === 'test') {
    await setState(env, chat, 'adm_test_n', {});
    return show(env, chat, mid, '<b>🧪 Tes Notifikasi</b>\nKetik <b>username Captain</b> yang mau dikirimin notif tes (atau ketik `admin` untuk tes ke akun lu sendiri):', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  }

  // --- 7. LOG ERROR ---
  if (a === 'logs') {
    const logs = (await sb(env, 'GET', 'error_logs?select=*&order=created_at.desc&limit=5')) || [];
    let text = '<b>📉 Log Error Bot (5 Terakhir)</b>\n\n';
    if (!logs.length) text += '✅ Tidak ada error tercatat.';
    else text += logs.map(l => `🔴 <b>${wib(l.created_at).slice(0, 16)}</b>\n${esc(l.error_message).slice(0, 100)}\n`).join('\n');
    return show(env, chat, mid, text, { inline_keyboard: [[b('🔄 Segarkan', 'm:adm:logs')], [b('⬅️ Kembali', 'm:adm')]] });
  }

  // --- 8. STATISTIK GAME ---
  if (a === 'stats') {
    const [brT, csT, brR, csR] = await Promise.all([
      count(env, 'tournaments?format=eq.BR&select=id'),
      count(env, 'tournaments?format=eq.CS&select=id'),
      count(env, 'registrations?tournaments.format=eq.BR&status=eq.resmi_terdaftar&select=id'),
      count(env, 'registrations?tournaments.format=eq.CS&status=eq.resmi_terdaftar&select=id')
    ]);
    return show(env, chat, mid, `<b>📈 Statistik Game</b>\n\n🎯 <b>Battle Royale (BR)</b>\nTotal Turnamen: ${brT}\nTotal Tim Terdaftar: ${brR}\n\n⚔️ <b>Clash Squad (CS)</b>\nTotal Turnamen: ${csT}\nTotal Tim Terdaftar: ${csR}`, { inline_keyboard: [[b('🔄 Segarkan', 'm:adm:stats')], [b('⬅️ Kembali', 'm:adm')]] });
  }
};

// ================= HANDLER STATE (TEXT INPUT) =================
T.adm_bc = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 1000) return show(env, chat, null, '❌ Pesan 3-1000 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  
  const users = (await sb(env, 'GET', 'profiles?select=id')) || [];
  let sent = 0;
  
  // Kirim bertahap (chunk) biar nggak timeout
  for (let i = 0; i < users.length; i += 50) {
    const chunk = users.slice(i, i + 50).map(u => ({
      user_id: u.id, kind: 'pengumuman', title: '📢 Pengumuman Admin', body: text, data: {}, is_read: false
    }));
    await sb(env, 'POST', 'notifications', chunk, 'return=minimal').catch(() => null);
    sent += chunk.length;
  }
  
  await clearState(env, chat);
  await audit(env, 'broadcast_pesan', 'notifications', text.slice(0, 100));
  return show(env, chat, null, `✅ Broadcast terkirim ke ${sent} Captain.`, { inline_keyboard: [[b('⬅️ Kembali', 'm:adm')]] });
};

T.adm_ban_find = async (env, chat, st, text) => {
  const rows = (await sb(env, 'GET', `teams?name=ilike.*${encodeURIComponent(text)}*&select=id,name&limit=10`)) || [];
  await clearState(env, chat);
  if (!rows.length) return show(env, chat, null, '❌ Tim tidak ditemukan.', { inline_keyboard: [[b('🔎 Cari Lagi', 'm:adm:ban')], [b('⬅️ Kembali', 'm:adm')]] });
  const kb = rows.map(r => [b(r.name, 'm:adm:ban_t:' + r.id)]);
  kb.push([b('⬅️ Kembali', 'm:adm')]);
  return show(env, chat, null, '<b>Pilih Tim:</b>', { inline_keyboard: kb });
};

T.adm_tmpl_t = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 50) return show(env, chat, null, '❌ Judul 3-50 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:adm:tmpl')]] });
  await setState(env, chat, 'adm_tmpl_b', { title: text });
  return show(env, chat, null, 'Ketik <b>isi pengumuman</b> (maks 1000 karakter):', { inline_keyboard: [[b('✖️ Batal', 'm:adm:tmpl')]] });
};
T.adm_tmpl_b = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 1000) return show(env, chat, null, '❌ Isi 3-1000 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:adm:tmpl')]] });
  await sb(env, 'POST', 'announcement_templates', { title: st.data.title, body: text }, 'return=minimal');
  await clearState(env, chat);
  return show(env, chat, null, '✅ Template berhasil disimpan.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:tmpl')]] });
};

T.adm_stream_u = async (env, chat, st, text) => {
  const tid = st.data?.tid;
  const url = text === '-' ? null : text.trim();
  if (url && !url.startsWith('http')) return show(env, chat, null, '❌ Link harus diawali http:// atau https://', { inline_keyboard: [[b('✖️ Batal', 'm:adm:stream')]] });
  await sb(env, 'PATCH', `tournaments?id=eq.${tid}`, { stream_url: url }, 'return=minimal');
  await clearState(env, chat);
  await audit(env, 'atur_live_stream', 'tournaments', url || 'dihapus', tid);
  return show(env, chat, null, '✅ Link Live Stream berhasil diperbarui.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:stream')]] });
};

T.adm_test_n = async (env, chat, st, text) => {
  if (text.length < 3) return show(env, chat, null, '❌ Username terlalu pendek.', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  const prof = (await sb(env, 'GET', `profiles?username=ilike.*${encodeURIComponent(text)}*&select=id,username&limit=1`))?.[0];
  if (!prof) return show(env, chat, null, '❌ Captain tidak ditemukan.', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  
  await notify(env, prof.id, 'tes', '🧪 Tes Notifikasi', 'Ini adalah pesan tes dari Admin. Kalau muncul pop-up di web, berarti realtime berjalan sukses!');
  await clearState(env, chat);
  return show(env, chat, null, `✅ Pesan tes berhasil dikirim ke <b>${esc(prof.username)}</b>.`, { inline_keyboard: [[b('⬅️ Kembali', 'm:adm')]] });
};


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
    const pls = (await sb(env, 'GET', `team_players?team_id=eq.${tid}&select=nickname,game_uid,status&order=sort_order.asc`)) || [];
    let text = `<b>👥 ${esc(t.name)}</b>\nCaptain: ${esc(owner?.username || '?')}\nDeskripsi: ${esc(t.description || '-')}\n\n<b>Roster:</b>\n`;
    text += pls.map((x, i) => `${i + 1}. ${esc(x.nickname)} (${esc(x.game_uid)}) ${x.status === 'banned' ? '⛔' : ''}`).join('\n') || '<i>Kosong</i>';
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
