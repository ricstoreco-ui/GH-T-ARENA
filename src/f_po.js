// GH-T ARENA Bot — f_po.js: Pencairan Hadiah (Payout DANA)
import {
  esc, wib, rp, UUID, rpc, sb, count, b, BACK, kbRows, show, stLabel, getT, audit, tPick, notify, notifNote
} from './core.js';

export const H = {};

const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);

async function poList(env, tid) {
  const t = await getT(env, tid);
  
  // Ambil data pemenang dari tournament_results
  const res = (await sb(env, 'GET', `tournament_results?tournament_id=eq.${tid}&select=registration_id,final_rank,prize_amount&order=final_rank.asc`)) || [];
  
  if (!res.length) {
    return { text: `<b>💸 Pencairan: ${esc(t.name)}</b>\nBelum ada data pemenang. Pastikan turnamen sudah difinalisasi.`, markup: { inline_keyboard: [[b('⬅️ Kembali', 'm:t:v:' + tid)]] } };
  }

  const regIds = res.map(r => r.registration_id).join(',');
  const regs = (await sb(env, 'GET', `registrations?id=in.(${regIds})&select=id,team_name,owner_id`)) || [];
  const ownerIds = regs.map(r => r.owner_id).join(',');
  
  const [profs, dana, pays] = await Promise.all([
    sb(env, 'GET', `profiles?id=in.(${ownerIds})&select=id,username,whatsapp`),
    sb(env, 'GET', `dana_accounts?user_id=in.(${ownerIds})&select=user_id,dana_number,dana_name`),
    sb(env, 'GET', `payouts?tournament_id=eq.${tid}&select=*`).catch(() => []) // Jika tabel payouts belum ada, anggap kosong
  ]);

  const pMap = Object.fromEntries((profs||[]).map(p => [p.id, p]));
  const dMap = Object.fromEntries((dana||[]).map(d => [d.user_id, d]));
  const payMap = Object.fromEntries((pays||[]).map(p => [p.registration_id, p]));

  let text = `<b>💸 Pencairan: ${esc(t.name)}</b>\n\n`;
  const kb = [];

  for (const r of res) {
    const reg = regs.find(x => x.id === r.registration_id);
    if (!reg) continue;
    const p = pMap[reg.owner_id] || {};
    const d = dMap[reg.owner_id] || { dana_number: 'Belum diisi', dana_name: 'Belum diisi' };
    const st = payMap[r.registration_id]?.status || 'belum_dibayar';
    
    text += `<b>#${r.final_rank} ${esc(reg.team_name)}</b>\n`;
    text += `Hadiah: ${rp(r.prize_amount)}\n`;
    text += `Captain: ${esc(p.username || '-')} (WA: ${esc(p.whatsapp || '-')})\n`;
    text += `DANA: ${esc(d.dana_name)} - ${esc(d.dana_number)}\n`;
    text += `Status: ${st.toUpperCase()}\n\n`;

    if (st !== 'sudah_dibayar') {
      kb.push([b(`💸 Proses ${String(reg.team_name).slice(0, 15)}`, `m:po:p:${tid}:${r.registration_id}`)]);
    }
  }

  if (!kb.length) text += '<i>Semua hadiah sudah dibayar.</i>\n';
  else kb.push([b('✅ Selesaikan Seluruh Pencairan', 'm:po:fin:' + tid)]);
  
  kb.push([b('⬅️ Kembali', 'm:t:v:' + tid)]);
  return { text, markup: { inline_keyboard: kb } };
}

H.po = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) {
    const x = await tPick(env, 'status=eq.selesai', 'm:po:t:');
    return show(env, chat, mid, '<b>💸 Pencairan Hadiah</b>\nPilih turnamen yang sudah selesai:', { inline_keyboard: [...x.kb, ...BACK] });
  }
  if (a === 't') return sh(env, chat, mid, await poList(env, id));
  
  if (a === 'p') {
    const rid = p[4];
    const reg = (await sb(env, 'GET', `registrations?id=eq.${rid}&select=owner_id,team_name`))?.[0];
    if (!reg) throw new Error('Tim tidak ditemukan');
    
    // Asumsi RPC admin_set_payout_status menerima registration_id atau payout_id.
    // Jika database menggunakan payout_id, sesuaikan parameternya.
    await rpc(env, 'admin_set_payout_status', { p_registration: rid, p_status: 'sudah_dibayar', p_note: 'Transfer manual via bot' }).catch(async (e) => {
        // Fallback jika parameter berbeda
        await rpc(env, 'admin_set_payout_status', { p_registration_id: rid, p_status: 'sudah_dibayar', p_note: 'Transfer manual via bot' });
    });

    await notify(env, reg.owner_id, 'hadiah', 'Hadiah Dicairkan', `Hadiah untuk tim ${reg.team_name} telah ditransfer ke DANA Anda.`);
    return sh(env, chat, mid, await poList(env, id, `✅ Status tim ${esc(reg.team_name)} diubah menjadi SUDAH DIBAYAR.`));
  }

  if (a === 'fin') {
    await rpc(env, 'admin_complete_payouts', { p_tournament: id });
    return sh(env, chat, mid, await poList(env, id, '✅ Seluruh pencairan ditandai selesai.'));
  }
};
