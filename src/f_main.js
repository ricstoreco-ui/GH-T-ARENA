// GH-T ARENA Bot — f_main.js: Dashboard, Pengaturan, Monitoring, Tabel Poin, Turnamen, Pendaftaran, Pengumuman, Display
import {
  esc, wib, rp, UUID, tg, rpc, sb, count, setSetting, getSetting, audit, notify, notifyRegistrants, notifNote,
  getState, setState, clearState, b, BACK, show, ST, stLabel, FINAL, getT, patchT, withRegLock, parseWib, parsePairs,
  sbHeaders, kbRows, notifyOwners,
} from './core.js';

export const H = {};
export const T = {};

async function recalcWaitlist(env, tid) {
  try { await rpc(env, 'sys_process_waitlist', { p_tournament: tid }); return '✅ Waiting List dihitung ulang.'; }
  catch (e) { return '⚠️ Waiting List GAGAL dihitung ulang: ' + esc(e.message); }
}

// ================= DASHBOARD / MONITORING =================
export async function dashboardText(env) {
  const [h, pay, act, wd, dana, ocr] = await Promise.all([
    rpc(env, 'admin_health'),
    count(env, 'registrations?status=eq.menunggu_verifikasi&select=id'),
    count(env, 'tournaments?status=in.(pendaftaran_dibuka,berlangsung)&select=id'),
    count(env, 'registrations?withdraw_requested_at=not.is.null&status=neq.mengundurkan_diri&select=id'),
    count(env, 'dana_change_requests?status=eq.diajukan&select=id'),
    count(env, 'ocr_drafts?status=eq.draft&select=id'),
  ]);
  const site = h.site || {};
  return (
    '<b>📊 Dashboard</b>\n' +
    `Situs: ${site.open ? '🟢 Buka' : '🔴 Maintenance'}${site.reason ? ' (' + esc(site.reason) + ')' : ''}\n` +
    `Bot terakhir aktif: ${wib(h.bot_last_seen)}\n\n` +
    `Turnamen aktif: <b>${act}</b>\nBukti bayar menunggu verifikasi: <b>${pay}</b>\nPengajuan mundur menunggu: <b>${wd}</b>\n` +
    `Permintaan ubah data DANA: <b>${dana}</b>\nDraft OCR menunggu konfirmasi: <b>${ocr}</b>\n` +
    `Sesi Captain aktif: ${h.sessions_active}\nJob antre/jalan/mati: ${h.jobs_pending}/${h.jobs_running}/${h.jobs_dead}`
  );
}
H.dash = (env, chat, mid) => dashboardText(env).then((t) => show(env, chat, mid, t, { inline_keyboard: [[b('🔄 Segarkan', 'm:dash')], ...BACK] }));

