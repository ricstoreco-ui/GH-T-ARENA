// GH-T ARENA — Telegram Bot Worker v0.5 (Cloudflare Workers, module syntax)
// Baru di v0.5: Banner, QRIS & Aset (upload dari Telegram), Konfigurasi, Waiting List (lihat),
// Pengajuan Mundur, Captain (cari, saldo), Edit Turnamen, Batalkan Turnamen, Ganti Banner Turnamen.
// Baru di v0.4: menu Pengumuman. Baru di v0.3: Pendaftaran + Verifikasi Pembayaran + notifikasi Captain.
// Baru di v0.2: Tabel Poin, Turnamen, input teks (bot_state), idempotensi (bot_processed_updates).
// Variabel di Cloudflare (JANGAN tulis nilainya di file ini):
//   BOT_TOKEN, ADMIN_ID, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
// Butuh SQL 5.09 (fungsi sys_check_values) untuk menu Mundur dan Batalkan Turnamen.

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
    [b('⏳ Waiting List', 'm:wl'), b('↩️ Pengajuan Mundur', 'm:wd')],
    [b('👤 Captain', 'm:cp'), b('💸 Pencairan', 'm:soon:Pencairan Hadiah')],
    [b('⚙️ Pengaturan', 'm:set'), b('🩺 Monitoring', 'm:mon')],
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
        [b('🖼 Banner', 'm:bn'), b('🧾 QRIS & Aset', 'm:as')],
        [b('🔧 Konfigurasi', 'm:cfg')],
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
    kb.push([b('✏️ Edit', 'm:te:m:' + id), b('🚫 Batalkan Turnamen', 'm:cc:s:' + id)]);
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
  l.push('\n<i>Hadiah per posisi, banner, deskripsi: diatur di menu Edit setelah turnamen dibuat.</i>');
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
    const v2 = await tDetail(env, id, '✅ Turnamen dibuat. Status awal: Segera Hadir.');
    return show(env, chat, mid, v2.text, v2.markup);
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
  if (r.withdraw_requested_at) lines.push(`⚠️ Mengajukan mundur ${wib(r.withdraw_requested_at)}${r.withdraw_reason ? ': ' + esc(r.withdraw_reason) : ''} (proses di menu Pengajuan Mundur)`);

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
  if (r.withdraw_requested_at && r.status !== 'mengundurkan_diri') kb.push([b('↩️ Proses Pengajuan Mundur', 'm:wd:v:' + rid)]);
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
// HELPER UMUM v0.5
// =====================================================================
async function checkVals(env, table, col) {
  let v;
  try { v = await rpc(env, 'sys_check_values', { p_table: table, p_column: col }); }
  catch (e) { throw new Error('Fungsi sys_check_values belum ada. Jalankan SQL 5.09 dulu. (' + e.message.slice(0, 80) + ')'); }
  return Array.isArray(v) ? [...new Set(v)] : [];
}

async function notifyOwners(env, ownerIds, kind, title, body, tid = null) {
  try {
    const ids = [...new Set(ownerIds)].filter(Boolean);
    if (!ids.length) return 0;
    await sb(env, 'POST', 'notifications',
      ids.map((u) => ({ user_id: u, kind, title, body, data: {}, tournament_id: tid, is_read: false })),
      'return=minimal');
    return ids.length;
  } catch (e) { return null; }
}

async function withRegLock(env, t, fn) {
  const needLock = t.status === 'pendaftaran_dibuka' && t.registration_enabled;
  if (needLock) await patchT(env, t.id, { registration_enabled: false });
  try { return await fn(); }
  finally { if (needLock) await patchT(env, t.id, { registration_enabled: true }).catch(() => null); }
}

function parsePairs(text, maxPlace) {
  const t = text.trim().replace(/\s*=\s*/g, '=');
  const out = {};
  for (const p of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = p.match(/^(\d{1,2})=(\d{1,12})$/);
    if (!m) return { err: `Format salah: "${p}"` };
    const pl = +m[1];
    if (pl < 1 || pl > maxPlace) return { err: `Posisi harus 1 sampai ${maxPlace} (kamu tulis ${pl}).` };
    out[pl] = Number(m[2]);
  }
  if (!Object.keys(out).length) return { err: 'Tidak ada data.' };
  return { out };
}

// =====================================================================
// UPLOAD GAMBAR (Telegram -> Supabase Storage) + file_registry
// =====================================================================
const MAXIMG = 10 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const publicUrl = (env, bucket, path) => `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${encPath(path)}`;
function ourPath(env, url, bucket) {
  const pre = `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/`;
  return typeof url === 'string' && url.startsWith(pre) ? decodeURIComponent(url.slice(pre.length)) : null;
}

function pickImage(msg) {
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { file_id: p.file_id, mime: 'image/jpeg', size: p.file_size || 0, caption: (msg.caption || '').trim() };
  }
  if (msg.document) {
    const m = msg.document.mime_type || '';
    if (EXT[m]) return { file_id: msg.document.file_id, mime: m, size: msg.document.file_size || 0, caption: (msg.caption || '').trim() };
    return { bad: true };
  }
  return null;
}

async function downloadTg(env, fileId) {
  const g = await tg(env, 'getFile', { file_id: fileId });
  if (!g.ok) throw new Error('getFile: ' + (g.description || '?'));
  const r = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${g.result.file_path}`);
  if (!r.ok) throw new Error('Unduh file dari Telegram gagal: ' + r.status);
  return r.arrayBuffer();
}

async function storageUpload(env, bucket, path, bytes, mime) {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${encPath(path)}`, {
    method: 'POST',
    headers: { ...sbHeaders(env), 'content-type': mime, 'x-upsert': 'false' },
    body: bytes,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error('Upload gagal: ' + (j.message || j.error || r.status));
  }
}

