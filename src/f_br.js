// GH-T ARENA Bot — f_br.js: Battle Royale, OCR otomatis, Leaderboard/Hasil, finalisasi, Predator.
import {
  esc, wib, rp, UUID, tg, rpc, sb, count, getState, setState, clearState, b, BACK, kbRows, show, ST, stLabel, FINAL,
  getT, patchT, audit, notify, notifyRegistrants, notifNote, tPick, MAXIMG, EXT, downloadTg, sha256Hex, storageUpload, storageDelete, regUpsert,
} from './core.js';

export const H = {};
export const T = {};
export const U = {};
export const KEEP = ['m:br:ayes', 'm:br:mok'];
const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);
const ICON = { belum_dimulai: '⚪', berlangsung: '🟢', selesai: '🟡', hasil_diproses: '🟠', hasil_dipublikasikan: '✅' };
const STL = { belum_dimulai: 'Belum Dimulai', berlangsung: 'Sedang Berlangsung', selesai: 'Selesai', hasil_diproses: 'Hasil Diproses', hasil_dipublikasikan: 'Hasil Dipublikasikan' };
const PRES = { hadir: 'Hadir', no_show: 'No-show', dq: 'DQ', tidak_terdeteksi: 'Tidak terdeteksi' };
const COMP = [['aktif', 'Aktif'], ['dq', 'Diskualifikasi (DQ)'], ['mundur_poin_dipertahankan', 'Mundur, poin dipertahankan'], ['dikeluarkan', 'Dikeluarkan dari perhitungan']];

// ---------- OCR: pemicu GitHub Actions ----------
export async function dispatchOcr(env, matchId) {
  if (!env.GH_TOKEN || !env.GH_REPO) return { ok: false, why: 'GH_TOKEN / GH_REPO belum diisi di Cloudflare' };
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gh-t-arena-bot', 'X-GitHub-Api-Version': '2022-11-28', 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'ocr', client_payload: { match: matchId || null } }),
    });
    if (r.status === 204) return { ok: true };
    return { ok: false, why: `GitHub menolak (${r.status})` };
  } catch (e) { return { ok: false, why: String(e.message).slice(0, 100) }; }
}

export async function ocrWatchdog(env) {
  const now = Date.now();
  const stuck = new Date(now - 20 * 60e3).toISOString();
  const cutoff = new Date(now - 3 * 60e3).toISOString();
  await sb(env, 'PATCH', `ocr_uploads?status=eq.diproses&uploaded_at=lt.${stuck}`, { status: 'menunggu' }, 'return=minimal').catch(() => null);
  const n = Number(await count(env, `ocr_uploads?status=eq.menunggu&uploaded_at=lt.${cutoff}&select=id`));
  if (n > 0) await dispatchOcr(env, null);
}

// ---------- util ----------
async function matchInfo(env, mid) {
  if (!UUID.test(mid)) throw new Error('ID match tidak valid');
  const rows = await sb(env, 'GET', `br_matches?id=eq.${mid}&select=*`);
  const m = rows?.[0];
  if (!m) throw new Error('Match tidak ditemukan');
  const t = await getT(env, m.tournament_id);
  let map = null;
  if (m.map_id) { const g = await sb(env, 'GET', `game_maps?id=eq.${m.map_id}&select=name`); map = g?.[0]?.name || null; }
  return { m, t, map };
}
const needBR = (t) => { if (t.format !== 'BR') throw new Error('Bukan turnamen BR'); };

// ---------- Panel turnamen BR ----------
async function panel(env, tid, notice) {
  const t = await getT(env, tid); needBR(t);
  const ms = (await sb(env, 'GET', `br_matches?tournament_id=eq.${tid}&select=id,match_no,status&order=match_no.asc`)) || [];
  const regs = await count(env, `registrations?tournament_id=eq.${tid}&status=eq.resmi_terdaftar&select=id`);
  const pub = ms.filter((m) => m.status === 'hasil_dipublikasikan').length;
  const kb = kbRows(ms.map((m) => b(`${ICON[m.status] || '❔'} Match ${m.match_no}`, 'm:br:m:' + m.id)), 3);
  if (!FINAL.includes(t.status)) kb.push([b('➕ Tambah Match', 'm:br:add:' + tid), b('➖ Hapus Match Terakhir', 'm:br:rem:' + tid)]);
  kb.push([b('🏆 Leaderboard', 'm:lb:t:' + tid), b('👑 Predator', 'm:br:pr:' + tid)]);
  if (!FINAL.includes(t.status)) kb.push([b('⚖️ Penyesuaian Poin', 'm:br:ad:' + tid), b('🚦 Status Tim', 'm:br:cs:' + tid)], [b('✅ Finalisasi Hasil Akhir', 'm:br:fin:' + tid)]);
  kb.push([b('⬅️ Turnamen', 'm:t:v:' + tid)]);
  return { text: (notice ? notice + '\n\n' : '') + `<b>🎯 ${esc(t.name)}</b>\nStatus: ${stLabel(t.status)}\nTim resmi: ${regs}/${t.total_slots}\nMatch: ${ms.length} (dikonfirmasi ${pub}/${t.match_count})\n\n⚪ belum · 🟢 berlangsung · 🟡 selesai · 🟠 diproses · ✅ dipublikasikan`, markup: { inline_keyboard: kb } };
}

async function matchDetail(env, mid, notice) {
  const { m, t, map } = await matchInfo(env, mid);
  const ups = (await sb(env, 'GET', `ocr_uploads?br_match_id=eq.${mid}&select=status&limit=200`)) || [];
  const c = {}; ups.forEach((u) => { c[u.status] = (c[u.status] || 0) + 1; });
  const dr = (await sb(env, 'GET', `ocr_drafts?br_match_id=eq.${mid}&status=eq.draft&select=id,version&limit=1`))?.[0];
  const L = [`<b>🎯 ${esc(t.name)} — Match ${m.match_no}</b>`, `Status: ${ICON[m.status] || ''} ${STL[m.status] || m.status}`, `Map: ${esc(map || '(belum dipilih)')}`, `Mode: ${esc(m.mode || '-')}`,
    `Screenshot: ${ups.length} (menunggu ${c.menunggu || 0}, diproses ${c.diproses || 0}, selesai ${c.selesai || 0}, gagal ${c.gagal || 0})`, `Draft OCR: ${dr ? 'ada (v' + dr.version + ')' : 'belum ada'}`];
  const pub = m.status === 'hasil_dipublikasikan';
  const kb = [];
  if (!pub) {
    kb.push([b('🗺 Pilih Map', 'm:br:mp:' + mid), b('✏️ Mode', 'm:br:md:' + mid)]);
    const row = [];
    if (m.status === 'belum_dimulai') row.push(b('▶️ Mulai Match', 'm:br:go:' + mid));
    if (m.status === 'berlangsung') row.push(b('⏹ Tandai Selesai', 'm:br:en:' + mid));
    if (row.length) kb.push(row);
    kb.push([b('📸 Upload Screenshot', 'm:oc:up:' + mid), b('🔍 Draft OCR', 'm:oc:d:' + mid)]);
  } else {
    kb.push([b('↩️ Batalkan Konfirmasi', 'm:br:unc:' + mid)]);
  }
  kb.push([b('🔑 Room ID', 'm:rm:b:' + mid)], [b('🔄 Segarkan', 'm:br:m:' + mid), b('⬅️ Match Lain', 'm:br:t:' + t.id)]);
  return { text: (notice ? notice + '\n\n' : '') + L.join('\n'), markup: { inline_keyboard: kb } };
}

