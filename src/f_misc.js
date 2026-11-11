// GH-T ARENA Bot — f_misc.js: Banner, QRIS & Aset, Konfigurasi, Waiting List, Pengajuan Mundur, Captain & Saldo, upload gambar.
import {
  esc, wib, rp, UUID, rpc, sb, count, setSetting, getSetting, audit, notify,
  getState, setState, clearState, b, BACK, show, stLabel, getT, patchT, checkVals,
  MAXIMG, EXT, publicUrl, ourPath, downloadTg, storageUpload, storageDelete, regUpsert, dropOld, sendImageCard,
} from './core.js';
import { rgLabel, getReg, tDetail } from './f_main.js';

export const H = {};
export const T = {};
export const U = {};
export const KEEP = ['m:wx:', 'm:cx:ok'];
const sh = (env, chat, mid, v) => show(env, chat, mid, v.text, v.markup);
const okNote = (ok) => (ok ? '🔔 Notifikasi terkirim ke Captain.' : '⚠️ Notifikasi ke Captain GAGAL dikirim.');

// ================= BANNER =================
async function bnList(env, notice) {
  const rows = (await sb(env, 'GET', 'banners?select=id,title,sort_order,is_active&order=sort_order.asc,created_at.asc&limit=20')) || [];
  const kb = rows.map((r, i) => [b(`${i + 1}. ${r.is_active ? '✅' : '⛔'} ${String(r.title || '(tanpa judul)').slice(0, 30)}`, 'm:bn:v:' + r.id)]);
  return {
    text: (notice ? notice + '\n\n' : '') + '<b>🖼 Banner</b>\n' + (rows.length ? 'Urutan tampil di website (atas = pertama). Pilih banner:' : 'Belum ada banner.'),
    markup: { inline_keyboard: [[b('➕ Upload Banner', 'm:bn:new')], ...kb, ...BACK] },
  };
}
async function bnGet(env, id) {
  if (!UUID.test(id)) throw new Error('ID banner tidak valid');
  const rows = await sb(env, 'GET', `banners?id=eq.${id}&select=*`);
  if (!rows?.[0]) throw new Error('Banner tidak ditemukan');
  return rows[0];
}
async function bnShow(env, chat, id, notice) {
  const bn = await bnGet(env, id);
  const caption = (notice ? notice + '\n' : '') + `<b>Banner #${bn.sort_order}</b> ${bn.is_active ? '✅ Aktif' : '⛔ Nonaktif'}\n${esc(bn.title || '(tanpa judul)')}`;
  const markup = { inline_keyboard: [
    [b('⬆️ Naik', 'm:bn:u:' + id), b('⬇️ Turun', 'm:bn:dn:' + id)],
    [b(bn.is_active ? '⛔ Nonaktifkan' : '✅ Aktifkan', 'm:bn:a:' + id), b('🔁 Ganti Gambar', 'm:bn:r:' + id)],
    [b('🗑 Hapus', 'm:bn:d:' + id)], [b('⬅️ Daftar Banner', 'm:bn')],
  ] };
  return sendImageCard(env, chat, bn.image_url, caption, markup);
}
async function bnMove(env, id, dir) {
  const rows = (await sb(env, 'GET', 'banners?select=id,sort_order&order=sort_order.asc,created_at.asc')) || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sort_order !== i + 1) {
      await sb(env, 'PATCH', `banners?id=eq.${rows[i].id}`, { sort_order: i + 1 }, 'return=minimal');
      rows[i].sort_order = i + 1;
    }
  }
  const idx = rows.findIndex((r) => r.id === id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= rows.length) return false;
  const A = rows[idx], B = rows[j];
  await sb(env, 'PATCH', `banners?id=eq.${A.id}`, { sort_order: 100000 + idx }, 'return=minimal');
  await sb(env, 'PATCH', `banners?id=eq.${B.id}`, { sort_order: idx + 1 }, 'return=minimal');
  await sb(env, 'PATCH', `banners?id=eq.${A.id}`, { sort_order: j + 1 }, 'return=minimal');
  return true;
}
async function bnDelete(env, id) {
  const bn = await bnGet(env, id);
  await sb(env, 'DELETE', `banners?id=eq.${id}`);
  await dropOld(env, 'banners', bn.storage_path);
  await audit(env, 'hapus_banner', 'banners', bn.title || '-', id, { image_url: bn.image_url }, null);
}
H.bn = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) return sh(env, chat, mid, await bnList(env));
  if (a === 'new') {
    await setState(env, chat, 'bn_up', { mode: 'new' });
    return show(env, chat, mid, '<b>➕ Upload Banner</b>\nKirim <b>foto</b> banner (atau file JPG/PNG/WEBP, maks 10 MB).\nCaption foto jadi judul banner (opsional).', { inline_keyboard: [[b('✖️ Batal', 'm:bn')]] });
  }
  if (a === 'v') return bnShow(env, chat, id);
  if (a === 'u' || a === 'dn') {
    const moved = await bnMove(env, id, a === 'u' ? -1 : 1);
    return bnShow(env, chat, id, moved ? '✅ Urutan diubah.' : `ℹ️ Sudah di posisi paling ${a === 'u' ? 'atas' : 'bawah'}.`);
  }
  if (a === 'a') {
    const bn = await bnGet(env, id);
    await sb(env, 'PATCH', `banners?id=eq.${id}`, { is_active: !bn.is_active }, 'return=minimal');
    await audit(env, bn.is_active ? 'nonaktif_banner' : 'aktif_banner', 'banners', bn.title || '-', id);
    return bnShow(env, chat, id, bn.is_active ? '⛔ Banner dinonaktifkan (tidak tampil di website).' : '✅ Banner diaktifkan.');
  }
  if (a === 'r') {
    await bnGet(env, id);
    await setState(env, chat, 'bn_up', { mode: 'replace', id });
    return show(env, chat, mid, '<b>🔁 Ganti Gambar Banner</b>\nKirim <b>foto</b> pengganti (JPG/PNG/WEBP, maks 10 MB). Gambar lama dihapus setelah yang baru berhasil dipakai.', { inline_keyboard: [[b('✖️ Batal', 'm:bn:v:' + id)]] });
  }
  if (a === 'd') {
    await bnGet(env, id);
    return show(env, chat, mid, '<b>Hapus banner ini?</b>\nBanner hilang dari website dan file gambarnya dihapus.', { inline_keyboard: [[b('🗑 Ya, hapus', 'm:bn:dy:' + id), b('✖️ Batal', 'm:bn:v:' + id)]] });
  }
  if (a === 'dy') { await bnDelete(env, id); return sh(env, chat, mid, await bnList(env, '🗑 Banner dihapus.')); }
};

