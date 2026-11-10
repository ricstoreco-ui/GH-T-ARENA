// GH-T ARENA Bot — f_cs.js: Clash Squad (Bracket, Pemenang, WO, DQ)
import {
  esc, wib, rp, UUID, rpc, sb, count, getState, setState, clearState, b, BACK, kbRows, show, stLabel, FINAL,
  getT, audit, tPick
} from './core.js';

export const H = {};
export const T = {};

const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);

async function csPanel(env, tid, notice) {
  const t = await getT(env, tid);
  if (t.format !== 'CS') throw new Error('Bukan turnamen CS');
  
  const ms = (await sb(env, 'GET', `cs_matches?tournament_id=eq.${tid}&select=id,round_no,match_no,status&order=round_no.asc,match_no.asc`)) || [];
  const pending = ms.filter(m => m.status === 'belum_dimulai' || m.status === 'berlangsung').length;
  
  let text = `<b>⚔️ ${esc(t.name)}</b>\nStatus Turnamen: ${stLabel(t.status)}\nBracket: ${t.cs_elimination === 'double' ? 'Double' : 'Single'} Elimination\nTotal Match: ${ms.length} (Sisa: ${pending})\n\n`;
  text += '<i>Pilih match di bawah untuk melihat detail atau menentukan pemenang.</i>';
  
  const kb = kbRows(ms.map(m => b(`R${m.round_no} M${m.match_no} (${m.status})`, 'm:cs:m:' + m.id)), 2);
  if (!ms.length && !FINAL.includes(t.status)) {
    kb.push([b('🎲 Buat Bracket (Undi)', 'm:cs:gen:' + tid)]);
  }
  kb.push([b('⬅️ Kembali', 'm:t:v:' + tid)]);
  
  return { text: (notice ? notice + '\n\n' : '') + text, markup: { inline_keyboard: kb } };
}

async function csMatchDetail(env, mid, notice) {
  if (!UUID.test(mid)) throw new Error('ID match tidak valid');
  const ms = await sb(env, 'GET', `cs_matches?id=eq.${mid}&select=*`);
  const m = ms?.[0];
  if (!m) throw new Error('Match tidak ditemukan');
  const t = await getT(env, m.tournament_id);

  let teamA = 'BYE', teamB = 'BYE';
  if (m.team_a) {
    const ra = await sb(env, 'GET', `registrations?id=eq.${m.team_a}&select=team_name`);
    teamA = ra?.[0]?.team_name || 'TBD';
  }
  if (m.team_b) {
    const rb = await sb(env, 'GET', `registrations?id=eq.${m.team_b}&select=team_name`);
    teamB = rb?.[0]?.team_name || 'TBD';
  }

  let text = `<b>⚔️ Match ${m.round_label || 'Ronde ' + m.round_no} #${m.match_no}</b>\n`;
  text += `Tim A: <b>${esc(teamA)}</b>\nTim B: <b>${esc(teamB)}</b>\n`;
  text += `Status: ${m.status}\n`;
  
  if (m.winner) {
    const rw = await sb(env, 'GET', `registrations?id=eq.${m.winner}&select=team_name`);
    text += `Pemenang: 🏆 <b>${esc(rw?.[0]?.team_name || '?')}</b>\n`;
  }

  const kb = [];
  if (m.status !== 'selesai' && m.status !== 'wo' && m.status !== 'bye' && m.team_a && m.team_b) {
    if (m.status === 'belum_dimulai') kb.push([b('▶️ Mulai Match', 'm:cs:go:' + m.id)]);
    if (m.status === 'berlangsung' || m.status === 'belum_dimulai') {
      kb.push([b(`✅ Menang: ${String(teamA).slice(0, 10)}`, `m:cs:win:${m.id}:a`), b(`✅ Menang: ${String(teamB).slice(0, 10)}`, `m:cs:win:${m.id}:b`)]);
      kb.push([b('🚫 Tim A WO', `m:cs:wo:${m.id}:a`), b('🚫 Tim B WO', `m:cs:wo:${m.id}:b`)]);
    }
  }
  
  if (m.status === 'selesai') {
    kb.push([b('↩️ Batalkan Hasil', 'm:cs:unc:' + m.id)]);
  }

  kb.push([b('⬅️ Kembali', 'm:cs:t:' + m.tournament_id)]);
  return { text: (notice ? notice + '\n\n' : '') + text, markup: { inline_keyboard: kb } };
}

H.cs = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) {
    const x = await tPick(env, 'format=eq.CS&status=not.in.(selesai,dibatalkan)', 'm:cs:t:');
    return show(env, chat, mid, '<b>⚔️ Clash Squad</b>\n' + (x.rows.length ? 'Pilih turnamen CS:' : 'Belum ada turnamen CS aktif.'), { inline_keyboard: [...x.kb, ...BACK] });
  }
  if (a === 't') return sh(env, chat, mid, await csPanel(env, id));
  if (a === 'm') return sh(env, chat, mid, await csMatchDetail(env, id));
  if (a === 'gen') {
    const t = await getT(env, id);
    if (t.drawn_at) throw new Error('Bracket sudah diundi. Tidak bisa undi ulang.');
    const res = await rpc(env, 'sys_generate_cs_bracket', { p_tournament: id });
    await audit(env, 'generate_bracket_cs', 'tournaments', 'via bot', id);
    return sh(env, chat, mid, await csPanel(env, id, `✅ Bracket berhasil dibuat (${t.cs_elimination}).`));
  }
  if (a === 'go') {
    await rpc(env, 'admin_cs_start_match', { p_match: id });
    return sh(env, chat, mid, await csMatchDetail(env, id, '✅ Match dimulai.'));
  }
  if (a === 'win') {
    const m = (await sb(env, 'GET', `cs_matches?id=eq.${id}&select=*`))?.[0];
    if (!m) throw new Error('Match tidak ditemukan');
    const winId = p[4] === 'a' ? m.team_a : m.team_b; // <--- INI YANG DIBENERIN
    if (!winId) throw new Error('Tim tidak valid');
    await rpc(env, 'admin_cs_set_winner', { p_match: id, p_winner: winId, p_result_type: 'normal' });
    return sh(env, chat, mid, await csMatchDetail(env, id, '✅ Pemenang disimpan, bracket dimajukan.'));
  }
  if (a === 'wo') {
    const m = (await sb(env, 'GET', `cs_matches?id=eq.${id}&select=*`))?.[0];
    if (!m) throw new Error('Match tidak ditemukan');
    const winId = p[4] === 'a' ? m.team_b : m.team_a; // <--- INI YANG DIBENERIN
    if (!winId) throw new Error('Lawan tidak ada (BYE)');
    await rpc(env, 'admin_cs_set_winner', { p_match: id, p_winner: winId, p_result_type: 'wo' });
    return sh(env, chat, mid, await csMatchDetail(env, id, '✅ WO dicatat, lawan maju.'));
  }
  if (a === 'unc') {
    await rpc(env, 'admin_cs_undo_result', { p_match: id, p_reason: 'via bot' });
    return sh(env, chat, mid, await csMatchDetail(env, id, '✅ Hasil dibatalkan.'));
  }
};
