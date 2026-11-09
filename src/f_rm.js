// GH-T ARENA Bot — f_rm.js: Pengaturan Room ID & Password
import {
  esc, UUID, rpc, sb, getState, setState, clearState, b, BACK, kbRows, show, getT, audit, tPick
} from './core.js';

export const H = {};
export const T = {};

async function rmMatchList(env, tid) {
  const t = await getT(env, tid);
  const kb = [];
  
  if (t.format === 'BR') {
    const ms = (await sb(env, 'GET', `br_matches?tournament_id=eq.${tid}&select=id,match_no&order=match_no.asc`)) || [];
    ms.forEach(m => kb.push([b(`Match ${m.match_no}`, `m:rm:b:${m.id}`)]));
  } else {
    const ms = (await sb(env, 'GET', `cs_matches?tournament_id=eq.${tid}&select=id,round_no,match_no&order=round_no.asc,match_no.asc`)) || [];
    ms.forEach(m => kb.push([b(`R${m.round_no} M${m.match_no}`, `m:rm:b:${m.id}`)]));
  }
  
  kb.push([b('⬅️ Kembali', 'm:t:v:' + tid)]);
  return { text: `<b>🔑 Room ID: ${esc(t.name)}</b>\nPilih match untuk mengatur Room ID:`, markup: { inline_keyboard: kb } };
}

H.rm = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a || a === 't') {
    const x = await tPick(env, 'status=in.(pendaftaran_ditutup,berlangsung)', 'm:rm:t:');
    return show(env, chat, mid, '<b>🔑 Room ID</b>\nPilih turnamen:', { inline_keyboard: [...x.kb, ...BACK] });
  }
  if (a === 'b') {
    const midMatch = id;
    const rooms = (await sb(env, 'GET', `tournament_rooms?match_id=eq.${midMatch}&select=room_id,room_pass&limit=1`))?.[0] || {};
    await setState(env, chat, 'rm_in', { match_id: midMatch });
    return show(env, chat, mid, `<b>🔑 Atur Room ID</b>\nRoom ID saat ini: ${esc(rooms.room_id || '-')}\nPassword saat ini: ${esc(rooms.room_pass || '-')}\n\nKetik format: <code>RoomID Password</code>\nContoh: <code>12345678 rahasia</code>\nKetik - untuk menghapus.`, { inline_keyboard: [[b('✖️ Batal', 'm:main')]] });
  }
};

T.rm_in = async (env, chat, st, text) => {
  const midMatch = st.data?.match_id;
  let room_id = null, room_pass = null;
  if (text !== '-') {
    const parts = text.split(/\s+/);
    if (parts.length < 2) return show(env, chat, null, '❌ Format salah. Ketik: <code>RoomID Password</code>', { inline_keyboard: [[b('✖️ Batal', 'm:main')]] });
    room_id = parts[0];
    room_pass = parts.slice(1).join(' ');
  }

  // Simpan ke Supabase (Upsert)
  await sb(env, 'POST', 'tournament_rooms?on_conflict=match_id', { match_id: midMatch, room_id, room_pass }, 'resolution=merge-duplicates,return=minimal');
  
  await clearState(env, chat);
  await audit(env, 'atur_room_id', 'tournament_rooms', 'via bot', midMatch);
  return show(env, chat, null, '✅ Room ID dan Password berhasil disimpan. Captain akan menerima notifikasi.', { inline_keyboard: [[b('⬅️ Menu Utama', 'm:main')]] });
};