// ---------- Leaderboard / Hasil ----------
export async function brBoard(env, tid) {
  const t = await getT(env, tid);
  const rows = (await sb(env, 'GET', `v_leaderboard_public?tournament_id=eq.${tid}&select=*&order=rank_no.asc,team_name.asc`)) || [];
  const lines = rows.map((r) => `#${r.rank_no} ${esc(r.team_name)}${r.competition_status === 'dq' ? ' 🟥DQ' : ''} — <b>${r.total_points}</b> poin · ${r.total_kills} kill · ${r.matches_played} match`);
  const pred = (await sb(env, 'GET', `v_predator_live?tournament_id=eq.${tid}&select=*`))?.[0];
  return { t, rows, text: `<b>🏆 Leaderboard: ${esc(t.name)}</b>\n${t.status === 'selesai' ? '✅ FINAL' : '🔴 LIVE / BELUM FINAL'}\n\n` + (lines.join('\n') || 'Belum ada hasil dikonfirmasi.') + (pred ? `\n\n👑 Predator sementara: <b>${esc(pred.nickname)}</b> (${esc(pred.team_name)}) — ${pred.total_kills} kill` : '') };
}

async function csResultText(env, tid) {
  const res = (await sb(env, 'GET', `tournament_results?tournament_id=eq.${tid}&select=registration_id,final_rank,prize_amount&order=final_rank.asc`)) || [];
  if (!res.length) return null;
  const ids = res.map((r) => r.registration_id).join(',');
  const rg = (await sb(env, 'GET', `registrations?id=in.(${ids})&select=id,team_name`)) || [];
  const nm = Object.fromEntries(rg.map((r) => [r.id, r.team_name]));
  const medal = ['🥇', '🥈', '🥉'];
  return res.map((r) => `${medal[r.final_rank - 1] || '#' + r.final_rank} ${esc(nm[r.registration_id] || '?')} — hadiah ${rp(r.prize_amount)}`).join('\n');
}

H.lb = async (env, chat, mid, p) => {
  if (p[2] !== 't') {
    const x = await tPick(env, 'status=not.eq.segera_hadir', 'm:lb:t:');
    return show(env, chat, mid, '<b>🏅 Hasil & Peringkat</b>\nPilih turnamen:', { inline_keyboard: [...x.kb, ...BACK] });
  }
  const tid = p[3];
  const t = await getT(env, tid);
  let text;
  if (t.format === 'BR') text = (await brBoard(env, tid)).text;
  else {
    const fin = await csResultText(env, tid);
    const ms = (await sb(env, 'GET', `v_cs_bracket_public?tournament_id=eq.${tid}&select=bracket,round_no,round_label,match_no,public_status,team_a_name,team_b_name,winner_name&order=bracket.asc,round_no.asc,match_no.asc&limit=60`)) || [];
    const lines = ms.map((x) => `${esc(x.round_label || x.bracket)} #${x.match_no}: ${esc(x.team_a_name || '—')} vs ${esc(x.team_b_name || '—')}${x.winner_name ? ' → <b>' + esc(x.winner_name) + '</b>' : ' (' + x.public_status + ')'}`);
    text = `<b>⚔️ Hasil: ${esc(t.name)}</b>\n${t.status === 'selesai' ? '✅ FINAL' : stLabel(t.status)}\n\n` + (fin ? fin + '\n\n' : '') + (lines.join('\n') || 'Bracket belum dibuat.');
  }
  if (t.status === 'selesai' && t.format === 'BR') {
    const fin = await csResultText(env, tid);
    if (fin) text += '\n\n<b>Hasil akhir & hadiah</b>\n' + fin;
  }
  return show(env, chat, mid, text, { inline_keyboard: [[b('🔄 Segarkan', 'm:lb:t:' + tid), b('⬅️ Daftar', 'm:lb')], ...BACK] });
};