async function storageDelete(env, bucket, path) {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${encPath(path)}`, { method: 'DELETE', headers: sbHeaders(env) });
  return r.ok || r.status === 404;
}

async function regUpsert(env, row) {
  try {
    await sb(env, 'POST', 'file_registry?on_conflict=bucket,path', { in_use: true, ...row }, 'resolution=merge-duplicates,return=minimal');
    return true;
  } catch (e) { return false; }
}

async function regRelease(env, bucket, path, deleted) {
  const body = deleted
    ? { in_use: false, deleted_at: new Date().toISOString() }
    : { in_use: false, delete_after: new Date().toISOString() };
  try { await sb(env, 'PATCH', `file_registry?bucket=eq.${bucket}&path=eq.${encodeURIComponent(path)}`, body, 'return=minimal'); } catch (e) { /* abaikan */ }
}

// Hapus file lama SETELAH yang baru berhasil dipakai
async function dropOld(env, bucket, path) {
  if (!path) return;
  const ok = await storageDelete(env, bucket, path);
  await regRelease(env, bucket, path, ok);
}

async function sendImageCard(env, chat, url, caption, markup) {
  const r = await tg(env, 'sendPhoto', { chat_id: chat, photo: url, caption, parse_mode: 'HTML', reply_markup: markup });
  if (!r.ok) await show(env, chat, null, caption + '\n<i>(gambar gagal ditampilkan)</i>', markup);
}

// =====================================================================
// BANNER
// =====================================================================
async function bnList(env, notice) {
  const rows = (await sb(env, 'GET', 'banners?select=id,title,sort_order,is_active&order=sort_order.asc,created_at.asc&limit=20')) || [];
  const kb = rows.map((r, i) => [b(`${i + 1}. ${r.is_active ? '✅' : '⛔'} ${String(r.title || '(tanpa judul)').slice(0, 30)}`, 'm:bn:v:' + r.id)]);
  return {
    text: (notice ? notice + '\n\n' : '') + '<b>🖼 Banner</b>\n' + (rows.length ? 'Urutan tampil di website (atas = pertama). Pilih banner:' : 'Belum ada banner.'),
    markup: { inline_keyboard: [[b('➕ Upload Banner', 'm:bn:new')], ...kb, ...BACK] },
  };
}

async function bnGet(env, id) {
  if (!UUID.test(id)) throw new Error('ID banner tidak valid');
  const rows = await sb(env, 'GET', `banners?id=eq.${id}&select=*`);
  if (!rows?.[0]) throw new Error('Banner tidak ditemukan');
  return rows[0];
}

async function bnShow(env, chat, id, notice) {
  const bn = await bnGet(env, id);
  const caption = (notice ? notice + '\n' : '') + `<b>Banner #${bn.sort_order}</b> ${bn.is_active ? '✅ Aktif' : '⛔ Nonaktif'}\n${esc(bn.title || '(tanpa judul)')}`;
  const markup = {
    inline_keyboard: [
      [b('⬆️ Naik', 'm:bn:u:' + id), b('⬇️ Turun', 'm:bn:dn:' + id)],
      [b(bn.is_active ? '⛔ Nonaktifkan' : '✅ Aktifkan', 'm:bn:a:' + id), b('🔁 Ganti Gambar', 'm:bn:r:' + id)],
      [b('🗑 Hapus', 'm:bn:d:' + id)],
      [b('⬅️ Daftar Banner', 'm:bn')],
    ],
  };
  return sendImageCard(env, chat, bn.image_url, caption, markup);
}

async function bnMove(env, id, dir) {
  const rows = (await sb(env, 'GET', 'banners?select=id,sort_order&order=sort_order.asc,created_at.asc')) || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sort_order !== i + 1) {
      await sb(env, 'PATCH', `banners?id=eq.${rows[i].id}`, { sort_order: i + 1 }, 'return=minimal');
      rows[i].sort_order = i + 1;
    }
  }
  const idx = rows.findIndex((r) => r.id === id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= rows.length) return false;
  const A = rows[idx], B = rows[j];
  await sb(env, 'PATCH', `banners?id=eq.${A.id}`, { sort_order: 100000 + idx }, 'return=minimal'); // sementara
  await sb(env, 'PATCH', `banners?id=eq.${B.id}`, { sort_order: idx + 1 }, 'return=minimal');
  await sb(env, 'PATCH', `banners?id=eq.${A.id}`, { sort_order: j + 1 }, 'return=minimal');
  return true;
}

async function bnDelete(env, id) {
  const bn = await bnGet(env, id);
  await sb(env, 'DELETE', `banners?id=eq.${id}`);
  await dropOld(env, 'banners', bn.storage_path);
  await audit(env, 'hapus_banner', 'banners', bn.title || '-', id, { image_url: bn.image_url }, null);
}

// =====================================================================
// LOGO & ASET, QRIS
// =====================================================================
const ASSET_KEYS = [
  ['qris_qr_image', '🔳 Gambar QR Pembayaran'],
  ['logo_qris', 'Logo QRIS'],
  ['logo_transparent', 'Logo GH-T Arena (transparan)'],
  ['logo_original', 'Logo GH-T Arena (original)'],
  ['logo_free_fire', 'Logo Free Fire'],
  ['logo_garena', 'Logo Garena'],
  ['logo_gh_topup', 'Logo GH TOPUP'],
  ['logo_dana', 'Logo DANA'],
];

async function asGetVal(env, key) {
  const rows = await sb(env, 'GET', `site_settings?key=eq.${key}&select=value`);
  return rows?.[0]?.value ?? null;
}

function asList() {
  return {
    text: '<b>🧾 QRIS & Aset</b>\nPilih aset untuk dilihat atau diganti. Perubahan langsung dipakai website.\n<i>Logo QRIS = identitas metode bayar. Gambar QR = kode yang dipindai Captain.</i>',
    markup: { inline_keyboard: [...ASSET_KEYS.map(([k, l], i) => [b(l, 'm:as:v:' + i)]), ...BACK] },
  };
}

async function asShow(env, chat, i, notice) {
  const a = ASSET_KEYS[i];
  if (!a) throw new Error('Aset tidak dikenal');
  const val = await asGetVal(env, a[0]);
  const caption = (notice ? notice + '\n' : '') + `<b>${esc(a[1])}</b>\n${val ? '' : 'Belum diisi.'}`;
  const markup = { inline_keyboard: [[b('🔁 Ganti Gambar', 'm:as:r:' + i)], [b('⬅️ Daftar Aset', 'm:as')]] };
  if (!val) return show(env, chat, null, caption, markup);
  return sendImageCard(env, chat, val, caption, markup);
}

