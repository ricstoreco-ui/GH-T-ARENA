// GH-T ARENA — Telegram Bot Worker v0.1 (Cloudflare Workers, module syntax)
// Variabel yang harus diisi di Cloudflare (JANGAN tulis nilainya di file ini):
//   BOT_TOKEN, ADMIN_ID, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wib = (x) => (x ? new Date(x).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-');

async function tg(env, method, body = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function sbHeaders(env, extra = {}) {
  const h = { apikey: env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json', ...extra };
  if (String(env.SUPABASE_SERVICE_KEY).startsWith('eyJ')) h.authorization = 'Bearer ' + env.SUPABASE_SERVICE_KEY;
  return h;
}

async function rpc(env, fn, args = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

async function count(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: sbHeaders(env, { Prefer: 'count=exact', Range: '0-0' }),
  });
  const cr = r.headers.get('content-range') || '';
  return cr.split('/')[1] ?? '?';
}

async function setSetting(env, key, value) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/site_settings?on_conflict=key`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ key, value }),
  });
  if (!r.ok) throw new Error(`site_settings: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

const audit = (env, action, entity, reason) =>
  rpc(env, 'sys_audit', {
    p_actor: 'super_admin', p_action: action, p_entity: entity, p_entity_id: null,
    p_old: null, p_new: null, p_reason: reason,
  }).catch(() => null);

// ---------- Menu ----------
const b = (text, data) => ({ text, callback_data: data });
const BACK = [[b('⬅️ Menu Utama', 'm:main')]];
const MAIN = {
  inline_keyboard: [
    [b('📊 Dashboard', 'm:dash'), b('🏆 Turnamen', 'm:soon:Turnamen')],
    [b('📝 Pendaftaran', 'm:soon:Pendaftaran'), b('💳 Pembayaran', 'm:soon:Verifikasi Pembayaran')],
    [b('🎯 Battle Royale', 'm:soon:Battle Royale'), b('⚔️ Clash Squad', 'm:soon:Clash Squad')],
    [b('📣 Pengumuman', 'm:soon:Pengumuman'), b('💸 Pencairan', 'm:soon:Pencairan Hadiah')],
    [b('⚙️ Pengaturan', 'm:set'), b('🩺 Monitoring', 'm:mon')],
  ],
};
const MAIN_TEXT = '<b>GH-T ARENA — Panel Super Admin</b>\nPilih menu:';

async function show(env, chat, mid, text, markup) {
  const body = { chat_id: chat, text, parse_mode: 'HTML', reply_markup: markup, disable_web_page_preview: true };
  if (mid) {
    const r = await tg(env, 'editMessageText', { ...body, message_id: mid });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  await tg(env, 'sendMessage', body);
}

async function dashboard(env) {
  const [h, pay, act, wd] = await Promise.all([
    rpc(env, 'admin_health'),
    count(env, 'registrations?status=eq.menunggu_verifikasi&select=id'),
    count(env, 'tournaments?status=in.(pendaftaran_dibuka,berlangsung)&select=id'),
    count(env, 'registrations?withdraw_requested_at=not.is.null&status=neq.mengundurkan_diri&select=id'),
  ]);
  const site = h.site || {};
  return (
    '<b>📊 Dashboard</b>\n' +
    `Situs: ${site.open ? '🟢 Buka' : '🔴 Maintenance'}${site.reason ? ' (' + esc(site.reason) + ')' : ''}\n` +
    `Bot terakhir aktif: ${wib(h.bot_last_seen)}\n\n` +
    `Turnamen aktif: <b>${act}</b>\n` +
    `Bukti bayar menunggu verifikasi: <b>${pay}</b>\n` +
    `Pengajuan mundur menunggu: <b>${wd}</b>\n` +
    `Sesi Captain aktif: ${h.sessions_active}\n` +
    `Job antre/jalan/mati: ${h.jobs_pending}/${h.jobs_running}/${h.jobs_dead}`
  );
}

async function healthText(env) {
  const lines = [];
  const t0 = Date.now();
  try {
    const h = await rpc(env, 'admin_health');
    lines.push(`✅ Database OK (${Date.now() - t0} ms), ukuran ${h.db_size_mb} MB, ${h.jumlah_tabel} tabel`);
    lines.push(h.site?.open ? '✅ Status situs: buka' : '⚠️ Status situs: maintenance');
    lines.push(h.jobs_dead > 0 ? `⚠️ Job mati: ${h.jobs_dead}` : '✅ Tidak ada job mati');
    lines.push(h.files_due > 0 ? `⚠️ File menunggu dihapus: ${h.files_due}` : '✅ Tidak ada file tertunda');
  } catch (e) { lines.push('❌ Database: ' + esc(e.message)); }
  try {
    const me = await tg(env, 'getMe');
    lines.push(me.ok ? '✅ Telegram Bot OK' : '❌ Telegram: ' + esc(me.description));
  } catch (e) { lines.push('❌ Telegram: ' + esc(e.message)); }
  try {
    const s = await rpc(env, 'admin_storage_usage');
    lines.push('✅ Storage OK');
    return '<b>🩺 Health Check</b>\n' + lines.join('\n');
  } catch (e) { lines.push('❌ Storage: ' + esc(e.message)); }
  return '<b>🩺 Health Check</b>\n' + lines.join('\n');
}

async function storageText(env) {
  const s = await rpc(env, 'admin_storage_usage');
  const rows = Object.entries(s.buckets || {}).map(([k, v]) => `• ${esc(k)}: ${v.files} file, ${v.mb} MB`);
  return (
    '<b>🗄 Monitoring Storage</b>\n' + (rows.join('\n') || 'Belum ada file.') +
    `\n\nDatabase: ${s.db_mb} MB dari 500 MB (${Math.round((s.db_mb / 500) * 100)}%)\n` +
    '<i>Batas storage: cek dashboard Supabase.</i>'
  );
}

async function settingsMenu(env) {
  const h = await rpc(env, 'admin_health');
  const [reg] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/site_settings?key=eq.registration_on&select=value`, { headers: sbHeaders(env) }).then((r) => r.json()),
  ]);
  const regOn = reg?.[0]?.value !== false;
  const open = h.site?.open;
  return {
    text: `<b>⚙️ Pengaturan</b>\nRegistrasi: ${regOn ? '🟢 ON' : '🔴 OFF'}\nSitus: ${open ? '🟢 Buka' : '🔴 Maintenance'}`,
    markup: {
      inline_keyboard: [
        [b(regOn ? '🔴 Matikan Registrasi' : '🟢 Hidupkan Registrasi', 'm:reg:' + (regOn ? '0' : '1'))],
        [b(open ? '🛠 Aktifkan Maintenance' : '✅ Matikan Maintenance', 'm:mt:' + (open ? '1' : '0'))],
        ...BACK,
      ],
    },
  };
}

async function onCallback(env, cq) {
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  const chat = cq.message.chat.id, mid = cq.message.message_id, d = cq.data || '';
  if (d === 'm:main') return show(env, chat, mid, MAIN_TEXT, MAIN);
  if (d === 'm:dash') return show(env, chat, mid, await dashboard(env), { inline_keyboard: [[b('🔄 Segarkan', 'm:dash')], ...BACK] });
  if (d === 'm:mon') {
    return show(env, chat, mid, '<b>🩺 Monitoring</b>', {
      inline_keyboard: [[b('🩺 Health Check', 'm:health'), b('🗄 Storage', 'm:storage')], ...BACK],
    });
  }
  if (d === 'm:health') return show(env, chat, mid, await healthText(env), { inline_keyboard: [[b('🔄 Ulangi', 'm:health')], ...BACK] });
  if (d === 'm:storage') return show(env, chat, mid, await storageText(env), { inline_keyboard: [[b('🔄 Segarkan', 'm:storage')], ...BACK] });
  if (d === 'm:set') { const s = await settingsMenu(env); return show(env, chat, mid, s.text, s.markup); }
  if (d === 'm:reg:0' || d === 'm:reg:1') {
    const on = d.endsWith('1');
    await setSetting(env, 'registration_on', on);
    await audit(env, on ? 'registrasi_on' : 'registrasi_off', 'site_settings', 'via bot');
    const s = await settingsMenu(env); return show(env, chat, mid, s.text, s.markup);
  }
  if (d === 'm:mt:0' || d === 'm:mt:1') {
    const on = d.endsWith('1');
    await setSetting(env, 'maintenance', { on, reason: on ? 'Pemeliharaan oleh admin' : '' });
    await audit(env, on ? 'maintenance_on' : 'maintenance_off', 'site_settings', 'via bot');
    const s = await settingsMenu(env); return show(env, chat, mid, s.text, s.markup);
  }
  if (d.startsWith('m:soon:')) {
    return show(env, chat, mid, `<b>${esc(d.slice(7))}</b>\nMenu ini belum aktif. Dibangun di tahap Bot berikutnya.`, { inline_keyboard: BACK });
  }
}

async function onMessage(env, msg) {
  const text = (msg.text || '').trim();
  if (text === '/start' || text === '/menu') return show(env, msg.chat.id, null, MAIN_TEXT, MAIN);
  if (text === '/health') return show(env, msg.chat.id, null, await healthText(env), { inline_keyboard: BACK });
  return show(env, msg.chat.id, null, 'Ketik /menu untuk membuka panel.', undefined);
}

async function handle(env, update) {
  const from = update.message?.from || update.callback_query?.from;
  if (!from || String(from.id) !== String(env.ADMIN_ID)) return; // hanya Super Admin
  try {
    if (update.callback_query) await onCallback(env, update.callback_query);
    else if (update.message) await onMessage(env, update.message);
  } catch (e) {
    await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: 'Terjadi error: ' + String(e.message).slice(0, 300) });
  }
}

// ---------- Cron (tiap 5 menit): heartbeat + proses job ----------
async function cron(env) {
  const me = await tg(env, 'getMe');
  if (!me.ok) return; // bot tidak sehat -> jangan kirim heartbeat
  await rpc(env, 'sys_bot_heartbeat');
  const jobs = (await rpc(env, 'sys_claim_jobs', { p_limit: 10 })) || [];
  for (const job of jobs) {
    try {
      if (job.kind === 'admin_telegram') {
        const r = await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: String(job.payload?.text || '').slice(0, 3500) });
        if (!r.ok) throw new Error(r.description || 'gagal kirim');
        await rpc(env, 'sys_job_done', { p_id: job.id });
      } else if (job.kind === 'web_push') {
        // Web Push dibangun di Tahap 9. Notifikasi tetap tersimpan di database.
        await rpc(env, 'sys_job_done', { p_id: job.id });
      } else {
        await rpc(env, 'sys_job_fail', { p_id: job.id, p_error: 'jenis job tidak dikenal: ' + job.kind, p_permanent: true });
      }
    } catch (e) {
      await rpc(env, 'sys_job_fail', { p_id: job.id, p_error: String(e.message), p_permanent: false }).catch(() => null);
    }
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === `/setup/${env.WEBHOOK_SECRET}`) {
      const r = await tg(env, 'setWebhook', {
        url: `${url.origin}/webhook/${env.WEBHOOK_SECRET}`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
    }
    if (req.method === 'POST' && url.pathname === `/webhook/${env.WEBHOOK_SECRET}`
        && req.headers.get('x-telegram-bot-api-secret-token') === env.WEBHOOK_SECRET) {
      const update = await req.json().catch(() => null);
      if (update) ctx.waitUntil(handle(env, update));
      return new Response('ok');
    }
    return new Response('GH-T Arena Bot', { status: 200 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env).catch(() => null));
  },
};