// ---------- Handler BR ----------
H.br = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) {
    const x = await tPick(env, 'format=eq.BR&status=not.in.(selesai,dibatalkan)', 'm:br:t:');
    return show(env, chat, mid, '<b>🎯 Battle Royale</b>\n' + (x.rows.length ? 'Pilih turnamen BR:' : 'Belum ada turnamen BR aktif.'), { inline_keyboard: [...x.kb, ...BACK] });
  }
  if (a === 't') return sh(env, chat, mid, await panel(env, id));
  if (a === 'm') return sh(env, chat, mid, await matchDetail(env, id));

  if (a === 'add') {
    const t = await getT(env, id); needBR(t);
    if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
    const last = (await sb(env, 'GET', `br_matches?tournament_id=eq.${id}&select=match_no&order=match_no.desc&limit=1`))?.[0];
    const no = (last?.match_no || 0) + 1;
    await sb(env, 'POST', 'br_matches', { tournament_id: id, match_no: no, status: 'belum_dimulai' }, 'return=minimal');
    await patchT(env, id, { match_count: no });
    await audit(env, 'tambah_match_br', 'br_matches', `match ${no}`, id);
    return sh(env, chat, mid, await panel(env, id, `✅ Match ${no} ditambahkan.`));
  }
  if (a === 'rem') {
    const t = await getT(env, id); needBR(t);
    const last = (await sb(env, 'GET', `br_matches?tournament_id=eq.${id}&select=id,match_no,status&order=match_no.desc&limit=1`))?.[0];
    if (!last) throw new Error('Tidak ada match');
    if (last.status !== 'belum_dimulai') throw new Error(`Match ${last.match_no} sudah berstatus ${last.status}, tidak bisa dihapus.`);
    const up = Number(await count(env, `ocr_uploads?br_match_id=eq.${last.id}&select=id`));
    if (up > 0) throw new Error(`Match ${last.match_no} sudah punya ${up} screenshot.`);
    if ((t.match_count || 0) <= 1) throw new Error('Minimal 1 match.');
    return show(env, chat, mid, `<b>Hapus Match ${last.match_no}?</b>`, { inline_keyboard: [[b('🗑 Ya, hapus', 'm:br:remy:' + id), b('✖️ Batal', 'm:br:t:' + id)]] });
  }
  if (a === 'remy') {
    const t = await getT(env, id); needBR(t);
    const last = (await sb(env, 'GET', `br_matches?tournament_id=eq.${id}&select=id,match_no,status&order=match_no.desc&limit=1`))?.[0];
    if (!last || last.status !== 'belum_dimulai') throw new Error('Match terakhir tidak bisa dihapus');
    await sb(env, 'DELETE', `br_matches?id=eq.${last.id}`);
    await patchT(env, id, { match_count: Math.max(1, last.match_no - 1) });
    await audit(env, 'hapus_match_br', 'br_matches', `match ${last.match_no}`, id);
    return sh(env, chat, mid, await panel(env, id, `🗑 Match ${last.match_no} dihapus.`));
  }

  if (a === 'mp') {
    const { m, t } = await matchInfo(env, id);
    if (m.status === 'hasil_dipublikasikan') throw new Error('Match sudah dikonfirmasi');
    const maps = (await sb(env, 'GET', `game_maps?game_id=eq.${t.game_id}&is_active=eq.true&select=id,name&order=sort_order.asc,name.asc`)) || [];
    if (!maps.length) throw new Error('Belum ada map aktif untuk game ini');
    return show(env, chat, mid, `<b>🗺 Pilih Map — Match ${m.match_no}</b>`, { inline_keyboard: [...kbRows(maps.map((x, i) => b(x.name, `m:br:ms:${id}:${i}`)), 2), [b('⬅️ Kembali', 'm:br:m:' + id)]] });
  }
  if (a === 'ms') {
    const { m, t } = await matchInfo(env, id);
    if (m.status === 'hasil_dipublikasikan') throw new Error('Match sudah dikonfirmasi');
    const maps = (await sb(env, 'GET', `game_maps?game_id=eq.${t.game_id}&is_active=eq.true&select=id,name&order=sort_order.asc,name.asc`)) || [];
    const mp = maps[Number(p[4])];
    if (!mp) throw new Error('Map tidak valid');
    await sb(env, 'PATCH', `br_matches?id=eq.${id}`, { map_id: mp.id }, 'return=minimal');
    await audit(env, 'set_map_match', 'br_matches', mp.name, id);
    return sh(env, chat, mid, await matchDetail(env, id, `✅ Map: ${esc(mp.name)}`));
  }
  if (a === 'md') {
    const { m } = await matchInfo(env, id);
    await setState(env, chat, 'br_mode', { mid: id });
    return show(env, chat, mid, `<b>✏️ Mode — Match ${m.match_no}</b>\nSekarang: ${esc(m.mode || '-')}\nKetik mode (contoh: Squad). Ketik - untuk mengosongkan.`, { inline_keyboard: [[b('✖️ Batal', 'm:br:m:' + id)]] });
  }
  if (a === 'go' || a === 'en') {
    const { m, t } = await matchInfo(env, id);
    if (a === 'go') {
      if (m.status !== 'belum_dimulai') throw new Error('Match tidak dalam status Belum Dimulai');
      if (t.status !== 'berlangsung') throw new Error('Turnamen belum berstatus Berlangsung. Mulai turnamen dulu (menu Turnamen > Ubah Status).');
      if (!m.map_id) throw new Error('Pilih map match dulu.');
    } else if (m.status !== 'berlangsung') throw new Error('Match tidak sedang berlangsung');
    const ns = a === 'go' ? 'berlangsung' : 'selesai';
    await sb(env, 'PATCH', `br_matches?id=eq.${id}`, { status: ns }, 'return=minimal');
    await audit(env, 'status_match_br', 'br_matches', ns, id, { status: m.status }, { status: ns });
    return sh(env, chat, mid, await matchDetail(env, id, `✅ Match ${m.match_no}: ${STL[ns]}`));
  }
  if (a === 'unc') {
    const { m } = await matchInfo(env, id);
    if (m.status !== 'hasil_dipublikasikan') throw new Error('Match belum dikonfirmasi');
    return show(env, chat, mid, `<b>↩️ Batalkan konfirmasi Match ${m.match_no}?</b>\nHasil dan statistik match ini dihapus dari leaderboard (draft OCR tetap ada untuk koreksi). Captain diberi tahu bahwa hasil sedang dikoreksi.`, { inline_keyboard: [[b('↩️ Ya, batalkan', 'm:br:uncy:' + id), b('✖️ Tidak', 'm:br:m:' + id)]] });
  }
  if (a === 'uncy') {
    const { m } = await matchInfo(env, id);
    await rpc(env, 'admin_br_unconfirm_match', { p_match: id, p_reason: 'via bot' });
    await sb(env, 'PATCH', `ocr_drafts?br_match_id=eq.${id}&status=eq.dikonfirmasi`, { status: 'draft', confirmed_at: null }, 'return=minimal').catch(() => null);
    return sh(env, chat, mid, await matchDetail(env, id, `✅ Konfirmasi Match ${m.match_no} dibatalkan. Leaderboard dihitung ulang otomatis.`));
  }

  // ----- Penyesuaian poin -----
  if (a === 'ad') {
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${id}&status=eq.resmi_terdaftar&select=id,team_name&order=team_name.asc&limit=24`)) || [];
    return show(env, chat, mid, '<b>⚖️ Penyesuaian Poin</b>\nPilih tim:', { inline_keyboard: [...kbRows(regs.map((r) => b(String(r.team_name).slice(0, 24), 'm:br:adt:' + r.id)), 2), [b('⬅️ Kembali', 'm:br:t:' + id)]] });
  }
  if (a === 'adt') {
    const r = (await sb(env, 'GET', `registrations?id=eq.${id}&select=id,team_name,tournament_id`))?.[0];
    if (!r) throw new Error('Tim tidak ditemukan');
    await setState(env, chat, 'br_adj', { rid: id, tid: r.tournament_id, team: r.team_name });
    return show(env, chat, mid, `<b>⚖️ Poin: ${esc(r.team_name)}</b>\nKetik selisih poin dan alasan (opsional):\n<code>-5 pelanggaran aturan</code>\n<code>+3 koreksi</code>`, { inline_keyboard: [[b('✖️ Batal', 'm:br:t:' + r.tournament_id)]] });
  }
  if (a === 'ayes') {
    const st = await getState(env, chat);
    if (!st || st.state !== 'br_adjc') return show(env, chat, mid, 'Sesi kedaluwarsa.', { inline_keyboard: BACK });
    const d = st.data;
    await rpc(env, 'admin_br_adjust_score', { p_registration: d.rid, p_delta: d.delta, p_reason: d.reason || null });
    await clearState(env, chat);
    return sh(env, chat, mid, await panel(env, d.tid, `✅ Poin ${esc(d.team)} disesuaikan ${d.delta > 0 ? '+' : ''}${d.delta}. Captain diberi notifikasi.`));
  }

  // ----- Status kompetisi tim -----
  if (a === 'cs') {
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${id}&status=eq.resmi_terdaftar&select=id,team_name,competition_status&order=team_name.asc&limit=24`)) || [];
    return show(env, chat, mid, '<b>🚦 Status Tim</b>\nPilih tim:', { inline_keyboard: [...kbRows(regs.map((r) => b(`${r.competition_status === 'aktif' ? '' : '⚠️ '}${String(r.team_name).slice(0, 22)}`, 'm:br:cst:' + r.id)), 2), [b('⬅️ Kembali', 'm:br:t:' + id)]] });
  }
  if (a === 'cst') {
    const r = (await sb(env, 'GET', `registrations?id=eq.${id}&select=id,team_name,competition_status,tournament_id`))?.[0];
    if (!r) throw new Error('Tim tidak ditemukan');
    return show(env, chat, mid, `<b>🚦 ${esc(r.team_name)}</b>\nStatus sekarang: ${esc(r.competition_status)}\nDQ: poin lama tetap, match berikutnya 0, tidak dapat hadiah. Mundur: pilih mempertahankan poin atau keluarkan dari perhitungan.`,
      { inline_keyboard: [...COMP.map(([k, l], i) => [b(l, `m:br:css:${id}:${i}`)]), [b('⬅️ Kembali', 'm:br:cs:' + r.tournament_id)]] });
  }
  if (a === 'css') {
    const r = (await sb(env, 'GET', `registrations?id=eq.${id}&select=id,team_name,tournament_id`))?.[0];
    const c = COMP[Number(p[4])];
    if (!r || !c) throw new Error('Pilihan tidak valid');
    await setState(env, chat, 'br_cst', { rid: id, tid: r.tournament_id, team: r.team_name, status: c[0] });
    return show(env, chat, mid, `<b>🚦 ${esc(r.team_name)} → ${esc(c[1])}</b>\nKetik <b>alasan/catatan</b> (dicatat di riwayat). Ketik - jika tidak ada.`, { inline_keyboard: [[b('✖️ Batal', 'm:br:cs:' + r.tournament_id)]] });
  }

  // ----- Predator & Finalisasi -----
  if (a === 'pr') {
    const x = await brBoard(env, id);
    const hist = (await sb(env, 'GET', 'tournament_archive?predator_nickname=not.is.null&select=tournament_name,predator_nickname,predator_team_name,predator_kills&order=ended_at.desc&limit=5')) || [];
    return show(env, chat, mid, '<b>👑 Predator</b>\n' + (x.text.split('\n\n').pop().startsWith('👑') ? x.text.split('\n\n').pop() : 'Belum ada Predator sementara.') +
      (hist.length ? '\n\n<b>Hall of Predators (terbaru)</b>\n' + hist.map((h) => `• ${esc(h.predator_nickname)} (${esc(h.predator_team_name)}) — ${h.predator_kills} kill · ${esc(h.tournament_name)}`).join('\n') : ''),
      { inline_keyboard: [[b('⬅️ Kembali', 'm:br:t:' + id)]] });
  }
  if (a === 'fin') {
    const t = await getT(env, id); needBR(t);
    if (t.status !== 'berlangsung') throw new Error('Finalisasi hanya untuk turnamen Berlangsung');
    const ms = (await sb(env, 'GET', `br_matches?tournament_id=eq.${id}&select=match_no,status`)) || [];
    const pend = ms.filter((m) => m.status !== 'hasil_dipublikasikan');
    const x = await brBoard(env, id);
    if (pend.length || ms.length < (t.match_count || 0)) {
      return show(env, chat, mid, `<b>✅ Finalisasi belum bisa</b>\nMatch belum dikonfirmasi: ${pend.map((m) => m.match_no).join(', ') || '(jumlah match kurang dari konfigurasi)'}\n\n` + x.text, { inline_keyboard: [[b('⬅️ Kembali', 'm:br:t:' + id)]] });
    }
    return show(env, chat, mid, '<b>✅ Finalisasi Hasil Akhir</b>\nSemua match sudah dikonfirmasi. Setelah ini turnamen jadi Selesai, hadiah/sertifikat/arsip dibuat, dan Captain diberi tahu.\n\n' + x.text + '\n\nLanjut?',
      { inline_keyboard: [[b('✅ Ya, finalisasi', 'm:br:fy:' + id), b('✖️ Batal', 'm:br:t:' + id)]] });
  }
  if (a === 'fy') return finalize(env, chat, mid, id, []);
};