// =====================================================================
// PROSES UPLOAD (banner, aset, banner turnamen)
// =====================================================================
async function onUpload(env, chat, st, img) {
  if (img.bad) return show(env, chat, null, '❌ Kirim sebagai foto, atau file gambar JPG / PNG / WEBP.', undefined);
  if (img.size > MAXIMG) return show(env, chat, null, '❌ Ukuran file maksimal 10 MB.', undefined);
  const d = st.data || {};
  const bytes = await downloadTg(env, img.file_id);
  if (bytes.byteLength > MAXIMG) throw new Error('Ukuran file lebih dari 10 MB');
  const ext = EXT[img.mime];
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const size = bytes.byteLength;

  if (st.state === 'bn_up') {
    const path = `b-${stamp}.${ext}`;
    await storageUpload(env, 'banners', path, bytes, img.mime);
    const url = publicUrl(env, 'banners', path);
    if (d.mode === 'replace') {
      const old = await bnGet(env, d.id);
      try { await sb(env, 'PATCH', `banners?id=eq.${d.id}`, { image_url: url, storage_path: path }, 'return=minimal'); }
      catch (e) { await storageDelete(env, 'banners', path); throw e; }
      const okReg = await regUpsert(env, { bucket: 'banners', path, kind: 'banner', ref_table: 'banners', ref_id: d.id, size_bytes: size });
      await dropOld(env, 'banners', old.storage_path);
      await clearState(env, chat);
      await audit(env, 'ganti_gambar_banner', 'banners', 'via bot', d.id, { image_url: old.image_url }, { image_url: url });
      return bnShow(env, chat, d.id, '✅ Gambar banner diganti.' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
    }
    const last = (await sb(env, 'GET', 'banners?select=sort_order&order=sort_order.desc&limit=1'))?.[0];
    let row;
    try {
      row = (await sb(env, 'POST', 'banners',
        { title: img.caption || null, image_url: url, storage_path: path, sort_order: (last?.sort_order || 0) + 1, is_active: true },
        'return=representation'))?.[0];
    } catch (e) { await storageDelete(env, 'banners', path); throw e; }
    const okReg = await regUpsert(env, { bucket: 'banners', path, kind: 'banner', ref_table: 'banners', ref_id: row.id, size_bytes: size });
    await clearState(env, chat);
    await audit(env, 'upload_banner', 'banners', img.caption || '-', row.id, null, { image_url: url });
    return bnShow(env, chat, row.id, '✅ Banner ditambahkan (judul dari caption foto, kalau ada).' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
  }

  if (st.state === 'tb_up') {
    const t = await getT(env, d.tid);
    const path = `t-${d.tid}-${stamp}.${ext}`;
    await storageUpload(env, 'banners', path, bytes, img.mime);
    const url = publicUrl(env, 'banners', path);
    try { await patchT(env, d.tid, { banner_url: url }); }
    catch (e) { await storageDelete(env, 'banners', path); throw e; }
    const okReg = await regUpsert(env, { bucket: 'banners', path, kind: 'tournament_banner', tournament_id: d.tid, ref_table: 'tournaments', ref_id: d.tid, size_bytes: size });
    await dropOld(env, 'banners', ourPath(env, t.banner_url, 'banners'));
    await clearState(env, chat);
    await audit(env, 'banner_turnamen', 'tournaments', 'via bot', d.tid, { banner_url: t.banner_url }, { banner_url: url });
    const v = await tDetail(env, d.tid, '✅ Banner turnamen diganti.' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
    return show(env, chat, null, v.text, v.markup);
  }

  if (st.state === 'as_up') {
    const a = ASSET_KEYS.findIndex((x) => x[0] === d.key);
    if (a < 0) throw new Error('Aset tidak dikenal');
    const path = `assets/${d.key}-${stamp}.${ext}`;
    await storageUpload(env, 'site-assets', path, bytes, img.mime);
    const url = publicUrl(env, 'site-assets', path);
    const cur = await asGetVal(env, d.key);
    try { await setSetting(env, d.key, url); }
    catch (e) { await storageDelete(env, 'site-assets', path); throw e; }
    const okReg = await regUpsert(env, { bucket: 'site-assets', path, kind: 'asset', ref_table: 'site_settings', size_bytes: size });
    await dropOld(env, 'site-assets', ourPath(env, cur, 'site-assets'));
    await clearState(env, chat);
    await audit(env, 'ganti_aset', 'site_settings', d.key, null, { value: cur }, { value: url });
    return asShow(env, chat, a, '✅ Gambar diganti. Website otomatis memakai gambar terbaru.' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
  }
}

// =====================================================================
// KONFIGURASI WEBSITE
// =====================================================================
const CFG = [
  ['admin_whatsapp', 'WhatsApp Admin'],
  ['waitlist_offer_minutes', 'Batas respons Waiting List (menit)'],
];

async function cfgMenu(env, notice) {
  const rows = (await sb(env, 'GET', `site_settings?key=in.(${CFG.map((c) => c[0]).join(',')})&select=key,value`)) || [];
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const lines = CFG.map(([k, l]) => `${l}: <b>${esc(m[k] === '' || m[k] == null ? '(kosong)' : m[k])}</b>`);
  return {
    text: (notice ? notice + '\n\n' : '') + '<b>🔧 Konfigurasi</b>\n' + lines.join('\n'),
    markup: { inline_keyboard: [...CFG.map(([k, l], i) => [b('✏️ ' + l, 'm:cfg:e:' + i)]), [b('⬅️ Pengaturan', 'm:set')]] },
  };
}

async function cfgText(env, chat, st, text) {
  const key = st.data?.key;
  const c = CFG.find((x) => x[0] === key);
  if (!c) throw new Error('Sesi tidak valid');
  let val;
  if (key === 'admin_whatsapp') {
    if (text === '-') val = '';
    else if (/^\+?\d{8,15}$/.test(text.replace(/[\s-]/g, ''))) val = text.replace(/[\s-]/g, '');
    else return show(env, chat, null, '❌ Nomor tidak valid. Contoh: 628123456789. Ketik - untuk mengosongkan.', { inline_keyboard: [[b('✖️ Batal', 'm:cfg')]] });
  } else {
    const n = /^\d{1,4}$/.test(text) ? Number(text) : 0;
    if (n < 1 || n > 1440) return show(env, chat, null, '❌ Isi angka 1 sampai 1440 (menit).', { inline_keyboard: [[b('✖️ Batal', 'm:cfg')]] });
    val = n;
  }
  const old = await asGetVal(env, key);
  await clearState(env, chat);
  await setSetting(env, key, val);
  await audit(env, 'ubah_konfigurasi', 'site_settings', key, null, { value: old }, { value: val });
  const v = await cfgMenu(env, `✅ ${esc(c[1])} diperbarui.`);
  return show(env, chat, null, v.text, v.markup);
}

// =====================================================================
// WAITING LIST (lihat antrean; diproses otomatis oleh housekeeping tiap 10 menit)
// =====================================================================
async function wlTournaments(env) {
  const rows = (await sb(env, 'GET', 'waiting_list?status=in.(menunggu,ditawari)&select=tournament_id,status&limit=1000')) || [];
  const per = {};
  rows.forEach((r) => { per[r.tournament_id] ??= { menunggu: 0, ditawari: 0 }; per[r.tournament_id][r.status]++; });
  const ids = Object.keys(per);
  let names = {};
  if (ids.length) {
    const ts = (await sb(env, 'GET', `tournaments?id=in.(${ids.join(',')})&select=id,name`)) || [];
    names = Object.fromEntries(ts.map((t) => [t.id, t.name]));
  }
  const kb = ids.map((id) => [b(`${String(names[id] || '?').slice(0, 24)} (${per[id].menunggu} antre, ${per[id].ditawari} ditawari)`, 'm:wl:t:' + id)]);
  return {
    text: '<b>⏳ Waiting List</b>\n' + (ids.length ? 'Turnamen dengan antrean aktif:' : 'Tidak ada antrean aktif.') +
      '\n<i>Penawaran slot diproses otomatis tiap 10 menit.</i>',
    markup: { inline_keyboard: [...kb, [b('🔄 Segarkan', 'm:wl')], ...BACK] },
  };
}

async function wlQueue(env, tid) {
  const t = await getT(env, tid);
  const rows = (await sb(env, 'GET', `waiting_list?tournament_id=eq.${tid}&status=in.(menunggu,ditawari)&select=seq,status,team_id,offer_expires_at&order=seq.asc&limit=30`)) || [];
  let names = {};
  const tids = [...new Set(rows.map((r) => r.team_id))];
  if (tids.length) {
    try {
      const ts = (await sb(env, 'GET', `teams?id=in.(${tids.join(',')})&select=id,name`)) || [];
      names = Object.fromEntries(ts.map((x) => [x.id, x.name]));
    } catch (e) { /* nama tim tidak tersedia */ }
  }
  const lines = rows.map((r) =>
    `#${r.seq} ${esc(names[r.team_id] || String(r.team_id).slice(0, 8))} — ${r.status === 'ditawari' ? '📨 ditawari' : '🕒 menunggu'}` +
    (r.status === 'ditawari' && r.offer_expires_at ? ` (batas ${wib(r.offer_expires_at)})` : ''));
  return {
    text: `<b>⏳ Antrean: ${esc(t.name)}</b>\n` + (lines.join('\n') || 'Kosong.'),
    markup: { inline_keyboard: [[b('🔄 Segarkan', 'm:wl:t:' + tid), b('⬅️ Daftar', 'm:wl')]] },
  };
}

// =====================================================================
// PENGAJUAN MUNDUR (setujui / tolak)
// =====================================================================
const COMP = [
  ['mundur_poin_dipertahankan', 'Mundur, poin dipertahankan'],
  ['dq', 'Diskualifikasi (DQ)'],
  ['dikeluarkan', 'Dikeluarkan dari perhitungan'],
];

async function wdList(env, notice) {
  const rows = (await sb(env, 'GET', 'registrations?withdraw_requested_at=not.is.null&status=neq.mengundurkan_diri&select=id,team_name,tournament_id&order=withdraw_requested_at.asc&limit=10')) || [];
  let names = {};
  if (rows.length) {
    const ids = [...new Set(rows.map((r) => r.tournament_id))];
    const ts = (await sb(env, 'GET', `tournaments?id=in.(${ids.join(',')})&select=id,name`)) || [];
    names = Object.fromEntries(ts.map((t) => [t.id, t.name]));
  }
  const kb = rows.map((r) => [b(`${String(r.team_name || '?').slice(0, 20)} · ${String(names[r.tournament_id] || '?').slice(0, 18)}`, 'm:wd:v:' + r.id)]);
  return {
    text: (notice ? notice + '\n\n' : '') + '<b>↩️ Pengajuan Mundur</b>\n' + (rows.length ? 'Menunggu keputusan (10 terlama):' : 'Tidak ada pengajuan mundur.'),
    markup: { inline_keyboard: [...kb, [b('🔄 Segarkan', 'm:wd')], ...BACK] },
  };
}

async function wdDetail(env, rid) {
  const r = await getReg(env, rid);
  const [t, prof] = await Promise.all([
    getT(env, r.tournament_id),
    sb(env, 'GET', `profiles?id=eq.${r.owner_id}&select=username,whatsapp`).catch(() => []),
  ]);
  const pf = prof?.[0];
  return {
    text:
      `<b>↩️ ${esc(r.team_name)}</b>\nTurnamen: ${esc(t.name)} (${stLabel(t.status)})\nStatus: ${rgLabel(r.status)}\n` +
      `Captain: ${esc(pf?.username || '-')} · WA: ${esc(pf?.whatsapp || '-')}\n` +
      `Biaya: ${rp(r.fee_amount)} · Metode: ${esc(r.payment_method || '-')}\n` +
      `Diajukan: ${wib(r.withdraw_requested_at)}\nAlasan: ${esc(r.withdraw_reason || '-')}`,
    markup: {
      inline_keyboard: [
        [b('✅ Setujui', 'm:wd:a:' + rid), b('❌ Tolak', 'm:wd:x:' + rid)],
        [b('⬅️ Daftar', 'm:wd')],
      ],
    },
  };
}

function wdNext(d) {
  if (d.dst == null) return 'dst';
  if (d.pct == null) return 'pct';
  if (d.needComp && d.comp == null) return 'comp';
  if (d.pct !== 100 && d.rsn === undefined) return 'rsn';
  return 'confirm';
}

function wdPrompt(d, step) {
  const CX = [b('✖️ Batal', 'm:wx:x')];
  if (step === 'dst') {
    const kb = [];
    for (let i = 0; i < d.dsts.length; i += 2) kb.push(d.dsts.slice(i, i + 2).map((v, j) => b(v, 'm:wx:d:' + (i + j))));
    return { text: `<b>Setujui pengunduran: ${esc(d.team)}</b>\nPilih <b>tujuan refund</b>:`, markup: { inline_keyboard: [...kb, CX] } };
  }
  if (step === 'pct') {
    return { text: `Berapa <b>persen refund</b>? (biaya ${rp(d.fee)})\nPilih atau ketik angka 0 sampai 100:`, markup: { inline_keyboard: [[b('100%', 'm:wx:p:100'), b('50%', 'm:wx:p:50'), b('0%', 'm:wx:p:0')], CX] } };
  }
  if (step === 'comp') {
    return { text: 'Turnamen BR sudah berlangsung. Status tim di kompetisi:', markup: { inline_keyboard: [...COMP.map((c, i) => [b(c[1], 'm:wx:c:' + i)]), CX] } };
  }
  if (step === 'rsn') {
    return { text: 'Refund bukan 100%. Ketik <b>alasan pengecualian</b>, atau ketik - untuk lewati:', markup: { inline_keyboard: [CX] } };
  }
  const amount = Math.floor((Number(d.fee) * d.pct) / 100);
  return {
    text:
      `<b>Konfirmasi pengunduran</b>\nTim: ${esc(d.team)}\nTurnamen: ${esc(d.tname)}\nTujuan refund: ${esc(d.dst)}\n` +
      `Refund: ${d.pct}% = ${rp(amount)}\n` + (d.needComp ? `Status kompetisi: ${esc(d.comp)}\n` : '') +
      (d.rsn && d.rsn !== '-' ? `Alasan: ${esc(d.rsn)}\n` : '') + '\nProses?',
    markup: { inline_keyboard: [[b('✅ Ya, setujui', 'm:wx:ok'), CX[0]]] },
  };
}

async function wdShow(env, chat, mid, d, err) {
  const step = wdNext(d);
  await setState(env, chat, 'wd:' + step, d);
  const p = wdPrompt(d, step);
  return show(env, chat, mid, (err ? '❌ ' + err + '\n\n' : '') + p.text, p.markup);
}

async function wdStart(env, chat, mid, rid) {
  const r = await getReg(env, rid);
  if (!r.withdraw_requested_at || r.status === 'mengundurkan_diri') throw new Error('Tidak ada pengajuan mundur aktif untuk tim ini');
  const t = await getT(env, r.tournament_id);
  const dsts = await checkVals(env, 'refund_requests', 'destination');
  if (!dsts.length) throw new Error('Daftar tujuan refund kosong. Pastikan SQL 5.09 sudah dijalankan.');
  const d = { rid, dsts, team: r.team_name, tname: t.name, fee: r.fee_amount, needComp: t.format === 'BR' && t.status === 'berlangsung' };
  return wdShow(env, chat, mid, d);
}

async function wdText(env, chat, st, text) {
  const d = st.data || {};
  const step = st.state.slice(3);
  let err = null;
  if (step === 'pct') {
    const n = /^\d{1,3}$/.test(text) ? Number(text) : -1;
    if (n < 0 || n > 100) err = 'Isi angka 0 sampai 100.'; else d.pct = n;
  } else if (step === 'rsn') {
    if (text !== '-' && (text.length < 3 || text.length > 300)) err = 'Alasan 3 sampai 300 karakter, atau ketik -.'; else d.rsn = text;
  } else err = 'Pilih lewat tombol.';
  return wdShow(env, chat, null, d, err);
}

async function wdCallback(env, chat, mid, parts) {
  const a = parts[2], v = parts[3];
  if (a === 'x') {
    await clearState(env, chat);
    const l = await wdList(env, 'Dibatalkan.');
    return show(env, chat, mid, l.text, l.markup);
  }
  const st = await getState(env, chat);
  if (!st || !st.state.startsWith('wd:')) {
    const l = await wdList(env, 'Sesi kedaluwarsa. Pilih ulang.');
    return show(env, chat, mid, l.text, l.markup);
  }
  const d = st.data || {};
  if (a === 'd') { d.dst = d.dsts[Number(v)]; if (d.dst == null) return wdShow(env, chat, mid, d, 'Pilihan tidak valid.'); }
  else if (a === 'p') { d.pct = Number(v); }
  else if (a === 'c') { d.comp = COMP[Number(v)]?.[0]; if (!d.comp) return wdShow(env, chat, mid, d, 'Pilihan tidak valid.'); }
  else if (a === 'ok') {
    if (wdNext(d) !== 'confirm') return wdShow(env, chat, mid, d, 'Data belum lengkap.');
    const r = await getReg(env, d.rid);
    if (!r.withdraw_requested_at || r.status === 'mengundurkan_diri') throw new Error('Pengajuan sudah diproses');
    const amount = Math.floor((Number(d.fee) * d.pct) / 100);
    await clearState(env, chat);
    await rpc(env, 'admin_approve_withdraw', {
      p_registration: d.rid, p_percent: d.pct, p_destination: d.dst,
      p_exception_reason: d.rsn && d.rsn !== '-' ? d.rsn : null,
      p_competition: d.needComp ? d.comp : null,
    });
    const ok = await notify(env, r.owner_id, 'pendaftaran', 'Pengunduran diri disetujui',
      `Pengunduran tim ${d.team} dari ${d.tname} disetujui. Refund ${d.pct}% (${rp(amount)}) ke: ${d.dst}.`, r.tournament_id);
    const l = await wdList(env, '✅ Pengunduran disetujui.\n' + (ok ? '🔔 Notifikasi terkirim ke Captain.' : '⚠️ Notifikasi ke Captain GAGAL dikirim.'));
    return show(env, chat, mid, l.text, l.markup);
  }
  return wdShow(env, chat, mid, d);
}

async function wdRejText(env, chat, st, text) {
  const rid = st.data?.rid;
  if (text.length < 3 || text.length > 300) {
    return show(env, chat, null, '❌ Alasan 3 sampai 300 karakter. Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:wd:v:' + rid)]] });
  }
  const r = await getReg(env, rid);
  if (!r.withdraw_requested_at || r.status === 'mengundurkan_diri') throw new Error('Pengajuan sudah diproses');
  const t = await getT(env, r.tournament_id);
  await clearState(env, chat);
  await rpc(env, 'admin_reject_withdraw', { p_registration: rid, p_reason: text });
  const ok = await notify(env, r.owner_id, 'pendaftaran', 'Pengunduran diri ditolak',
    `Pengajuan mundur tim ${r.team_name} dari ${t.name} ditolak. Alasan: ${text}`, r.tournament_id);
  const l = await wdList(env, '✅ Pengajuan ditolak.\n' + (ok ? '🔔 Notifikasi terkirim ke Captain.' : '⚠️ Notifikasi ke Captain GAGAL dikirim.'));
  return show(env, chat, null, l.text, l.markup);
}

