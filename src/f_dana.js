// GH-T ARENA Bot — f_dana.js: Persetujuan Perubahan Data DANA
import {
  esc, wib, UUID, rpc, sb, count, getState, setState, clearState, b, BACK, show, audit, notify, notifNote
} from './core.js';

export const H = {};
export const T = {};

const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);

async function dcList(env, notice) {
  const rows = (await sb(env, 'GET', 'dana_change_requests?status=eq.diajukan&select=id,user_id,created_at&order=created_at.asc&limit=15')) || [];
  
  if (!rows.length) {
    return { text: (notice ? notice + '\n\n' : '') + '<b>💳 Persetujuan DANA</b>\nTidak ada pengajuan perubahan data DANA.', markup: { inline_keyboard: [[b('🔄 Segarkan', 'm:dc')], ...BACK] } };
  }

  const uids = rows.map(r => r.user_id).join(',');
  const profs = (await sb(env, 'GET', `profiles?id=in.(${uids})&select=id,username`)) || [];
  const pMap = Object.fromEntries(profs.map(p => [p.id, p.username]));

  const kb = rows.map(r => [b(`${esc(pMap[r.user_id] || 'User')} (${wib(r.created_at).slice(0,10)})`, 'm:dc:v:' + r.id)]);
  kb.push([b('🔄 Segarkan', 'm:dc')], ...BACK);
  
  return { text: (notice ? notice + '\n\n' : '') + '<b>💳 Persetujuan DANA</b>\nMenunggu persetujuan:', markup: { inline_keyboard: kb } };
}

H.dc = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) return sh(env, chat, mid, await dcList(env));
  
  if (a === 'v') {
    if (!UUID.test(id)) throw new Error('ID pengajuan tidak valid');
    const req = (await sb(env, 'GET', `dana_change_requests?id=eq.${id}&select=*`))?.[0];
    if (!req) throw new Error('Pengajuan tidak ditemukan');
    if (req.status !== 'diajukan') throw new Error('Pengajuan ini sudah diproses.');

    const prof = (await sb(env, 'GET', `profiles?id=eq.${req.user_id}&select=username,whatsapp`))?.[0];
    const current = (await sb(env, 'GET', `dana_accounts?user_id=eq.${req.user_id}&select=dana_number,dana_name`))?.[0] || { dana_number: '-', dana_name: '-' };

    let text = `<b>💳 Pengajuan Ubah DANA</b>\nCaptain: <b>${esc(prof?.username || '?')}</b> (WA: ${esc(prof?.whatsapp || '-')})\n\n`;
    text += `<b>Data Lama:</b>\nDANA: ${esc(current.dana_number)}\nAtas Nama: ${esc(current.dana_name)}\n\n`;
    text += `<b>Data Baru (Diajukan):</b>\nDANA: <b>${esc(req.new_dana_number)}</b>\nAtas Nama: <b>${esc(req.new_dana_name)}</b>\n`;

    return show(env, chat, mid, text, {
      inline_keyboard: [
        [b('✅ Setujui', 'm:dc:ok:' + id), b('❌ Tolak', 'm:dc:no:' + id)],
        [b('⬅️ Kembali', 'm:dc')]
      ]
    });
  }

  if (a === 'ok') {
    const req = (await sb(env, 'GET', `dana_change_requests?id=eq.${id}&select=*`))?.[0];
    if (!req || req.status !== 'diajukan') throw new Error('Pengajuan sudah diproses');
    
    // Update data DANA di tabel dana_accounts
    await sb(env, 'POST', 'dana_accounts?on_conflict=user_id', { 
      user_id: req.user_id, 
      dana_number: req.new_dana_number, 
      dana_name: req.new_dana_name 
    }, 'resolution=merge-duplicates,return=minimal');
    
    // Ubah status pengajuan
    await sb(env, 'PATCH', `dana_change_requests?id=eq.${id}`, { status: 'disetujui', reviewed_at: new Date().toISOString() }, 'return=minimal');
    
    await audit(env, 'acc_ubah_dana', 'dana_change_requests', 'via bot', id);
    const ok = await notify(env, req.user_id, 'keamanan', 'Data DANA Disetujui', `Perubahan data DANA Anda telah disetujui. Nomor: ${req.new_dana_number} (${req.new_dana_name}).`);
    
    return sh(env, chat, mid, await dcList(env, '✅ Perubahan DANA disetujui.\n' + notifNote(ok)));
  }

  if (a === 'no') {
    const req = (await sb(env, 'GET', `dana_change_requests?id=eq.${id}&select=*`))?.[0];
    if (!req || req.status !== 'diajukan') throw new Error('Pengajuan sudah diproses');
    
    await setState(env, chat, 'dc_rej', { id, uid: req.user_id });
    return show(env, chat, mid, '<b>❌ Tolak Pengajuan DANA</b>\nKetik alasan penolakan (akan dikirim ke Captain):', {
      inline_keyboard: [[b('✖️ Batal', 'm:dc:v:' + id)]]
    });
  }
};

T.dc_rej = async (env, chat, st, text) => {
  const { id, uid } = st.data;
  if (text.length < 3 || text.length > 200) {
    return show(env, chat, null, '❌ Alasan 3 sampai 200 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:dc:v:' + id)]] });
  }
  
  await sb(env, 'PATCH', `dana_change_requests?id=eq.${id}`, { status: 'ditolak', reject_reason: text, reviewed_at: new Date().toISOString() }, 'return=minimal');
  await clearState(env, chat);
  await audit(env, 'tolak_ubah_dana', 'dana_change_requests', text, id);
  
  const ok = await notify(env, uid, 'keamanan', 'Data DANA Ditolak', `Pengajuan perubahan data DANA Anda ditolak. Alasan: ${text}`);
  
  return sh(env, chat, null, await dcList(env, '✅ Pengajuan ditolak.\n' + notifNote(ok)));
};
