// GH-T ARENA — Telegram Bot Worker v0.4 (Cloudflare Workers, module syntax)
// Baru di v0.4: menu Pengumuman (buat, lihat, hapus; notifikasi ke Captain terdaftar).
// Baru di v0.3: slot terisi, notifikasi Captain (tabel notifications), menu Pendaftaran,
// menu Verifikasi Pembayaran (verifikasi, tolak bayar, data belum lengkap, tolak, lihat bukti).
// Variabel yang harus diisi di Cloudflare (JANGAN tulis nilainya di file ini):
//   BOT_TOKEN, ADMIN_ID, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
// Baru di v0.2: menu Tabel Poin, menu Turnamen (daftar, buat, ubah status, tunda,
// jadwal lanjutan, lanjutkan, registrasi ON/OFF), input teks (bot_state),
// idempotensi update (bot_processed_updates).

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wib = (x) => (x ? new Date(x).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-');
const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const UUID = /^[0-9a-f-]{36}$/i;

async function tg(env, method, body = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function sbHeaders(env, extra = {}) {
  const h = { apikey: env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json', ...extra };
  if (String(env.SUPABASE_SERVICE_KEY).startsWith('eyJ')) h.authorization = 'Bearer ' + env.SUPABASE_SERVICE_KEY;
  return h;
}

async function rpc(env, fn, args = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// Helper REST umum (GET/POST/PATCH/DELETE)
async function sb(env, method, path, body, prefer) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: sbHeaders(env, prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) {
    const e = new Error(`${path.split('?')[0]}: ${r.status} ${t.slice(0, 220)}`);
    e.status = r.status;
    throw e;
  }
  return t ? JSON.parse(t) : null;
}

async function count(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: sbHeaders(env, { Prefer: 'count=exact', Range: '0-0' }),
  });
  const cr = r.headers.get('content-range') || '';
  return cr.split('/')[1] ?? '?';
}

async function setSetting(env, key, value) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/site_settings?on_conflict=key`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ key, value }),
  });
  if (!r.ok) throw new Error(`site_settings: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

const audit = (env, action, entity, reason, entityId = null, oldV = null, newV = null) =>
  rpc(env, 'sys_audit', {
    p_actor: 'super_admin', p_action: action, p_entity: entity, p_entity_id: entityId,
    p_old: oldV, p_new: newV, p_reason: reason,
  }).catch(() => null);

// ---------- Notifikasi Captain (tabel notifications) ----------
async function notify(env, userId, kind, title, body, tournamentId = null) {
  try {
    await sb(env, 'POST', 'notifications',
      { user_id: userId, kind, title, body, data: {}, tournament_id: tournamentId, is_read: false },
      'return=minimal');
    return true;
  } catch (e) { return false; }
}

// Kirim ke semua Captain yang timnya Resmi Terdaftar di turnamen. Return jumlah, atau null jika gagal.
async function notifyRegistrants(env, tid, kind, title, body) {
  try {
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&status=eq.resmi_terdaftar&select=owner_id`)) || [];
    const ids = [...new Set(regs.map((r) => r.owner_id))];
    if (!ids.length) return 0;
    await sb(env, 'POST', 'notifications',
      ids.map((u) => ({ user_id: u, kind, title, body, data: {}, tournament_id: tid, is_read: false })),
      'return=minimal');
    return ids.length;
  } catch (e) { return null; }
}
const notifNote = (n) => (n === null ? '⚠️ Notifikasi ke Captain GAGAL dikirim.' : `🔔 Notifikasi terkirim ke ${n} Captain.`);

// ---------- Idempotensi update Telegram ----------
async function firstTime(env, updateId) {
  try {
    await sb(env, 'POST', 'bot_processed_updates', { update_id: updateId }, 'return=minimal');
    return true;
  } catch (e) {
    return e.status === 409 ? false : true; // 409 = sudah pernah diproses
  }
}

// ---------- State input teks (tabel bot_state) ----------
async function getState(env, chat) {
  const rows = await sb(env, 'GET', `bot_state?chat_id=eq.${chat}&select=state,data,updated_at`);
  const r = rows?.[0];
  if (!r || !r.state) return null;
  if (Date.now() - new Date(r.updated_at).getTime() > 30 * 60 * 1000) return null; // kedaluwarsa 30 menit
  return r;
}
async function setState(env, chat, state, data = {}) {
  await sb(env, 'POST', 'bot_state?on_conflict=chat_id',
    { chat_id: chat, state, data, updated_at: new Date().toISOString() },
    'resolution=merge-duplicates,return=minimal');
}
async function clearState(env, chat) {
  await sb(env, 'DELETE', `bot_state?chat_id=eq.${chat}`).catch(() => null);
}

// ---------- Menu ----------
const b = (text, data) => ({ text, callback_data: data });
const BACK = [[b('⬅️ Menu Utama', 'm:main')]];
const MAIN = {
  inline_keyboard: [
    [b('📊 Dashboard', 'm:dash'), b('🏆 Turnamen', 'm:t')],
    [b('📝 Pendaftaran', 'm:rg'), b('💳 Pembayaran', 'm:vp')],
    [b('🎯 Battle Royale', 'm:soon:Battle Royale'), b('⚔️ Clash Squad', 'm:soon:Clash Squad')],
    [b('🧮 Tabel Poin', 'm:pt'), b('📣 Pengumuman', 'm:an')],
    [b('💸 Pencairan', 'm:soon:Pencairan Hadiah'), b('⚙️ Pengaturan', 'm:set')],
    [b('🩺 Monitoring', 'm:mon')],
  ],
};
const MAIN_TEXT = '<b>GH-T ARENA — Panel Super Admin</b>\nPilih menu:';

async function show(env, chat, mid, text, markup) {
  const body = { chat_id: chat, text, parse_mode: 'HTML', reply_markup: markup, disable_web_page_preview: true };
  if (mid) {
    const r = await tg(env, 'editMessageText', { ...body, message_id: mid });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  const r1 = await tg(env, 'sendMessage', body);
  if (r1.ok) return;
  // Gagal (mis. format HTML ditolak): kirim ulang sebagai teks polos, lalu lapor
  const plain = String(text).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const r2 = await tg(env, 'sendMessage', { chat_id: chat, text: plain, reply_markup: markup, disable_web_page_preview: true });
  if (!r2.ok) {
    await tg(env, 'sendMessage', { chat_id: chat, text: 'Aksi tersimpan, tapi balasan gagal terkirim: ' + String(r2.description || r1.description || '?').slice(0, 200) });
  }
}

async function dashboard(env) {
  const [h, pay, act, wd] = await Promise.all([
    rpc(env, 'admin_health'),
    count(env, 'registrations?status=eq.menunggu_verifikasi&select=id'),
    count(env, 'tournaments?status=in.(pendaftaran_dibuka,berlangsung)&select=id'),
    count(env, 'registrations?withdraw_requested_at=not.is.null&status=neq.mengundurkan_diri&select=id'),
  ]);
  const site = h.site || {};
  return (
    '<b>📊 Dashboard</b>\n' +
    `Situs: ${site.open ? '🟢 Buka' : '🔴 Maintenance'}${site.reason ? ' (' + esc(site.reason) + ')' : ''}\n` +
    `Bot terakhir aktif: ${wib(h.bot_last_seen)}\n\n` +
    `Turnamen aktif: <b>${act}</b>\n` +
    `Bukti bayar menunggu verifikasi: <b>${pay}</b>\n` +
    `Pengajuan mundur menunggu: <b>${wd}</b>\n` +
    `Sesi Captain aktif: ${h.sessions_active}\n` +
    `Job antre/jalan/mati: ${h.jobs_pending}/${h.jobs_running}/${h.jobs_dead}`
  );
}

async function healthText(env) {
  const lines = [];
  const t0 = Date.now();
  try {
    const h = await rpc(env, 'admin_health');
    lines.push(`✅ Database OK (${Date.now() - t0} ms), ukuran ${h.db_size_mb} MB, ${h.jumlah_tabel} tabel`);
    lines.push(h.site?.open ? '✅ Status situs: buka' : '⚠️ Status situs: maintenance');
    lines.push(h.jobs_dead > 0 ? `⚠️ Job mati: ${h.jobs_dead}` : '✅ Tidak ada job mati');
    lines.push(h.files_due > 0 ? `⚠️ File menunggu dihapus: ${h.files_due}` : '✅ Tidak ada file tertunda');
  } catch (e) { lines.push('❌ Database: ' + esc(e.message)); }
  try {
    const me = await tg(env, 'getMe');
    lines.push(me.ok ? '✅ Telegram Bot OK' : '❌ Telegram: ' + esc(me.description));
  } catch (e) { lines.push('❌ Telegram: ' + esc(e.message)); }
  try {
    await rpc(env, 'admin_storage_usage');
    lines.push('✅ Storage OK');
    return '<b>🩺 Health Check</b>\n' + lines.join('\n');
  } catch (e) { lines.push('❌ Storage: ' + esc(e.message)); }
  return '<b>🩺 Health Check</b>\n' + lines.join('\n');
}

async function storageText(env) {
  const s = await rpc(env, 'admin_storage_usage');
  const rows = Object.entries(s.buckets || {}).map(([k, v]) => `• ${esc(k)}: ${v.files} file, ${v.mb} MB`);
  return (
    '<b>🗄 Monitoring Storage</b>\n' + (rows.join('\n') || 'Belum ada file.') +
    `\n\nDatabase: ${s.db_mb} MB dari 500 MB (${Math.round((s.db_mb / 500) * 100)}%)\n` +
    '<i>Batas storage: cek dashboard Supabase.</i>'
  );
}

async function settingsMenu(env) {
  const h = await rpc(env, 'admin_health');
  const [reg] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/site_settings?key=eq.registration_on&select=value`, { headers: sbHeaders(env) }).then((r) => r.json()),
  ]);
  const regOn = reg?.[0]?.value !== false;
  const open = h.site?.open;
  return {
    text: `<b>⚙️ Pengaturan</b>\nRegistrasi: ${regOn ? '🟢 ON' : '🔴 OFF'}\nSitus: ${open ? '🟢 Buka' : '🔴 Maintenance'}`,
    markup: {
      inline_keyboard: [
        [b(regOn ? '🔴 Matikan Registrasi' : '🟢 Hidupkan Registrasi', 'm:reg:' + (regOn ? '0' : '1'))],
        [b(open ? '🛠 Aktifkan Maintenance' : '✅ Matikan Maintenance', 'm:mt:' + (open ? '1' : '0'))],
        ...BACK,
      ],
    },
  };
}