// =====================================================================
// CAPTAIN: SALDO
// =====================================================================
function ledgerLine(r) {
  const f = [];
  if (r.created_at) f.push(wib(r.created_at));
  for (const k of ['kind', 'type', 'amount', 'balance_after', 'reason', 'note']) {
    if (r[k] !== undefined && r[k] !== null) f.push(`${k}: ${typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]}`);
  }
  return '• ' + esc(f.join(' · ').slice(0, 170));
}

async function cpDetail(env, uid, notice) {
  if (!UUID.test(uid)) throw new Error('ID user tidak valid');
  const rows = await sb(env, 'GET', `profiles?id=eq.${uid}&select=id,username,whatsapp`);
  const p = rows?.[0];
  if (!p) throw new Error('Captain tidak ditemukan');
  const [nt, nr, led] = await Promise.all([
    count(env, `teams?owner_id=eq.${uid}&select=id`).catch(() => '?'),
    count(env, `registrations?owner_id=eq.${uid}&select=id`).catch(() => '?'),
    sb(env, 'GET', `wallet_ledger?user_id=eq.${uid}&select=*&order=created_at.desc&limit=5`).catch(() => null),
  ]);
  return {
    text:
      (notice ? notice + '\n\n' : '') +
      `<b>👤 ${esc(p.username)}</b>\nWA: ${esc(p.whatsapp || '-')}\nTim: ${nt} · Pendaftaran: ${nr}\n\n<b>Ledger saldo (5 terakhir)</b>\n` +
      (led === null ? '(ledger tidak terbaca)' : led.length ? led.map(ledgerLine).join('\n') : 'Belum ada transaksi.'),
    markup: {
      inline_keyboard: [
        [b('💰 Ubah Saldo', 'm:cp:b:' + uid), b('🗑 Hapus Akun', 'm:cp:d:' + uid)],
        [b('🔎 Cari Lagi', 'm:cp:s'), b('⬅️ Menu Utama', 'm:main')],
      ],
    },
  };
}

