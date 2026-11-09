// GH-T ARENA — Telegram Bot Worker v0.2 (Cloudflare Workers, module syntax)
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
    [b('📝 Pendaftaran', 'm:soon:Pendaftaran'), b('💳 Pembayaran', 'm:soon:Verifikasi Pembayaran')],
    [b('🎯 Battle Royale', 'm:soon:Battle Royale'), b('⚔️ Clash Squad', 'm:soon:Clash Squad')],
    [b('🧮 Tabel Poin', 'm:pt'), b('📣 Pengumuman', 'm:soon:Pengumuman')],
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
  await tg(env, 'sendMessage', body);
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
  const lines = [
    `<b>🏆 ${esc(t.name)}</b>`,
    `Format: ${t.format === 'BR' ? '🎯 Battle Royale' : '⚔️ Clash Squad'}`,
    `Status: ${stLabel(t.status)}`,
    `Registrasi: ${t.registration_enabled ? '🟢 ON' : '🔴 OFF'}`,
    `Slot total: ${t.total_slots} · Pemain utama/tim: ${t.starters_per_team} · Cadangan maks: ${t.max_subs}`,
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
  return tDetail(env, id, `✅ Turnamen dilanjutkan${matchNo ? ` (Match ${matchNo} berlangsung)` : ''}.\n⚠️ Notifikasi ke Captain belum aktif di versi ini.`);
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
    return tDetail(env, id, '✅ Turnamen dibuat. Status awal: Segera Hadir.');
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
  return tDetail(env, id, '✅ Turnamen ditunda. Belum ada notifikasi jadwal karena belum ada tanggal pasti.');
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
  return tDetail(env, id, `✅ Jadwal lanjutan: ${wib(p.iso)}\n⚠️ Notifikasi ke Captain dan hitung ulang Waiting List belum aktif di versi ini.`);
}

// =====================================================================
// ROUTER
// =====================================================================
async function onCallback(env, cq) {
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  const chat = cq.message.chat.id, mid = cq.message.message_id, d = cq.data || '';
  const parts = d.split(':');
  // Bersihkan state input teks kecuali sedang di wizard atau simpan tabel poin
  if (!(d.startsWith('m:w:') || d === 'm:pt:save')) await clearState(env, chat);

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
