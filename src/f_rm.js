// GH-T ARENA Bot — f_rm.js: Pengaturan Room ID & Password
import {
  esc, UUID, rpc, sb, getState, setState, clearState, b, BACK, kbRows, show, getT, audit, tPick
} from './core.js';

export const H = {};
export const T = {};

H.rm = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a || a === 't') {
    const x = await tPick(env, 'status=in.(pendaftaran_ditutup,berlangsung)', 'm:rm:t:');
    return show(env, chat, mid, '<b>🔑 Room ID</b>\nPilih turnamen:', { inline_keyboard: [...x.kb, ...BACK] });
  }
  if (a === 'b') {
    const midMatch = id;
    
    // Cek apakah ini match BR atau CS
    const tFormat = p[4]; 
    
    let rooms = [];
    if (tFormat === 'BR') {
      rooms = await sb(env, 'GET', `tournament_rooms?br_match_id=eq.${midMatch}&select=room_id,room_password&limit=1`);
    } else {
      rooms = await sb(env, 'GET', `tournament_rooms?cs_match_id=eq.${midMatch}&select=room_id,room_password&limit=1`);
    }
    
    const current = rooms?.[0] || {};
    
    await setState(env, chat, 'rm_in', { match_id: midMatch, format: tFormat });
    return show(env, chat, mid, `<b>🔑 Atur Room ID</b>\nRoom ID saat ini: ${esc(current.room_id || '-')}\nPassword saat ini: ${esc(current.room_password || '-')}\n\nKetik format: <code>RoomID Password</code>\nContoh: <code>12345678 rahasia</code>\nKetik - untuk menghapus.`, { inline_keyboard: [[b('✖️ Batal', 'm:main')]] });
  }
};

T.rm_in = async (env, chat, st, text) => {
  const { match_id, format } = st.data || {};
  let room_id = null, room_password = null;
  
  if (text !== '-') {
    const parts = text.split(/\s+/);
    if (parts.length < 2) return show(env, chat, null, '❌ Format salah. Ketik: <code>RoomID Password</code>', { inline_keyboard: [[b('✖️ Batal', 'm:main')]] });
    room_id = parts[0];
    room_password = parts.slice(1).join(' ');
  }

  const payload = {
    room_id,
    room_password,
    published_at: new Date().toISOString()
  };
  
  if (format === 'BR') payload.br_match_id = match_id;
  else payload.cs_match_id = match_id;

  // Coba update dulu, kalau gak ada baru insert
  let res;
  if (format === 'BR') {
    res = await sb(env, 'PATCH', `tournament_rooms?br_match_id=eq.${match_id}`, payload, 'return=representation');
  } else {
    res = await sb(env, 'PATCH', `tournament_rooms?cs_match_id=eq.${match_id}`, payload, 'return=representation');
  }
  
  if (!res || res.length === 0) {
    // Belum ada, insert baru
    await sb(env, 'POST', 'tournament_rooms', payload, 'return=minimal');
  }
  
  await clearState(env, chat);
  await audit(env, 'atur_room_id', 'tournament_rooms', 'via bot', match_id);
  return show(env, chat, null, '✅ Room ID dan Password berhasil disimpan. Captain akan menerima notifikasi.', { inline_keyboard: [[b('⬅️ Menu Utama', 'm:main')]] });
};