// =====================================================================
// TABEL POIN
// =====================================================================
async function ptRows(env) {
  return (await sb(env, 'GET', 'point_table?select=placement,points&order=placement.asc')) || [];
}

async function ptView(env) {
  const rows = await ptRows(env);
  const body = rows.map((r) => `${String(r.placement).padStart(2, ' ')}  →  ${r.points}`).join('\n');
  return {
    text:
      '<b>🧮 Tabel Poin BR</b>\n<pre>Peringkat → Poin\n' + esc(body || '(kosong)') + '</pre>' +
      'Kill: 1 poin per kill (tetap).',
    markup: { inline_keyboard: [[b('✏️ Ubah Poin', 'm:pt:edit')], ...BACK] },
  };
}

async function ptPrompt(env, chat, mid) {
  await setState(env, chat, 'pt_edit', {});
  return show(env, chat, mid,
    '<b>✏️ Ubah Tabel Poin</b>\nKetik poin baru. Pilih salah satu format:\n\n' +
    '1) Sebagian saja:\n<code>1=15, 2=12, 3=10</code>\n\n' +
    '2) Semua 12 peringkat berurutan:\n<code>12 11 10 9 8 7 6 5 4 3 2 1</code>\n\n' +
    'Peringkat 1 sampai 12, poin bilangan bulat 0 atau lebih.',
    { inline_keyboard: [[b('✖️ Batal', 'm:pt')]] });
}

function parsePoints(text) {
  const t = text.trim().replace(/\s*=\s*/g, '=');
  const out = {};
  if (t.includes('=')) {
    for (const p of t.split(/[,;\s]+/).filter(Boolean)) {
      const m = p.match(/^(\d{1,2})=(\d{1,4})$/);
      if (!m) return { err: `Format salah: "${p}"` };
      const pl = +m[1];
      if (pl < 1 || pl > 12) return { err: `Peringkat harus 1 sampai 12 (kamu tulis ${pl}).` };
      out[pl] = +m[2];
    }
  } else {
    const nums = t.split(/[,;\s]+/).filter(Boolean);
    if (nums.length !== 12 || nums.some((n) => !/^\d{1,4}$/.test(n))) {
      return { err: 'Tanpa tanda "=" harus tepat 12 angka (peringkat 1 sampai 12).' };
    }
    nums.forEach((n, i) => { out[i + 1] = +n; });
  }
  if (!Object.keys(out).length) return { err: 'Tidak ada data.' };
  return { out };
}

async function ptTextInput(env, chat, text) {
  const p = parsePoints(text);
  if (p.err) {
    return show(env, chat, null, '❌ ' + esc(p.err) + '\nCoba ketik lagi, atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:pt')]] });
  }
  const cur = await ptRows(env);
  const oldMap = Object.fromEntries(cur.map((r) => [r.placement, r.points]));
  const changes = {};
  for (const [pl, pts] of Object.entries(p.out)) if (oldMap[pl] !== pts) changes[pl] = pts;
  if (!Object.keys(changes).length) {
    return show(env, chat, null, 'Gak ada yang berubah (nilainya sama dengan tabel sekarang). Ketik lagi atau /batal.',
      { inline_keyboard: [[b('✖️ Batal', 'm:pt')]] });
  }
  const merged = { ...oldMap, ...changes };
  const total = Object.values(merged).reduce((a, c) => a + Number(c), 0);
  const lines = Object.entries(changes).map(([pl, pts]) => `Peringkat ${pl}: ${oldMap[pl] ?? '-'} → <b>${pts}</b>`);
  await setState(env, chat, 'pt_save', { changes, old: oldMap });
  return show(env, chat, null,
    '<b>Konfirmasi perubahan Tabel Poin</b>\n' + lines.join('\n') +
    (total === 0 ? '\n\n⚠️ Semua poin jadi 0. Konfirmasi match akan ditolak sistem (TABEL_POIN_KOSONG).' : '') +
    '\n\nSimpan?',
    { inline_keyboard: [[b('✅ Simpan', 'm:pt:save'), b('✏️ Ulangi', 'm:pt:go')], [b('✖️ Batal', 'm:pt')]] });
}

async function ptSave(env, chat, mid) {
  const st = await getState(env, chat);
  if (!st || st.state !== 'pt_save') {
    return show(env, chat, mid, 'Sesi kedaluwarsa. Buka lagi menu Tabel Poin.', { inline_keyboard: [[b('🧮 Tabel Poin', 'm:pt')], ...BACK] });
  }
  const { changes, old } = st.data;
  const rows = Object.entries(changes).map(([pl, pts]) => ({ placement: +pl, points: +pts }));
  await clearState(env, chat);
  await sb(env, 'POST', 'point_table?on_conflict=placement', rows, 'resolution=merge-duplicates,return=minimal');
  const oldPart = {};
  for (const k of Object.keys(changes)) oldPart[k] = old[k] ?? null;
  await audit(env, 'ubah_tabel_poin', 'point_table', 'via bot', null, oldPart, changes);
  const v = await ptView(env);
  return show(env, chat, mid, '✅ Tabel poin disimpan. Website ikut diperbarui.\n\n' + v.text, v.markup);
}

// =====================================================================
// TURNAMEN
// =====================================================================
const ST = {
  segera_hadir: ['⏳', 'Segera Hadir'],
  pendaftaran_dibuka: ['🟢', 'Pendaftaran Dibuka'],
  pendaftaran_ditutup: ['🔒', 'Pendaftaran Ditutup'],
  ditunda: ['⏸', 'Ditunda'],
  berlangsung: ['🔥', 'Berlangsung'],
  selesai: ['✅', 'Selesai'],
  dibatalkan: ['❌', 'Dibatalkan'],
};
const stLabel = (s) => { const x = ST[s] || ['❔', s]; return `${x[0]} ${x[1]}`; };
const SET_ORDER = ['segera_hadir', 'pendaftaran_dibuka', 'pendaftaran_ditutup', 'berlangsung'];
const CHANGEABLE = ['segera_hadir', 'pendaftaran_dibuka', 'pendaftaran_ditutup'];
const FINAL = ['selesai', 'dibatalkan'];

async function getT(env, id) {
  if (!UUID.test(id)) throw new Error('ID turnamen tidak valid');
  const rows = await sb(env, 'GET', `tournaments?id=eq.${id}&select=*`);
  if (!rows?.[0]) throw new Error('Turnamen tidak ditemukan');
  return rows[0];
}

async function patchT(env, id, body) {
  const rows = await sb(env, 'PATCH', `tournaments?id=eq.${id}`, body, 'return=representation');
  if (!rows?.[0]) throw new Error('Turnamen tidak ditemukan / tidak berubah');
  return rows[0];
}