async function cpFindText(env, chat, text) {
  const term = text.replace(/[^\w.\- ]/g, '').trim();
  if (term.length < 2) return show(env, chat, null, '❌ Ketik minimal 2 karakter username. Atau /batal.', { inline_keyboard: BACK });
  const rows = (await sb(env, 'GET', `profiles?username=ilike.*${encodeURIComponent(term)}*&select=id,username&limit=8`)) || [];
  await clearState(env, chat);
  if (!rows.length) return show(env, chat, null, 'Tidak ada Captain dengan username itu.', { inline_keyboard: [[b('🔎 Cari Lagi', 'm:cp:s')], ...BACK] });
  return show(env, chat, null, '<b>Hasil pencarian</b>', {
    inline_keyboard: [...rows.map((r) => [b(String(r.username).slice(0, 40), 'm:cp:u:' + r.id)]), [b('🔎 Cari Lagi', 'm:cp:s')], ...BACK],
  });
}

async function cpAmtText(env, chat, st, text) {
  const t = text.replace(/[.\s]/g, '');
  if (!/^-?\d{1,9}$/.test(t) || Number(t) === 0) {
    return show(env, chat, null, '❌ Isi angka bukan nol. Tambah: 50000, kurangi: -20000. Atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:cp:u:' + st.data.uid)]] });
  }
  await setState(env, chat, 'cp_rsn', { ...st.data, amt: Number(t) });
  return show(env, chat, null, 'Ketik <b>alasan</b> perubahan saldo (3 sampai 200 karakter):', { inline_keyboard: [[b('✖️ Batal', 'm:cp:u:' + st.data.uid)]] });
}

