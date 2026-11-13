// GH-T ARENA Bot — f_admin.js: Admin Tools, Scrim, E-Ticket, Sponsor, VIP, Backup, dll.
import {
  esc, wib, rp, UUID, rpc, sb, count, getState, setState, clearState, b, BACK, kbRows, show, getT, audit, notify, sbHeaders,
  MAXIMG, EXT, downloadTg, storageUpload, publicUrl
} from './core.js';

export const H = {};
export const T = {};
export const U = {};

const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);

// ================= TOOLS UTAMA =================
H.adm = async (env, chat, mid, p) => {
  const a = p[2];
  if (!a) {
    return show(env, chat, mid, '<b>🛠 Admin Tools</b>\nPilih alat:', {
      inline_keyboard: [
        [b('📢 Broadcast Pesan', 'm:adm:bc'), b('📊 Export CSV', 'm:adm:csv')],
        [b('🚫 Ban Player', 'm:adm:ban'), b('📝 Template Pengumuman', 'm:adm:tmpl')],
        [b('🔴 Atur Live Stream', 'm:adm:stream'), b('🧪 Tes Notifikasi', 'm:adm:test')],
        [b('📉 Log Error Bot', 'm:adm:logs'), b('📈 Statistik Game', 'm:adm:stats')],
        [b('⬅️ Kembali', 'm:main')]
      ]
    });
  }

  if (a === 'bc') { await setState(env, chat, 'adm_bc', {}); return show(env, chat, mid, '<b>📢 Broadcast Pesan</b>\nKetik pesan ke SEMUA Captain (maks 1000 karakter):', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] }); }
  
  if (a === 'csv') {
    const ts = (await sb(env, 'GET', 'tournaments?select=id,name,status&order=created_at.desc&limit=10')) || [];
    const kb = ts.map(t => [b(`${t.name} (${t.status})`, 'm:adm:csv:t:' + t.id)]);
    kb.push([b('⬅️ Kembali', 'm:adm')]);
    return show(env, chat, mid, '<b>📊 Export CSV</b>\nPilih turnamen:', { inline_keyboard: kb });
  }
  if (a === 'csv' && p[3] === 't') {
    const tid = p[4], t = await getT(env, tid);
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&select=id,team_name,status,fee_amount,created_at&order=created_at.asc`)) || [];
    if (!regs.length) return show(env, chat, mid, '❌ Belum ada pendaftar.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:csv')]] });
    let csv = 'No,Team Name,Status,Fee,Tanggal Daftar\n';
    regs.forEach((r, i) => { csv += `${i + 1},"${r.team_name}","${r.status}",${r.fee_amount},"${wib(r.created_at)}"\n`; });
    try {
      const blob = new Blob([csv], { type: 'text/csv' }), formData = new FormData();
      formData.append('chat_id', chat); formData.append('caption', `Data Peserta: ${t.name}`);
      formData.append('document', blob, `Peserta_${t.name.replace(/[^a-z0-9]/gi, '_')}.csv`);
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: formData });
      return show(env, chat, mid, '✅ File CSV terkirim.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm')]] });
    } catch (e) { return show(env, chat, mid, '❌ Gagal kirim CSV: ' + e.message, { inline_keyboard: [[b('⬅️ Kembali', 'm:adm')]] }); }
  }

  if (a === 'ban') { await setState(env, chat, 'adm_ban_find', {}); return show(env, chat, mid, '<b>🚫 Ban Player</b>\nKetik nama tim:', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] }); }
  if (a === 'ban_t') {
    const tid = p[3], t = (await sb(env, 'GET', `teams?id=eq.${tid}&select=*`))?.[0];
    const players = (await sb(env, 'GET', `team_players?team_id=eq.${tid}&select=id,nickname,game_uid,status&order=sort_order.asc`)) || [];
    const kb = players.map(pl => [b(`${pl.status === 'banned' ? '⛔' : '✅'} ${pl.nickname} (${pl.game_uid})`, 'm:adm:ban_v:' + pl.id)]);
    kb.push([b('⬅️ Kembali', 'm:adm:ban')]);
    return show(env, chat, mid, `<b>🚫 Roster: ${esc(t.name)}</b>\nPilih pemain untuk Ban/Unban:`, { inline_keyboard: kb });
  }
  if (a === 'ban_v') {
    const pid = p[3], pl = (await sb(env, 'GET', `team_players?id=eq.${pid}&select=*`))?.[0];
    const newStat = pl.status === 'banned' ? 'aktif' : 'banned';
    await sb(env, 'PATCH', `team_players?id=eq.${pid}`, { status: newStat }, 'return=minimal');
    await sb(env, 'POST', 'global_blacklist', { game_uid: pl.game_uid, nickname: pl.nickname, reason: newStat === 'banned' ? 'Cheat via Bot' : 'Unban' }, 'resolution=merge-duplicates,return=minimal').catch(() => null);
    await audit(env, newStat === 'banned' ? 'ban_player' : 'unban_player', 'team_players', pl.nickname, pid);
    return show(env, chat, mid, `✅ Pemain <b>${esc(pl.nickname)}</b> di-${newStat === 'banned' ? 'BANNED' : 'AKTIFKAN'}.`, { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:ban_t:' + pl.team_id)]] });
  }

  if (a === 'tmpl') {
    const rows = (await sb(env, 'GET', 'announcement_templates?select=id,title&order=created_at.desc')) || [];
    const kb = rows.map(r => [b(r.title, 'm:adm:tmpl_v:' + r.id)]);
    kb.push([b('➕ Tambah Template', 'm:adm:tmpl_add')], [b('⬅️ Kembali', 'm:adm')]);
    return show(env, chat, mid, '<b>📝 Template Pengumuman</b>\nPilih:', { inline_keyboard: kb });
  }
  if (a === 'tmpl_add') { await setState(env, chat, 'adm_tmpl_t', {}); return show(env, chat, mid, 'Ketik <b>judul</b> template:', { inline_keyboard: [[b('✖️ Batal', 'm:adm:tmpl')]] }); }
  if (a === 'tmpl_v') {
    const t = (await sb(env, 'GET', `announcement_templates?id=eq.${p[3]}&select=*`))?.[0];
    return show(env, chat, mid, `<b>📝 ${esc(t.title)}</b>\n\n${esc(t.body)}`, { inline_keyboard: [[b('🗑 Hapus', 'm:adm:tmpl_del:' + p[3])], [b('⬅️ Kembali', 'm:adm:tmpl')]] });
  }
  if (a === 'tmpl_del') { await sb(env, 'DELETE', `announcement_templates?id=eq.${p[3]}`); return show(env, chat, mid, '✅ Template dihapus.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:tmpl')]] }); }

  if (a === 'stream') {
    const ts = (await sb(env, 'GET', 'tournaments?select=id,name,status&order=created_at.desc&limit=10')) || [];
    const kb = ts.map(t => [b(`${t.name} (${t.status})`, 'm:adm:stream_t:' + t.id)]);
    kb.push([b('⬅️ Kembali', 'm:adm')]);
    return show(env, chat, mid, '<b>🔴 Atur Live Stream</b>\nPilih turnamen:', { inline_keyboard: kb });
  }
  if (a === 'stream_t') {
    const t = await getT(env, p[3]);
    await setState(env, chat, 'adm_stream_u', { tid: t.id });
    return show(env, chat, mid, `<b>🔴 Live Stream: ${esc(t.name)}</b>\nLink saat ini: ${esc(t.stream_url || 'Belum diatur')}\n\nKetik link YouTube. Ketik - untuk hapus.`, { inline_keyboard: [[b('✖️ Batal', 'm:adm:stream')]] });
  }

  if (a === 'test') { await setState(env, chat, 'adm_test_n', {}); return show(env, chat, mid, '<b>🧪 Tes Notifikasi</b>\nKetik <b>username Captain</b> target:', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] }); }

  if (a === 'logs') {
    const logs = (await sb(env, 'GET', 'error_logs?select=*&order=created_at.desc&limit=5')) || [];
    let text = '<b>📉 Log Error Bot (5 Terakhir)</b>\n\n';
    if (!logs.length) text += '✅ Tidak ada error.';
    else text += logs.map(l => `🔴 <b>${wib(l.created_at).slice(0, 16)}</b>\n${esc(l.error_message).slice(0, 100)}\n`).join('\n');
    return show(env, chat, mid, text, { inline_keyboard: [[b('🔄 Segarkan', 'm:adm:logs')], [b('⬅️ Kembali', 'm:adm')]] });
  }

  if (a === 'stats') {
    const [brT, csT, brR, csR] = await Promise.all([
      count(env, 'tournaments?format=eq.BR&select=id'), count(env, 'tournaments?format=eq.CS&select=id'),
      count(env, 'registrations?tournaments.format=eq.BR&status=eq.resmi_terdaftar&select=id'), count(env, 'registrations?tournaments.format=eq.CS&status=eq.resmi_terdaftar&select=id')
    ]);
    return show(env, chat, mid, `<b>📈 Statistik Game</b>\n\n🎯 <b>BR</b>\nTotal Turnamen: ${brT}\nTim Terdaftar: ${brR}\n\n⚔️ <b>CS</b>\nTotal Turnamen: ${csT}\nTim Terdaftar: ${csR}`, { inline_keyboard: [[b('🔄 Segarkan', 'm:adm:stats')], [b('⬅️ Kembali', 'm:adm')]] });
  }
};

// ================= SPONSOR =================
H.sponsor = async (env, chat, mid, p) => {
  const a = p[2];
  if (!a) {
    const rows = (await sb(env, 'GET', 'sponsors?select=id,name,is_active&order=sort_order.asc')) || [];
    const kb = rows.map(r => [b(`${r.is_active ? '✅' : '⛔'} ${r.name}`, 'm:sponsor:v:' + r.id)]);
    kb.push([b('➕ Tambah Sponsor', 'm:sponsor:add')], [b('⬅️ Kembali', 'm:main')]);
    return show(env, chat, mid, '<b>🤝 Kelola Sponsor</b>\nPilih sponsor:', { inline_keyboard: kb });
  }
  if (a === 'add') { await setState(env, chat, 'sp_add_name', {}); return show(env, chat, mid, '<b>➕ Sponsor Baru</b>\nKetik Nama Sponsor:', { inline_keyboard: [[b('✖️ Batal', 'm:sponsor')]] }); }
  if (a === 'v') {
    const s = (await sb(env, 'GET', `sponsors?id=eq.${p[3]}&select=*`))?.[0];
    return show(env, chat, mid, `<b>🤝 ${esc(s.name)}</b>\nStatus: ${s.is_active ? 'Aktif' : 'Nonaktif'}`, { inline_keyboard: [[b('🗑 Hapus', 'm:sponsor:del:' + p[3]), b('⬅️ Kembali', 'm:sponsor')]] });
  }
  if (a === 'del') { await sb(env, 'DELETE', `sponsors?id=eq.${p[3]}`); return show(env, chat, mid, '✅ Sponsor dihapus.', { inline_keyboard: [[b('⬅️ Kembali', 'm:sponsor')]] }); }
};

// ================= VIP =================
H.vip = async (env, chat, mid, p) => {
  if (!p[2]) { await setState(env, chat, 'vip_find', {}); return show(env, chat, mid, '<b>👑 Kelola VIP</b>\nKetik username Captain:', { inline_keyboard: [[b('✖️ Batal', 'm:main')]] }); }
};

// ================= BACKUP PROJECT =================
H.backup = async (env, chat, mid, p) => {
  if (!p[2]) {
    return show(env, chat, mid, '<b>📦 Backup Project</b>\nProses ini akan menarik semua file dari GitHub & Skema Database, lalu mengirimkannya sebagai file teks.\n\nLanjut?', { inline_keyboard: [[b('✅ Mulai Backup', 'm:backup:go')], [b('✖️ Batal', 'm:main')]] });
  }
  if (p[2] === 'go') {
    await show(env, chat, mid, '⏳ <b>Sedang memproses backup...</b>\nMengambil data dari GitHub dan Supabase. Mohon tunggu ±10 detik.');
    try {
      const schema = await rpc(env, 'sys_dump_schema');
      let githubFiles = '--- GITHUB FILES ---\n';
      const ghRes = await fetch(`https://api.github.com/repos/${env.GH_REPO}/git/trees/main?recursive=1`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'gh-t-arena' } });
      const tree = await ghRes.json();
      if (tree.tree) {
        // UPDATE: Filter file yang di-backup (js, html, toml, yml, json, sql)
        const files = tree.tree.filter(t => t.type === 'blob' && (
            t.path.endsWith('.js') || t.path.endsWith('.html') || t.path.endsWith('.toml') ||
            t.path.endsWith('.yml') || t.path.endsWith('.yaml') || t.path.endsWith('.json') ||
            t.path.endsWith('.sql')
        ));
        for (const file of files) {
          if (file.size > 500000) continue;
          const rawRes = await fetch(`https://raw.githubusercontent.com/${env.GH_REPO}/main/${file.path}`);
          const content = await rawRes.text();
          githubFiles += `\n\n// ==========================================\n// FILE: ${file.path}\n// ==========================================\n\n${content}`;
        }
      }
      const fullBackup = `=== MASTER CHECKPOINT & BACKUP GH-T ARENA ===\nTanggal: ${new Date().toISOString()}\n\n\n${schema}\n\n\n${githubFiles}`;
      const blob = new Blob([fullBackup], { type: 'text/plain' }), formData = new FormData();
      formData.append('chat_id', chat); formData.append('caption', '📦 Backup Project (Kode + DB Schema). Simpan file ini baik-baik!');
      formData.append('document', blob, `BACKUP_GHT_${Date.now()}.txt`);
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: formData });
      return show(env, chat, mid, '✅ Backup berhasil dikirim!', { inline_keyboard: [[b('⬅️ Kembali', 'm:main')]] });
    } catch (e) { return show(env, chat, mid, '❌ Gagal Backup: ' + e.message, { inline_keyboard: [[b('⬅️ Kembali', 'm:main')]] }); }
  }
};