// Perubahan penting saat pendaftaran terbuka: matikan registrasi sementara (Master Prompt 15.4)
async function safePatchT(env, t, body) {
  const needLock = t.status === 'pendaftaran_dibuka' && t.registration_enabled;
  if (needLock) await patchT(env, t.id, { registration_enabled: false });
  try {
    return await patchT(env, t.id, body);
  } finally {
    if (needLock) await patchT(env, t.id, { registration_enabled: true }).catch(() => null);
  }
}

async function tList(env) {
  const rows = (await sb(env, 'GET', 'tournaments?select=id,name,format,status&order=created_at.desc&limit=10')) || [];
  const kb = rows.map((t) => [b(`${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`, 'm:t:v:' + t.id)]);
  return {
    text: '<b>🏆 Turnamen</b>\n' + (rows.length ? 'Pilih turnamen (10 terbaru):' : 'Belum ada turnamen.'),
    markup: { inline_keyboard: [[b('➕ Buat Turnamen', 'm:t:new')], ...kb, ...BACK] },
  };
}

async function tDetail(env, id, notice) {
  const t = await getT(env, id);
  const filled = await count(env, `registrations?tournament_id=eq.${id}&status=eq.resmi_terdaftar&select=id`);
  const lines = [
    `<b>🏆 ${esc(t.name)}</b>`,
    `Format: ${t.format === 'BR' ? '🎯 Battle Royale' : '⚔️ Clash Squad'}`,
    `Status: ${stLabel(t.status)}`,
    `Registrasi: ${t.registration_enabled ? '🟢 ON' : '🔴 OFF'}`,
    `Slot terisi: <b>${filled}/${t.total_slots}</b> · Pemain utama/tim: ${t.starters_per_team} · Cadangan maks: ${t.max_subs}`,
    `Biaya: ${rp(t.entry_fee)} · Hadiah: ${rp(t.prize_pool)} · Posisi pemenang: ${t.winner_positions}`,
    `Jadwal: ${wib(t.schedule_at)}`,
    `Batas daftar: ${wib(t.registration_deadline)}`,
  ];
  if (t.format === 'BR') lines.push(`Jumlah match: ${t.match_count}`);
  else lines.push(`Bracket: ${t.cs_elimination === 'double' ? 'Double' : 'Single'} Elimination · Undian: ${t.cs_draw_method === 'spin' ? 'Spin' : 'Shuffle'}`);
  if (t.postponed_reason) lines.push(`Alasan tunda: ${esc(t.postponed_reason)}`);
  if (t.resume_note) lines.push(`Catatan lanjutan: ${esc(t.resume_note)}`);
  if (t.cancel_reason) lines.push(`Alasan batal: ${esc(t.cancel_reason)}`);

  const kb = [];
  if (!FINAL.includes(t.status)) {
    kb.push([b('🔁 Ubah Status', 'm:t:s:' + id), b(t.registration_enabled ? '🔴 Registrasi OFF' : '🟢 Registrasi ON', 'm:t:r:' + id)]);
    if (t.status === 'ditunda') kb.push([b('📅 Atur Jadwal Lanjutan', 'm:t:j:' + id), b('▶️ Lanjutkan', 'm:t:c:' + id)]);
    else kb.push([b('⏸ Tunda Turnamen', 'm:t:p:' + id)]);
  }
  kb.push([b('🔄 Segarkan', 'm:t:v:' + id), b('⬅️ Daftar', 'm:t')]);
  return { text: (notice ? notice + '\n\n' : '') + lines.join('\n'), markup: { inline_keyboard: kb } };
}

async function tStatusMenu(env, id) {
  const t = await getT(env, id);
  if (!CHANGEABLE.includes(t.status)) {
    const why = t.status === 'ditunda' ? 'Turnamen ditunda: pakai tombol Lanjutkan.'
      : t.status === 'berlangsung' ? 'Turnamen sedang berlangsung: status akhir lewat menu BR/CS (finalisasi), jeda lewat Tunda.'
      : 'Status akhir tidak bisa diubah dari sini.';
    return { text: `<b>Ubah Status</b>\nSaat ini: ${stLabel(t.status)}\n${why}`, markup: { inline_keyboard: [[b('⬅️ Kembali', 'm:t:v:' + id)]] } };
  }
  const kb = SET_ORDER.map((s, n) => (s === t.status ? null : [b(stLabel(s), `m:t:ss:${id}:${n}`)])).filter(Boolean);
  kb.push([b('⬅️ Kembali', 'm:t:v:' + id)]);
  return { text: `<b>Ubah Status</b>\n${esc(t.name)}\nSaat ini: ${stLabel(t.status)}\nPilih status baru:`, markup: { inline_keyboard: kb } };
}

async function tSetStatus(env, id, n, confirmed) {
  const t = await getT(env, id);
  const ns = SET_ORDER[n];
  if (!ns) throw new Error('Status tidak dikenal');
  if (!CHANGEABLE.includes(t.status)) throw new Error('Status saat ini tidak bisa diubah dari menu ini');
  if (ns === 'berlangsung' && !confirmed) {
    return {
      text: `<b>Mulai turnamen?</b>\n${esc(t.name)}\nStatus akan jadi 🔥 Berlangsung. Turnamen tidak dimulai otomatis, ini keputusan lo. Slot total: ${t.total_slots}.\nLanjut?`,
      markup: { inline_keyboard: [[b('✅ Ya, mulai', `m:t:sy:${id}:${n}`), b('✖️ Batal', 'm:t:v:' + id)]] },
    };
  }
  await patchT(env, id, { status: ns });
  await audit(env, 'ubah_status_turnamen', 'tournaments', 'via bot', id, { status: t.status }, { status: ns });
  return tDetail(env, id, `✅ Status: ${stLabel(t.status)} → ${stLabel(ns)}`);
}

async function tToggleReg(env, id) {
  const t = await getT(env, id);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const nv = !t.registration_enabled;
  await patchT(env, id, { registration_enabled: nv });
  await audit(env, nv ? 'registrasi_turnamen_on' : 'registrasi_turnamen_off', 'tournaments', 'via bot', id,
    { registration_enabled: t.registration_enabled }, { registration_enabled: nv });
  return tDetail(env, id, `✅ Registrasi turnamen: ${nv ? '🟢 ON' : '🔴 OFF'}`);
}