async function cpRsnText(env, chat, st, text) {
  if (text.length < 3 || text.length > 200) {
    return show(env, chat, null, '❌ Alasan 3 sampai 200 karakter. Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:cp:u:' + st.data.uid)]] });
  }
  const d = { ...st.data, rsn: text };
  await setState(env, chat, 'cp_conf', d);
  return show(env, chat, null,
    `<b>Konfirmasi ubah saldo</b>\nCaptain: ${esc(d.uname)}\nPerubahan: <b>${d.amt > 0 ? '+' : '-'}${rp(Math.abs(d.amt))}</b>\nAlasan: ${esc(d.rsn)}\n\nProses?`,
    { inline_keyboard: [[b('✅ Ya, proses', 'm:cx:ok'), b('✖️ Batal', 'm:cp:u:' + d.uid)]] });
}

async function cpApply(env, chat, mid) {
  const st = await getState(env, chat);
  if (!st || st.state !== 'cp_conf') {
    return show(env, chat, mid, 'Sesi kedaluwarsa. Ulangi dari menu Captain.', { inline_keyboard: [[b('👤 Captain', 'm:cp')], ...BACK] });
  }
  const d = st.data;
  await clearState(env, chat);
  const res = await rpc(env, 'admin_adjust_balance', { p_user: d.uid, p_amount: d.amt, p_reason: d.rsn });
  const ok = await notify(env, d.uid, 'saldo', 'Saldo GH-T Arena diperbarui',
    `Saldo ${d.amt > 0 ? 'bertambah' : 'berkurang'} ${rp(Math.abs(d.amt))}. Alasan: ${d.rsn}`);
  const v = await cpDetail(env, d.uid,
    `✅ Saldo diubah.\n${ok ? '🔔 Notifikasi terkirim ke Captain.' : '⚠️ Notifikasi ke Captain GAGAL dikirim.'}\nHasil sistem: ${esc(JSON.stringify(res)).slice(0, 160)}`);
  return show(env, chat, mid, v.text, v.markup);
}

// =====================================================================
// EDIT TURNAMEN & BATALKAN TURNAMEN
// =====================================================================
const TE = [
  ['name', 'Nama'], ['description', 'Deskripsi'], ['entry_fee', 'Biaya'], ['prize_pool', 'Total Hadiah'],
  ['total_slots', 'Jumlah Slot'], ['starters_per_team', 'Pemain Utama/Tim'], ['winner_positions', 'Posisi Pemenang'],
  ['schedule_at', 'Jadwal'], ['registration_deadline', 'Batas Daftar'], ['prizes', 'Hadiah per Posisi'],
];
const ACTIVE_REG = 'status=in.(menunggu_pembayaran,menunggu_verifikasi,data_belum_lengkap,resmi_terdaftar)';

async function teMenu(env, tid) {
  const t = await getT(env, tid);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan, tidak bisa diedit');
  const kb = [];
  for (let i = 0; i < TE.length; i += 2) kb.push(TE.slice(i, i + 2).map(([k, l], j) => b(l, `m:te:f:${tid}:${i + j}`)));
  kb.push([b('🖼 Ganti Banner', 'm:te:b:' + tid)], [b('⬅️ Kembali', 'm:t:v:' + tid)]);
  return {
    text: `<b>✏️ Edit: ${esc(t.name)}</b>\nPilih yang diubah.\n<i>Jadwal, biaya, hadiah, dan batas daftar saat pendaftaran dibuka: registrasi dimatikan sementara otomatis, lalu dinyalakan lagi.</i>`,
    markup: { inline_keyboard: kb },
  };
}