// ================= E-TICKET SCANNER =================
H.ticket = async (env, chat, mid, p) => {
  if (p[2] === 'scan') {
    await setState(env, chat, 'ticket_scan', {});
    return show(env, chat, mid, '<b>🎟️ Scan E-Ticket</b>\nKetik <b>6-digit Kode Unik</b> dari tiket pemain:', { inline_keyboard: [[b('✖️ Batal', 'm:main')]] });
  }
  return show(env, chat, mid, '<b>🎟️ Cek-in Tiket Offline</b>\nTekan tombol di bawah untuk mulai memindai:', { inline_keyboard: [[b('📷 Mulai Scan Kode', 'm:ticket:scan')], [b('⬅️ Kembali', 'm:main')]] });
};
T.ticket_scan = async (env, chat, st, text) => {
  const code = text.toUpperCase().trim();
  const { data } = await sb(env, 'GET', `etickets?ticket_code=eq.${code}&select=*, registrations(team_name)`);
  const t = data?.[0];
  if (!t) return show(env, chat, null, '❌ Tiket tidak ditemukan.', { inline_keyboard: [[b('🔄 Scan Lagi', 'm:ticket:scan')]] });
  if (t.is_checked_in) return show(env, chat, null, `⚠️ Tiket ini sudah di-scan pada ${wib(t.checked_in_at)}!`, { inline_keyboard: [[b('🔄 Scan Lagi', 'm:ticket:scan')]] });
  await sb(env, 'PATCH', `etickets?id=eq.${t.id}`, { is_checked_in: true, checked_in_at: new Date().toISOString(), checked_in_by: 'Admin Bot' }, 'return=minimal');
  await clearState(env, chat);
  return show(env, chat, null, `✅ <b>CHECK-IN BERHASIL</b>\n\nTim: <b>${esc(t.registrations?.team_name)}</b>\nKode: ${t.ticket_code}\n\nSelamat bertanding!`, { inline_keyboard: [[b('🔄 Scan Lagi', 'm:ticket:scan'), b('🏠 Menu', 'm:main')]] });
};