async function finalize(env, chat, mid, tid, manual) {
  try {
    const r = await rpc(env, 'admin_br_finalize', { p_tournament: tid, p_manual: manual });
    await audit(env, 'finalisasi_br', 'tournaments', 'via bot', tid);
    await clearState(env, chat);
    const x = await brBoard(env, tid);
    return show(env, chat, mid, `✅ <b>Turnamen selesai.</b> Juara: <b>${esc(r?.juara || '-')}</b>\nHadiah/sertifikat dibuat otomatis. Lanjut ke menu Pencairan untuk payout.\n\n` + x.text, { inline_keyboard: [[b('💸 Pencairan', 'm:po:t:' + tid), b('⬅️ Turnamen', 'm:t:v:' + tid)]] });
  } catch (e) {
    if (!/SERI_PERLU_KEPUTUSAN/.test(e.message)) throw e;
    const t = await getT(env, tid);
    const x = await brBoard(env, tid);
    const dq = x.rows.filter((r) => r.competition_status === 'dq').length;
    const grp = {};
    x.rows.forEach((r) => { const k = `${r.total_points}|${r.total_kills}|${r.placement_points}`; (grp[k] ||= []).push(r); });
    const groups = Object.values(grp).filter((g) => g.length > 1 && Math.min(...g.map((r) => r.rank_no)) <= t.winner_positions + dq);
    if (!groups.length) throw e;
    const items = [];
    const lines = groups.map((g) => g.map((r) => { items.push({ id: r.registration_id, name: r.team_name, g: groups.indexOf(g) }); return `${items.length}. ${esc(r.team_name)}`; }).join('\n'));
    await setState(env, chat, 'br_man', { tid, items, ng: groups.length });
    return show(env, chat, mid, '<b>⚖️ Seri di posisi hadiah</b>\nPoin, kill, dan placement sama. Hubungi Captain via WhatsApp, lalu tentukan urutannya.\n\n' + lines.map((l, i) => `<b>Grup ${i + 1}</b>\n${l}`).join('\n\n') +
      '\n\nKetik nomor tim dari <b>terbaik ke terburuk</b> untuk tiap grup, pisahkan grup dengan <code>|</code>. Contoh: <code>2 1 | 4 3</code>', { inline_keyboard: [[b('✖️ Batal', 'm:br:t:' + tid)]] });
  }
}