// ================= LOGO & ASET, QRIS =================
const ASSET_KEYS = [
  ['qris_qr_image', '🔳 Gambar QR Pembayaran'], ['logo_qris', 'Logo QRIS'],
  ['logo_transparent', 'Logo GH-T Arena (transparan)'], ['logo_original', 'Logo GH-T Arena (original)'],
  ['logo_free_fire', 'Logo Free Fire'], ['logo_garena', 'Logo Garena'], ['logo_gh_topup', 'Logo GH TOPUP'], ['logo_dana', 'Logo DANA'],
];
async function asShow(env, chat, i, notice) {
  const a = ASSET_KEYS[i];
  if (!a) throw new Error('Aset tidak dikenal');
  const val = await getSetting(env, a[0]);
  const caption = (notice ? notice + '\n' : '') + `<b>${esc(a[1])}</b>\n${val ? '' : 'Belum diisi.'}`;
  const markup = { inline_keyboard: [[b('🔁 Ganti Gambar', 'm:as:r:' + i)], [b('⬅️ Daftar Aset', 'm:as')]] };
  if (!val) return show(env, chat, null, caption, markup);
  return sendImageCard(env, chat, val, caption, markup);
}
H.as = async (env, chat, mid, p) => {
  const a = p[2];
  if (!a) {
    return show(env, chat, mid,
      '<b>🧾 QRIS & Aset</b>\nPilih aset untuk dilihat atau diganti. Perubahan langsung dipakai website.\n<i>Logo QRIS = identitas metode bayar. Gambar QR = kode yang dipindai Captain.</i>',
      { inline_keyboard: [...ASSET_KEYS.map(([k, l], i) => [b(l, 'm:as:v:' + i)]), ...BACK] });
  }
  if (a === 'v') return asShow(env, chat, Number(p[3]));
  if (a === 'r') {
    const k = ASSET_KEYS[Number(p[3])];
    if (!k) throw new Error('Aset tidak dikenal');
    await setState(env, chat, 'as_up', { key: k[0] });
    return show(env, chat, mid, `<b>🔁 Ganti: ${esc(k[1])}</b>\nKirim <b>foto</b> atau file gambar (JPG/PNG/WEBP, maks 10 MB). Gambar lama dihapus setelah yang baru berhasil dipakai.`, { inline_keyboard: [[b('✖️ Batal', 'm:as')]] });
  }
};

