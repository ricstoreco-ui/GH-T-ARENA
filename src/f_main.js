// GH-T ARENA Bot — f_main.js: Dashboard, Pengaturan, Monitoring, Tabel Poin, Turnamen, Pendaftaran, Pengumuman, Display Proyektor
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
  kb.push([b('🔴 Atur Live Stream', 'm:adm:stream_t:' + id), b('📺 Display Proyektor', 'm:t:disp:' + id)]); // <--- TOMBOL DISPLAY BARU
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
    const baseUrl = 'https://gh-t-arena-web.pages.dev/display'; 
    const linkBr = `${baseUrl}?view=br&t=${id}`;
    const linkCs = `${baseUrl}?view=cs&t=${id}`;
    const linkLive = `${baseUrl}?view=live&t=${id}`;
    const linkCd = `${baseUrl}?view=standby&t=${id}`;
    
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
    case 'format': return { text: 'Pilih <
