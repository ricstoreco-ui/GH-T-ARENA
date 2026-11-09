// GH-T ARENA Bot — core.js (helper bersama). Jangan taruh rahasia di file ini.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const wib = (x) => (x ? new Date(x).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-');
export const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
export const UUID = /^[0-9a-f-]{36}$/i;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rnd(n) {
  const u = new Uint32Array(1);
  const lim = Math.floor(4294967296 / n) * n;
  let v;
  do { crypto.getRandomValues(u); v = u[0]; } while (v >= lim);
  return v % n;
}
export function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = rnd(i + 1); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

export async function tg(env, method, body = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

export function sbHeaders(env, extra = {}) {
  const h = { apikey: env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json', ...extra };
  if (String(env.SUPABASE_SERVICE_KEY).startsWith('eyJ')) h.authorization = 'Bearer ' + env.SUPABASE_SERVICE_KEY;
  return h;
}

export async function rpc(env, fn, args = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbHeaders(env), body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) {
    let msg = t.slice(0, 220);
    try { const j = JSON.parse(t); msg = j.message || msg; } catch (e) { /* teks mentah */ }
    throw new Error(`${fn}: ${msg}`);
  }
  return t ? JSON.parse(t) : null;
}

export async function sb(env, method, path, body, prefer) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: sbHeaders(env, prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) { const e = new Error(`${path.split('?')[0]}: ${r.status} ${t.slice(0, 220)}`); e.status = r.status; throw e; }
  return t ? JSON.parse(t) : null;
}

export async function count(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { method: 'HEAD', headers: sbHeaders(env, { Prefer: 'count=exact', Range: '0-0' }) });
  return (r.headers.get('content-range') || '').split('/')[1] ?? '?';
}

export async function setSetting(env, key, value) {
  await sb(env, 'POST', 'site_settings?on_conflict=key', { key, value }, 'resolution=merge-duplicates,return=minimal');
}
export async function getSetting(env, key) {
  const rows = await sb(env, 'GET', `site_settings?key=eq.${key}&select=value`);
  return rows?.[0]?.value ?? null;
}

export const audit = (env, action, entity, reason, entityId = null, oldV = null, newV = null) =>
  rpc(env, 'sys_audit', { p_actor: 'super_admin', p_action: action, p_entity: entity, p_entity_id: entityId, p_old: oldV, p_new: newV, p_reason: reason }).catch(() => null);

// ---------- Notifikasi Captain ----------
export async function notify(env, userId, kind, title, body, tid = null) {
  try {
    await sb(env, 'POST', 'notifications', { user_id: userId, kind, title, body, data: {}, tournament_id: tid, is_read: false }, 'return=minimal');
    await rpc(env, 'sys_enqueue_job', { p_kind: 'web_push', p_payload: { user_id: userId }, p_idem: null, p_run_after: new Date().toISOString() }).catch(() => null);
    return true;
  } catch (e) { return false; }
}
export async function notifyOwners(env, ids, kind, title, body, tid = null) {
  try {
    const u = [...new Set(ids)].filter(Boolean);
    if (!u.length) return 0;
    await sb(env, 'POST', 'notifications', u.map((x) => ({ user_id: x, kind, title, body, data: {}, tournament_id: tid, is_read: false })), 'return=minimal');
    for (const x of u) await rpc(env, 'sys_enqueue_job', { p_kind: 'web_push', p_payload: { user_id: x }, p_idem: null, p_run_after: new Date().toISOString() }).catch(() => null);
    return u.length;
  } catch (e) { return null; }
}
export async function notifyRegistrants(env, tid, kind, title, body) {
  try {
    const regs = (await sb(env, 'GET', `registrations?tournament_id=eq.${tid}&status=eq.resmi_terdaftar&select=owner_id`)) || [];
    return await notifyOwners(env, regs.map((r) => r.owner_id), kind, title, body, tid);
  } catch (e) { return null; }
}
export const notifNote = (n) => (n === null ? '⚠️ Notifikasi ke Captain GAGAL dikirim.' : `🔔 Notifikasi terkirim ke ${n} Captain.`);