// ================= STATE HANDLERS =================
T.adm_bc = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 1000) return show(env, chat, null, '❌ Pesan 3-1000 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  const users = (await sb(env, 'GET', 'profiles?select=id')) || [];
  let sent = 0;
  for (let i = 0; i < users.length; i += 50) {
    const chunk = users.slice(i, i + 50).map(u => ({ user_id: u.id, kind: 'pengumuman', title: '📢 Pengumuman Admin', body: text, data: {}, is_read: false }));
    await sb(env, 'POST', 'notifications', chunk, 'return=minimal').catch(() => null); sent += chunk.length;
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
  return show(env, chat, null, '✅ Template disimpan.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:tmpl')]] });
};
T.adm_stream_u = async (env, chat, st, text) => {
  const url = text === '-' ? null : text.trim();
  if (url && !url.startsWith('http')) return show(env, chat, null, '❌ Link harus http/https', { inline_keyboard: [[b('✖️ Batal', 'm:adm:stream')]] });
  await sb(env, 'PATCH', `tournaments?id=eq.${st.data.tid}`, { stream_url: url }, 'return=minimal');
  await clearState(env, chat);
  await audit(env, 'atur_live_stream', 'tournaments', url || 'dihapus', st.data.tid);
  return show(env, chat, null, '✅ Link Live Stream diperbarui.', { inline_keyboard: [[b('⬅️ Kembali', 'm:adm:stream')]] });
};
T.adm_test_n = async (env, chat, st, text) => {
  const prof = (await sb(env, 'GET', `profiles?username=ilike.*${encodeURIComponent(text)}*&select=id,username&limit=1`))?.[0];
  if (!prof) return show(env, chat, null, '❌ Captain tidak ditemukan.', { inline_keyboard: [[b('✖️ Batal', 'm:adm')]] });
  await notify(env, prof.id, 'tes', '🧪 Tes Notifikasi', 'Ini pesan tes. Kalau pop-up muncul di web, realtime berjalan sukses!');
  await clearState(env, chat);
  return show(env, chat, null, `✅ Tes dikirim ke <b>${esc(prof.username)}</b>.`, { inline_keyboard: [[b('⬅️ Kembali', 'm:adm')]] });
};