// ================= PROSES UPLOAD (banner, aset, banner turnamen) =================
async function onUpload(env, chat, st, img) {
  if (img.bad) return show(env, chat, null, '❌ Kirim sebagai foto, atau file gambar JPG / PNG / WEBP.');
  if (img.size > MAXIMG) return show(env, chat, null, '❌ Ukuran file maksimal 10 MB.');
  const d = st.data || {};
  const bytes = await downloadTg(env, img.file_id);
  if (bytes.byteLength > MAXIMG) throw new Error('Ukuran file lebih dari 10 MB');
  const ext = EXT[img.mime];
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const size = bytes.byteLength;

  if (st.state === 'bn_up') {
    const path = `b-${stamp}.${ext}`;
    await storageUpload(env, 'banners', path, bytes, img.mime);
    const url = publicUrl(env, 'banners', path);
    if (d.mode === 'replace') {
      const old = await bnGet(env, d.id);
      try { await sb(env, 'PATCH', `banners?id=eq.${d.id}`, { image_url: url, storage_path: path }, 'return=minimal'); }
      catch (e) { await storageDelete(env, 'banners', path); throw e; }
      const okReg = await regUpsert(env, { bucket: 'banners', path, kind: 'banner', ref_table: 'banners', ref_id: d.id, size_bytes: size });
      await dropOld(env, 'banners', old.storage_path);
      await clearState(env, chat);
      await audit(env, 'ganti_gambar_banner', 'banners', 'via bot', d.id, { image_url: old.image_url }, { image_url: url });
      return bnShow(env, chat, d.id, '✅ Gambar banner diganti.' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
    }
    const last = (await sb(env, 'GET', 'banners?select=sort_order&order=sort_order.desc&limit=1'))?.[0];
    let row;
    try {
      row = (await sb(env, 'POST', 'banners', { title: img.caption || null, image_url: url, storage_path: path, sort_order: (last?.sort_order || 0) + 1, is_active: true }, 'return=representation'))?.[0];
    } catch (e) { await storageDelete(env, 'banners', path); throw e; }
    const okReg = await regUpsert(env, { bucket: 'banners', path, kind: 'banner', ref_table: 'banners', ref_id: row.id, size_bytes: size });
    await clearState(env, chat);
    await audit(env, 'upload_banner', 'banners', img.caption || '-', row.id, null, { image_url: url });
    return bnShow(env, chat, row.id, '✅ Banner ditambahkan (judul dari caption foto, kalau ada).' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
  }

  if (st.state === 'tb_up') {
    const t = await getT(env, d.tid);
    const path = `t-${d.tid}-${stamp}.${ext}`;
    await storageUpload(env, 'banners', path, bytes, img.mime);
    const url = publicUrl(env, 'banners', path);
    try { await patchT(env, d.tid, { banner_url: url }); }
    catch (e) { await storageDelete(env, 'banners', path); throw e; }
    const okReg = await regUpsert(env, { bucket: 'banners', path, kind: 'tournament_banner', tournament_id: d.tid, ref_table: 'tournaments', ref_id: d.tid, size_bytes: size });
    await dropOld(env, 'banners', ourPath(env, t.banner_url, 'banners'));
    await clearState(env, chat);
    await audit(env, 'banner_turnamen', 'tournaments', 'via bot', d.tid, { banner_url: t.banner_url }, { banner_url: url });
    const v = await tDetail(env, d.tid, '✅ Banner turnamen diganti.' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
    return show(env, chat, null, v.text, v.markup);
  }

  if (st.state === 'as_up') {
    const a = ASSET_KEYS.findIndex((x) => x[0] === d.key);
    if (a < 0) throw new Error('Aset tidak dikenal');
    const path = `assets/${d.key}-${stamp}.${ext}`;
    await storageUpload(env, 'site-assets', path, bytes, img.mime);
    const url = publicUrl(env, 'site-assets', path);
    const cur = await getSetting(env, d.key);
    try { await setSetting(env, d.key, url); }
    catch (e) { await storageDelete(env, 'site-assets', path); throw e; }
    const okReg = await regUpsert(env, { bucket: 'site-assets', path, kind: 'asset', ref_table: 'site_settings', size_bytes: size });
    await dropOld(env, 'site-assets', ourPath(env, cur, 'site-assets'));
    await clearState(env, chat);
    await audit(env, 'ganti_aset', 'site_settings', d.key, null, { value: cur }, { value: url });
    return asShow(env, chat, a, '✅ Gambar diganti. Website otomatis memakai gambar terbaru.' + (okReg ? '' : '\n⚠️ Gagal mencatat ke file_registry.'));
  }
}
U.bn_up = onUpload; U.tb_up = onUpload; U.as_up = onUpload;

// ================= KONFIGURASI =================
// 👇 INI BAGIAN YANG GUA TAMBAHIN (admin_fee_qris)
const CFG = [
  ['admin_whatsapp', 'WhatsApp Admin'], 
  ['waitlist_offer_minutes', 'Batas respons Waiting List (menit)'], 
  ['admin_fee_qris', 'Biaya Admin QRIS (Rp)']
];

async function cfgMenu(env, notice) {
  const rows = (await sb(env, 'GET', `site_settings?key=in.(${CFG.map((c) => c[0]).join(',')})&select=key,value`)) || [];
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const lines = CFG.map(([k, l]) => `${l}: <b>${esc(m[k] === '' || m[k] == null ? '(kosong)' : m[k])}</b>`);
  return {
    text: (notice ? notice + '\n\n' : '') + '<b>🔧 Konfigurasi</b>\n' + lines.join('\n'),
    markup: { inline_keyboard: [...CFG.map(([k, l], i) => [b('✏️ ' + l, 'm:cfg:e:' + i)]), [b('⬅️ Pengaturan', 'm:set')]] },
  };
}
H.cfg = async (env, chat, mid, p) => {
  if (p[2] === 'e') {
    const c = CFG[Number(p[3])];
    if (!c) throw new Error('Pilihan tidak valid');
    await setState(env, chat, 'cfg', { key: c[0] });
    const ask = c[0] === 'admin_whatsapp' ? 'Ketik nomor WhatsApp admin (contoh 628123456789). Ketik - untuk mengosongkan.' :
                c[0] === 'admin_fee_qris' ? 'Ketik nominal Biaya Admin (contoh 1000). Ketik 0 jika tidak ada.' :
                'Ketik batas waktu respons Waiting List dalam menit (1 sampai 1440).';
    return show(env, chat, mid, `<b>✏️ ${esc(c[1])}</b>\n${ask}`, { inline_keyboard: [[b('✖️ Batal', 'm:cfg')]] });
  }
  return sh(env, chat, mid, await cfgMenu(env));
};
T.cfg = async (env, chat, st, text) => {
  const key = st.data?.key;
  const c = CFG.find((x) => x[0] === key);
  if (!c) throw new Error('Sesi tidak valid');
  let val;
  if (key === 'admin_whatsapp') {
    if (text === '-') val = '';
    else if (/^\+?\d{8,15}$/.test(text.replace(/[\s-]/g, ''))) val = text.replace(/[\s-]/g, '');
    else return show(env, chat, null, '❌ Nomor tidak valid. Contoh: 628123456789. Ketik - untuk mengosongkan.', { inline_keyboard: [[b('✖️ Batal', 'm:cfg')]] });
  } else if (key === 'admin_fee_qris') {
    const n = /^\d{1,9}$/.test(text) ? Number(text) : -1;
    if (n < 0) return show(env, chat, null, '❌ Isi angka 0 atau lebih (tanpa titik/koma).', { inline_keyboard: [[b('✖️ Batal', 'm:cfg')]] });
    val = n;
  } else {
    const n = /^\d{1,4}$/.test(text) ? Number(text) : 0;
    if (n < 1 || n > 1440) return show(env, chat, null, '❌ Isi angka 1 sampai 1440 (menit).', { inline_keyboard: [[b('✖️ Batal', 'm:cfg')]] });
    val = n;
  }
  const old = await getSetting(env, key);
  await clearState(env, chat);
  await setSetting(env, key, val);
  await audit(env, 'ubah_konfigurasi', 'site_settings', key, null, { value: old }, { value: val });
  return sh(env, chat, null, await cfgMenu(env, `✅ ${esc(c[1])} diperbarui.`));
};

// ================= WAITING LIST (lihat antrean) =================
async function wlTournaments(env) {
  const rows = (await sb(env, 'GET', 'waiting_list?status=in.(menunggu,ditawari)&select=tournament_id,status&limit=1000')) || [];
  const per = {};
  rows.forEach((r) => { per[r.tournament_id] ??= { menunggu: 0, ditawari: 0 }; per[r.tournament_id][r.status]++; });
  const ids = Object.keys(per);
  let names = {};
  if (ids.length) {
    const ts = (await sb(env, 'GET', `tournaments?id=in.(${ids.join(',')})&select=id,name`)) || [];
    names = Object.fromEntries(ts.map((t) => [t.id, t.name]));
  }
  const kb = ids.map((id) => [b(`${String(names[id] || '?').slice(0, 24)} (${per[id].menunggu} antre, ${per[id].ditawari} ditawari)`, 'm:wl:t:' + id)]);
  return {
    text: '<b>⏳ Waiting List</b>\n' + (ids.length ? 'Turnamen dengan antrean aktif:' : 'Tidak ada antrean aktif.') + '\n<i>Penawaran slot diproses otomatis oleh sistem.</i>',
    markup: { inline_keyboard: [...kb, [b('🔄 Segarkan', 'm:wl')], ...BACK] },
  };
}
async function wlQueue(env, tid) {
  const t = await getT(env, tid);
  const rows = (await sb(env, 'GET', `waiting_list?tournament_id=eq.${tid}&status=in.(menunggu,ditawari)&select=seq,status,team_id,offer_expires_at&order=seq.asc&limit=30`)) || [];
  let names = {};
  const tids = [...new Set(rows.map((r) => r.team_id))].filter(Boolean);
  if (tids.length) {
    try {
      const ts = (await sb(env, 'GET', `teams?id=in.(${tids.join(',')})&select=id,name`)) || [];
      names = Object.fromEntries(ts.map((x) => [x.id, x.name]));
    } catch (e) { /* nama tim tidak tersedia */ }
  }
  const lines = rows.map((r) => `#${r.seq} ${esc(names[r.team_id] || String(r.team_id).slice(0, 8))} — ${r.status === 'ditawari' ? '📨 ditawari' : '🕒 menunggu'}` +
    (r.status === 'ditawari' && r.offer_expires_at ? ` (batas ${wib(r.offer_expires_at)})` : ''));
  return {
    text: `<b>⏳ Antrean: ${esc(t.name)}</b>\n` + (lines.join('\n') || 'Kosong.'),
    markup: { inline_keyboard: [[b('🔄 Segarkan', 'm:wl:t:' + tid), b('⬅️ Daftar', 'm:wl')]] },
  };
}
H.wl = async (env, chat, mid, p) => {
  if (p[2] === 't') return sh(env, chat, mid, await wlQueue(env, p[3]));
  return sh(env, chat, mid, await wlTournaments(env));
};

// ================= PENGAJUAN MUNDUR =================
const COMP = [['mundur_poin_dipertahankan', 'Mundur, poin dipertahankan'], ['dq', 'Diskualifikasi (DQ)'], ['dikeluarkan', 'Dikeluarkan dari perhitungan']];
async function wdList(env, notice) {
  const rows = (await sb(env, 'GET', 'registrations?withdraw_requested_at=not.is.null&status=neq.mengundurkan_diri&select=id,team_name,tournament_id&order=withdraw_requested_at.asc&limit=10')) || [];
  let names = {};
  if (rows.length) {
    const ids = [...new Set(rows.map((r) => r.tournament_id))];
    const ts = (await sb(env, 'GET', `tournaments?id=in.(${ids.join(',')})&select=id,name`)) || [];
    names = Object.fromEntries(ts.map((t) => [t.id, t.name]));
  }
  const kb = rows.map((r) => [b(`${String(r.team_name || '?').slice(0, 20)} · ${String(names[r.tournament_id] || '?').slice(0, 18)}`, 'm:wd:v:' + r.id)]);
  return {
    text: (notice ? notice + '\n\n' : '') + '<b>↩️ Pengajuan Mundur</b>\n' + (rows.length ? 'Menunggu keputusan (10 terlama):' : 'Tidak ada pengajuan mundur.'),
    markup: { inline_keyboard: [...kb, [b('🔄 Segarkan', 'm:wd')], ...BACK] },
  };
}
async function wdDetail(env, rid) {
  const r = await getReg(env, rid);
  const [t, prof] = await Promise.all([getT(env, r.tournament_id), sb(env, 'GET', `profiles?id=eq.${r.owner_id}&select=username,whatsapp`).catch(() => [])]);
  const pf = prof?.[0];
  return {
    text: `<b>↩️ ${esc(r.team_name)}</b>\nTurnamen: ${esc(t.name)} (${stLabel(t.status)})\nStatus: ${rgLabel(r.status)}\n` +
      `Captain: ${esc(pf?.username || '-')} · WA: ${esc(pf?.whatsapp || '-')}\nBiaya: ${rp(r.fee_amount)} · Metode: ${esc(r.payment_method || '-')}\n` +
      `Diajukan: ${wib(r.withdraw_requested_at)}\nAlasan: ${esc(r.withdraw_reason || '-')}`,
    markup: { inline_keyboard: [[b('✅ Setujui', 'm:wd:a:' + rid), b('❌ Tolak', 'm:wd:x:' + rid)], [b('⬅️ Daftar', 'm:wd')]] },
  };
}
function wdNext(d) {
  if (d.dst == null) return 'dst';
  if (d.pct == null) return 'pct';
  if (d.needComp && d.comp == null) return 'comp';
  if (d.pct !== 100 && d.rsn === undefined) return 'rsn';
  return 'confirm';
}
function wdPrompt(d, step) {
  const CX = [b('✖️ Batal', 'm:wx:x')];
  if (step === 'dst') {
    const kb = [];
    for (let i = 0; i < d.dsts.length; i += 2) kb.push(d.dsts.slice(i, i + 2).map((v, j) => b(v, 'm:wx:d:' + (i + j))));
    return { text: `<b>Setujui pengunduran: ${esc(d.team)}</b>\nPilih <b>tujuan refund</b>:`, markup: { inline_keyboard: [...kb, CX] } };
  }
  if (step === 'pct') return { text: `Berapa <b>persen refund</b>? (biaya ${rp(d.fee)})\nPilih atau ketik angka 0 sampai 100:`, markup: { inline_keyboard: [[b('100%', 'm:wx:p:100'), b('50%', 'm:wx:p:50'), b('0%', 'm:wx:p:0')], CX] } };
  if (step === 'comp') return { text: 'Turnamen BR sudah berlangsung. Status tim di kompetisi:', markup: { inline_keyboard: [...COMP.map((c, i) => [b(c[1], 'm:wx:c:' + i)]), CX] } };
  if (step === 'rsn') return { text: 'Refund bukan 100%. Ketik <b>alasan pengecualian</b>, atau ketik - untuk lewati:', markup: { inline_keyboard: [CX] } };
  const amount = Math.floor((Number(d.fee) * d.pct) / 100);
  return {
    text: `<b>Konfirmasi pengunduran</b>\nTim: ${esc(d.team)}\nTurnamen: ${esc(d.tname)}\nTujuan refund: ${esc(d.dst)}\nRefund: ${d.pct}% = ${rp(amount)}\n` +
      (d.needComp ? `Status kompetisi: ${esc(d.comp)}\n` : '') + (d.rsn && d.rsn !== '-' ? `Alasan: ${esc(d.rsn)}\n` : '') + '\nProses?',
    markup: { inline_keyboard: [[b('✅ Ya, setujui', 'm:wx:ok'), CX[0]]] },
  };
}
async function wdShow(env, chat, mid, d, err) {
  const step = wdNext(d);
  await setState(env, chat, 'wd:' + step, d);
  const p = wdPrompt(d, step);
  return show(env, chat, mid, (err ? '❌ ' + err + '\n\n' : '') + p.text, p.markup);
}
async function wdStart(env, chat, mid, rid) {
  const r = await getReg(env, rid);
  if (!r.withdraw_requested_at || r.status === 'mengundurkan_diri') throw new Error('Tidak ada pengajuan mundur aktif untuk tim ini');
  const t = await getT(env, r.tournament_id);
  const dsts = await checkVals(env, 'refund_requests', 'destination');
  if (!dsts.length) throw new Error('Daftar tujuan refund kosong. Pastikan SQL 5.09 sudah dijalankan.');
  return wdShow(env, chat, mid, { rid, dsts, team: r.team_name, tname: t.name, fee: r.fee_amount, needComp: t.format === 'BR' && t.status === 'berlangsung' });
}
H.wd = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a) return sh(env, chat, mid, await wdList(env));
  if (a === 'v') return sh(env, chat, mid, await wdDetail(env, id));
  if (a === 'a') return wdStart(env, chat, mid, id);
  if (a === 'x') {
    const r = await getReg(env, id);
    if (!r.withdraw_requested_at || r.status === 'mengundurkan_diri') throw new Error('Pengajuan sudah diproses');
    await setState(env, chat, 'wdrej', { rid: id });
    return show(env, chat, mid, `<b>❌ Tolak pengajuan mundur</b>\nTim: ${esc(r.team_name)}\nKetik <b>alasan penolakan</b> (dikirim ke Captain):`, { inline_keyboard: [[b('✖️ Batal', 'm:wd:v:' + id)]] });
  }
};
T.wd = async (env, chat, st, text) => {
  const d = st.data || {};
  const step = st.state.slice(3);
  let err = null;
  if (step === 'pct') { const n = /^\d{1,3}$/.test(text) ? Number(text) : -1; if (n < 0 || n > 100) err = 'Isi angka 0 sampai 100.'; else d.pct = n; }
  else if (step === 'rsn') { if (text !== '-' && (text.length < 3 || text.length > 300)) err = 'Alasan 3 sampai 300 karakter, atau ketik -.'; else d.rsn = text; }
  else err = 'Pilih lewat tombol.';
  return wdShow(env, chat, null, d, err);
};
H.wx = async (env, chat, mid, p) => {
  const a = p[2], v = p[3];
  if (a === 'x') { await clearState(env, chat); return sh(env, chat, mid, await wdList(env, 'Dibatalkan.')); }
  const st = await getState(env, chat);
  if (!st || !st.state.startsWith('wd:')) return sh(env, chat, mid, await wdList(env, 'Sesi kedaluwarsa. Pilih ulang.'));
  const d = st.data || {};
  if (a === 'd') { d.dst = d.dsts[Number(v)]; if (d.dst == null) return wdShow(env, chat, mid, d, 'Pilihan tidak valid.'); }
  else if (a === 'p') d.pct = Number(v);
  else if (a === 'c') { d.comp = COMP[Number(v)]?.[0]; if (!d.comp) return wdShow(env, chat, mid, d, 'Pilihan tidak valid.'); }
  else if (a === 'ok') {
    if (wdNext(d) !== 'confirm') return wdShow(env, chat, mid, d, 'Data belum lengkap.');
    const r = await getReg(env, d.rid);
    if (!r.withdraw_requested_at || r.status === 'mengundurkan_diri') throw new Error('Pengajuan sudah diproses');
    const amount = Math.floor((Number(d.fee) * d.pct) / 100);
    await clearState(env, chat);
    await rpc(env, 'admin_approve_withdraw', { p_registration: d.rid, p_percent: d.pct, p_destination: d.dst, p_exception_reason: d.rsn && d.rsn !== '-' ? d.rsn : null, p_competition: d.needComp ? d.comp : null });
    const ok = await notify(env, r.owner_id, 'pendaftaran', 'Pengunduran diri disetujui', `Pengunduran tim ${d.team} dari ${d.tname} disetujui. Refund ${d.pct}% (${rp(amount)}) ke: ${d.dst}.`, r.tournament_id);
    return sh(env, chat, mid, await wdList(env, '✅ Pengunduran disetujui.\n' + okNote(ok)));
  }
  return wdShow(env, chat, mid, d);
};
T.wdrej = async (env, chat, st, text) => {
  const rid = st.data?.rid;
  if (text.length < 3 || text.length > 300) return show(env, chat, null, '❌ Alasan 3 sampai 300 karakter. Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:wd:v:' + rid)]] });
  const r = await getReg(env, rid);
  if (!r.withdraw_requested_at || r.status === 'mengundurkan_diri') throw new Error('Pengajuan sudah diproses');
  const t = await getT(env, r.tournament_id);
  await clearState(env, chat);
  await rpc(env, 'admin_reject_withdraw', { p_registration: rid, p_reason: text });
  const ok = await notify(env, r.owner_id, 'pendaftaran', 'Pengunduran diri ditolak', `Pengajuan mundur tim ${r.team_name} dari ${t.name} ditolak. Alasan: ${text}`, r.tournament_id);
  return sh(env, chat, null, await wdList(env, '✅ Pengajuan ditolak.\n' + okNote(ok)));
};