// ---------- Idempotensi & state ----------
export async function firstTime(env, updateId) {
  try { await sb(env, 'POST', 'bot_processed_updates', { update_id: updateId }, 'return=minimal'); return true; }
  catch (e) { return e.status === 409 ? false : true; }
}
export async function getState(env, chat) {
  const rows = await sb(env, 'GET', `bot_state?chat_id=eq.${chat}&select=state,data,updated_at`);
  const r = rows?.[0];
  if (!r || !r.state) return null;
  if (Date.now() - new Date(r.updated_at).getTime() > 30 * 60 * 1000) return null;
  return r;
}
export async function setState(env, chat, state, data = {}) {
  await sb(env, 'POST', 'bot_state?on_conflict=chat_id', { chat_id: chat, state, data, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
}
export async function clearState(env, chat) { await sb(env, 'DELETE', `bot_state?chat_id=eq.${chat}`).catch(() => null); }

// ---------- UI ----------
export const b = (text, data) => ({ text, callback_data: data });
export const BACK = [[b('⬅️ Menu Utama', 'm:main')]];
export const kbRows = (items, n = 1) => { const o = []; for (let i = 0; i < items.length; i += n) o.push(items.slice(i, i + n)); return o; };

export async function show(env, chat, mid, text, markup) {
  const t = String(text).slice(0, 3900);
  const body = { chat_id: chat, text: t, parse_mode: 'HTML', reply_markup: markup, disable_web_page_preview: true };
  if (mid) {
    const r = await tg(env, 'editMessageText', { ...body, message_id: mid });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  const r1 = await tg(env, 'sendMessage', body);
  if (r1.ok) return;
  const plain = t.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const r2 = await tg(env, 'sendMessage', { chat_id: chat, text: plain, reply_markup: markup, disable_web_page_preview: true });
  if (!r2.ok) await tg(env, 'sendMessage', { chat_id: chat, text: 'Aksi tersimpan, tapi balasan gagal terkirim: ' + String(r2.description || r1.description || '?').slice(0, 200) });
}

// ---------- Turnamen ----------
export const ST = {
  segera_hadir: ['⏳', 'Segera Hadir'], pendaftaran_dibuka: ['🟢', 'Pendaftaran Dibuka'], pendaftaran_ditutup: ['🔒', 'Pendaftaran Ditutup'],
  ditunda: ['⏸', 'Ditunda'], berlangsung: ['🔥', 'Berlangsung'], selesai: ['✅', 'Selesai'], dibatalkan: ['❌', 'Dibatalkan'],
};
export const stLabel = (s) => { const x = ST[s] || ['❔', s]; return `${x[0]} ${x[1]}`; };
export const FINAL = ['selesai', 'dibatalkan'];

export async function getT(env, id) {
  if (!UUID.test(id)) throw new Error('ID turnamen tidak valid');
  const rows = await sb(env, 'GET', `tournaments?id=eq.${id}&select=*`);
  if (!rows?.[0]) throw new Error('Turnamen tidak ditemukan');
  return rows[0];
}
export async function patchT(env, id, body) {
  const rows = await sb(env, 'PATCH', `tournaments?id=eq.${id}`, body, 'return=representation');
  if (!rows?.[0]) throw new Error('Turnamen tidak ditemukan / tidak berubah');
  return rows[0];
}
// Perubahan penting saat pendaftaran terbuka: matikan registrasi sementara (Master Prompt 15.4)
export async function withRegLock(env, t, fn) {
  const need = t.status === 'pendaftaran_dibuka' && t.registration_enabled;
  if (need) await patchT(env, t.id, { registration_enabled: false });
  try { return await fn(); }
  finally { if (need) await patchT(env, t.id, { registration_enabled: true }).catch(() => null); }
}
export const tPick = async (env, filter, prefix, extra = []) => {
  const rows = (await sb(env, 'GET', `tournaments?${filter}&select=id,name,format,status&order=created_at.desc&limit=10`)) || [];
  return { rows, kb: rows.map((t) => [b(`${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`, prefix + t.id)]), extra };
};

export function parseWib(s) {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00+07:00`);
  if (isNaN(dt.getTime())) return null;
  return { iso: dt.toISOString(), note: (m[6] || '').trim() };
}
export function parsePairs(text, maxPlace) {
  const t = text.trim().replace(/\s*=\s*/g, '=');
  const out = {};
  for (const p of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = p.match(/^(\d{1,2})=(\d{1,12})$/);
    if (!m) return { err: `Format salah: "${p}"` };
    const pl = +m[1];
    if (pl < 1 || pl > maxPlace) return { err: `Posisi harus 1 sampai ${maxPlace} (kamu tulis ${pl}).` };
    out[pl] = Number(m[2]);
  }
  if (!Object.keys(out).length) return { err: 'Tidak ada data.' };
  return { out };
}

export async function checkVals(env, table, col) {
  let v;
  try { v = await rpc(env, 'sys_check_values', { p_table: table, p_column: col }); }
  catch (e) { throw new Error('Fungsi sys_check_values belum ada. Jalankan SQL 5.09. (' + e.message.slice(0, 80) + ')'); }
  return Array.isArray(v) ? [...new Set(v)] : [];
}

// ---------- Gambar / Storage ----------
export const MAXIMG = 10 * 1024 * 1024;
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
export const publicUrl = (env, bucket, path) => `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${encPath(path)}`;
export function ourPath(env, url, bucket) {
  const pre = `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/`;
  return typeof url === 'string' && url.startsWith(pre) ? decodeURIComponent(url.slice(pre.length)) : null;
}
export function pickImage(msg) {
  if (msg.photo?.length) { const p = msg.photo[msg.photo.length - 1]; return { file_id: p.file_id, mime: 'image/jpeg', size: p.file_size || 0, caption: (msg.caption || '').trim() }; }
  if (msg.document) {
    const m = msg.document.mime_type || '';
    if (EXT[m]) return { file_id: msg.document.file_id, mime: m, size: msg.document.file_size || 0, caption: (msg.caption || '').trim() };
    return { bad: true };
  }
  return null;
}
export async function downloadTg(env, fileId) {
  const g = await tg(env, 'getFile', { file_id: fileId });
  if (!g.ok) throw new Error('getFile: ' + (g.description || '?'));
  const r = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${g.result.file_path}`);
  if (!r.ok) throw new Error('Unduh dari Telegram gagal: ' + r.status);
  return r.arrayBuffer();
}
export async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function storageUpload(env, bucket, path, bytes, mime) {
  let last;
  for (let i = 0; i < 3; i++) { // coba ulang otomatis (Master Prompt 18.3)
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${encPath(path)}`, {
      method: 'POST', headers: { ...sbHeaders(env), 'content-type': mime, 'x-upsert': 'false' }, body: bytes,
    });
    if (r.ok) return;
    const j = await r.json().catch(() => ({}));
    last = j.message || j.error || r.status;
    await sleep(500 * (i + 1));
  }
  throw new Error('Upload gagal: ' + last);
}
export async function storageDelete(env, bucket, path) {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${encPath(path)}`, { method: 'DELETE', headers: sbHeaders(env) });
  return r.ok || r.status === 404;
}
export async function regUpsert(env, row) {
  try { await sb(env, 'POST', 'file_registry?on_conflict=bucket,path', { in_use: true, ...row }, 'resolution=merge-duplicates,return=minimal'); return true; }
  catch (e) {
    try { const { size_bytes, ...rest } = row; await sb(env, 'POST', 'file_registry?on_conflict=bucket,path', { in_use: true, ...rest }, 'resolution=merge-duplicates,return=minimal'); return true; }
    catch (e2) { return false; }
  }
}
export async function regRelease(env, bucket, path, deleted) {
  const body = deleted ? { in_use: false, deleted_at: new Date().toISOString() } : { in_use: false, delete_after: new Date().toISOString() };
  try { await sb(env, 'PATCH', `file_registry?bucket=eq.${bucket}&path=eq.${encodeURIComponent(path)}`, body, 'return=minimal'); } catch (e) { /* abaikan */ }
}
export async function dropOld(env, bucket, path) {
  if (!path) return;
  const ok = await storageDelete(env, bucket, path);
  await regRelease(env, bucket, path, ok);
}
export async function sendImageCard(env, chat, url, caption, markup) {
  const r = await tg(env, 'sendPhoto', { chat_id: chat, photo: url, caption: String(caption).slice(0, 1000), parse_mode: 'HTML', reply_markup: markup });
  if (!r.ok) await show(env, chat, null, caption + '\n<i>(gambar gagal ditampilkan)</i>', markup);
}