// Sponsor State
T.sp_add_name = async (env, chat, st, text) => {
  await setState(env, chat, 'sp_add_img', { name: text });
  return show(env, chat, null, 'Kirim <b>foto/logo</b> sponsor:', { inline_keyboard: [[b('✖️ Batal', 'm:sponsor')]] });
};
U.sp_add_img = async (env, chat, st, img) => {
  if (img.bad) return show(env, chat, null, '❌ Kirim sebagai foto/gambar.');
  if (img.size > MAXIMG) return show(env, chat, null, '❌ Maksimal 10 MB.');
  const bytes = await downloadTg(env, img.file_id);
  const ext = EXT[img.mime], path = `sp-${Date.now()}.${ext}`;
  await storageUpload(env, 'site-assets', path, bytes, img.mime);
  const url = publicUrl(env, 'site-assets', path);
  await setState(env, chat, 'sp_add_link', { ...st.data, logo_url: url });
  return show(env, chat, null, 'Ketik <b>Link Website</b> sponsor (atau ketik - jika tidak ada):', { inline_keyboard: [[b('✖️ Batal', 'm:sponsor')]] });
};
T.sp_add_link = async (env, chat, st, text) => {
  const link = text === '-' ? null : text;
  await sb(env, 'POST', 'sponsors', { name: st.data.name, logo_url: st.data.logo_url, link_url: link, is_active: true }, 'return=minimal');
  await clearState(env, chat);
  return show(env, chat, null, '✅ Sponsor ditambahkan.', { inline_keyboard: [[b('⬅️ Kembali', 'm:sponsor')]] });
};

