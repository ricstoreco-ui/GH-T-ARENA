// ==========================================
// GH-T ARENA Bot — f_rm.js: Pengaturan Room ID & Password (VERSI PERBAIKAN)
// Alur: Room ID -> pilih turnamen -> pilih "Room Utama" / match tertentu -> ketik "RoomID Password"
// Data disimpan di tournament_rooms DENGAN tournament_id, supaya tampil di website
// (menu Turnamen Saya -> Room ID) untuk peserta yang sudah resmi terdaftar.
// ==========================================
import {
  esc, sb, setState, clearState, b, BACK, show, audit, tPick, notifyRegistrants, notifNote
} from './core.js';

export const H = {};
export const T = {};

const STATUS_RM = 'status=in.(pendaftaran_dibuka,pendaftaran_ditutup,berlangsung,ditunda)';

// ---------- helper ----------
async function getTour(env, tid) {
  const r = await sb(env, 'GET', `tournaments?id=eq.${tid}&select=id,name,format,status&limit=1`);
  return r && r[0];
}
async function getRooms(env, tid) {
  return (await sb(env, 'GET', `tournament_rooms?tournament_id=eq.${tid}&select=id,room_id,room_password,note,br_match_id,cs_match_id&order=published_at.asc`)) || [];
}
// cari 1 baris room sesuai target (utama / match BR / match CS)
async function findRoom(env, t) {
  let q;
  if (t.br) q = `br_match_id=eq.${t.br}`;
  else if (t.cs) q = `cs_match_id=eq.${t.cs}`;
  else q = `tournament_id=eq.${t.tid}&br_match_id=is.null&cs_match_id=is.null`;
  const r = await sb(env, 'GET', `tournament_rooms?${q}&select=id,room_id,room_password,note&limit=1`);
  return { row: r && r[0], q };
}

async function tourView(env, chat, mid, tid, notice) {
  const t = await getTour(env, tid);
  if (!t) return show(env, chat, mid, '❌ Turnamen tidak ditemukan.', { inline_keyboard: [...BACK] });
  const rooms = await getRooms(env, tid);
  let L = `<b>🔑 Room ID — ${esc(t.name)}</b>\nFormat: ${esc(t.format)}\n`;
  if (notice) L = notice + '\n\n' + L;
  L += '\n';
  if (!rooms.length) L += '<i>Belum ada Room ID yang diisi.</i>\n';
  else {
    for (const r of rooms) {
      L += `• <b>${esc(r.note || 'Room Utama')}</b>\n   ID: <code>${esc(r.room_id || '-')}</code> | Pass: <code>${esc(r.room_password || '-')}</code>\n`;
    }
  }
  L += '\nPilih yang mau diisi / diubah. Peserta yang <b>resmi terdaftar</b> langsung melihatnya di website.';

  const kb = [[b('✏️ Room Utama (semua match)', 'm:rm:g:' + tid)]];
  try {
    if (t.format === 'BR') {
      const ms = (await sb(env, 'GET', `br_matches?tournament_id=eq.${tid}&select=id,match_no&order=match_no.asc&limit=12`)) || [];
      for (let i = 0; i < ms.length; i += 3) kb.push(ms.slice(i, i + 3).map((m) => b('🎯 Match ' + m.match_no, 'm:rm:b:' + m.id + ':BR')));
    } else {
      const ms = (await sb(env, 'GET', `cs_matches?tournament_id=eq.${tid}&select=id,round_no,match_no,round_label&order=round_no.asc,match_no.asc&limit=12`)) || [];
      for (let i = 0; i < ms.length; i += 2) kb.push(ms.slice(i, i + 2).map((m) => b(`⚔️ ${String(m.round_label || 'R' + m.round_no).slice(0, 12)} #${m.match_no}`, 'm:rm:b:' + m.id + ':CS')));
    }
  } catch (e) { /* daftar match opsional */ }
  kb.push([b('🔄 Segarkan', 'm:rm:t:' + tid), b('⬅️ Daftar Turnamen', 'm:rm')]);
  kb.push([b('🏠 Menu Utama', 'm:main')]);
  return show(env, chat, mid, L, { inline_keyboard: kb });
}

async function askInput(env, chat, mid, target) {
  const { row } = await findRoom(env, target);
  await setState(env, chat, 'rm_in', target);
  const cur = row ? `\nSaat ini:\nRoom ID: <code>${esc(row.room_id || '-')}</code>\nPassword: <code>${esc(row.room_password || '-')}</code>\n` : '\n<i>Belum ada isian.</i>\n';
  return show(env, chat, mid,
    `<b>🔑 Atur Room ID — ${esc(target.label)}</b>\n${cur}\nKetik: <code>RoomID Password</code>\nContoh: <code>12345678 rahasia</code>\nKetik <code>-</code> untuk menghapus.`,
    { inline_keyboard: [[b('✖️ Batal', 'm:rm:t:' + target.tid)]] });
}