function parseWib(s) {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00+07:00`);
  if (isNaN(dt.getTime())) return null;
  return { iso: dt.toISOString(), note: (m[6] || '').trim() };
}

async function tResumeMenu(env, id) {
  const t = await getT(env, id);
  if (t.status !== 'ditunda') throw new Error('Hanya turnamen berstatus Ditunda yang bisa dilanjutkan');
  const kb = [];
  let info = 'Status turnamen akan jadi 🔥 Berlangsung.';
  if (t.format === 'BR') {
    const ms = (await sb(env, 'GET', `br_matches?tournament_id=eq.${id}&select=match_no,status&order=match_no.asc`)) || [];
    const open = ms.filter((m) => m.status !== 'hasil_dipublikasikan');
    if (open.length) {
      info += '\nPilih match yang dilanjutkan (match lain tidak diubah):';
      for (let i = 0; i < open.length; i += 3) {
        kb.push(open.slice(i, i + 3).map((m) => b(`Match ${m.match_no}`, `m:t:cm:${id}:${m.match_no}`)));
      }
    }
  } else {
    info += '\nPemilihan pertandingan CS dilakukan di menu Clash Squad.';
  }
  kb.push([b('▶️ Lanjutkan tanpa pilih match', 'm:t:c0:' + id)]);
  kb.push([b('⬅️ Kembali', 'm:t:v:' + id)]);
  return { text: `<b>▶️ Lanjutkan Turnamen</b>\n${esc(t.name)}\n${info}`, markup: { inline_keyboard: kb } };
}

async function tResume(env, id, matchNo) {
  const t = await getT(env, id);
  if (t.status !== 'ditunda') throw new Error('Turnamen tidak dalam status Ditunda');
  await patchT(env, id, { status: 'berlangsung' });
  if (matchNo) {
    await sb(env, 'PATCH', `br_matches?tournament_id=eq.${id}&match_no=eq.${Number(matchNo)}`, { status: 'berlangsung' }, 'return=minimal');
  }
  await audit(env, 'lanjutkan_turnamen', 'tournaments', matchNo ? `match ${matchNo}` : 'tanpa pilih match', id, { status: 'ditunda' }, { status: 'berlangsung' });
  const n = await notifyRegistrants(env, id, 'jadwal', 'Turnamen dilanjutkan',
    `${t.name} dilanjutkan${matchNo ? ` (Match ${matchNo})` : ''}. Pantau jadwal dan info room di website.`);
  return tDetail(env, id, `✅ Turnamen dilanjutkan${matchNo ? ` (Match ${matchNo} berlangsung)` : ''}.\n${notifNote(n)}`);
}

// ----- Wizard Buat Turnamen -----
function wizNextStep(d) {
  if (!d.game_id) return 'game';
  if (!d.name) return 'name';
  if (!d.format) return 'format';
  if (d.total_slots == null) return 'slots';
  if (d.starters_per_team == null) return 'starters';
  if (d.format === 'BR' && d.match_count == null) return 'matches';
  if (d.format === 'CS' && !d.cs_elimination) return 'elim';
  if (d.format === 'CS' && !d.cs_draw_method) return 'draw';
  if (d.entry_fee == null) return 'fee';
  if (d.prize_pool == null) return 'prize';
  if (d.winner_positions == null) return 'winners';
  if (d.schedule_at === undefined) return 'schedule';
  if (d.registration_deadline === undefined) return 'deadline';
  return 'confirm';
}
const BUTTON_STEPS = ['game', 'format', 'starters', 'elim', 'draw', 'confirm'];
const CANCEL_W = [b('✖️ Batal', 'm:w:x')];

function wizSummary(d) {
  const l = [
    '<b>Ringkasan turnamen baru</b>',
    `Nama: ${esc(d.name)}`,
    `Game: ${esc(d.game_name || '-')}`,
    `Format: ${d.format}`,
    `Slot: ${d.total_slots} · Pemain utama/tim: ${d.starters_per_team} · Cadangan maks: 2`,
  ];
  if (d.format === 'BR') l.push(`Jumlah match: ${d.match_count}`);
  else l.push(`Bracket: ${d.cs_elimination} · Undian: ${d.cs_draw_method}`);
  l.push(`Biaya: ${rp(d.entry_fee)} · Hadiah: ${rp(d.prize_pool)} · Posisi pemenang: ${d.winner_positions}`);
  l.push(`Jadwal: ${wib(d.schedule_at)}`);
  l.push(`Batas daftar: ${wib(d.registration_deadline)}`);
  l.push('Status awal: ⏳ Segera Hadir');
  l.push('\n<i>Distribusi hadiah per posisi, banner, deskripsi, aturan, map: diatur di menu Edit (versi berikutnya).</i>');
  return l.join('\n');
}

function wizPrompt(d, step) {
  switch (step) {
    case 'game':
      return { text: '<b>➕ Buat Turnamen</b>\nPilih game:', markup: { inline_keyboard: [...(d.gl || []).map((g, i) => [b(g.name, 'm:w:g:' + i)]), CANCEL_W] } };
    case 'name': return { text: '<b>➕ Buat Turnamen</b>\nKetik <b>nama turnamen</b>:', markup: { inline_keyboard: [CANCEL_W] } };
    case 'format': return { text: 'Pilih <b>format</b>:', markup: { inline_keyboard: [[b('🎯 Battle Royale', 'm:w:f:BR'), b('⚔️ Clash Squad', 'm:w:f:CS')], CANCEL_W] } };
    case 'slots':
      return { text: d.format === 'BR' ? 'Ketik <b>jumlah slot</b> tim (2 sampai 12):' : 'Ketik <b>jumlah slot</b> tim (minimal 2):', markup: { inline_keyboard: [CANCEL_W] } };
    case 'starters':
      return { text: 'Pilih <b>jumlah pemain utama</b> per tim (atau ketik angka lain):', markup: { inline_keyboard: [[1, 2, 3, 4].map((n) => b(`${n}v${n}`, 'm:w:s:' + n)), CANCEL_W] } };
    case 'matches': return { text: 'Ketik <b>jumlah match</b> BR (angka 1 atau lebih):', markup: { inline_keyboard: [CANCEL_W] } };
    case 'elim': return { text: 'Pilih <b>format bracket</b> CS:', markup: { inline_keyboard: [[b('Single Elimination', 'm:w:e:single'), b('Double Elimination', 'm:w:e:double')], CANCEL_W] } };
    case 'draw': return { text: 'Pilih <b>metode undian</b> CS:', markup: { inline_keyboard: [[b('🎡 Spin', 'm:w:d:spin'), b('🔀 Shuffle', 'm:w:d:shuffle')], CANCEL_W] } };
    case 'fee': return { text: 'Ketik <b>biaya pendaftaran</b> (Rp, angka saja, 0 = gratis):', markup: { inline_keyboard: [CANCEL_W] } };
    case 'prize': return { text: 'Ketik <b>total hadiah</b> (Rp, angka saja, 0 jika tidak ada):', markup: { inline_keyboard: [CANCEL_W] } };
    case 'winners': return { text: `Ketik <b>jumlah posisi pemenang</b> (1 sampai ${Math.min(12, d.total_slots)}):`, markup: { inline_keyboard: [CANCEL_W] } };
    case 'schedule':
      return { text: 'Ketik <b>jadwal turnamen</b> (WIB), format:\n<code>2026-11-25 19:00</code>\nKetik <code>-</code> kalau belum ada.', markup: { inline_keyboard: [CANCEL_W] } };
    case 'deadline':
      return { text: 'Ketik <b>batas pendaftaran</b> (WIB), format sama:\n<code>2026-11-25 18:00</code>\nKetik <code>-</code> kalau belum ada.', markup: { inline_keyboard: [CANCEL_W] } };
    default:
      return { text: wizSummary(d), markup: { inline_keyboard: [[b('✅ Simpan', 'm:w:ok'), b('✖️ Batal', 'm:w:x')]] } };
  }
}

async function wizShow(env, chat, mid, d, err) {
  const step = wizNextStep(d);
  await setState(env, chat, 'w:' + step, d);
  const p = wizPrompt(d, step);
  return show(env, chat, mid, (err ? '❌ ' + err + '\n\n' : '') + p.text, p.markup);
}

async function wizStart(env, chat, mid) {
  const games = (await sb(env, 'GET', 'games?status=eq.active&select=id,name&order=sort_order.asc')) || [];
  if (!games.length) {
    return show(env, chat, mid, 'Belum ada game aktif di database.', { inline_keyboard: BACK });
  }
  const d = { gl: games };
  if (games.length === 1) { d.game_id = games[0].id; d.game_name = games[0].name; }
  return wizShow(env, chat, mid, d);
}

async function wizText(env, chat, st, text) {
  const d = st.data || {};
  const step = st.state.slice(2);
  const num = (s) => { const x = String(s).replace(/[.,\s]/g, ''); return /^\d{1,9}$/.test(x) ? parseInt(x, 10) : null; };
  let err = null;
  if (BUTTON_STEPS.includes(step) && step !== 'starters') err = 'Pilih lewat tombol.';
  else if (step === 'name') {
    if (text.length < 3 || text.length > 80) err = 'Nama harus 3 sampai 80 karakter.'; else d.name = text;
  } else if (step === 'slots') {
    const n = num(text); const max = d.format === 'BR' ? 12 : 32767;
    if (n === null || n < 2 || n > max) err = `Slot harus angka 2 sampai ${max}.`; else d.total_slots = n;
  } else if (step === 'starters') {
    const n = num(text);
    if (n === null || n < 1 || n > 20) err = 'Angka 1 sampai 20.'; else d.starters_per_team = n;
  } else if (step === 'matches') {
    const n = num(text);
    if (n === null || n < 1 || n > 100) err = 'Jumlah match harus angka 1 sampai 100.'; else d.match_count = n;
  } else if (step === 'fee') {
    const n = num(text);
    if (n === null) err = 'Ketik angka saja, contoh 50000 (0 = gratis).'; else d.entry_fee = n;
  } else if (step === 'prize') {
    const n = num(text);
    if (n === null) err = 'Ketik angka saja, contoh 500000 (0 jika tidak ada).'; else d.prize_pool = n;
  } else if (step === 'winners') {
    const n = num(text);
    if (n === null || n < 1 || n > Math.min(12, d.total_slots)) err = `Angka 1 sampai ${Math.min(12, d.total_slots)}.`; else d.winner_positions = n;
  } else if (step === 'schedule') {
    if (text === '-') d.schedule_at = null;
    else { const p = parseWib(text); if (!p) err = 'Format salah. Contoh: 2026-11-25 19:00'; else d.schedule_at = p.iso; }
  } else if (step === 'deadline') {
    if (text === '-') d.registration_deadline = null;
    else {
      const p = parseWib(text);
      if (!p) err = 'Format salah. Contoh: 2026-11-25 18:00';
      else if (d.schedule_at && new Date(p.iso) > new Date(d.schedule_at)) err = 'Batas pendaftaran tidak boleh setelah jadwal turnamen.';
      else d.registration_deadline = p.iso;
    }
  }
  return wizShow(env, chat, null, d, err);
}

async function wizCallback(env, chat, mid, parts) {
  const a = parts[2], v = parts[3];
  if (a === 'x') {
    await clearState(env, chat);
    return show(env, chat, mid, 'Pembuatan turnamen dibatalkan.', { inline_keyboard: [[b('🏆 Turnamen', 'm:t')], ...BACK] });
  }
  const st = await getState(env, chat);
  if (!st || !st.state.startsWith('w:')) {
    return show(env, chat, mid, 'Sesi pembuatan kedaluwarsa. Mulai lagi.', { inline_keyboard: [[b('➕ Buat Turnamen', 'm:t:new')], ...BACK] });
  }
  const d = st.data || {};
  if (a === 'g') {
    const g = (d.gl || [])[Number(v)];
    if (!g) return wizShow(env, chat, mid, d, 'Game tidak valid.');
    d.game_id = g.id; d.game_name = g.name;
  } else if (a === 'f') { d.format = v === 'CS' ? 'CS' : 'BR'; }
  else if (a === 's') { d.starters_per_team = Number(v); }
  else if (a === 'e') { d.cs_elimination = v === 'double' ? 'double' : 'single'; }
  else if (a === 'd') { d.cs_draw_method = v === 'shuffle' ? 'shuffle' : 'spin'; }
  else if (a === 'ok') {
    if (wizNextStep(d) !== 'confirm') return wizShow(env, chat, mid, d, 'Data belum lengkap.');
    const row = {
      game_id: d.game_id, name: d.name, format: d.format,
      entry_fee: d.entry_fee, prize_pool: d.prize_pool, winner_positions: d.winner_positions,
      total_slots: d.total_slots, starters_per_team: d.starters_per_team,
      schedule_at: d.schedule_at, registration_deadline: d.registration_deadline,
    };
    if (d.format === 'BR') row.match_count = d.match_count;
    else { row.cs_elimination = d.cs_elimination; row.cs_draw_method = d.cs_draw_method; }
    await clearState(env, chat);
    let created;
    try {
      created = await sb(env, 'POST', 'tournaments', row, 'return=representation');
    } catch (e) {
      await setState(env, chat, 'w:confirm', d);
      throw e;
    }
    const id = created?.[0]?.id;
    await audit(env, 'buat_turnamen', 'tournaments', d.name, id, null, row);
    const v = await tDetail(env, id, '✅ Turnamen dibuat. Status awal: Segera Hadir.');
    return show(env, chat, mid, v.text, v.markup);
  }
  return wizShow(env, chat, mid, d);
}

// ----- Input teks: tunda & jadwal lanjutan -----
async function tpText(env, chat, st, text) {
  const id = st.data?.tid;
  const t = await getT(env, id);
  if (FINAL.includes(t.status) || t.status === 'ditunda') throw new Error('Turnamen tidak bisa ditunda (status: ' + t.status + ')');
  if (text.length < 3) return show(env, chat, null, '❌ Alasan terlalu pendek. Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
  await clearState(env, chat);
  await patchT(env, id, { status: 'ditunda', postponed_reason: text.slice(0, 500) });
  await audit(env, 'tunda_turnamen', 'tournaments', text.slice(0, 500), id, { status: t.status }, { status: 'ditunda' });
  const v = await tDetail(env, id, '✅ Turnamen ditunda. Belum ada notifikasi jadwal karena belum ada tanggal pasti.');
  return show(env, chat, null, v.text, v.markup);
}

async function tjText(env, chat, st, text) {
  const id = st.data?.tid;
  const t = await getT(env, id);
  if (t.status !== 'ditunda') throw new Error('Jadwal lanjutan hanya untuk turnamen Ditunda');
  const p = parseWib(text);
  if (!p) {
    return show(env, chat, null, '❌ Format salah. Contoh: <code>2026-11-25 19:00 catatan opsional</code>', { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
  }
  await clearState(env, chat);
  await safePatchT(env, t, { schedule_at: p.iso, resume_note: p.note || null });
  await audit(env, 'jadwal_lanjutan', 'tournaments', p.note || 'via bot', id, { schedule_at: t.schedule_at }, { schedule_at: p.iso });
  const n = await notifyRegistrants(env, id, 'jadwal', 'Jadwal turnamen diperbarui',
    `${t.name}: jadwal baru ${wib(p.iso)}${p.note ? '. ' + p.note : ''}`);
  const v = await tDetail(env, id, `✅ Jadwal lanjutan: ${wib(p.iso)}\n${notifNote(n)}\n⚠️ Hitung ulang Waiting List belum aktif.`);
  return show(env, chat, null, v.text, v.markup);
}

// =====================================================================
// PENDAFTARAN & VERIFIKASI PEMBAYARAN
// =====================================================================
const RG_ST = [
  ['menunggu_verifikasi', '🕒 Menunggu Verifikasi'],
  ['menunggu_pembayaran', '💰 Menunggu Pembayaran'],
  ['data_belum_lengkap', '⚠️ Data Belum Lengkap'],
  ['resmi_terdaftar', '✅ Resmi Terdaftar'],
  ['ditolak', '🚫 Ditolak'],
  ['mengundurkan_diri', '↩️ Mengundurkan Diri'],
];
const rgLabel = (s) => (RG_ST.find((x) => x[0] === s) || [s, s])[1];

async function getReg(env, rid) {
  if (!UUID.test(rid)) throw new Error('ID pendaftaran tidak valid');
  const rows = await sb(env, 'GET', `registrations?id=eq.${rid}&select=*`);
  if (!rows?.[0]) throw new Error('Pendaftaran tidak ditemukan');
  return rows[0];
}

async function rgTournaments(env) {
  const [pending, rows] = await Promise.all([
    count(env, 'registrations?status=eq.menunggu_verifikasi&select=id'),
    sb(env, 'GET', 'tournaments?select=id,name,format,status&order=created_at.desc&limit=10'),
  ]);
  const kb = (rows || []).map((t) => [b(`${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`, 'm:rg:t:' + t.id)]);
  return {
    text: '<b>📝 Pendaftaran</b>\n' + (rows?.length ? 'Pilih turnamen:' : 'Belum ada turnamen.'),
    markup: { inline_keyboard: [[b(`💳 Menunggu Verifikasi (${pending})`, 'm:vp')], ...kb, ...BACK] },
  };
}

async function rgSummary(env, tid) {
  const t = await getT(env, tid);
  const rows = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&select=status&limit=1000`)) || [];
  const c = {};
  rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
  const lines = RG_ST.map(([k, l]) => `${l}: <b>${c[k] || 0}</b>`);
  const kb = RG_ST.map(([k, l], i) => (c[k] ? [b(`${l} (${c[k]})`, `m:rg:l:${tid}:${i}`)] : null)).filter(Boolean);
  kb.push([b('🔄 Segarkan', 'm:rg:t:' + tid), b('⬅️ Daftar', 'm:rg')]);
  return {
    text: `<b>📝 Pendaftaran</b>\n${esc(t.name)}\nSlot terisi: <b>${c.resmi_terdaftar || 0}/${t.total_slots}</b>\n\n` + lines.join('\n'),
    markup: { inline_keyboard: kb },
  };
}