async function tePrompt(env, chat, mid, tid, i) {
  const t = await getT(env, tid);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const item = TE[i];
  if (!item) throw new Error('Pilihan tidak valid');
  const k = item[0];
  await setState(env, chat, 'te', { tid, k });
  let ask = '';
  if (k === 'name') ask = `Sekarang: ${esc(t.name)}\nKetik nama baru (3 sampai 80 karakter):`;
  else if (k === 'description') ask = 'Ketik deskripsi (maks 1000 karakter). Ketik - untuk menghapus.';
  else if (k === 'entry_fee') ask = `Sekarang: ${rp(t.entry_fee)}\nKetik biaya baru (Rp, angka saja, 0 = gratis):`;
  else if (k === 'prize_pool') ask = `Sekarang: ${rp(t.prize_pool)}\nKetik total hadiah baru (Rp, angka saja):`;
  else if (k === 'total_slots') ask = `Sekarang: ${t.total_slots}\nKetik jumlah slot baru (${t.format === 'BR' ? '2 sampai 12' : 'minimal 2'}; tidak boleh di bawah slot terisi atau jumlah posisi pemenang):`;
  else if (k === 'starters_per_team') ask = `Sekarang: ${t.starters_per_team}\nKetik jumlah pemain utama/tim (1 sampai 20). Tidak bisa diubah kalau sudah ada pendaftaran aktif.`;
  else if (k === 'winner_positions') ask = `Sekarang: ${t.winner_positions}\nKetik jumlah posisi pemenang (1 sampai ${Math.min(12, t.total_slots)}):`;
  else if (k === 'schedule_at') ask = `Sekarang: ${wib(t.schedule_at)}\nKetik jadwal baru (WIB): <code>2026-11-25 19:00</code>\nKetik - untuk mengosongkan.`;
  else if (k === 'registration_deadline') ask = `Sekarang: ${wib(t.registration_deadline)}\nKetik batas daftar baru (WIB): <code>2026-11-25 18:00</code>\nKetik - untuk mengosongkan.`;
  else {
    const pr = (await sb(env, 'GET', `tournament_prizes?tournament_id=eq.${tid}&select=place,amount&order=place.asc`)) || [];
    ask = `Sekarang: ${pr.length ? pr.map((x) => `${x.place}=${x.amount}`).join(', ') : '(belum diatur)'}\n` +
      `Ketik SEMUA posisi (1 sampai ${t.winner_positions}), contoh:\n<code>1=100000, 2=50000, 3=25000</code>\nIni menggantikan distribusi lama.`;
  }
  return show(env, chat, mid, `<b>✏️ ${esc(item[1])}</b>\n${ask}`, { inline_keyboard: [[b('✖️ Batal', 'm:te:m:' + tid)]] });
}

async function teText(env, chat, st, text) {
  const { tid, k } = st.data || {};
  const t = await getT(env, tid);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const num = (s) => { const x = String(s).replace(/[.,\s]/g, ''); return /^\d{1,12}$/.test(x) ? Number(x) : null; };
  const filled = Number(await count(env, `registrations?tournament_id=eq.${tid}&status=eq.resmi_terdaftar&select=id`)) || 0;
  let patch = null, err = null, prizeRows = null, notice = '', schedChanged = false;

  if (k === 'name') {
    if (text.length < 3 || text.length > 80) err = 'Nama 3 sampai 80 karakter.'; else patch = { name: text };
  } else if (k === 'description') {
    if (text !== '-' && text.length > 1000) err = 'Maksimal 1000 karakter.'; else patch = { description: text === '-' ? null : text };
  } else if (k === 'entry_fee' || k === 'prize_pool') {
    const n = num(text);
    if (n === null) err = 'Ketik angka saja.'; else patch = { [k]: n };
  } else if (k === 'total_slots') {
    const n = num(text);
    const max = t.format === 'BR' ? 12 : 32767;
    if (n === null || n < 2 || n > max) err = `Slot harus 2 sampai ${max}.`;
    else if (n < filled) err = `Slot terisi sudah ${filled}. Tidak boleh di bawah itu.`;
    else if (n < t.winner_positions) err = `Posisi pemenang saat ini ${t.winner_positions}. Turunkan dulu posisi pemenang.`;
    else patch = { total_slots: n };
  } else if (k === 'starters_per_team') {
    const n = num(text);
    const active = Number(await count(env, `registrations?tournament_id=eq.${tid}&${ACTIVE_REG}&select=id`)) || 0;
    if (n === null || n < 1 || n > 20) err = 'Angka 1 sampai 20.';
    else if (active > 0) err = `Sudah ada ${active} pendaftaran aktif. Jumlah pemain utama tidak bisa diubah.`;
    else patch = { starters_per_team: n };
  } else if (k === 'winner_positions') {
    const n = num(text);
    const max = Math.min(12, t.total_slots);
    if (n === null || n < 1 || n > max) err = `Angka 1 sampai ${max}.`; else patch = { winner_positions: n };
  } else if (k === 'schedule_at') {
    if (text === '-') patch = { schedule_at: null };
    else {
      const p = parseWib(text);
      if (!p) err = 'Format salah. Contoh: 2026-11-25 19:00';
      else if (t.registration_deadline && new Date(t.registration_deadline) > new Date(p.iso)) err = 'Batas daftar saat ini sesudah jadwal baru. Ubah batas daftar dulu.';
      else { patch = { schedule_at: p.iso }; schedChanged = true; }
    }
  } else if (k === 'registration_deadline') {
    if (text === '-') patch = { registration_deadline: null };
    else {
      const p = parseWib(text);
      if (!p) err = 'Format salah. Contoh: 2026-11-25 18:00';
      else if (t.schedule_at && new Date(p.iso) > new Date(t.schedule_at)) err = 'Batas daftar tidak boleh sesudah jadwal turnamen.';
      else patch = { registration_deadline: p.iso };
    }
  } else if (k === 'prizes') {
    const p = parsePairs(text, t.winner_positions);
    if (p.err) err = p.err;
    else prizeRows = Object.entries(p.out).map(([pl, amt]) => ({ tournament_id: tid, place: Number(pl), amount: amt }));
  } else err = 'Sesi tidak valid.';

  if (err) return show(env, chat, null, '❌ ' + err + '\nKetik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:te:m:' + tid)]] });
  await clearState(env, chat);

  if (prizeRows) {
    await withRegLock(env, t, async () => {
      await sb(env, 'POST', 'tournament_prizes?on_conflict=tournament_id,place', prizeRows, 'resolution=merge-duplicates,return=minimal');
      await sb(env, 'DELETE', `tournament_prizes?tournament_id=eq.${tid}&place=not.in.(${prizeRows.map((r) => r.place).join(',')})`);
    });
    const sum = prizeRows.reduce((a, r) => a + r.amount, 0);
    await audit(env, 'edit_hadiah_per_posisi', 'tournament_prizes', 'via bot', tid, null, { distribusi: prizeRows.map((r) => `${r.place}=${r.amount}`) });
    notice = '✅ Hadiah per posisi disimpan.' + (sum !== Number(t.prize_pool) ? `\n⚠️ Total distribusi ${rp(sum)} berbeda dari Total Hadiah ${rp(t.prize_pool)}.` : '');
  } else {
    const important = ['entry_fee', 'prize_pool', 'schedule_at', 'registration_deadline', 'total_slots', 'winner_positions'].includes(k);
    if (important) await withRegLock(env, t, () => patchT(env, tid, patch));
    else await patchT(env, tid, patch);
    await audit(env, 'edit_turnamen', 'tournaments', k, tid, { [k]: t[k] }, patch);
    notice = `✅ ${TE.find((x) => x[0] === k)[1]} diperbarui.`;
    if (schedChanged && patch.schedule_at) {
      const n = await notifyRegistrants(env, tid, 'jadwal', 'Jadwal turnamen diperbarui', `${t.name}: jadwal baru ${wib(patch.schedule_at)}`);
      notice += '\n' + notifNote(n) + '\n⚠️ Hitung ulang Waiting List belum otomatis.';
    }
  }
  const v = await tDetail(env, tid, notice);
  return show(env, chat, null, v.text, v.markup);
}