export async function healthText(env) {
  const lines = [];
  const t0 = Date.now();
  try {
    const h = await rpc(env, 'admin_health');
    lines.push(`✅ Database OK (${Date.now() - t0} ms), ${h.db_size_mb} MB, ${h.jumlah_tabel} tabel`);
    lines.push(h.site?.open ? '✅ Status situs: buka' : '⚠️ Status situs: maintenance');
    lines.push(h.jobs_dead > 0 ? `⚠️ Job mati: ${h.jobs_dead}` : '✅ Tidak ada job mati');
    lines.push(h.files_due > 0 ? `⚠️ File menunggu dihapus: ${h.files_due}` : '✅ Tidak ada file tertunda');
  } catch (e) { lines.push('❌ Database: ' + esc(e.message)); }
  try { const me = await tg(env, 'getMe'); lines.push(me.ok ? '✅ Telegram Bot OK' : '❌ Telegram: ' + esc(me.description)); } catch (e) { lines.push('❌ Telegram: ' + esc(e.message)); }
  try { await rpc(env, 'admin_storage_usage'); lines.push('✅ Storage OK'); } catch (e) { lines.push('❌ Storage: ' + esc(e.message)); }
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/realtime_events?select=id&order=id.desc&limit=1`, { headers: sbHeaders(env) });
    lines.push(r.ok ? '✅ Tabel sinyal Realtime bisa dibaca' : '❌ Realtime: ' + r.status);
  } catch (e) { lines.push('❌ Realtime: ' + esc(e.message)); }
  return '<b>🩺 Health Check</b>\n' + lines.join('\n');
}
H.health = (env, chat, mid) => healthText(env).then((t) => show(env, chat, mid, t, { inline_keyboard: [[b('🔄 Ulangi', 'm:health')], ...BACK] }));

export async function quotaInfo(env) {
  const s = await rpc(env, 'admin_storage_usage');
  const dbPct = Math.round((s.db_mb / 500) * 100);
  const files = Object.values(s.buckets || {}).reduce((a, v) => a + Number(v.mb || 0), 0);
  const stPct = Math.round((files / 1024) * 100);
  return { s, dbPct, files, stPct };
}
H.storage = async (env, chat, mid) => {
  const { s, dbPct, files, stPct } = await quotaInfo(env);
  const rows = Object.entries(s.buckets || {}).map(([k, v]) => `• ${esc(k)}: ${v.files} file, ${v.mb} MB`);
  const warn = dbPct >= 80 || stPct >= 80 ? '\n\n⚠️ Kuota hampir habis.' : '';
  return show(env, chat, mid, '<b>🗄 Monitoring Kuota</b>\n' + (rows.join('\n') || 'Belum ada file.') + `\n\nDatabase: ${s.db_mb} MB / 500 MB (${dbPct}%)\nStorage: ${files.toFixed(1)} MB / 1024 MB (${stPct}%)` + warn, { inline_keyboard: [[b('🔄 Segarkan', 'm:storage')], ...BACK] });
};

H.mon = (env, chat, mid, p) => {
  if (p[2] === 'clean') return show(env, chat, mid, '<b>🧹 Pembersihan data</b>\nLanjut?', { inline_keyboard: [[b('✅ Jalankan', 'm:mon:cy'), b('✖️ Batal', 'm:mon')]] });
  if (p[2] === 'cy') return rpc(env, 'sys_run_housekeeping').then((r) => show(env, chat, mid, '✅ Selesai.\n<pre>' + esc(JSON.stringify(r, null, 1)).slice(0, 1500) + '</pre>', { inline_keyboard: [[b('⬅️ Monitoring', 'm:mon')]] }));
  return show(env, chat, mid, '<b>🩺 Monitoring</b>', { inline_keyboard: [[b('🩺 Health Check', 'm:health'), b('🗄 Kuota & Storage', 'm:storage')], [b('🧹 Pembersihan Data', 'm:mon:clean')], ...BACK] });
};

// ================= PENGATURAN =================
export async function settingsMenu(env) {
  const [h, reg] = await Promise.all([rpc(env, 'admin_health'), getSetting(env, 'registration_on')]);
  const regOn = reg !== false;
  const open = h.site?.open;
  return {
    text: `<b>⚙️ Pengaturan</b>\nRegistrasi (global): ${regOn ? '🟢 ON' : '🔴 OFF'}\nSitus: ${open ? '🟢 Buka' : '🔴 Maintenance'}`,
    markup: { inline_keyboard: [
      [b(regOn ? '🔴 Matikan Registrasi' : '🟢 Hidupkan Registrasi', 'm:reg:' + (regOn ? '0' : '1'))],
      [b(open ? '🛠 Aktifkan Maintenance' : '✅ Matikan Maintenance', 'm:mt:' + (open ? '1' : '0'))],
      [b('🖼 Banner', 'm:bn'), b('🧾 QRIS & Aset', 'm:as')],
      [b('🔧 Konfigurasi', 'm:cfg'), b('📜 Aturan', 'm:ru')],
      [b('🎨 Ganti Tema', 'm:thm')], 
      ...BACK] },
  };
}
const showSettings = async (env, chat, mid) => { const s = await settingsMenu(env); return show(env, chat, mid, s.text, s.markup); };
H.set = showSettings;
H.reg = async (env, chat, mid, p) => {
  const on = p[2] === '1';
  await setSetting(env, 'registration_on', on);
  await audit(env, on ? 'registrasi_on' : 'registrasi_off', 'site_settings', 'via bot');
  return showSettings(env, chat, mid);
};
H.mt = async (env, chat, mid, p) => {
  const on = p[2] === '1';
  await setSetting(env, 'maintenance', { on, reason: on ? 'Pemeliharaan oleh admin' : '' });
  await audit(env, on ? 'maintenance_on' : 'maintenance_off', 'site_settings', 'via bot');
  return showSettings(env, chat, mid);
};

// ================= TABEL POIN =================
const ptRows = async (env) => (await sb(env, 'GET', 'point_table?select=placement,points&order=placement.asc')) || [];
async function ptView(env) {
  const rows = await ptRows(env);
  const body = rows.map((r) => `${String(r.placement).padStart(2, ' ')}  →  ${r.points}`).join('\n');
  const empty = rows.every((r) => !r.points);
  return {
    text: '<b>🧮 Tabel Poin BR</b>\n<pre>Peringkat → Poin\n' + esc(body || '(kosong)') + '</pre>Kill: 1 poin per kill (tetap).' + (empty ? '\n\n⚠️ Semua poin masih 0.' : ''),
    markup: { inline_keyboard: [[b('✏️ Ubah Poin', 'm:pt:edit')], ...BACK] },
  };
}
async function ptPrompt(env, chat, mid) {
  await setState(env, chat, 'pt_edit', {});
  return show(env, chat, mid, '<b>✏️ Ubah Tabel Poin</b>\nKetik poin baru:\n<code>1=15, 2=12, 3=10</code>\nAtau 12 angka berurutan.', { inline_keyboard: [[b('✖️ Batal', 'm:pt')]] });
}
function parsePoints(text) {
  const t = text.trim().replace(/\s*=\s*/g, '=');
  const out = {};
  if (t.includes('=')) {
    for (const p of t.split(/[,;\s]+/).filter(Boolean)) {
      const m = p.match(/^(\d{1,2})=(\d{1,4})$/);
      if (!m) return { err: `Format salah: "${p}"` };
      const pl = +m[1];
      if (pl < 1 || pl > 12) return { err: `Peringkat harus 1-12.` };
      if (out[pl]) return { err: `Peringkat ${pl} dobel.` };
      out[pl] = +m[2];
    }
  } else {
    const nums = t.split(/[,;\s]+/).filter(Boolean);
    if (nums.length !== 12) return { err: 'Harus tepat 12 angka.' };
    nums.forEach((n, i) => { out[i + 1] = +n; });
  }
  return { out };
}
H.pt = async (env, chat, mid, p) => {
  const a = p[2];
  if (!a) { const v = await ptView(env); return show(env, chat, mid, v.text, v.markup); }
  if (a === 'edit') return ptPrompt(env, chat, mid);
  if (a === 'save') {
    const st = await getState(env, chat);
    if (!st || st.state !== 'pt_save') return show(env, chat, mid, 'Sesi habis.', { inline_keyboard: [[b('🧮 Tabel Poin', 'm:pt')], ...BACK] });
    const { changes } = st.data;
    await sb(env, 'POST', 'point_table?on_conflict=placement', Object.entries(changes).map(([pl, pts]) => ({ placement: +pl, points: +pts })), 'resolution=merge-duplicates,return=minimal');
    await clearState(env, chat);
    const v = await ptView(env);
    return show(env, chat, mid, '✅ Tersimpan.\n\n' + v.text, v.markup);
  }
};
T.pt_edit = async (env, chat, st, text) => {
  const p = parsePoints(text);
  if (p.err) return show(env, chat, null, '❌ ' + esc(p.err), { inline_keyboard: [[b('✖️ Batal', 'm:pt')]] });
  await setState(env, chat, 'pt_save', { changes: p.out });
  return show(env, chat, null, '<b>Simpan perubahan?</b>', { inline_keyboard: [[b('✅ Simpan', 'm:pt:save'), b('✖️ Batal', 'm:pt')]] });
};

// ================= TURNAMEN =================
const SET_ORDER = ['segera_hadir', 'pendaftaran_dibuka', 'pendaftaran_ditutup', 'berlangsung'];
const CHANGEABLE = ['segera_hadir', 'pendaftaran_dibuka', 'pendaftaran_ditutup'];

async function tList(env) {
  const rows = (await sb(env, 'GET', 'tournaments?select=id,name,format,status&order=created_at.desc&limit=10')) || [];
  const kb = rows.map((t) => [b(`${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`, 'm:t:v:' + t.id)]);
  return { text: '<b>🏆 Turnamen</b>\n' + (rows.length ? 'Pilih turnamen:' : 'Belum ada turnamen.'), markup: { inline_keyboard: [[b('➕ Buat Turnamen', 'm:t:new')], ...kb, ...BACK] } };
}

export async function tDetail(env, id, notice) {
  const t = await getT(env, id);
  const filled = await count(env, `registrations?tournament_id=eq.${id}&status=eq.resmi_terdaftar&select=id`);
  const L = [
    `<b>🏆 ${esc(t.name)}</b>`, `Format: ${t.format === 'BR' ? '🎯 BR' : '⚔️ CS'} (${t.is_offline ? '📍 OFFLINE' : '🌐 ONLINE'})`, `Status: ${stLabel(t.status)}`,
    `Slot terisi: <b>${filled}/${t.total_slots}</b>`,
    `Biaya: ${rp(t.entry_fee)} · Hadiah: ${rp(t.prize_pool)}`,
    `Jadwal: ${wib(t.schedule_at)}`,
  ];
  if (t.is_offline) L.push(`Lokasi: ${esc(t.location_name || '-')}`);
  if (t.stream_url) L.push(`🔴 Live Stream: ${esc(t.stream_url)}`);
  
  const kb = [];
  if (!FINAL.includes(t.status)) {
    kb.push([b('🔁 Ubah Status', 'm:t:s:' + id), b(t.registration_enabled ? '🔴 Registrasi OFF' : '🟢 Registrasi ON', 'm:t:r:' + id)]);
    if (t.status === 'ditunda') kb.push([b('📅 Atur Jadwal Lanjutan', 'm:t:j:' + id), b('▶️ Lanjutkan', 'm:t:c:' + id)]);
    else kb.push([b('⏸ Tunda Turnamen', 'm:t:p:' + id)]);
    kb.push([b('✏️ Edit', 'm:te:m:' + id), b('🚫 Batalkan Turnamen', 'm:cc:s:' + id)]);
  }
  if (['segera_hadir', 'dibatalkan'].includes(t.status)) kb.push([b('🗑️ Hapus Permanen', 'm:t:del:' + id)]);
  
  kb.push([b(t.format === 'BR' ? '🎯 Kelola BR' : '⚔️ Kelola CS', (t.format === 'BR' ? 'm:br:t:' : 'm:cs:t:') + id), b('📝 Pendaftaran', 'm:rg:t:' + id)]);
  kb.push([b('🏅 Hasil & Peringkat', 'm:lb:t:' + id), b('🔑 Room ID', 'm:rm:t:' + id)]);
  kb.push([b('🔴 Atur Live Stream', 'm:adm:stream_t:' + id), b('📺 Display Proyektor', 'm:t:disp:' + id)]); // <--- TOMBOL DISPLAY
  kb.push([b('🔄 Segarkan', 'm:t:v:' + id), b('⬅️ Daftar', 'm:t')]);
  return { text: (notice ? notice + '\n\n' : '') + L.join('\n'), markup: { inline_keyboard: kb } };
}
const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);

// --- DISPLAY PROYEKTOR CONTROLLER ---
H.t = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) return sh(env, chat, mid, await tList(env));
  if (a === 'new') return wizStart(env, chat, mid);
  if (a === 'v') return sh(env, chat, mid, await tDetail(env, id));
  
  if (a === 'disp') {
    return show(env, chat, mid, `<b>📺 Kontrol Display Proyektor</b>\nPilih mode layar yang ingin ditampilkan di laptop proyektor:`, {
      inline_keyboard: [
        [b('🟢 Standby / Countdown', `m:t:dis:cd:${id}`)],
        [b('📊 Leaderboard BR', `m:t:dis:br:${id}`), b('⚔️ Bracket CS', `m:t:dis:cs:${id}`)],
        [b('📺 Live Stream + Chat', `m:t:dis:live:${id}`)],
        [b('📝 Ubah Running Text', `m:t:rt:${id}`)],
        [b('⬅️ Kembali', 'm:t:v:' + id)]
      ]
    });
  }
  if (a === 'dis') {
    const mode = p[3];
    const baseUrl = 'https://gh-t-arena-web.pages.dev/display'; 
    const url = `${baseUrl}?view=${mode}&t=${id}`;
    return show(env, chat, mid, `<b>✅ LINK DISPLAY SIAP</b>\nCopy link di bawah ini, lalu buka di Chrome laptop proyektor:\n\n<code>${url}</code>\n\n<i>Tips: Tekan F11 di laptop untuk Fullscreen.</i>`, { inline_keyboard: [[b('⬅️ Kembali', 'm:t:disp:' + id)]] });
  }
  if (a === 'rt') {
    await setState(env, chat, 't_rt', { tid: id });
    return show(env, chat, mid, `<b>📝 Ubah Running Text</b>\nKetik teks berjalan di bawah layar proyektor:`, { inline_keyboard: [[b('✖️ Batal', 'm:t:disp:' + id)]] });
  }

  if (a === 's') return sh(env, chat, mid, await tStatusMenu(env, id));
  if (a === 'ss' || a === 'sy') return sh(env, chat, mid, await tSetStatus(env, id, Number(p[4]), a === 'sy'));
  if (a === 'r') return sh(env, chat, mid, await tToggleReg(env, id));
  
  if (a === 'del') {
    const t = await getT(env, id);
    return show(env, chat, mid, `<b>🗑️ Hapus Permanen?</b>\nTurnamen <b>${esc(t.name)}</b> akan dihapus!`, { inline_keyboard: [[b('🗑️ Ya, Hapus', 'm:t:dely:' + id), b('✖️ Batal', 'm:t:v:' + id)]] });
  }
  if (a === 'dely') {
    const t = await getT(env, id);
    await sb(env, 'DELETE', `tournaments?id=eq.${id}`);
    return show(env, chat, mid, `🗑️ Turnamen dihapus.`, { inline_keyboard: [[b('⬅️ Daftar Turnamen', 'm:t')], ...BACK] });
  }
  
  if (a === 'p') {
    const t = await getT(env, id);
    await setState(env, chat, 'tp', { tid: id });
    return show(env, chat, mid, `<b>⏸ Tunda Turnamen</b>\n${esc(t.name)}\nKetik <b>alasan penundaan</b>:`, { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
  }
  if (a === 'j') {
    const t = await getT(env, id);
    await setState(env, chat, 'tj', { tid: id });
    return show(env, chat, mid, `<b>📅 Jadwal Lanjutan</b>\n${esc(t.name)}\nKetik tanggal & jam (WIB):\n<code>2026-11-25 19:00 catatan</code>`, { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
  }
  if (a === 'c') return sh(env, chat, mid, await tResumeMenu(env, id));
  if (a === 'c0') return sh(env, chat, mid, await tResume(env, id, null));
  if (a === 'cm') return sh(env, chat, mid, await tResume(env, id, p[4]));
};

T.t_rt = async (env, chat, st, text) => {
  const tid = st.data?.tid;
  await setSetting(env, 'display_running_text', text);
  await clearState(env, chat);
  return show(env, chat, null, '✅ Running text layar proyektor diperbarui.', { inline_keyboard: [[b('⬅️ Kembali', 'm:t:disp:' + tid)]] });
};

async function tStatusMenu(env, id) {
  const t = await getT(env, id);
  if (!CHANGEABLE.includes(t.status)) {
    const why = t.status === 'ditunda' ? 'Turnamen ditunda: pakai tombol Lanjutkan.' : t.status === 'berlangsung' ? 'Sedang berlangsung: jeda lewat Tunda.' : 'Status akhir tidak bisa diubah.';
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
  if (ns === 'berlangsung' && !confirmed) return { text: `<b>Mulai turnamen?</b>\n${esc(t.name)}\nStatus jadi 🔥 Berlangsung.\nLanjut?`, markup: { inline_keyboard: [[b('✅ Ya, mulai', `m:t:sy:${id}:${n}`), b('✖️ Batal', 'm:t:v:' + id)]] } };
  await patchT(env, id, { status: ns });
  await audit(env, 'ubah_status_turnamen', 'tournaments', 'via bot', id, { status: t.status }, { status: ns });
  return tDetail(env, id, `✅ Status: ${stLabel(t.status)} → ${stLabel(ns)}`);
}
async function tToggleReg(env, id) {
  const t = await getT(env, id);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const nv = !t.registration_enabled;
  await patchT(env, id, { registration_enabled: nv });
  await audit(env, nv ? 'registrasi_turnamen_on' : 'registrasi_turnamen_off', 'tournaments', 'via bot', id, { registration_enabled: t.registration_enabled }, { registration_enabled: nv });
  return tDetail(env, id, `✅ Registrasi turnamen: ${nv ? '🟢 ON' : '🔴 OFF'}`);
}
async function tResumeMenu(env, id) {
  const t = await getT(env, id);
  if (t.status !== 'ditunda') throw new Error('Hanya turnamen Ditunda yang bisa dilanjutkan');
  const kb = [];
  let info = 'Status turnamen jadi 🔥 Berlangsung.';
  if (t.format === 'BR') {
    const ms = (await sb(env, 'GET', `br_matches?tournament_id=eq.${id}&select=match_no,status&order=match_no.asc`)) || [];
    const open = ms.filter((m) => m.status !== 'hasil_dipublikasikan');
    if (open.length) { info += '\nPilih match yang dilanjutkan:'; kb.push(...kbRows(open.map((m) => b(`Match ${m.match_no}`, `m:t:cm:${id}:${m.match_no}`)), 3)); }
  } else {
    const ms = (await sb(env, 'GET', `cs_matches?tournament_id=eq.${id}&status=eq.ditunda&select=id,bracket,round_no,match_no,round_label&order=round_no.asc,match_no.asc&limit=12`)) || [];
    if (ms.length) info += '\nMatch CS yang ditunda (lanjutan dipilih di menu Clash Squad):';
  }
  kb.push([b('▶️ Lanjutkan tanpa pilih match', 'm:t:c0:' + id)], [b('⬅️ Kembali', 'm:t:v:' + id)]);
  return { text: `<b>▶️ Lanjutkan Turnamen</b>\n${esc(t.name)}\n${info}`, markup: { inline_keyboard: kb } };
}
async function tResume(env, id, matchNo) {
  const t = await getT(env, id);
  if (t.status !== 'ditunda') throw new Error('Turnamen tidak dalam status Ditunda');
  await patchT(env, id, { status: 'berlangsung' });
  if (matchNo) await sb(env, 'PATCH', `br_matches?tournament_id=eq.${id}&match_no=eq.${Number(matchNo)}`, { status: 'berlangsung' }, 'return=minimal');
  await audit(env, 'lanjutkan_turnamen', 'tournaments', matchNo ? `match ${matchNo}` : 'tanpa pilih match', id, { status: 'ditunda' }, { status: 'berlangsung' });
  const n = await notifyRegistrants(env, id, 'jadwal', 'Turnamen dilanjutkan', `${t.name} dilanjutkan${matchNo ? ` (Match ${matchNo})` : ''}.`);
  return tDetail(env, id, `✅ Turnamen dilanjutkan.\n${notifNote(n)}`);
}

T.tp = async (env, chat, st, text) => {
  const id = st.data?.tid;
  const t = await getT(env, id);
  if (text.length < 3) return show(env, chat, null, '❌ Alasan terlalu pendek.', { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
  await patchT(env, id, { status: 'ditunda', postponed_reason: text.slice(0, 500) });
  await clearState(env, chat);
  return sh(env, chat, null, await tDetail(env, id, '✅ Turnamen ditunda.'));
};
T.tj = async (env, chat, st, text) => {
  const id = st.data?.tid;
  const t = await getT(env, id);
  const p = parseWib(text);
  if (!p) return show(env, chat, null, '❌ Format salah. Contoh: <code>2026-11-25 19:00 catatan</code>', { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + id)]] });
  await patchT(env, id, { schedule_at: p.iso, resume_note: p.note || null });
  await clearState(env, chat);
  return sh(env, chat, null, await tDetail(env, id, `✅ Jadwal lanjutan: ${wib(p.iso)}`));
};

// ----- Wizard Buat Turnamen (UPDATED: ONLINE / OFFLINE) -----
function wizNext(d) {
  if (!d.game_id) return 'game'; 
  if (!d.name) return 'name'; 
  if (!d.format) return 'format';
  if (d.is_offline === undefined) return 'is_offline'; // Tanya online/offline
  if (d.is_offline && !d.location_name) return 'loc_name'; // Tanya lokasi
  if (d.is_offline && !d.location_address) return 'loc_addr';
  if (d.is_offline && d.location_maps === undefined) return 'loc_maps';
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
const BTN_STEPS = ['game', 'format', 'elim', 'draw', 'is_offline', 'confirm'];
const CW = [b('✖️ Batal', 'm:w:x')];
function wizSummary(d) {
  const l = ['<b>Ringkasan turnamen baru</b>', `Nama: ${esc(d.name)}`, `Game: ${esc(d.game_name || '-')}`, `Format: ${d.format} (${d.is_offline ? 'Offline' : 'Online'})`];
  if (d.is_offline) l.push(`Lokasi: ${esc(d.location_name)}`);
  l.push(`Slot: ${d.total_slots} · Pemain utama: ${d.starters_per_team}`);
  l.push(`Biaya: ${rp(d.entry_fee)} · Hadiah: ${rp(d.prize_pool)}`, `Jadwal: ${wib(d.schedule_at)}`, 'Status awal: ⏳ Segera Hadir');
  return l.join('\n');
}
function wizPrompt(d, step) {
  const one = (text) => ({ text, markup: { inline_keyboard: [CW] } });
  switch (step) {
    case 'game': return { text: '<b>➕ Buat Turnamen</b>\nPilih game:', markup: { inline_keyboard: [...(d.gl || []).map((g, i) => [b(g.name, 'm:w:g:' + i)]), CW] } };
    case 'name': return one('<b>➕ Buat Turnamen</b>\nKetik <b>nama turnamen</b>:');
    case 'format': return { text: 'Pilih <b>format</b>:', markup: { inline_keyboard: [[b('🎯 Battle Royale', 'm:w:f:BR'), b('⚔️ Clash Squad', 'm:w:f:CS')], CW] } };
    case 'is_offline': return { text: 'Turnamen ini diadakan di mana?', markup: { inline_keyboard: [[b('🌐 Online (Bisa dari rumah)', 'm:w:off:0'), b('📍 Offline (Kopdar/Event)', 'm:w:off:1')], CW] } };
    case 'loc_name': return one('Ketik <b>Nama Tempat/Lokasi</b> event (contoh: Cafe Kopi Senja):');
    case 'loc_addr': return one('Ketik <b>Alamat Lengkap</b> event:');
    case 'loc_maps': return one('Ketik <b>Link Google Maps</b> (atau ketik - jika tidak ada):');
    case 'slots': return one(d.format === 'BR' ? 'Ketik <b>jumlah slot</b> tim (2 sampai 12):' : 'Ketik <b>jumlah slot</b> tim (minimal 2):');
    case 'starters': return { text: 'Pilih <b>jumlah pemain utama</b> per tim:', markup: { inline_keyboard: [[1, 2, 3, 4].map((n) => b(`${n}v${n}`, 'm:w:s:' + n)), CW] } };
    case 'matches': return one('Ketik <b>jumlah match</b> BR (1 atau lebih):');
    case 'elim': return { text: 'Pilih <b>format bracket</b> CS:', markup: { inline_keyboard: [[b('Single Elimination', 'm:w:e:single'), b('Double Elimination', 'm:w:e:double')], CW] } };
    case 'draw': return { text: 'Pilih <b>metode undian</b> CS:', markup: { inline_keyboard: [[b('🎡 Spin', 'm:w:d:spin'), b('🔀 Shuffle', 'm:w:d:shuffle')], CW] } };
    case 'fee': return one('Ketik <b>biaya pendaftaran</b> (Rp, angka saja, 0 = gratis):');
    case 'prize': return one('Ketik <b>total hadiah</b> (Rp, angka saja, 0 jika tidak ada):');
    case 'winners': return one(`Ketik <b>jumlah posisi pemenang</b> (1 sampai ${Math.min(12, d.total_slots)}):`);
    case 'schedule': return one('Ketik <b>jadwal turnamen</b> (WIB):\n<code>2026-11-25 19:00</code>\nKetik <code>-</code> kalau belum ada.');
    case 'deadline': return one('Ketik <b>batas pendaftaran</b> (WIB):\n<code>2026-11-25 18:00</code>\nKetik <code>-</code> kalau belum ada.');
    default: return { text: wizSummary(d), markup: { inline_keyboard: [[b('✅ Simpan', 'm:w:ok'), b('✖️ Batal', 'm:w:x')]] } };
  }
}
async function wizShow(env, chat, mid, d, err) {
  const step = wizNext(d);
  await setState(env, chat, 'w:' + step, d);
  const p = wizPrompt(d, step);
  return show(env, chat, mid, (err ? '❌ ' + err + '\n\n' : '') + p.text, p.markup);
}
async function wizStart(env, chat, mid) {
  const games = (await sb(env, 'GET', 'games?status=eq.active&select=id,name&order=sort_order.asc')) || [];
  if (!games.length) return show(env, chat, mid, 'Belum ada game aktif di database.', { inline_keyboard: BACK });
  const d = { gl: games };
  if (games.length === 1) { d.game_id = games[0].id; d.game_name = games[0].name; }
  return wizShow(env, chat, mid, d);
}
T.w = async (env, chat, st, text) => {
  const d = st.data || {}; const step = st.state.slice(2);
  const num = (s) => { const x = String(s).replace(/[.,\s]/g, ''); return /^\d{1,9}$/.test(x) ? parseInt(x, 10) : null; };
  let err = null;
  if (BTN_STEPS.includes(step)) err = 'Pilih lewat tombol.';
  else if (step === 'name') { if (text.length < 3 || text.length > 80) err = 'Nama 3 sampai 80 karakter.'; else d.name = text; }
  else if (step === 'loc_name') { if (text.length < 3) err = 'Terlalu pendek.'; else d.location_name = text; }
  else if (step === 'loc_addr') { if (text.length < 5) err = 'Terlalu pendek.'; else d.location_address = text; }
  else if (step === 'loc_maps') { d.location_maps = text === '-' ? null : text; }
  else if (step === 'slots') { const n = num(text); const max = d.format === 'BR' ? 12 : 32767; if (n === null || n < 2 || n > max) err = `Slot harus 2 sampai ${max}.`; else d.total_slots = n; }
  else if (step === 'starters') { const n = num(text); if (n === null || n < 1 || n > 20) err = 'Angka 1 sampai 20.'; else d.starters_per_team = n; }
  else if (step === 'matches') { const n = num(text); if (n === null || n < 1 || n > 100) err = 'Angka 1 sampai 100.'; else d.match_count = n; }
  else if (step === 'fee') { const n = num(text); if (n === null) err = 'Ketik angka saja.'; else d.entry_fee = n; }
  else if (step === 'prize') { const n = num(text); if (n === null) err = 'Ketik angka saja.'; else d.prize_pool = n; }
  else if (step === 'winners') { const n = num(text); const mx = Math.min(12, d.total_slots); if (n === null || n < 1 || n > mx) err = `Angka 1 sampai ${mx}.`; else d.winner_positions = n; }
  else if (step === 'schedule') { if (text === '-') d.schedule_at = null; else { const p = parseWib(text); if (!p) err = 'Format salah. Contoh: 2026-11-25 19:00'; else d.schedule_at = p.iso; } }
  else if (step === 'deadline') {
    if (text === '-') d.registration_deadline = null;
    else { const p = parseWib(text); if (!p) err = 'Format salah. Contoh: 2026-11-25 18:00'; else if (d.schedule_at && new Date(p.iso) > new Date(d.schedule_at)) err = 'Batas daftar tidak boleh setelah jadwal.'; else d.registration_deadline = p.iso; }
  }
  return wizShow(env, chat, null, d, err);
};
H.w = async (env, chat, mid, p) => {
  const a = p[2], v = p[3];
  if (a === 'x') { await clearState(env, chat); return show(env, chat, mid, 'Pembuatan turnamen dibatalkan.', { inline_keyboard: [[b('🏆 Turnamen', 'm:t')], ...BACK] }); }
  const st = await getState(env, chat);
  if (!st || !st.state.startsWith('w:')) return show(env, chat, mid, 'Sesi kedaluwarsa.', { inline_keyboard: [[b('➕ Buat Turnamen', 'm:t:new')], ...BACK] });
  const d = st.data || {};
  if (a === 'g') { const g = (d.gl || [])[Number(v)]; if (!g) return wizShow(env, chat, mid, d, 'Game tidak valid.'); d.game_id = g.id; d.game_name = g.name; }
  else if (a === 'f') d.format = v === 'CS' ? 'CS' : 'BR';
  else if (a === 'off') d.is_offline = v === '1';
  else if (a === 's') d.starters_per_team = Number(v);
  else if (a === 'e') d.cs_elimination = v === 'double' ? 'double' : 'single';
  else if (a === 'd') d.cs_draw_method = v === 'shuffle' ? 'shuffle' : 'spin';
  else if (a === 'ok') {
    if (wizNext(d) !== 'confirm') return wizShow(env, chat, mid, d, 'Data belum lengkap.');
    const row = { game_id: d.game_id, name: d.name, format: d.format, entry_fee: d.entry_fee, prize_pool: d.prize_pool, winner_positions: d.winner_positions,
      total_slots: d.total_slots, starters_per_team: d.starters_per_team, schedule_at: d.schedule_at, registration_deadline: d.registration_deadline,
      is_offline: d.is_offline, location_name: d.location_name, location_address: d.location_address, location_maps_url: d.location_maps };
    if (d.format === 'BR') row.match_count = d.match_count; else { row.cs_elimination = d.cs_elimination; row.cs_draw_method = d.cs_draw_method; }
    await clearState(env, chat);
    let created;
    try { created = await sb(env, 'POST', 'tournaments', row, 'return=representation'); }
    catch (e) { await setState(env, chat, 'w:confirm', d); throw e; }
    const id = created?.[0]?.id;
    if (!id) { await setState(env, chat, 'w:confirm', d); throw new Error('Database tidak mengembalikan ID turnamen baru'); }
    if (d.format === 'BR') {
      const ms = Array.from({ length: d.match_count }, (_, i) => ({ tournament_id: id, match_no: i + 1, status: 'belum_dimulai' }));
      try { await sb(env, 'POST', 'br_matches', ms, 'return=minimal'); }
      catch (e) {
        const rolled = await sb(env, 'DELETE', `tournaments?id=eq.${id}`).then(() => true).catch(() => false);
        await setState(env, chat, 'w:confirm', d);
        throw new Error('Gagal membuat match BR: ' + e.message);
      }
    }
    await audit(env, 'buat_turnamen', 'tournaments', d.name, id, null, row);
    return sh(env, chat, mid, await tDetail(env, id, '✅ Turnamen dibuat. Status awal: Segera Hadir.'));
  }
  return wizShow(env, chat, mid, d);
};

// ----- Edit Turnamen -----
const TE = [['name', 'Nama'], ['description', 'Deskripsi'], ['entry_fee', 'Biaya'], ['prize_pool', 'Total Hadiah'], ['total_slots', 'Jumlah Slot'],
  ['starters_per_team', 'Pemain Utama/Tim'], ['winner_positions', 'Posisi Pemenang'], ['schedule_at', 'Jadwal'], ['registration_deadline', 'Batas Daftar'], ['prizes', 'Hadiah per Posisi']];
const ACTIVE_REG = 'status=in.(menunggu_pembayaran,menunggu_verifikasi,data_belum_lengkap,resmi_terdaftar)';
async function teMenu(env, tid) {
  const t = await getT(env, tid);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const kb = kbRows(TE.map(([k, l], i) => b(l, `m:te:f:${tid}:${i}`)), 2);
  kb.push([b('🖼 Ganti Banner', 'm:te:b:' + tid)], [b('⬅️ Kembali', 'm:t:v:' + tid)]);
  return { text: `<b>✏️ Edit: ${esc(t.name)}</b>\nPilih yang diubah.`, markup: { inline_keyboard: kb } };
}
H.te = async (env, chat, mid, p) => {
  const a = p[2], tid = p[3];
  if (a === 'm') return sh(env, chat, mid, await teMenu(env, tid));
  if (a === 'b') {
    const t = await getT(env, tid);
    await setState(env, chat, 'tb_up', { tid });
    return show(env, chat, mid, `<b>🖼 Banner: ${esc(t.name)}</b>\nKirim <b>foto</b> banner baru (maks 10 MB).`, { inline_keyboard: [[b('✖️ Batal', 'm:te:m:' + tid)]] });
  }
  if (a === 'f') {
    const t = await getT(env, tid);
    const item = TE[Number(p[4])]; if (!item) throw new Error('Pilihan tidak valid');
    const k = item[0];
    await setState(env, chat, 'te', { tid, k });
    let ask;
    if (k === 'name') ask = `Sekarang: ${esc(t.name)}\nKetik nama baru:`;
    else if (k === 'description') ask = 'Ketik deskripsi (maks 1000 karakter). Ketik - untuk menghapus.';
    else if (k === 'entry_fee') ask = `Sekarang: ${rp(t.entry_fee)}\nKetik biaya baru (angka):`;
    else if (k === 'prize_pool') ask = `Sekarang: ${rp(t.prize_pool)}\nKetik total hadiah baru (angka):`;
    else if (k === 'total_slots') ask = `Sekarang: ${t.total_slots}\nKetik slot baru:`;
    else if (k === 'starters_per_team') ask = `Sekarang: ${t.starters_per_team}\nKetik jumlah pemain utama/tim (1-20).`;
    else if (k === 'winner_positions') ask = `Sekarang: ${t.winner_positions}\nKetik jumlah posisi pemenang:`;
    else if (k === 'schedule_at') ask = `Sekarang: ${wib(t.schedule_at)}\nKetik jadwal baru (WIB).`;
    else if (k === 'registration_deadline') ask = `Sekarang: ${wib(t.registration_deadline)}\nKetik batas daftar baru (WIB).`;
    else {
      ask = `Ketik SEMUA posisi (1 sampai ${t.winner_positions}), contoh:\n<code>1=100000, 2=50000, 3=25000</code>`;
    }
    return show(env, chat, mid, `<b>✏️ ${esc(item[1])}</b>\n${ask}`, { inline_keyboard: [[b('✖️ Batal', 'm:te:m:' + tid)]] });
  }
};
T.te = async (env, chat, st, text) => {
  const { tid, k } = st.data || {};
  const t = await getT(env, tid);
  if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
  const num = (s) => { const x = String(s).replace(/[.,\s]/g, ''); return /^\d{1,12}$/.test(x) ? Number(x) : null; };
  const filled = Number(await count(env, `registrations?tournament_id=eq.${tid}&status=eq.resmi_terdaftar&select=id`)) || 0;
  let patch = null, err = null, prizeRows = null, notice = '', sched = false;
  if (k === 'name') { if (text.length < 3 || text.length > 80) err = 'Nama 3 sampai 80 karakter.'; else patch = { name: text }; }
  else if (k === 'description') { if (text !== '-' && text.length > 1000) err = 'Maksimal 1000 karakter.'; else patch = { description: text === '-' ? null : text }; }
  else if (k === 'entry_fee' || k === 'prize_pool') { const n = num(text); if (n === null) err = 'Ketik angka saja.'; else patch = { [k]: n }; }
  else if (k === 'total_slots') {
    const n = num(text); const max = t.format === 'BR' ? 12 : 32767;
    if (n === null || n < 2 || n > max) err = `Slot harus 2 sampai ${max}.`;
    else if (n < filled) err = `Slot terisi sudah ${filled}.`;
    else patch = { total_slots: n };
  } else if (k === 'starters_per_team') {
    const n = num(text); const active = Number(await count(env, `registrations?tournament_id=eq.${tid}&${ACTIVE_REG}&select=id`)) || 0;
    if (n === null || n < 1 || n > 20) err = 'Angka 1 sampai 20.'; else if (active > 0) err = `Sudah ada ${active} pendaftaran aktif.`; else patch = { starters_per_team: n };
  } else if (k === 'winner_positions') { const n = num(text); const mx = Math.min(12, t.total_slots); if (n === null || n < 1 || n > mx) err = `Angka 1 sampai ${mx}.`; else patch = { winner_positions: n }; }
  else if (k === 'schedule_at') {
    if (text === '-') patch = { schedule_at: null };
    else { const p = parseWib(text); if (!p) err = 'Format salah. Contoh: 2026-11-25 19:00'; else { patch = { schedule_at: p.iso }; sched = true; } }
  } else if (k === 'registration_deadline') {
    if (text === '-') patch = { registration_deadline: null };
    else { const p = parseWib(text); if (!p) err = 'Format salah. Contoh: 2026-11-25 18:00'; else patch = { registration_deadline: p.iso }; }
  } else if (k === 'prizes') {
    const p = parsePairs(text, t.winner_positions);
    if (p.err) err = p.err; else prizeRows = Object.entries(p.out).map(([pl, amt]) => ({ tournament_id: tid, place: Number(pl), amount: amt }));
  } else err = 'Sesi tidak valid.';
  if (err) return show(env, chat, null, '❌ ' + err + '\nKetik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:te:m:' + tid)]] });
  if (prizeRows) {
    await withRegLock(env, t, async () => {
      await sb(env, 'POST', 'tournament_prizes?on_conflict=tournament_id,place', prizeRows, 'resolution=merge-duplicates,return=minimal');
      await sb(env, 'DELETE', `tournament_prizes?tournament_id=eq.${tid}&place=not.in.(${prizeRows.map((r) => r.place).join(',')})`);
    });
    await clearState(env, chat);
    notice = '✅ Hadiah per posisi disimpan.';
  } else {
    const important = ['entry_fee', 'prize_pool', 'schedule_at', 'registration_deadline', 'total_slots', 'winner_positions'].includes(k);
    if (important) await withRegLock(env, t, () => patchT(env, tid, patch)); else await patchT(env, tid, patch);
    await clearState(env, chat);
    notice = `✅ Diperbarui.`;
    if (sched && patch.schedule_at) {
      const n = await notifyRegistrants(env, tid, 'jadwal', 'Jadwal diperbarui', `Jadwal baru: ${wib(patch.schedule_at)}`);
      notice += '\n' + notifNote(n);
    }
  }
  return sh(env, chat, null, await tDetail(env, tid, notice));
};

// ----- Batalkan Turnamen -----
H.cc = async (env, chat, mid, p) => {
  const a = p[2];
  if (a === 's') {
    const t = await getT(env, p[3]);
    return show(env, chat, mid, `<b>🚫 Batalkan turnamen</b>\n${esc(t.name)}\nPilih <b>tujuan refund</b>:`, { inline_keyboard: [[b('💰 Saldo GH-T Arena', `m:cc:d:${t.id}:0`), b('🏦 Refund eksternal', `m:cc:d:${t.id}:1`)], [b('✖️ Batal', 'm:t:v:' + t.id)]] });
  }
  if (a === 'd') {
    const dst = ['saldo', 'eksternal'][Number(p[4])];
    const t = await getT(env, p[3]);
    await setState(env, chat, 'cc', { tid: t.id, dst, tname: t.name });
    return show(env, chat, mid, `<b>🚫 Batalkan: ${esc(t.name)}</b>\nKetik <b>alasan pembatalan</b>:`, { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + t.id)]] });
  }
  if (a === 'ok') {
    const st = await getState(env, chat);
    if (!st || st.state !== 'cc_conf') return show(env, chat, mid, 'Sesi kedaluwarsa.', { inline_keyboard: [[b('🏆 Turnamen', 'm:t')], ...BACK] });
    const d = st.data;
    const t = await getT(env, d.tid);
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${d.tid}&${ACTIVE_REG}&select=owner_id`)) || [];
    await rpc(env, 'admin_cancel_tournament', { p_tournament: d.tid, p_reason: d.reason, p_destination: d.dst, p_exceptions: [] });
    await clearState(env, chat);
    const n = await notifyOwners(env, regs.map((r) => r.owner_id), 'pendaftaran', 'Turnamen dibatalkan', `${t.name} dibatalkan. Alasan: ${d.reason}. Refund: ${d.dst}.`, d.tid);
    return sh(env, chat, mid, await tDetail(env, d.tid, `✅ Turnamen dibatalkan.\n${notifNote(n)}`));
  }
};
T.cc = async (env, chat, st, text) => {
  const d = st.data;
  if (text.length < 3 || text.length > 300) return show(env, chat, null, '❌ Alasan 3 sampai 300 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:t:v:' + d.tid)]] });
  const n = await count(env, `registrations?tournament_id=eq.${d.tid}&${ACTIVE_REG}&select=id`);
  await setState(env, chat, 'cc_conf', { ...d, reason: text });
  return show(env, chat, null, `<b>⚠️ Konfirmasi pembatalan</b>\nTurnamen: ${esc(d.tname)}\nPendaftaran aktif: ${n}\n\nLanjut?`, { inline_keyboard: [[b('🚫 Ya, batalkan', 'm:cc:ok')], [b('✖️ Tidak', 'm:t:v:' + d.tid)]] });
};