// ================= CAPTAIN: SALDO & HAPUS AKUN =================
function ledgerLine(r) {
  const f = [];
  if (r.created_at) f.push(wib(r.created_at));
  for (const k of ['kind', 'type', 'entry_type', 'amount', 'balance_after', 'reason', 'note']) {
    if (r[k] !== undefined && r[k] !== null) f.push(`${k}: ${typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]}`);
  }
  return '• ' + esc(f.join(' · ').slice(0, 170));
}
async function cpDetail(env, uid, notice) {
  if (!UUID.test(uid)) throw new Error('ID user tidak valid');
  const rows = await sb(env, 'GET', `profiles?id=eq.${uid}&select=id,username,whatsapp`);
  const p = rows?.[0];
  if (!p) throw new Error('Captain tidak ditemukan');
  const [nt, nr, led] = await Promise.all([
    count(env, `teams?owner_id=eq.${uid}&select=id`).catch(() => '?'),
    count(env, `registrations?owner_id=eq.${uid}&select=id`).catch(() => '?'),
    sb(env, 'GET', `wallet_ledger?user_id=eq.${uid}&select=*&order=created_at.desc&limit=5`).catch(() => null),
  ]);
  return {
    text: (notice ? notice + '\n\n' : '') + `<b>👤 ${esc(p.username)}</b>\nWA: ${esc(p.whatsapp || '-')}\nTim: ${nt} · Pendaftaran: ${nr}\n\n<b>Ledger saldo (5 terakhir)</b>\n` +
      (led === null ? '(ledger tidak terbaca)' : led.length ? led.map(ledgerLine).join('\n') : 'Belum ada transaksi.'),
    markup: { inline_keyboard: [[b('💰 Ubah Saldo', 'm:cp:b:' + uid), b('🗑 Hapus Akun', 'm:cp:d:' + uid)], [b('🔎 Cari Lagi', 'm:cp:s'), b('⬅️ Menu Utama', 'm:main')]] },
  };
}
H.cp = async (env, chat, mid, p) => {
  const a = p[2], id = p[3];
  if (!a || a === 's') {
    await setState(env, chat, 'cp_find', {});
    return show(env, chat, mid, '<b>👤 Captain</b>\nKetik <b>username</b> (atau sebagian) yang dicari:', { inline_keyboard: BACK });
  }
  if (a === 'u') return sh(env, chat, mid, await cpDetail(env, id));
  if (a === 'b') {
    if (!UUID.test(id)) throw new Error('ID user tidak valid');
    const rows = await sb(env, 'GET', `profiles?id=eq.${id}&select=username`);
    if (!rows?.[0]) throw new Error('Captain tidak ditemukan');
    await setState(env, chat, 'cp_amt', { uid: id, uname: rows[0].username });
    return show(env, chat, mid, `<b>💰 Ubah Saldo: ${esc(rows[0].username)}</b>\nKetik jumlah perubahan (Rp). Tambah: <code>50000</code>, kurangi: <code>-20000</code>.`, { inline_keyboard: [[b('✖️ Batal', 'm:cp:u:' + id)]] });
  }
  if (a === 'd') {
    if (!UUID.test(id)) throw new Error('ID user tidak valid');
    const rows = await sb(env, 'GET', `profiles?id=eq.${id}&select=username`);
    if (!rows?.[0]) throw new Error('Captain tidak ditemukan');
    return show(env, chat, mid, `<b>🗑 Mulai penghapusan akun</b>\nCaptain: ${esc(rows[0].username)}\nMasa tunggu 30 hari, Captain bisa membatalkan. Akun yang masih punya turnamen aktif, payout tertunda, atau saldo akan ditunda otomatis oleh sistem.\n\nLanjut?`,
      { inline_keyboard: [[b('🗑 Ya, mulai', 'm:cp:dy:' + id), b('✖️ Batal', 'm:cp:u:' + id)]] });
  }
  if (a === 'dy') {
    if (!UUID.test(id)) throw new Error('ID user tidak valid');
    await rpc(env, 'admin_start_account_deletion', { p_user: id });
    const ok = await notify(env, id, 'keamanan', 'Penghapusan akun dimulai', 'Super Admin memulai penghapusan akun Anda. Masa tunggu 30 hari; Anda bisa membatalkannya dari pengaturan akun.');
    await audit(env, 'mulai_hapus_akun', 'profiles', 'via bot', id);
    return sh(env, chat, mid, await cpDetail(env, id, '✅ Penghapusan akun dimulai (masa tunggu 30 hari).\n' + okNote(ok)));
  }
};
T.cp_find = async (env, chat, st, text) => {
  const term = text.replace(/[^\w.\- ]/g, '').trim();
  if (term.length < 2) return show(env, chat, null, '❌ Ketik minimal 2 karakter username. Atau /batal.', { inline_keyboard: BACK });
  const rows = (await sb(env, 'GET', `profiles?username=ilike.*${encodeURIComponent(term)}*&select=id,username&limit=8`)) || [];
  await clearState(env, chat);
  if (!rows.length) return show(env, chat, null, 'Tidak ada Captain dengan username itu.', { inline_keyboard: [[b('🔎 Cari Lagi', 'm:cp:s')], ...BACK] });
  return show(env, chat, null, '<b>Hasil pencarian</b>', { inline_keyboard: [...rows.map((r) => [b(String(r.username).slice(0, 40), 'm:cp:u:' + r.id)]), [b('🔎 Cari Lagi', 'm:cp:s')], ...BACK] });
};
T.cp_amt = async (env, chat, st, text) => {
  const t = text.replace(/[.\s]/g, '');
  if (!/^-?\d{1,9}$/.test(t) || Number(t) === 0) return show(env, chat, null, '❌ Isi angka bukan nol. Tambah: 50000, kurangi: -20000. Atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:cp:u:' + st.data.uid)]] });
  await setState(env, chat, 'cp_rsn', { ...st.data, amt: Number(t) });
  return show(env, chat, null, 'Ketik <b>alasan</b> perubahan saldo (3 sampai 200 karakter):', { inline_keyboard: [[b('✖️ Batal', 'm:cp:u:' + st.data.uid)]] });
};
T.cp_rsn = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 200) return show(env, chat, null, '❌ Alasan 3 sampai 200 karakter. Ketik lagi atau /batal.', { inline_keyboard: [[b('✖️ Batal', 'm:cp:u:' + st.data.uid)]] });
  const d = { ...st.data, rsn: text };
  await setState(env, chat, 'cp_conf', d);
  return show(env, chat, null, `<b>Konfirmasi ubah saldo</b>\nCaptain: ${esc(d.uname)}\nPerubahan: <b>${d.amt > 0 ? '+' : '-'}${rp(Math.abs(d.amt))}</b>\nAlasan: ${esc(d.rsn)}\n\nProses?`,
    { inline_keyboard: [[b('✅ Ya, proses', 'm:cx:ok'), b('✖️ Batal', 'm:cp:u:' + d.uid)]] });
};
H.cx = async (env, chat, mid, p) => {
  if (p[2] !== 'ok') return;
  const st = await getState(env, chat);
  if (!st || st.state !== 'cp_conf') return show(env, chat, mid, 'Sesi kedaluwarsa. Ulangi dari menu Captain.', { inline_keyboard: [[b('👤 Captain', 'm:cp')], ...BACK] });
  const d = st.data;
  await clearState(env, chat);
  const res = await rpc(env, 'admin_adjust_balance', { p_user: d.uid, p_amount: d.amt, p_reason: d.rsn });
  const ok = await notify(env, d.uid, 'saldo', 'Saldo GH-T Arena diperbarui', `Saldo ${d.amt > 0 ? 'bertambah' : 'berkurang'} ${rp(Math.abs(d.amt))}. Alasan: ${d.rsn}`);
  return sh(env, chat, mid, await cpDetail(env, d.uid, `✅ Saldo diubah.\n${okNote(ok)}\nHasil sistem: ${esc(JSON.stringify(res)).slice(0, 160)}`));
};