// ---------- callback ----------
H.rm = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];

  // m:rm  -> daftar turnamen
  if (!a) {
    const x = await tPick(env, STATUS_RM, 'm:rm:t:');
    if (!x.rows.length) return show(env, chat, mid, '<b>🔑 Room ID</b>\nBelum ada turnamen yang aktif / berjalan.', { inline_keyboard: [...BACK] });
    return show(env, chat, mid, '<b>🔑 Room ID</b>\nPilih turnamen:', { inline_keyboard: [...x.kb, ...BACK] });
  }

  // m:rm:t:<tid> -> menu room turnamen  (BUG LAMA: dulu kembali ke daftar lagi)
  if (a === 't') return tourView(env, chat, mid, id);

  // m:rm:g:<tid> -> isi Room Utama
  if (a === 'g') {
    const t = await getTour(env, id);
    if (!t) return show(env, chat, mid, '❌ Turnamen tidak ditemukan.', { inline_keyboard: [...BACK] });
    return askInput(env, chat, mid, { tid: id, br: null, cs: null, label: 'Room Utama · ' + t.name });
  }

  // m:rm:b:<matchId>:<BR|CS> -> isi room per match
  if (a === 'b') {
    const fmt = p[4] === 'BR' ? 'BR' : 'CS';
    const tbl = fmt === 'BR' ? 'br_matches' : 'cs_matches';
    const sel = fmt === 'BR' ? 'tournament_id,match_no' : 'tournament_id,match_no,round_no,round_label';
    const r = await sb(env, 'GET', `${tbl}?id=eq.${id}&select=${sel}&limit=1`);
    const m = r && r[0];
    if (!m) return show(env, chat, mid, '❌ Match tidak ditemukan.', { inline_keyboard: [...BACK] });
    const label = fmt === 'BR' ? `Match ${m.match_no}` : `${m.round_label || 'Ronde ' + m.round_no} #${m.match_no}`;
    return askInput(env, chat, mid, { tid: m.tournament_id, br: fmt === 'BR' ? id : null, cs: fmt === 'CS' ? id : null, label });
  }

  return show(env, chat, mid, '🚧 Menu tidak dikenal.', { inline_keyboard: [...BACK] });
};

// ---------- input teks ----------
T.rm_in = async (env, chat, st, text) => {
  const tg = st.data || {};
  if (!tg.tid) { await clearState(env, chat); return show(env, chat, null, '❌ Sesi habis. Mulai lagi dari menu Room ID.', { inline_keyboard: [[b('🔑 Room ID', 'm:rm')]] }); }
  const back = { inline_keyboard: [[b('✖️ Batal', 'm:rm:t:' + tg.tid)]] };
  const raw = String(text || '').trim();
  const { row, q } = await findRoom(env, tg);

  // hapus
  if (raw === '-') {
    if (row) await sb(env, 'DELETE', `tournament_rooms?id=eq.${row.id}`, undefined, 'return=minimal');
    await clearState(env, chat);
    await audit(env, 'hapus_room_id', 'tournament_rooms', 'via bot: ' + tg.label, tg.tid);
    return tourView(env, chat, null, tg.tid, '🗑 Room ID dihapus.');
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return show(env, chat, null, '❌ Format salah. Ketik: <code>RoomID Password</code>', back);
  const room_id = parts[0];
  const room_password = parts.length > 1 ? parts.slice(1).join(' ') : null;

  const payload = {
    tournament_id: tg.tid,
    room_id,
    room_password,
    note: tg.br || tg.cs ? tg.label : 'Room Utama',
    published_at: new Date().toISOString(),
  };
  if (tg.br) payload.br_match_id = tg.br;
  if (tg.cs) payload.cs_match_id = tg.cs;

  if (row) await sb(env, 'PATCH', `tournament_rooms?id=eq.${row.id}`, payload, 'return=minimal');
  else await sb(env, 'POST', 'tournament_rooms', payload, 'return=minimal');

  await clearState(env, chat);
  await audit(env, 'atur_room_id', 'tournament_rooms', 'via bot: ' + tg.label, tg.tid);

  // beri tahu captain yang sudah resmi terdaftar (password TIDAK dikirim lewat notifikasi)
  const t = await getTour(env, tg.tid);
  const n = await notifyRegistrants(env, tg.tid, 'room_id', '🔑 Room ID tersedia',
    `Room ID untuk ${t ? t.name : 'turnamen'} (${payload.note}) sudah dipublikasikan. Buka Turnamen Saya → Room ID.`);
  return tourView(env, chat, null, tg.tid, '✅ Room ID & Password tersimpan dan sudah tampil di website.\n' + notifNote(n));
};