// ================= PENDAFTARAN & PEMBAYARAN =================
const RG_ST = [['menunggu_verifikasi', '🕒 Menunggu Verifikasi'], ['menunggu_pembayaran', '💰 Menunggu Pembayaran'], ['data_belum_lengkap', '⚠️ Data Belum Lengkap'],
  ['resmi_terdaftar', '✅ Resmi Terdaftar'], ['ditolak', '🚫 Ditolak'], ['mengundurkan_diri', '↩️ Mengundurkan Diri']];
export const rgLabel = (s) => (RG_ST.find((x) => x[0] === s) || [s, s])[1];
export async function getReg(env, rid) {
  if (!UUID.test(rid)) throw new Error('ID pendaftaran tidak valid');
  const rows = await sb(env, 'GET', `registrations?id=eq.${rid}&select=*`);
  if (!rows?.[0]) throw new Error('Pendaftaran tidak ditemukan');
  return rows[0];
}
async function rgTournaments(env) {
  const [pending, rows] = await Promise.all([count(env, 'registrations?status=eq.menunggu_verifikasi&select=id'), sb(env, 'GET', 'tournaments?select=id,name,format,status&order=created_at.desc&limit=10')]);
  const kb = (rows || []).map((t) => [b(`${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`, 'm:rg:t:' + t.id)]);
  return { text: '<b>📝 Pendaftaran</b>\n' + (rows?.length ? 'Pilih turnamen:' : 'Belum ada turnamen.'), markup: { inline_keyboard: [[b(`💳 Menunggu Verifikasi (${pending})`, 'm:vp')], ...kb, ...BACK] } };
}
async function rgSummary(env, tid) {
  const t = await getT(env, tid);
  const rows = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&select=status&limit=1000`)) || [];
  const c = {}; rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
  const kb = RG_ST.map(([k, l], i) => (c[k] ? [b(`${l} (${c[k]})`, `m:rg:l:${tid}:${i}`)] : null)).filter(Boolean);
  kb.push([b('🔄 Segarkan', 'm:rg:t:' + tid), b('⬅️ Daftar', 'm:rg')]);
  return { text: `<b>📝 Pendaftaran</b>\n${esc(t.name)}\nSlot terisi: <b>${c.resmi_terdaftar || 0}/${t.total_slots}</b>\n\n` + RG_ST.map(([k, l]) => `${l}: <b>${c[k] || 0}</b>`).join('\n'), markup: { inline_keyboard: kb } };
}
async function rgList(env, tid, i) {
  const st = RG_ST[i]; if (!st) throw new Error('Status tidak dikenal');
  const rows = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&status=eq.${st[0]}&select=id,team_name&order=created_at.asc&limit=12`)) || [];
  const kb = rows.map((r) => [b(String(r.team_name || '(tanpa nama)').slice(0, 40), 'm:rg:v:' + r.id)]);
  kb.push([b('⬅️ Kembali', 'm:rg:t:' + tid)]);
  return { text: `<b>${st[1]}</b>\n${rows.length ? 'Pilih tim:' : 'Kosong.'}`, markup: { inline_keyboard: kb } };
}
async function rgPending(env) {
  const rows = (await sb(env, 'GET', 'registrations?status=eq.menunggu_verifikasi&select=id,team_name,tournament_id&order=created_at.asc&limit=10')) || [];
  let names = {};
  if (rows.length) { const ids = [...new Set(rows.map((r) => r.tournament_id))]; const ts = (await sb(env, 'GET', `tournaments?id=in.(${ids.join(',')})&select=id,name`)) || []; names = Object.fromEntries(ts.map((t) => [t.id, t.name])); }
  const kb = rows.map((r) => [b(`${String(r.team_name || '?').slice(0, 20)} · ${String(names[r.tournament_id] || '?').slice(0, 18)}`, 'm:rg:v:' + r.id)]);
  kb.push([b('🔄 Segarkan', 'm:vp')], ...BACK);
  return { text: '<b>💳 Verifikasi Pembayaran</b>\n' + (rows.length ? 'Menunggu verifikasi (10 terlama):' : 'Tidak ada yang menunggu verifikasi. 🎉'), markup: { inline_keyboard: kb } };
}
export async function rgDetail(env, rid, notice) {
  const r = await getReg(env, rid);
  const [t, prof, pays] = await Promise.all([
    getT(env, r.tournament_id),
    sb(env, 'GET', `profiles?id=eq.${r.owner_id}&select=username,whatsapp`).catch(() => null),
    sb(env, 'GET', `payments?registration_id=eq.${rid}&select=method,amount,status,proof_path,proof_deleted_at,reject_reason&order=created_at.desc&limit=1`).catch(() => null),
  ]);
  const payFail = pays === null;
  const pay = pays?.[0], pf = prof?.[0];
  const hasProof = !!(pay?.proof_path && !pay?.proof_deleted_at);
  const L = [`<b>📝 ${esc(r.team_name)}</b>`, `Turnamen: ${esc(t.name)}`, `Status: ${rgLabel(r.status)}`, `Captain: ${esc(pf?.username || '-')} · WA: ${esc(pf?.whatsapp || '-')}`, `Biaya: ${rp(r.fee_amount)}`];
  if (payFail) L.push('⚠️ Data pembayaran gagal dimuat.');
  else if (pay) L.push(`Pembayaran: ${esc(pay.status)}${hasProof ? ' · bukti ada' : ' · belum ada bukti'}`);
  const kb = [];
  if (r.status === 'menunggu_verifikasi') kb.push([b('✅ Verifikasi', 'm:rg:ok:' + rid), b('❌ Tolak Pembayaran', 'm:rg:no:' + rid)]);
  if (hasProof) kb.push([b('📷 Lihat Bukti', 'm:rg:pf:' + rid)]);
  if (['menunggu_pembayaran', 'menunggu_verifikasi', 'data_belum_lengkap'].includes(r.status)) {
    const row = []; if (r.status !== 'data_belum_lengkap') row.push(b('⚠️ Data Belum Lengkap', 'm:rg:inc:' + rid)); row.push(b('🚫 Tolak Pendaftaran', 'm:rg:rj:' + rid)); kb.push(row);
  }
  if (r.withdraw_requested_at && r.status !== 'mengundurkan_diri') kb.push([b('↩️ Proses Pengajuan Mundur', 'm:wd:v:' + rid)]);
  kb.push([b('🔄 Segarkan', 'm:rg:v:' + rid), b('⬅️ Kembali', 'm:rg:t:' + r.tournament_id)]);
  return { text: (notice ? notice + '\n\n' : '') + L.join('\n'), markup: { inline_keyboard: kb } };
}
const RR = { no: { title: 'Tolak Pembayaran', from: ['menunggu_verifikasi'] }, inc: { title: 'Tandai Data Belum Lengkap', from: ['menunggu_pembayaran', 'menunggu_verifikasi'] },
  rj: { title: 'Tolak Pendaftaran', from: ['menunggu_pembayaran', 'menunggu_verifikasi', 'data_belum_lengkap'] } };