T.br_mode = async (env, chat, st, text) => {
  const id = st.data?.mid;
  const { m } = await matchInfo(env, id);
  if (m.status === 'hasil_dipublikasikan') throw new Error('Match sudah dikonfirmasi');
  if (text !== '-' && text.length > 40) return show(env, chat, null, '❌ Maksimal 40 karakter.', { inline_keyboard: [[b('✖️ Batal', 'm:br:m:' + id)]] });
  await sb(env, 'PATCH', `br_matches?id=eq.${id}`, { mode: text === '-' ? null : text }, 'return=minimal');
  await clearState(env, chat);
  return sh(env, chat, null, await matchDetail(env, id, '✅ Mode diperbarui.'));
};
T.br_adj = async (env, chat, st, text) => {
  const d = st.data;
  const m = text.match(/^([+-]?\d{1,5})\s*([\s\S]*)$/);
  if (!m || Number(m[1]) === 0) return show(env, chat, null, '❌ Format: <code>-5 alasan</code> atau <code>+3</code> (bukan nol). Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:br:t:' + d.tid)]] });
  const nd = { ...d, delta: Number(m[1]), reason: m[2].trim().slice(0, 200) };
  await setState(env, chat, 'br_adjc', nd);
  return show(env, chat, null, `<b>Konfirmasi penyesuaian poin</b>\nTim: ${esc(d.team)}\nSelisih: <b>${nd.delta > 0 ? '+' : ''}${nd.delta}</b>\nAlasan: ${esc(nd.reason || '-')}\n\nProses?`, { inline_keyboard: [[b('✅ Ya', 'm:br:ayes'), b('✖️ Batal', 'm:br:t:' + d.tid)]] });
};
T.br_cst = async (env, chat, st, text) => {
  const d = st.data;
  if (text !== '-' && (text.length < 3 || text.length > 300)) return show(env, chat, null, '❌ Catatan 3 sampai 300 karakter, atau -.', { inline_keyboard: [[b('✖️ Batal', 'm:br:cs:' + d.tid)]] });
  await rpc(env, 'admin_set_competition_status', { p_registration: d.rid, p_status: d.status, p_note: text === '-' ? null : text });
  await clearState(env, chat);
  return sh(env, chat, null, await panel(env, d.tid, `✅ Status ${esc(d.team)}: ${esc(d.status)}. Captain diberi notifikasi.`));
};
T.br_man = async (env, chat, st, text) => {
  const d = st.data;
  const groups = text.split('|').map((g) => g.trim().split(/[\s,]+/).filter(Boolean).map(Number));
  const used = new Set(); const manual = [];
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      const it = d.items[g[i] - 1];
      if (!it || !Number.isInteger(g[i]) || used.has(g[i])) return show(env, chat, null, '❌ Nomor tidak valid atau ganda. Ketik lagi.', { inline_keyboard: [[b('✖️ Batal', 'm:br:t:' + d.tid)]] });
      used.add(g[i]); manual.push({ registration_id: it.id, final_rank: i + 1 });
    }
  }
  if (used.size !== d.items.length) return show(env, chat, null, `❌ Semua ${d.items.length} tim harus diurutkan.`, { inline_keyboard: [[b('✖️ Batal', 'm:br:t:' + d.tid)]] });
  await audit(env, 'putusan_seri_manual', 'tournaments', JSON.stringify(manual).slice(0, 400), d.tid);
  return finalize(env, chat, null, d.tid, manual);
};

// ================= OCR =================
const getDraft = async (env, mid) => (await sb(env, 'GET', `ocr_drafts?br_match_id=eq.${mid}&status=eq.draft&select=*&order=created_at.desc&limit=1`))?.[0] || null;
async function saveDraft(env, d, data) {
  const rows = await sb(env, 'PATCH', `ocr_drafts?id=eq.${d.id}`, { merged_data: data, version: (d.version || 1) + 1 }, 'return=representation');
  if (!rows?.[0]) throw new Error('Draft tidak tersimpan');
  return rows[0];
}
const sortRows = (rows) => rows.sort((x, y) => {
  const hx = x.presence === 'hadir' ? 0 : 1, hy = y.presence === 'hadir' ? 0 : 1;
  if (hx !== hy) return hx - hy;
  return (x.placement ?? 99) - (y.placement ?? 99) || String(x.team_name).localeCompare(String(y.team_name));
});

export function validateDraft(data) {
  const rows = data.rows || [], errors = [], warns = [];
  const hadir = rows.filter((r) => r.presence === 'hadir');
  const n = hadir.length;
  if (!n) errors.push('Tidak ada tim berstatus Hadir.');
  else {
    const noRank = hadir.filter((r) => r.placement == null);
    if (noRank.length) errors.push('Tim hadir tanpa peringkat: ' + noRank.map((r) => r.team_name).join(', '));
    else {
      const set = new Set(hadir.map((r) => r.placement));
      if (set.size !== n) errors.push('Ada peringkat ganda.');
      else if (Math.max(...set) !== n || Math.min(...set) < 1) errors.push(`Peringkat harus tepat 1 sampai ${n} (jumlah tim hadir).`);
    }
  }
  for (const r of hadir) {
    const ps = (r.players || []).reduce((a, p) => a + (Number(p.kills) || 0), 0);
    if ((r.players || []).length && ps !== Number(r.kills)) warns.push(`Kill tim ${r.team_name} (${r.kills}) ≠ jumlah kill pemain (${ps}).`);
    if (r.conf != null && r.conf < 60 && !r.edited) warns.push(`Keyakinan OCR rendah untuk ${r.team_name} (${Math.round(r.conf)}%).`);
    (r.flags || []).forEach((f) => warns.push(`${r.team_name}: ${f}`));
  }
  if (data.map_ok === false) warns.push(`MAP BERBEDA: screenshot ${data.map || '?'} ≠ map match ${data.map_expected || '?'}.`);
  else if (data.map_ok == null) warns.push('Map tidak terbaca dari screenshot, cek manual.');
  return { errors, warns };
}