async function rgList(env, tid, i) {
  const st = RG_ST[i];
  if (!st) throw new Error('Status tidak dikenal');
  if (!UUID.test(tid)) throw new Error('ID turnamen tidak valid');
  const rows = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&status=eq.${st[0]}&select=id,team_name&order=created_at.asc&limit=12`)) || [];
  const kb = rows.map((r) => [b(String(r.team_name || '(tanpa nama)').slice(0, 40), 'm:rg:v:' + r.id)]);
  kb.push([b('⬅️ Kembali', 'm:rg:t:' + tid)]);
  return { text: `<b>${st[1]}</b>\n${rows.length ? 'Pilih tim (maks 12 pertama):' : 'Kosong.'}`, markup: { inline_keyboard: kb } };
}

async function rgPending(env) {
  const rows = (await sb(env, 'GET', 'registrations?status=eq.menunggu_verifikasi&select=id,team_name,tournament_id&order=created_at.asc&limit=10')) || [];
  let names = {};
  if (rows.length) {
    const ids = [...new Set(rows.map((r) => r.tournament_id))];
    const ts = (await sb(env, 'GET', `tournaments?id=in.(${ids.join(',')})&select=id,name`)) || [];
    names = Object.fromEntries(ts.map((t) => [t.id, t.name]));
  }
  const kb = rows.map((r) => [b(`${String(r.team_name || '?').slice(0, 20)} · ${String(names[r.tournament_id] || '?').slice(0, 18)}`, 'm:rg:v:' + r.id)]);
  kb.push([b('🔄 Segarkan', 'm:vp')], ...BACK);
  return { text: '<b>💳 Verifikasi Pembayaran</b>\n' + (rows.length ? 'Menunggu verifikasi (10 terlama):' : 'Tidak ada yang menunggu verifikasi. 🎉'), markup: { inline_keyboard: kb } };
}

async function rgDetail(env, rid, notice) {
  const r = await getReg(env, rid);
  const [t, prof, pays] = await Promise.all([
    getT(env, r.tournament_id),
    sb(env, 'GET', `profiles?id=eq.${r.owner_id}&select=username,whatsapp`).catch(() => []),
    sb(env, 'GET', `payments?registration_id=eq.${rid}&select=method,amount,status,proof_path,proof_deleted_at,reject_reason&order=created_at.desc&limit=1`).catch(() => []),
  ]);
  const p = pays?.[0], pf = prof?.[0];
  const hasProof = !!(p?.proof_path && !p?.proof_deleted_at);
  const lines = [
    `<b>📝 ${esc(r.team_name)}</b>`,
    `Turnamen: ${esc(t.name)}`,
    `Status: ${rgLabel(r.status)}`,
    `Captain: ${esc(pf?.username || '-')} · WA: ${esc(pf?.whatsapp || '-')}`,
    `Biaya: ${rp(r.fee_amount)} · Metode: ${esc(r.payment_method || '-')}`,
  ];
  if (p) lines.push(`Pembayaran: ${esc(p.status)}${hasProof ? ' · bukti ada' : p.proof_deleted_at ? ' · bukti sudah dihapus' : ' · belum ada bukti'}`);
  if (p?.reject_reason) lines.push(`Alasan tolak bayar: ${esc(p.reject_reason)}`);
  if (r.incomplete_reason) lines.push(`Alasan data belum lengkap: ${esc(r.incomplete_reason)}`);
  if (r.reject_reason) lines.push(`Alasan ditolak: ${esc(r.reject_reason)}`);
  if (r.withdraw_requested_at) lines.push(`⚠️ Mengajukan mundur ${wib(r.withdraw_requested_at)}${r.withdraw_reason ? ': ' + esc(r.withdraw_reason) : ''} (diproses di menu berikutnya)`);

  const kb = [];
  if (r.status === 'menunggu_verifikasi') kb.push([b('✅ Verifikasi', 'm:rg:ok:' + rid), b('❌ Tolak Pembayaran', 'm:rg:no:' + rid)]);
  if (hasProof) kb.push([b('📷 Lihat Bukti', 'm:rg:pf:' + rid)]);
  const open = ['menunggu_pembayaran', 'menunggu_verifikasi', 'data_belum_lengkap'].includes(r.status);
  if (open) {
    const row = [];
    if (r.status !== 'data_belum_lengkap') row.push(b('⚠️ Data Belum Lengkap', 'm:rg:inc:' + rid));
    row.push(b('🚫 Tolak Pendaftaran', 'm:rg:rj:' + rid));
    kb.push(row);
  }
  kb.push([b('🔄 Segarkan', 'm:rg:v:' + rid), b('⬅️ Kembali', 'm:rg:t:' + r.tournament_id)]);
  return { text: (notice ? notice + '\n\n' : '') + lines.join('\n'), markup: { inline_keyboard: kb } };
}

async function rgVerifyConfirm(env, rid) {
  const r = await getReg(env, rid);
  if (r.status !== 'menunggu_verifikasi') throw new Error('Status bukan Menunggu Verifikasi (sekarang: ' + r.status + ')');
  return {
    text: `<b>Verifikasi pembayaran?</b>\nTim: ${esc(r.team_name)}\nBiaya: ${rp(r.fee_amount)}\nSetelah ini tim jadi ✅ Resmi Terdaftar dan slot bertambah. Pastikan bukti sudah dicek.`,
    markup: { inline_keyboard: [[b('✅ Ya, verifikasi', 'm:rg:oy:' + rid), b('✖️ Batal', 'm:rg:v:' + rid)]] },
  };
}

async function rgVerify(env, rid) {
  const r = await getReg(env, rid);
  if (r.status !== 'menunggu_verifikasi') throw new Error('Status bukan Menunggu Verifikasi (sekarang: ' + r.status + ')');
  await rpc(env, 'admin_verify_payment', { p_registration: rid });
  const t = await getT(env, r.tournament_id);
  const ok = await notify(env, r.owner_id, 'pembayaran', 'Pembayaran terverifikasi',
    `Tim ${r.team_name} resmi terdaftar di ${t.name}.`, r.tournament_id);
  return rgDetail(env, rid, '✅ Pembayaran terverifikasi.\n' + (ok ? '🔔 Notifikasi terkirim ke Captain.' : '⚠️ Notifikasi ke Captain GAGAL dikirim.'));
}

const RR = {
  no: { title: 'Tolak Pembayaran', from: ['menunggu_verifikasi'] },
  inc: { title: 'Tandai Data Belum Lengkap', from: ['menunggu_pembayaran', 'menunggu_verifikasi'] },
  rj: { title: 'Tolak Pendaftaran', from: ['menunggu_pembayaran', 'menunggu_verifikasi', 'data_belum_lengkap'] },
};

async function rrPrompt(env, chat, mid, rid, act) {
  const r = await getReg(env, rid);
  if (!RR[act].from.includes(r.status)) throw new Error('Aksi ini tidak berlaku untuk status ' + r.status);
  await setState(env, chat, 'rr', { rid, act });
  return show(env, chat, mid,
    `<b>${RR[act].title}</b>\nTim: ${esc(r.team_name)}\nKetik <b>alasan</b> (akan dikirim ke Captain):`,
    { inline_keyboard: [[b('✖️ Batal', 'm:rg:v:' + rid)]] });
}

async function rrText(env, chat, st, text) {
  const { rid, act } = st.data || {};
  if (!RR[act]) throw new Error('Sesi tidak valid');
  if (text.length < 3 || text.length > 300) {
    return show(env, chat, null, '❌ Alasan 3 sampai 300 karakter. Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:rg:v:' + rid)]] });
  }
  const r = await getReg(env, rid);
  if (!RR[act].from.includes(r.status)) throw new Error('Aksi ini tidak berlaku untuk status ' + r.status);
  const t = await getT(env, r.tournament_id);
  await clearState(env, chat);
  let kind, title, body;
  if (act === 'no') {
    await rpc(env, 'admin_reject_payment', { p_registration: rid, p_reason: text });
    kind = 'pembayaran'; title = 'Pembayaran ditolak';
    body = `Pembayaran tim ${r.team_name} di ${t.name} ditolak. Alasan: ${text}`;
  } else if (act === 'inc') {
    await rpc(env, 'admin_mark_incomplete', { p_registration: rid, p_reason: text });
    kind = 'pendaftaran'; title = 'Data pendaftaran belum lengkap';
    body = `Tim ${r.team_name} di ${t.name}: ${text}. Hubungi admin lewat WhatsApp untuk melengkapi.`;
  } else {
    await rpc(env, 'admin_reject_registration', { p_registration: rid, p_reason: text });
    kind = 'pendaftaran'; title = 'Pendaftaran ditolak';
    body = `Pendaftaran tim ${r.team_name} di ${t.name} ditolak. Alasan: ${text}`;
  }
  const ok = await notify(env, r.owner_id, kind, title, body, r.tournament_id);
  const v = await rgDetail(env, rid, `✅ ${RR[act].title} berhasil.\n` + (ok ? '🔔 Notifikasi terkirim ke Captain.' : '⚠️ Notifikasi ke Captain GAGAL dikirim.'));
  return show(env, chat, null, v.text, v.markup);
}

async function rgProof(env, chat, rid) {
  if (!UUID.test(rid)) throw new Error('ID pendaftaran tidak valid');
  const pays = await sb(env, 'GET', `payments?registration_id=eq.${rid}&select=proof_path,proof_deleted_at,amount&order=created_at.desc&limit=1`);
  const p = pays?.[0];
  if (!p?.proof_path || p.proof_deleted_at) {
    return tg(env, 'sendMessage', { chat_id: chat, text: 'Belum ada bukti bayar (atau sudah dihapus otomatis).' });
  }
  const path = p.proof_path.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/payment-proofs/${path}`, {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify({ expiresIn: 300 }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error('Gagal membuat link bukti: ' + (j.message || j.error || r.status));
  const link = j.signedURL.startsWith('http') ? j.signedURL
    : env.SUPABASE_URL + (j.signedURL.startsWith('/storage/v1') ? '' : '/storage/v1') + j.signedURL;
  const sent = await tg(env, 'sendPhoto', { chat_id: chat, photo: link, caption: `Bukti bayar · ${rp(p.amount)}` });
  if (!sent.ok) {
    await tg(env, 'sendMessage', { chat_id: chat, text: 'Gagal kirim foto (' + (sent.description || '?') + '). Link bukti (berlaku 5 menit):\n' + link });
  }
}

// =====================================================================
// PENGUMUMAN
// =====================================================================
const CANCEL_AN = [b('✖️ Batal', 'm:an:x')];

async function anList(env) {
  const rows = (await sb(env, 'GET', 'announcements?select=id,title,tournament_id&order=created_at.desc&limit=8')) || [];
  const kb = rows.map((a) => [b(`${a.tournament_id ? '🏆' : '🌐'} ${String(a.title).slice(0, 32)}`, 'm:an:v:' + a.id)]);
  return {
    text: '<b>📣 Pengumuman</b>\n' + (rows.length ? '8 terbaru:' : 'Belum ada pengumuman.'),
    markup: { inline_keyboard: [[b('➕ Buat Pengumuman', 'm:an:new')], ...kb, ...BACK] },
  };
}

async function anView(env, id, notice) {
  if (!UUID.test(id)) throw new Error('ID pengumuman tidak valid');
  const rows = await sb(env, 'GET', `announcements?id=eq.${id}&select=*`);
  const a = rows?.[0];
  if (!a) throw new Error('Pengumuman tidak ditemukan');
  let target = '🌐 Umum (website)';
  if (a.tournament_id) {
    const t = await getT(env, a.tournament_id).catch(() => null);
    target = '🏆 ' + esc(t?.name || '(turnamen dihapus)');
  }
  return {
    text: (notice ? notice + '\n\n' : '') + `<b>📣 ${esc(a.title)}</b>\nUntuk: ${target}\nDibuat: ${wib(a.created_at)}\n\n${esc(a.body)}`,
    markup: { inline_keyboard: [[b('🗑 Hapus', 'm:an:d:' + id)], [b('⬅️ Daftar', 'm:an')]] },
  };
}

async function anTargets(env) {
  const rows = (await sb(env, 'GET', 'tournaments?select=id,name,format,status&order=created_at.desc&limit=8')) || [];
  const kb = rows.map((t) => [b(`${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`, 'm:an:t:' + t.id)]);
  return {
    text: '<b>➕ Buat Pengumuman</b>\nUntuk siapa?\n\n🌐 Umum: tampil di website saja.\n🏆 Turnamen: tampil di website + notifikasi ke Captain yang timnya Resmi Terdaftar di turnamen itu.',
    markup: { inline_keyboard: [[b('🌐 Umum (website saja)', 'm:an:g')], ...kb, CANCEL_AN] },
  };
}

async function anTitleText(env, chat, st, text) {
  if (text.length < 3 || text.length > 100) {
    return show(env, chat, null, '❌ Judul 3 sampai 100 karakter. Ketik lagi atau /batal.', { inline_keyboard: [CANCEL_AN] });
  }
  await setState(env, chat, 'an_body', { ...st.data, title: text });
  return show(env, chat, null, 'Ketik <b>isi pengumuman</b> (maks 1000 karakter):', { inline_keyboard: [CANCEL_AN] });
}

async function anBodyText(env, chat, st, text) {
  if (text.length < 3 || text.length > 1000) {
    return show(env, chat, null, '❌ Isi 3 sampai 1000 karakter. Ketik lagi atau /batal.', { inline_keyboard: [CANCEL_AN] });
  }
  const d = { ...st.data, body: text };
  await setState(env, chat, 'an_conf', d);
  let who = '🌐 Umum (website saja, tanpa notifikasi)';
  if (d.tid) {
    const n = await count(env, `registrations?tournament_id=eq.${d.tid}&status=eq.resmi_terdaftar&select=id`);
    who = `🏆 ${esc(d.tname)}\nNotifikasi ke Captain dari ${n} tim Resmi Terdaftar`;
  }
  return show(env, chat, null,
    `<b>Konfirmasi pengumuman</b>\nUntuk: ${who}\n\n<b>${esc(d.title)}</b>\n${esc(d.body)}\n\nKirim?`,
    { inline_keyboard: [[b('✅ Kirim', 'm:an:ok'), b('✖️ Batal', 'm:an:x')]] });
}

async function anSend(env, chat, mid) {
  const st = await getState(env, chat);
  if (!st || st.state !== 'an_conf') {
    return show(env, chat, mid, 'Sesi kedaluwarsa. Buat pengumuman lagi.', { inline_keyboard: [[b('➕ Buat Pengumuman', 'm:an:new')], ...BACK] });
  }
  const d = st.data;
  await clearState(env, chat); // cegah kirim ganda kalau tombol ditekan dua kali
  const rows = await sb(env, 'POST', 'announcements',
    { tournament_id: d.tid || null, title: d.title, body: d.body }, 'return=representation');
  const id = rows?.[0]?.id;
  let note = '✅ Pengumuman tersimpan dan tampil di website.';
  if (d.tid) {
    const n = await notifyRegistrants(env, d.tid, 'pengumuman', d.title, d.body);
    note += '\n' + notifNote(n);
  } else {
    note += '\nℹ️ Pengumuman umum tidak dikirim sebagai notifikasi.';
  }
  await audit(env, 'buat_pengumuman', 'announcements', d.title, id, null, { tournament_id: d.tid || null });
  const v = await anView(env, id, note);
  return show(env, chat, mid, v.text, v.markup);
}

async function anDelete(env, chat, mid, id) {
  if (!UUID.test(id)) throw new Error('ID pengumuman tidak valid');
  const rows = await sb(env, 'GET', `announcements?id=eq.${id}&select=title,tournament_id`);
  if (!rows?.[0]) throw new Error('Pengumuman tidak ditemukan');
  await sb(env, 'DELETE', `announcements?id=eq.${id}`);
  await audit(env, 'hapus_pengumuman', 'announcements', rows[0].title, id, rows[0], null);
  const v = await anList(env);
  return show(env, chat, mid, '🗑 Pengumuman dihapus dari website (notifikasi yang sudah terkirim tetap ada di Captain).\n\n' + v.text, v.markup);
}

// =====================================================================
// ROUTER
// =====================================================================
async function onCallback(env, cq) {
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  const chat = cq.message.chat.id, mid = cq.message.message_id, d = cq.data || '';
  const parts = d.split(':');
  // Bersihkan state input teks kecuali sedang di wizard atau simpan tabel poin
  if (!(d.startsWith('m:w:') || d === 'm:pt:save' || d === 'm:an:ok')) await clearState(env, chat);

  if (d === 'm:main') return show(env, chat, mid, MAIN_TEXT, MAIN);
  if (d === 'm:dash') return show(env, chat, mid, await dashboard(env), { inline_keyboard: [[b('🔄 Segarkan', 'm:dash')], ...BACK] });
  if (d === 'm:mon') {
    return show(env, chat, mid, '<b>🩺 Monitoring</b>', {
      inline_keyboard: [[b('🩺 Health Check', 'm:health'), b('🗄 Storage', 'm:storage')], ...BACK],
    });
  }
  if (d === 'm:health') return show(env, chat, mid, await healthText(env), { inline_keyboard: [[b('🔄 Ulangi', 'm:health')], ...BACK] });
  if (d === 'm:storage') return show(env, chat, mid, await storageText(env), { inline_keyboard: [[b('🔄 Segarkan', 'm:storage')], ...BACK] });
  if (d === 'm:set') { const s = await settingsMenu(env); return show(env, chat, mid, s.text, s.markup); }
  if (d === 'm:reg:0' || d === 'm:reg:1') {
    const on = d.endsWith('1');
    await setSetting(env, 'registration_on', on);
    await audit(env, on ? 'registrasi_on' : 'registrasi_off', 'site_settings', 'via bot');
    const s = await settingsMenu(env); return show(env, chat, mid, s.text, s.markup);
  }
  if (d === 'm:mt:0' || d === 'm:mt:1') {
    const on = d.endsWith('1');
    await setSetting(env, 'maintenance', { on, reason: on ? 'Pemeliharaan oleh admin' : '' });
    await audit(env, on ? 'maintenance_on' : 'maintenance_off', 'site_settings', 'via bot');
    const s = await settingsMenu(env); return show(env, chat, mid, s.text, s.markup);
  }

  // ----- Tabel Poin -----
  if (d === 'm:pt') { const v = await ptView(env); return show(env, chat, mid, v.text, v.markup); }
  if (d === 'm:pt:edit') {
    const n = Number(await count(env, 'br_matches?status=eq.hasil_dipublikasikan&select=id'));
    if (n > 0) {
      return show(env, chat, mid,
        `<b>⚠️ Peringatan</b>\nAda <b>${n}</b> match BR yang sudah dikonfirmasi. Poin dihitung saat konfirmasi, jadi mengubah tabel ini <b>TIDAK</b> mengubah hasil match lama.\n\n` +
        'Kalau hasil lama mau ikut berubah: batalkan konfirmasi match (menu BR, nanti), lalu konfirmasi ulang.\n\nTetap ubah tabel poin?',
        { inline_keyboard: [[b('✏️ Tetap Ubah', 'm:pt:go'), b('✖️ Batal', 'm:pt')]] });
    }
    return ptPrompt(env, chat, mid);
  }
  if (d === 'm:pt:go') return ptPrompt(env, chat, mid);
  if (d === 'm:pt:save') return ptSave(env, chat, mid);

  // ----- Turnamen -----
  if (d === 'm:t') { const v = await tList(env); return show(env, chat, mid, v.text, v.markup); }
  if (d === 'm:t:new') return wizStart(env, chat, mid);
  if (parts[1] === 'w') return wizCallback(env, chat, mid, parts);
  if (parts[1] === 't') {
    const a = parts[2], id = parts[3];
    if (a === 'v') { const v = await tDetail(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 's') { const v = await tStatusMenu(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'ss' || a === 'sy') {
      const v = await tSetStatus(env, id, Number(parts[4]), a === 'sy');
      return show(env, chat, mid, v.text, v.markup);
    }
    if (a === 'r') { const v = await tToggleReg(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'p') {
      const t = await getT(env, id);
      if (FINAL.includes(t.status) || t.status === 'ditunda') throw new Error('Turnamen tidak bisa ditunda (status: ' + t.status + ')');
      await setState(env, chat, 'tp', { tid: id });
      return show(env, chat, mid, `<b>⏸ Tunda Turnamen</b>\n${esc(t.name)}\nKetik <b>alasan penundaan</b>:`, { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
    }
    if (a === 'j') {
      const t = await getT(env, id);
      if (t.status !== 'ditunda') throw new Error('Jadwal lanjutan hanya untuk turnamen Ditunda');
      await setState(env, chat, 'tj', { tid: id });
      return show(env, chat, mid,
        `<b>📅 Jadwal Lanjutan</b>\n${esc(t.name)}\nKetik tanggal & jam (WIB), catatan opsional di belakangnya:\n<code>2026-11-25 19:00 catatan</code>`,
        { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
    }
    if (a === 'c') { const v = await tResumeMenu(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'c0') { const v = await tResume(env, id, null); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'cm') { const v = await tResume(env, id, parts[4]); return show(env, chat, mid, v.text, v.markup); }
  }

  // ----- Pengumuman -----
  if (d === 'm:an' || d === 'm:an:x') { const v = await anList(env); return show(env, chat, mid, v.text, v.markup); }
  if (parts[1] === 'an') {
    const a = parts[2], id = parts[3];
    if (a === 'v') { const v = await anView(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'new') { const v = await anTargets(env); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'g') {
      await setState(env, chat, 'an_title', { tid: null });
      return show(env, chat, mid, '<b>➕ Pengumuman Umum</b>\nKetik <b>judul</b> (maks 100 karakter):', { inline_keyboard: [CANCEL_AN] });
    }
    if (a === 't') {
      const t = await getT(env, id);
      await setState(env, chat, 'an_title', { tid: id, tname: t.name });
      return show(env, chat, mid, `<b>➕ Pengumuman: ${esc(t.name)}</b>\nKetik <b>judul</b> (maks 100 karakter):`, { inline_keyboard: [CANCEL_AN] });
    }
    if (a === 'ok') return anSend(env, chat, mid);
    if (a === 'd') {
      return show(env, chat, mid, '<b>Hapus pengumuman ini dari website?</b>\nNotifikasi yang sudah terkirim ke Captain tidak ikut terhapus.',
        { inline_keyboard: [[b('🗑 Ya, hapus', 'm:an:dy:' + id), b('✖️ Batal', 'm:an:v:' + id)]] });
    }
    if (a === 'dy') return anDelete(env, chat, mid, id);
  }

  // ----- Pendaftaran & Verifikasi Pembayaran -----
  if (d === 'm:rg') { const v = await rgTournaments(env); return show(env, chat, mid, v.text, v.markup); }
  if (d === 'm:vp') { const v = await rgPending(env); return show(env, chat, mid, v.text, v.markup); }
  if (parts[1] === 'rg') {
    const a = parts[2], id = parts[3];
    if (a === 't') { const v = await rgSummary(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'l') { const v = await rgList(env, id, Number(parts[4])); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'v') { const v = await rgDetail(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'ok') { const v = await rgVerifyConfirm(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'oy') { const v = await rgVerify(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'no' || a === 'inc' || a === 'rj') return rrPrompt(env, chat, mid, id, a);
    if (a === 'pf') return rgProof(env, chat, id);
  }

  if (d.startsWith('m:soon:')) {
    return show(env, chat, mid, `<b>${esc(d.slice(7))}</b>\nMenu ini belum aktif. Dibangun di tahap Bot berikutnya.`, { inline_keyboard: BACK });
  }
}

async function onMessage(env, msg) {
  const chat = msg.chat.id;
  const text = (msg.text || '').trim();
  if (text === '/start' || text === '/menu') { await clearState(env, chat); return show(env, chat, null, MAIN_TEXT, MAIN); }
  if (text === '/batal') { await clearState(env, chat); return show(env, chat, null, 'Dibatalkan.\n\n' + MAIN_TEXT, MAIN); }
  if (text === '/health') return show(env, chat, null, await healthText(env), { inline_keyboard: BACK });
  if (text.startsWith('/')) return show(env, chat, null, 'Perintah tidak dikenal. Ketik /menu untuk membuka panel.', undefined);
  const st = text ? await getState(env, chat) : null;
  if (st) {
    if (st.state === 'pt_edit') return ptTextInput(env, chat, text);
    if (st.state === 'pt_save') return show(env, chat, null, 'Tekan tombol Simpan / Ulangi / Batal di pesan konfirmasi.', undefined);
    if (st.state.startsWith('w:')) return wizText(env, chat, st, text);
    if (st.state === 'tp') return tpText(env, chat, st, text);
    if (st.state === 'tj') return tjText(env, chat, st, text);
    if (st.state === 'rr') return rrText(env, chat, st, text);
    if (st.state === 'an_title') return anTitleText(env, chat, st, text);
    if (st.state === 'an_body') return anBodyText(env, chat, st, text);
    if (st.state === 'an_conf') return show(env, chat, null, 'Tekan tombol Kirim atau Batal di pesan konfirmasi.', undefined);
  }
  return show(env, chat, null, 'Ketik /menu untuk membuka panel.', undefined);
}

async function handle(env, update) {
  const from = update.message?.from || update.callback_query?.from;
  if (!from || String(from.id) !== String(env.ADMIN_ID)) return; // hanya Super Admin
  if (update.update_id != null && !(await firstTime(env, update.update_id))) return; // sudah diproses
  try {
    if (update.callback_query) await onCallback(env, update.callback_query);
    else if (update.message) await onMessage(env, update.message);
  } catch (e) {
    await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: 'Terjadi error: ' + String(e.message).slice(0, 300) });
  }
}

// ---------- Cron (tiap 5 menit): heartbeat + proses job ----------
async function cron(env) {
  const me = await tg(env, 'getMe');
  if (!me.ok) return; // bot tidak sehat -> jangan kirim heartbeat
  await rpc(env, 'sys_bot_heartbeat');
  const jobs = (await rpc(env, 'sys_claim_jobs', { p_limit: 10 })) || [];
  for (const job of jobs) {
    try {
      if (job.kind === 'admin_telegram') {
        const r = await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: String(job.payload?.text || '').slice(0, 3500) });
        if (!r.ok) throw new Error(r.description || 'gagal kirim');
        await rpc(env, 'sys_job_done', { p_id: job.id });
      } else if (job.kind === 'web_push') {
        // Web Push dibangun di Tahap 9. Notifikasi tetap tersimpan di database.
        await rpc(env, 'sys_job_done', { p_id: job.id });
      } else {
        await rpc(env, 'sys_job_fail', { p_id: job.id, p_error: 'jenis job tidak dikenal: ' + job.kind, p_permanent: true });
      }
    } catch (e) {
      await rpc(env, 'sys_job_fail', { p_id: job.id, p_error: String(e.message), p_permanent: false }).catch(() => null);
    }
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === `/setup/${env.WEBHOOK_SECRET}`) {
      const r = await tg(env, 'setWebhook', {
        url: `${url.origin}/webhook/${env.WEBHOOK_SECRET}`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
    }
    if (req.method === 'POST' && url.pathname === `/webhook/${env.WEBHOOK_SECRET}`
        && req.headers.get('x-telegram-bot-api-secret-token') === env.WEBHOOK_SECRET) {
      const update = await req.json().catch(() => null);
      if (update) ctx.waitUntil(handle(env, update));
      return new Response('ok');
    }
    return new Response('GH-T Arena Bot', { status: 200 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env).catch(() => null));
  },
};