// VIP State
T.vip_find = async (env, chat, st, text) => {
  const prof = (await sb(env, 'GET', `profiles?username=ilike.*${encodeURIComponent(text)}*&select=id,username,is_vip&limit=1`))?.[0];
  if (!prof) return show(env, chat, null, '❌ Captain tidak ditemukan.', { inline_keyboard: [[b('🔎 Cari Lagi', 'm:vip')]] });
  await clearState(env, chat);
  const newStat = !prof.is_vip;
  await sb(env, 'PATCH', `profiles?id=eq.${prof.id}`, { is_vip: newStat, vip_expired_at: newStat ? new Date(Date.now() + 30*864e5).toISOString() : null }, 'return=minimal');
  return show(env, chat, null, `✅ Status VIP <b>${esc(prof.username)}</b>: ${newStat ? 'AKTIF (30 Hari)' : 'DICABUT'}.`, { inline_keyboard: [[b('⬅️ Kembali', 'm:main')]] });
};

// ================= SCRIM MANAGER =================
H.scrim = async (env, chat, mid, p) => {
  if (!p[2]) {
    const scrims = (await sb(env, 'GET', 'scrim_matches?status=eq.mencari_lawan&select=id,game_format,bet_amount,challenger_id&order=created_at.desc&limit=10')) || [];
    if (!scrims.length) {
      return show(env, chat, mid, '<b>🎯 Scrim Manager</b>\nBelum ada tantangan scrim yang masuk.', { inline_keyboard: [[b('⬅️ Kembali', 'm:main')]] });
    }
    const cIds = [...new Set(scrims.map(s => s.challenger_id))];
    const profs = (await sb(env, 'GET', `profiles?id=in.(${cIds.join(',')})&select=id,username`)) || [];
    const pMap = Object.fromEntries(profs.map(p => [p.id, p.username]));

    const kb = scrims.map(s => [b(`${pMap[s.challenger_id] || '?'} - ${rp(s.bet_amount)}`, 'm:scrim:v:' + s.id)]);
    kb.push([b('⬅️ Kembali', 'm:main')]);
    
    return show(env, chat, mid, '<b>🎯 Scrim Manager</b>\nPilih tantangan scrim untuk diurus (buat Room / Sahkan Pemenang):', { inline_keyboard: kb });
  }

  if (p[2] === 'v') {
    const s = (await sb(env, 'GET', `scrim_matches?id=eq.${p[3]}&select=*, challenger:profiles!challenger_id(username), opponent:profiles!opponent_id(username)`))?.[0];
    if (!s) throw new Error('Scrim tidak ditemukan');
    
    let text = `<b>⚔️ Detail Scrim Taruhan</b>\n`;
    text += `Format: ${s.game_format}\n`;
    text += `Penantang: ${s.challenger?.username || '?'}\n`;
    text += `Lawan: ${s.opponent?.username || 'Belum ada'}\n`;
    text += `Taruhan: ${rp(s.bet_amount)} / tim\n`;
    text += `Fee Admin: ${rp(s.admin_fee)}\n`;
    text += `Total Hadiah: <b>${rp((s.bet_amount * 2) - s.admin_fee)}</b>\n`;
    text += `Status: ${s.status.toUpperCase()}\n`;
    if (s.room_id) text += `Room: ${s.room_id} / ${s.room_password}\n`;

    const kb = [];
    if (s.status === 'siap_main' && !s.room_id) {
      kb.push([b('🔑 Buat Room ID', 'm:scrim:room:' + s.id)]);
    }
    if (s.status === 'berlangsung' && s.proof_path) {
      kb.push([b('✅ Sahkan Pemenang', 'm:scrim:win:' + s.id)]);
    }
    kb.push([b('⬅️ Kembali', 'm:scrim')]);

    return show(env, chat, mid, text, { inline_keyboard: kb });
  }

  if (p[2] === 'room') {
    await setState(env, chat, 'scrim_room', { sid: p[3] });
    return show(env, chat, mid, '<b>🔑 Buat Room ID</b>\nKetik: <code>RoomID Password</code>\nContoh: <code>12345678 scrim123</code>', { inline_keyboard: [[b('✖️ Batal', 'm:scrim:v:' + p[3])]] });
  }

  if (p[2] === 'win') {
    const s = (await sb(env, 'GET', `scrim_matches?id=eq.${p[3]}&select=*`))?.[0];
    const winnerId = s.challenger_id; // Anggap penantang yang menang (bisa disesuaikan tombolnya nanti)
    await rpc(env, 'admin_set_scrim_winner', { p_scrim: s.id, p_winner: winnerId }).catch(async () => {
        await sb(env, 'PATCH', `scrim_matches?id=eq.${s.id}`, { status: 'selesai', winner_id: winnerId }, 'return=minimal');
    });
    return show(env, chat, mid, '✅ Pemenang disahkan, saldo telah ditransfer.', { inline_keyboard: [[b('⬅️ Kembali', 'm:scrim')]] });
  }
};