function draftView(m, t, d, notice) {
  const data = d.merged_data || {};
  const rows = data.rows || [];
  const v = validateDraft(data);
  const mapLine = data.map_ok === true ? `Map: ✅ ${esc(data.map)}` : data.map_ok === false ? `Map: ⚠️ terbaca ${esc(data.map)}, seharusnya ${esc(data.map_expected)}` : `Map: ❔ tidak terbaca (match: ${esc(data.map_expected || '-')})`;
  const lines = rows.map((r) => {
    const ic = r.edited ? '✏️' : r.conf != null && r.conf < 60 ? '⚠️' : r.presence === 'hadir' ? '✅' : '▫️';
    return r.presence === 'hadir' ? `${ic} #${r.placement ?? '?'} ${esc(r.team_name)} — ${r.kills} kill${r.conf != null ? ` (${Math.round(r.conf)}%)` : ''}` : `${ic} — ${esc(r.team_name)}: ${PRES[r.presence] || r.presence}`;
  });
  const warn = [...(d.warnings || []), ...v.warns];
  const text = (notice ? notice + '\n\n' : '') + `<b>📋 Draft OCR — Match ${m.match_no}</b> (v${d.version})\n${mapLine}\n\n${lines.join('\n')}` +
    (v.errors.length ? '\n\n❌ <b>Harus diperbaiki:</b>\n' + v.errors.map((e) => '• ' + esc(e)).join('\n') : '') +
    (warn.length ? '\n\n⚠️ <b>Periksa:</b>\n' + [...new Set(warn)].slice(0, 12).map((w) => '• ' + esc(w)).join('\n') : '');
  const kb = kbRows(rows.map((r, i) => b(`${r.presence === 'hadir' ? (r.placement ?? '?') : '—'} ${String(r.team_name).slice(0, 16)}`, `m:oc:e:${m.id}:${i}`)), 2);
  kb.push([b('✅ Konfirmasi', 'm:oc:cf:' + m.id), b('🔁 OCR Ulang', 'm:oc:rt:' + m.id)], [b('🗑 Buang Draft', 'm:oc:dd:' + m.id), b('⬅️ Match', 'm:br:m:' + m.id)]);
  return { text, markup: { inline_keyboard: kb } };
}

async function showDraft(env, chat, mid, matchId, notice) {
  const { m, t } = await matchInfo(env, matchId);
  const d = await getDraft(env, matchId);
  if (!d) {
    const pend = Number(await count(env, `ocr_uploads?br_match_id=eq.${matchId}&status=in.(menunggu,diproses)&select=id`));
    const fail = Number(await count(env, `ocr_uploads?br_match_id=eq.${matchId}&status=eq.gagal&select=id`));
    return show(env, chat, mid, (notice ? notice + '\n\n' : '') + `<b>📋 Draft OCR — Match ${m.match_no}</b>\n` + (pend ? `⏳ OCR masih berjalan (${pend} screenshot). Hasil dikirim otomatis ke sini.\n` : 'Belum ada draft.\n') + (fail ? `❌ ${fail} screenshot gagal dibaca.\n` : ''),
      { inline_keyboard: [[b('🔄 Segarkan', 'm:oc:d:' + matchId), b('🔁 OCR Ulang', 'm:oc:rt:' + matchId)], [b('📝 Isi Manual', 'm:oc:mk:' + matchId)], [b('⬅️ Match', 'm:br:m:' + matchId)]] });
  }
  const v = draftView(m, t, d, notice);
  return show(env, chat, mid, v.text, v.markup);
}

async function teamMenu(env, chat, mid, matchId, idx, notice) {
  const { m } = await matchInfo(env, matchId);
  const d = await getDraft(env, matchId);
  if (!d) throw new Error('Draft tidak ada');
  const r = (d.merged_data.rows || [])[idx];
  if (!r) throw new Error('Tim tidak ada di draft');
  const pl = (r.players || []).map((p, i) => `${i + 1}. ${esc(p.nickname)} — ${p.kills} kill${p.edited ? ' ✏️' : ''}${p.conf != null && p.conf < 75 ? ' ⚠️' : ''}`).join('\n');
  const kb = [[b('✏️ Peringkat', `m:oc:f:${matchId}:${idx}:p`), b('✏️ Kill Tim', `m:oc:f:${matchId}:${idx}:k`)], [b('👥 Kill Pemain', `m:oc:f:${matchId}:${idx}:y`)],
    [b('Hadir', `m:oc:f:${matchId}:${idx}:h`), b('No-show', `m:oc:f:${matchId}:${idx}:n`), b('Tdk terdeteksi', `m:oc:f:${matchId}:${idx}:t`)], [b('⬅️ Draft', 'm:oc:d:' + matchId)]];
  return show(env, chat, mid, (notice ? notice + '\n\n' : '') + `<b>✏️ ${esc(r.team_name)}</b> — Match ${m.match_no}\nStatus: ${PRES[r.presence] || r.presence}\nPeringkat: ${r.placement ?? '—'} · Kill tim: ${r.kills}${r.edited ? ' ✏️' : ''}\n\n<b>Pemain</b>\n${pl || '(tidak ada)'}`, { inline_keyboard: kb });
}