async function ccStart(env, chat, mid, tid) {
  const t = await getT(env, tid);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const dsts = await checkVals(env, 'refund_requests', 'destination');
  if (!dsts.length) throw new Error('Daftar tujuan refund kosong. Pastikan SQL 5.09 sudah dijalankan.');
  const kb = [];
  for (let i = 0; i < dsts.length; i += 2) kb.push(dsts.slice(i, i + 2).map((v, j) => b(v, `m:cc:d:${tid}:${i + j}`)));
  kb.push([b('✖️ Batal', 'm:t:v:' + tid)]);
  return show(env, chat, mid,
    `<b>🚫 Batalkan turnamen</b>\n${esc(t.name)}\nDefault refund 100%. Pilih <b>tujuan refund</b>:`, { inline_keyboard: kb });
}

async function ccDest(env, chat, mid, tid, i) {
  const dsts = await checkVals(env, 'refund_requests', 'destination');
  const dst = dsts[i];
  if (!dst) throw new Error('Pilihan tidak valid');
  const t = await getT(env, tid);
  await setState(env, chat, 'cc', { tid, dst, tname: t.name });
  return show(env, chat, mid, `<b>🚫 Batalkan: ${esc(t.name)}</b>\nTujuan refund: ${esc(dst)}\nKetik <b>alasan pembatalan</b> (3 sampai 300 karakter):`,
    { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + tid)]] });
}

async function ccText(env, chat, st, text) {
  const d = st.data;
  if (text.length < 3 || text.length > 300) {
    return show(env, chat, null, '❌ Alasan 3 sampai 300 karakter. Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + d.tid)]] });
  }
  const n = await count(env, `registrations?tournament_id=eq.${d.tid}&${ACTIVE_REG}&select=id`);
  await setState(env, chat, 'cc_conf', { ...d, reason: text });
  return show(env, chat, null,
    `<b>⚠️ Konfirmasi pembatalan</b>\nTurnamen: ${esc(d.tname)}\nTujuan refund: ${esc(d.dst)}\nAlasan: ${esc(text)}\nPendaftaran aktif terdampak: ${n}\n\nTindakan ini tidak bisa dibatalkan. Lanjut?`,
    { inline_keyboard: [[b('🚫 Ya, batalkan turnamen', 'm:cc:ok')], [b('✖️ Tidak', 'm:t:v:' + d.tid)]] });
}

async function ccApply(env, chat, mid) {
  const st = await getState(env, chat);
  if (!st || st.state !== 'cc_conf') {
    return show(env, chat, mid, 'Sesi kedaluwarsa. Ulangi dari detail turnamen.', { inline_keyboard: [[b('🏆 Turnamen', 'm:t')], ...BACK] });
  }
  const d = st.data;
  await clearState(env, chat);
  const t = await getT(env, d.tid);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${d.tid}&${ACTIVE_REG}&select=owner_id`)) || [];
  await rpc(env, 'admin_cancel_tournament', { p_tournament: d.tid, p_reason: d.reason, p_destination: d.dst, p_exceptions: [] });
  const n = await notifyOwners(env, regs.map((r) => r.owner_id), 'pendaftaran', 'Turnamen dibatalkan',
    `${t.name} dibatalkan. Alasan: ${d.reason}. Refund diproses ke: ${d.dst}.`, d.tid);
  const v = await tDetail(env, d.tid, `✅ Turnamen dibatalkan.\n${notifNote(n)}`);
  return show(env, chat, mid, v.text, v.markup);
}

// =====================================================================
// ROUTER
// =====================================================================
async function onCallback(env, cq) {
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  const chat = cq.message.chat.id, mid = cq.message.message_id, d = cq.data || '';
  const parts = d.split(':');
  // Bersihkan state input teks kecuali di tengah alur yang butuh state
  const KEEP = d.startsWith('m:w:') || d.startsWith('m:wx:') || d === 'm:pt:save' || d === 'm:an:ok' || d === 'm:cx:ok' || d === 'm:cc:ok';
  if (!KEEP) await clearState(env, chat);

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

  // ----- Edit & Batalkan Turnamen -----
  if (parts[1] === 'te') {
    const a = parts[2], id = parts[3];
    if (a === 'm') { const v = await teMenu(env, id); return show(env, chat, mid, v.text, v.markup); }
    if (a === 'f') return tePrompt(env, chat, mid, id, Number(parts[4]));
    if (a === 'b') {
      const t = await getT(env, id);
      if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
      await setState(env, chat, 'tb_up', { tid: id });
      return show(env, chat, mid, `<b>🖼 Banner: ${esc(t.name)}</b>\nKirim <b>foto</b> banner baru (atau file JPG/PNG/WEBP, maks 10 MB).`,
        { inline_keyboard: [[b('✖️ Batal', 'm:te:m:' + id)]] });
    }
  }
  if (parts[1] === 'cc') {
    const a = parts[2];
    if (a === 's') return ccStart(env, chat, mid, parts[3]);
    if (a === 'd') return ccDest(env, chat, mid, parts[3], Number(parts[4]));
    if (a === 'ok') return ccApply(env, chat, mid);
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

  // ----- Banner -----
  if (d === 'm:bn') { const v = await bnList(env); return show(env, chat, mid, v.text, v.markup); }
  if (parts[1] === 'bn') {
    const a = parts[2], id = parts[3];
    if (a === 'new') {
      await setState(env, chat, 'bn_up', { mode: 'new' });
      return show(env, chat, mid, '<b>➕ Upload Banner</b>\nKirim <b>foto</b> banner (atau file JPG/PNG/WEBP, maks 10 MB).\nCaption foto jadi judul banner (opsional).',
        { inline_keyboard: [[b('✖️ Batal', 'm:bn')]] });
    }
    if (a === 'v') return bnShow(env, chat, id);
    if (a === 'u' || a === 'dn') 