T.scrim_room = async (env, chat, st, text) => {
  const parts = text.split(' ');
  if (parts.length < 2) return show(env, chat, null, '❌ Format salah. Ketik: RoomID Password', { inline_keyboard: [[b('✖️ Batal', 'm:scrim:v:' + st.data.sid)]] });
  await sb(env, 'PATCH', `scrim_matches?id=eq.${st.data.sid}`, { room_id: parts[0], room_password: parts.slice(1).join(' '), status: 'berlangsung' }, 'return=minimal');
  await clearState(env, chat);
  return show(env, chat, null, '✅ Room ID disimpan, status jadi Berlangsung.', { inline_keyboard: [[b('⬅️ Kembali', 'm:scrim')]] });
};

// ================= TOP UP SALDO (BARU) =================
H.tp = async (env, chat, mid, p) => {
    const a = p[2];
    
    if (!a) {
        const rows = (await sb(env, 'GET', 'topup_requests?status=eq.menunggu_verifikasi&select=id,user_id,amount&order=created_at.asc')) || [];
        if (!rows.length) {
            return show(env, chat, mid, '<b>💰 Verifikasi Top Up</b>\nTidak ada pengajuan top up.', { inline_keyboard: [[b('⬅️ Kembali', 'm:main')]] });
        }

        const uids = rows.map(r => r.user_id);
        const profs = (await sb(env, 'GET', `profiles?id=in.(${uids.join(',')})&select=id,username`)) || [];
        const pMap = Object.fromEntries(profs.map(x => [x.id, x.username]));

        const kb = rows.map(r => [b(`Rp ${Number(r.amount).toLocaleString('id-ID')} - ${pMap[r.user_id] || 'User'}`, 'm:tp:v:' + r.id)]);
        kb.push([b('⬅️ Kembali', 'm:main')]);
        return show(env, chat, mid, '<b>💰 Verifikasi Top Up</b>\nPilih request:', { inline_keyboard: kb });
    }
    
    if (a === 'v') {
        const r = (await sb(env, 'GET', `topup_requests?id=eq.${p[3]}&select=*`))?.[0];
        const prof = (await sb(env, 'GET', `profiles?id=eq.${r.user_id}&select=username`))?.[0];
        
        const caption = `<b>💰 Request Top Up</b>\nCaptain: ${prof?.username || '?'}\nNominal: <b>Rp ${Number(r.amount).toLocaleString('id-ID')}</b>`;
        const kb = { inline_keyboard: [[b('✅ Setujui', 'm:tp:ok:' + r.id), b('❌ Tolak', 'm:tp:no:' + r.id)], [b('⬅️ Kembali', 'm:tp')]] };

        if (r.proof_path) {
            const path = r.proof_path.split('/').map(encodeURIComponent).join('/');
            const rSign = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/payment-proofs/${path}`, { method: 'POST', headers: sbHeaders(env), body: JSON.stringify({ expiresIn: 3600 }) });
            const jSign = await rSign.json();
            if (jSign.signedURL) {
                await tg(env, 'sendPhoto', { chat_id: chat, photo: env.SUPABASE_URL + jSign.signedURL, caption: caption, parse_mode: 'HTML', reply_markup: kb });
                return;
            }
        }
        return show(env, chat, mid, caption + '\n\n⚠️ Bukti transfer tidak ditemukan.', { inline_keyboard: kb.inline_keyboard });
    }

    if (a === 'ok') {
        await rpc(env, 'admin_approve_topup', { p_request_id: p[3] });
        return show(env, chat, mid, '✅ Top up disetujui. Saldo user otomatis bertambah.', { inline_keyboard: [[b('⬅️ Kembali', 'm:tp')]] });
    }

    if (a === 'no') {
        await setState(env, chat, 'tp_rej', { rid: p[3] });
        return show(env, chat, mid, '<b>❌ Tolak Top Up</b>\nKetik alasan penolakan:', { inline_keyboard: [[b('✖️ Batal', 'm:tp')]] });
    }
};

T.tp_rej = async (env, chat, st, text) => {
    const rid = st.data?.rid;
    if (text.length < 3 || text.length > 200) return show(env, chat, null, '❌ Alasan 3-200 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:tp')]] });
    
    await sb(env, 'PATCH', `topup_requests?id=eq.${rid}`, { status: 'ditolak', reject_reason: text, processed_at: new Date().toISOString() }, 'return=minimal');
    
    const req = (await sb(env, 'GET', `topup_requests?id=eq.${rid}&select=user_id`))?.[0];
    if (req) await notify(env, req.user_id, 'saldo', 'Top Up Ditolak', `Pengajuan Top Up Anda ditolak. Alasan: ${text}`);
    
    await clearState(env, chat);
    return show(env, chat, null, '✅ Top up ditolak.', { inline_keyboard: [[b('⬅️ Kembali', 'm:tp')]] });
};