H.oc = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (a === 'up') {
    const { m, t } = await matchInfo(env, id); needBR(t);
    if (m.status === 'hasil_dipublikasikan') throw new Error('Match sudah dikonfirmasi: screenshot baru ditolak. Batalkan konfirmasi dulu untuk koreksi.');
    if (FINAL.includes(t.status)) throw new Error('Turnamen sudah selesai/dibatalkan');
    await setState(env, chat, 'oc_up', { mid: id });
    return show(env, chat, mid, `<b>📸 Upload Screenshot — Match ${m.match_no}</b>\nKirim satu atau banyak screenshot hasil match. <b>Disarankan kirim sebagai File/Dokumen</b> (tanpa kompres Telegram) supaya terbaca jelas.\nOCR berjalan otomatis; hasilnya dikirim ke sini. Screenshot duplikat dilewati.`,
      { inline_keyboard: [[b('✅ Selesai Upload', 'm:oc:done:' + id)], [b('⬅️ Match', 'm:br:m:' + id)]] });
  }
  if (a === 'done') {
    await clearState(env, chat);
    const d = await dispatchOcr(env, id);
    return sh(env, chat, mid, await matchDetail(env, id, d.ok ? '✅ Upload selesai. OCR berjalan, hasil dikirim otomatis.' : `⚠️ Upload tersimpan, tapi OCR belum bisa dipicu: ${esc(d.why)}. Akan dicoba ulang otomatis.`));
  }
  if (a === 'd') return showDraft(env, chat, mid, id);
  if (a === 'rt') {
    await sb(env, 'PATCH', `ocr_uploads?br_match_id=eq.${id}&status=in.(gagal,selesai,diproses)&deleted_at=is.null`, { status: 'menunggu', error: null }, 'return=minimal');
    const d = await dispatchOcr(env, id);
    return showDraft(env, chat, mid, id, d.ok ? '🔁 OCR diulang. Hasil dikirim otomatis (±1 menit).' : `⚠️ Pemicu OCR gagal: ${esc(d.why)}. Akan dicoba ulang otomatis.`);
  }
  if (a === 'mk') {
    const { m, t } = await matchInfo(env, id); needBR(t);
    if (m.status === 'hasil_dipublikasikan') throw new Error('Match sudah dikonfirmasi');
    if (await getDraft(env, id)) return showDraft(env, chat, mid, id, 'Draft sudah ada.');
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${t.id}&status=eq.resmi_terdaftar&competition_status=neq.dikeluarkan&select=id,team_name,competition_status`)) || [];
    if (!regs.length) throw new Error('Belum ada tim resmi terdaftar');
    const rps = (await sb(env, 'GET', `registration_players?tournament_id=eq.${t.id}&select=registration_id,nickname,sort_order&order=sort_order.asc`)) || [];
    const rows = regs.map((r) => ({ registration_id: r.id, team_name: r.team_name, presence: r.competition_status === 'dq' ? 'dq' : r.competition_status === 'mundur_poin_dipertahankan' ? 'no_show' : 'tidak_terdeteksi', placement: null, kills: 0, edited: false, conf: null, flags: [],
      players: rps.filter((x) => x.registration_id === r.id).map((x) => ({ nickname: x.nickname, kills: 0, played: false, conf: null, edited: false })) }));
    const { map } = await matchInfo(env, id);
    await sb(env, 'POST', 'ocr_drafts', { br_match_id: id, merged_data: { map: null, map_expected: map, map_ok: null, rows: sortRows(rows), manual: true }, warnings: ['Draft manual: isi hasil tiap tim.'], status: 'draft', version: 1 }, 'return=minimal');
    return showDraft(env, chat, mid, id, '📝 Draft manual dibuat. Pilih tim untuk mengisi hasil.');
  }
  if (a === 'dd') return show(env, chat, mid, '<b>Buang draft OCR ini?</b>\nEdit manual ikut hilang. Screenshot tetap tersimpan (3 hari).', { inline_keyboard: [[b('🗑 Ya, buang', 'm:oc:ddy:' + id), b('✖️ Batal', 'm:oc:d:' + id)]] });
  if (a === 'ddy') { await sb(env, 'PATCH', `ocr_drafts?br_match_id=eq.${id}&status=eq.draft`, { status: 'dibatalkan' }, 'return=minimal'); return sh(env, chat, mid, await matchDetail(env, id, '🗑 Draft dibuang.')); }
  if (a === 'e') return teamMenu(env, chat, mid, id, Number(p[4]));
  if (a === 'f') {
    const idx = Number(p[4]), f = p[5];
    const d = await getDraft(env, id);
    if (!d) throw new Error('Draft tidak ada');
    const data = d.merged_data; const r = data.rows[idx];
    if (!r) throw new Error('Tim tidak ada');
    if (f === 'h' || f === 'n' || f === 't') {
      r.presence = f === 'h' ? 'hadir' : f === 'n' ? 'no_show' : 'tidak_terdeteksi';
      if (r.presence !== 'hadir') { r.placement = null; r.kills = 0; (r.players || []).forEach((x) => { x.kills = 0; x.played = false; }); }
      r.edited = true; sortRows(data.rows);
      const nd = await saveDraft(env, d, data);
      return teamMenu(env, chat, mid, id, nd.merged_data.rows.findIndex((x) => x.registration_id === r.registration_id), `✅ Status: ${PRES[r.presence]}`);
    }
    await setState(env, chat, 'oc_val', { mid: id, idx, f, rid: r.registration_id });
    const ask = f === 'p' ? 'Ketik <b>peringkat</b> (angka 1 sampai 12):' : f === 'k' ? 'Ketik <b>kill tim</b> (angka):' :
      'Ketik kill pemain dengan nomor:\n<code>1=3 2=1 3=0 4=2</code>\n' + (r.players || []).map((x, i) => `${i + 1}. ${esc(x.nickname)}`).join('\n');
    return show(env, chat, mid, `<b>✏️ ${esc(r.team_name)}</b>\n${ask}`, { inline_keyboard: [[b('✖️ Batal', `m:oc:e:${id}:${idx}`)]] });
  }
  if (a === 'cf') {
    const { m, t } = await matchInfo(env, id);
    if (m.status === 'hasil_dipublikasikan') throw new Error('Match sudah dikonfirmasi');
    if (t.status !== 'berlangsung') throw new Error('Turnamen belum berstatus Berlangsung.');
    const d = await getDraft(env, id);
    if (!d) throw new Error('Belum ada draft OCR');
    const v = validateDraft(d.merged_data);
    if (v.errors.length) return showDraft(env, chat, mid, id, '❌ Belum bisa dikonfirmasi:\n' + v.errors.map((e) => '• ' + esc(e)).join('\n'));
    const rows = d.merged_data.rows;
    const lines = rows.filter((r) => r.presence === 'hadir').map((r) => `#${r.placement} ${esc(r.team_name)} — ${r.kills} kill`);
    const others = rows.filter((r) => r.presence !== 'hadir').map((r) => `${esc(r.team_name)}: ${PRES[r.presence]} (0 poin)`);
    const warn = [...(d.warnings || []), ...v.warns];
    return show(env, chat, mid, `<b>✅ Konfirmasi Match ${m.match_no}?</b>\n${lines.join('\n')}${others.length ? '\n\n' + others.join('\n') : ''}` +
      (warn.length ? '\n\n⚠️ Masih ada peringatan (sudah Anda periksa?):\n' + [...new Set(warn)].slice(0, 8).map((w) => '• ' + esc(w)).join('\n') : '') + '\n\nHasil langsung masuk leaderboard publik.',
      { inline_keyboard: [[b(warn.length ? '✅ Sudah saya periksa, konfirmasi' : '✅ Konfirmasi & Publikasikan', 'm:oc:cy:' + id)], [b('⬅️ Kembali ke draft', 'm:oc:d:' + id)]] });
  }
  if (a === 'cy') {
    const { m } = await matchInfo(env, id);
    const d = await getDraft(env, id);
    if (!d) throw new Error('Draft tidak ada (mungkin sudah dikonfirmasi)');
    const data = d.merged_data;
    const v = validateDraft(data);
    if (v.errors.length) throw new Error(v.errors[0]);
    const prow = data.rows.map((r) => ({ registration_id: r.registration_id, presence: r.presence, placement: r.presence === 'hadir' ? r.placement : null, kills: r.presence === 'hadir' ? Number(r.kills) || 0 : 0, edited_manually: !!r.edited }));
    const pl = [];
    for (const r of data.rows) for (const x of r.players || []) pl.push({ registration_id: r.registration_id, nickname: x.nickname, kills: Number(x.kills) || 0, played: !!x.played, edited_manually: !!x.edited });
    const res = await rpc(env, 'admin_br_confirm_match', { p_match: id, p_rows: prow, p_players: pl });
    await audit(env, 'konfirmasi_match_via_bot', 'br_matches', `match ${m.match_no}`, id, null, { tim_hadir: res?.tim_hadir });
    const x = await brBoard(env, m.tournament_id);
    return show(env, chat, mid, `✅ <b>Match ${m.match_no} dikonfirmasi</b> (${res?.tim_hadir ?? '?'} tim hadir). Leaderboard publik diperbarui otomatis.\n\n` + x.text, { inline_keyboard: [[b('⬅️ Panel BR', 'm:br:t:' + m.tournament_id)]] });
  }
};