const PROOF_BUCKET = 'payment-proofs';
async function rgProof(env, chat, rid) {
  if (!UUID.test(rid)) throw new Error('ID pendaftaran tidak valid');
  const pays = await sb(env, 'GET', `payments?registration_id=eq.${rid}&select=proof_path,proof_deleted_at,amount&order=created_at.desc&limit=1`);
  const pay = pays?.[0];
  if (!pay?.proof_path || pay.proof_deleted_at) return tg(env, 'sendMessage', { chat_id: chat, text: 'Belum ada bukti bayar.' });
  const path = pay.proof_path.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${PROOF_BUCKET}/${path}`, { method: 'POST', headers: sbHeaders(env), body: JSON.stringify({ expiresIn: 300 }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error('Gagal membuat link bukti.');
  const link = j.signedURL.startsWith('http') ? j.signedURL : env.SUPABASE_URL + (j.signedURL.startsWith('/storage/v1') ? '' : '/storage/v1') + j.signedURL;
  const sent = await tg(env, 'sendPhoto', { chat_id: chat, photo: link, caption: `Bukti bayar · ${rp(pay.amount)}` });
  if (!sent.ok) await tg(env, 'sendMessage', { chat_id: chat, text: 'Gagal kirim foto. Link:\n' + link });
}
H.rg = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) return sh(env, chat, mid, await rgTournaments(env));
  if (a === 't') return sh(env, chat, mid, await rgSummary(env, id));
  if (a === 'l') return sh(env, chat, mid, await rgList(env, id, Number(p[4])));
  if (a === 'v') return sh(env, chat, mid, await rgDetail(env, id));
  if (a === 'ok') {
    const r = await getReg(env, id);
    return show(env, chat, mid, `<b>Verifikasi pembayaran?</b>\nTim: ${esc(r.team_name)}\nBiaya: ${rp(r.fee_amount)}\nLanjut?`, { inline_keyboard: [[b('✅ Ya', 'm:rg:oy:' + id), b('✖️ Batal', 'm:rg:v:' + id)]] });
  }
  if (a === 'oy') {
    const r = await getReg(env, id);
    await rpc(env, 'admin_verify_payment', { p_registration: id });
    const t = await getT(env, r.tournament_id);
    const ok = await notify(env, r.owner_id, 'pembayaran', 'Pembayaran terverifikasi', `Tim ${r.team_name} resmi terdaftar di ${t.name}.`, r.tournament_id);
    return sh(env, chat, mid, await rgDetail(env, id, '✅ Terverifikasi.\n' + (ok ? '🔔 Notif terkirim.' : '⚠️ Notif GAGAL.')));
  }
  if (a === 'no' || a === 'inc' || a === 'rj') {
    const r = await getReg(env, id);
    await setState(env, chat, 'rr', { rid: id, act: a });
    return show(env, chat, mid, `<b>${RR[a].title}</b>\nKetik <b>alasan</b>:`, { inline_keyboard: [[b('✖️ Batal', 'm:rg:v:' + id)]] });
  }
  if (a === 'pf') return rgProof(env, chat, id);
};
H.vp = async (env, chat, mid) => sh(env, chat, mid, await rgPending(env));
T.rr = async (env, chat, st, text) => {
  const { rid, act } = st.data || {};
  if (text.length < 3 || text.length > 300) return show(env, chat, null, '❌ Alasan 3-300 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:rg:v:' + rid)]] });
  const r = await getReg(env, rid);
  const t = await getT(env, r.tournament_id);
  let kind, title, body;
  if (act === 'no') { await rpc(env, 'admin_reject_payment', { p_registration: rid, p_reason: text }); kind = 'pembayaran'; title = 'Pembayaran ditolak'; body = `Pembayaran tim ${r.team_name} ditolak. Alasan: ${text}`; }
  else if (act === 'inc') { await rpc(env, 'admin_mark_incomplete', { p_registration: rid, p_reason: text }); kind = 'pendaftaran'; title = 'Data belum lengkap'; body = `Tim ${r.team_name}: ${text}. Hubungi admin.`; }
  else { await rpc(env, 'admin_reject_registration', { p_registration: rid, p_reason: text }); kind = 'pendaftaran'; title = 'Pendaftaran ditolak'; body = `Pendaftaran tim ${r.team_name} ditolak. Alasan: ${text}`; }
  await clearState(env, chat);
  const ok = await notify(env, r.owner_id, kind, title, body, r.tournament_id);
  return sh(env, chat, null, await rgDetail(env, rid, `✅ ${RR[act].title} berhasil.\n` + (ok ? '🔔 Notif terkirim.' : '⚠️ Notif GAGAL.')));
};

// ================= PENGUMUMAN =================
const CAN = [b('✖️ Batal', 'm:an:x')];
async function anList(env) {
  const rows = (await sb(env, 'GET', 'announcements?select=id,title,tournament_id&order=created_at.desc&limit=8')) || [];
  const kb = rows.map((a) => [b(`${a.tournament_id ? '🏆' : '🌐'} ${String(a.title).slice(0, 32)}`, 'm:an:v:' + a.id)]);
  return { text: '<b>📣 Pengumuman</b>\n' + (rows.length ? '8 terbaru:' : 'Belum ada pengumuman.'), markup: { inline_keyboard: [[b('➕ Buat Pengumuman', 'm:an:new')], ...kb, ...BACK] } };
}
async function anView(env, id, notice) {
  const rows = await sb(env, 'GET', `announcements?id=eq.${id}&select=*`);
  const a = rows?.[0]; if (!a) throw new Error('Pengumuman tidak ditemukan');
  let target = '🌐 Umum (website)';
  if (a.tournament_id) { const t = await getT(env, a.tournament_id).catch(() => null); target = '🏆 ' + esc(t?.name || '(turnamen dihapus)'); }
  return { text: (notice ? notice + '\n\n' : '') + `<b>📣 ${esc(a.title)}</b>\nUntuk: ${target}\nDibuat: ${wib(a.created_at)}\n\n${esc(a.body)}`, markup: { inline_keyboard: [[b('🗑 Hapus', 'm:an:d:' + id)], [b('⬅️ Daftar', 'm:an')]] } };
}
H.an = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a || a === 'x') return sh(env, chat, mid, await anList(env));
  if (a === 'v') return sh(env, chat, mid, await anView(env, id));
  if (a === 'new') {
    const rows = (await sb(env, 'GET', 'tournaments?select=id,name,format,status&order=created_at.desc&limit=8')) || [];
    const kb = rows.map((t) => [b(`${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`, 'm:an:t:' + t.id)]);
    return show(env, chat, mid, '<b>➕ Buat Pengumuman</b>\nUntuk siapa?', { inline_keyboard: [[b('🌐 Umum (website saja)', 'm:an:g')], ...kb, CAN] });
  }
  if (a === 'g') { await setState(env, chat, 'an_title', { tid: null }); return show(env, chat, mid, '<b>➕ Pengumuman Umum</b>\nKetik <b>judul</b>:', { inline_keyboard: [CAN] }); }
  if (a === 't') { const t = await getT(env, id); await setState(env, chat, 'an_title', { tid: id, tname: t.name }); return show(env, chat, mid, `<b>➕ Pengumuman: ${esc(t.name)}</b>\nKetik <b>judul</b>:`, { inline_keyboard: [CAN] }); }
  if (a === 'ok') {
    const st = await getState(env, chat);
    if (!st || st.state !== 'an_conf') return show(env, chat, mid, 'Sesi habis.', { inline_keyboard: [[b('➕ Buat Pengumuman', 'm:an:new')], ...BACK] });
    const d = st.data;
    const rows = await sb(env, 'POST', 'announcements', { tournament_id: d.tid || null, title: d.title, body: d.body }, 'return=representation');
    await clearState(env, chat);
    const aid = rows?.[0]?.id;
    let note = '✅ Pengumuman tersimpan.';
    if (d.tid) { const n = await notifyRegistrants(env, d.tid, 'pengumuman', d.title, d.body); note += '\n' + notifNote(n); }
    return sh(env, chat, mid, await anView(env, aid, note));
  }
  if (a === 'd') return show(env, chat, mid, '<b>Hapus pengumuman ini?</b>', { inline_keyboard: [[b('🗑 Ya, hapus', 'm:an:dy:' + id), b('✖️ Batal', 'm:an:v:' + id)]] });
  if (a === 'dy') {
    const rows = await sb(env, 'GET', `announcements?id=eq.${id}&select=title,tournament_id`);
    await sb(env, 'DELETE', `announcements?id=eq.${id}`);
    const v = await anList(env);
    return show(env, chat, mid, '🗑 Pengumuman dihapus.\n\n' + v.text, v.markup);
  }
};
T.an_title = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 100) return show(env, chat, null, '❌ Judul 3-100 karakter.', { inline_keyboard: [CAN] });
  await setState(env, chat, 'an_body', { ...st.data, title: text });
  return show(env, chat, null, 'Ketik <b>isi pengumuman</b> (maks 1000 karakter):', { inline_keyboard: [CAN] });
};
T.an_body = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 1000) return show(env, chat, null, '❌ Isi 3-1000 karakter.', { inline_keyboard: [CAN] });
  const d = { ...st.data, body: text };
  await setState(env, chat, 'an_conf', d);
  let who = '🌐 Umum (website saja, tanpa notifikasi)';
  if (d.tid) { const n = await count(env, `registrations?tournament_id=eq.${d.tid}&status=eq.resmi_terdaftar&select=id`); who = `🏆 ${esc(d.tname)}\nNotifikasi ke ${n} tim Resmi Terdaftar`; }
  return show(env, chat, null, `<b>Konfirmasi pengumuman</b>\nUntuk: ${who}\n\n<b>${esc(d.title)}</b>\n${esc(d.body)}\n\nKirim?`, { inline_keyboard: [[b('✅ Kirim', 'm:an:ok'), b('✖️ Batal', 'm:an:x')]] });
};