T.oc_val = async (env, chat, st, text) => {
  const { mid, idx, f, rid } = st.data;
  const d = await getDraft(env, mid);
  if (!d) throw new Error('Draft tidak ada');
  const data = d.merged_data;
  const r = data.rows.find((x) => x.registration_id === rid);
  if (!r) throw new Error('Tim tidak ada di draft');
  const back = { inline_keyboard: [[b('✖️ Batal', `m:oc:e:${mid}:${idx}`)]] };
  if (f === 'p') {
    const n = /^\d{1,2}$/.test(text) ? Number(text) : 0;
    if (n < 1 || n > 12) return show(env, chat, null, '❌ Peringkat 1 sampai 12.', back);
    r.placement = n; r.presence = 'hadir';
  } else if (f === 'k') {
    if (!/^\d{1,3}$/.test(text)) return show(env, chat, null, '❌ Ketik angka kill.', back);
    r.kills = Number(text); r.presence = 'hadir';
  } else {
    const toks = text.split(/[\s,;]+/).filter(Boolean); const ups = [];
    for (const t of toks) {
      const m = t.match(/^(\d{1,2})=(\d{1,3})$/);
      if (!m || !(r.players || [])[Number(m[1]) - 1]) return show(env, chat, null, `❌ "${esc(t)}" tidak valid. Contoh: <code>1=3 2=1</code>`, back);
      ups.push([Number(m[1]) - 1, Number(m[2])]);
    }
    if (!ups.length) return show(env, chat, null, '❌ Tidak ada data.', back);
    ups.forEach(([i, k]) => { r.players[i].kills = k; r.players[i].played = k > 0 || r.players[i].played; r.players[i].edited = true; });
    r.kills = r.players.reduce((a, x) => a + (Number(x.kills) || 0), 0); r.presence = 'hadir';
  }
  r.edited = true;
  sortRows(data.rows);
  const nd = await saveDraft(env, d, data);
  await clearState(env, chat);
  return teamMenu(env, chat, null, mid, nd.merged_data.rows.findIndex((x) => x.registration_id === rid), '✅ Disimpan (ditandai ✏️ edit manual).');
};

// Upload screenshot (state oc_up tetap aktif supaya bisa kirim banyak)
U.oc_up = async (env, chat, st, img) => {
  const mid = st.data?.mid;
  const { m, t } = await matchInfo(env, mid);
  const kb = { inline_keyboard: [[b('✅ Selesai Upload', 'm:oc:done:' + mid)]] };
  if (img.bad) return show(env, chat, null, '❌ Kirim sebagai foto atau file JPG/PNG/WEBP.', kb);
  if (m.status === 'hasil_dipublikasikan') { await clearState(env, chat); return show(env, chat, null, '❌ Match sudah dikonfirmasi: screenshot baru ditolak.', { inline_keyboard: [[b('⬅️ Match', 'm:br:m:' + mid)]] }); }
  if (img.size > MAXIMG) return show(env, chat, null, '❌ Ukuran file maksimal 10 MB.', kb);
  const bytes = await downloadTg(env, img.file_id);
  if (bytes.byteLength > MAXIMG) throw new Error('Ukuran file lebih dari 10 MB');
  const sha = await sha256Hex(bytes);
  const dup = await sb(env, 'GET', `ocr_uploads?br_match_id=eq.${mid}&sha256=eq.${sha}&select=id`);
  if (dup?.[0]) return show(env, chat, null, '♻️ Screenshot ini sudah pernah dikirim untuk match ini (dilewati).', kb);
  const path = `m-${mid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${EXT[img.mime]}`;
  await storageUpload(env, 'ocr-screenshots', path, bytes, img.mime);
  const expires = new Date(Date.now() + 3 * 864e5).toISOString();
  let row;
  try { row = (await sb(env, 'POST', 'ocr_uploads', { br_match_id: mid, telegram_file_id: img.file_id, storage_path: path, sha256: sha, status: 'menunggu', expires_at: expires }, 'return=representation'))?.[0]; }
  catch (e) { await storageDelete(env, 'ocr-screenshots', path); if (e.status === 409) return show(env, chat, null, '♻️ Screenshot duplikat (dilewati).', kb); throw e; }
  const reg = await regUpsert(env, { bucket: 'ocr-screenshots', path, kind: 'ocr', tournament_id: t.id, ref_table: 'ocr_uploads', ref_id: row?.id, size_bytes: bytes.byteLength, delete_after: expires });
  const n = Number(await count(env, `ocr_uploads?br_match_id=eq.${mid}&select=id`));
  const d = await dispatchOcr(env, mid);
  return show(env, chat, null, `✅ Screenshot ${n} diterima (Match ${m.match_no}).${reg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'}\n` + (d.ok ? '🤖 OCR berjalan otomatis (±1 menit).' : `⚠️ OCR belum bisa dipicu: ${esc(d.why)}. Dicoba ulang otomatis.`) + '\nKirim lagi jika ada, atau tekan Selesai.', kb);
};
