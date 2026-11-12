// GH-T ARENA Bot — index.js: Router Utama & Cron
import { tg, rpc, sb, firstTime, getState, clearState, show, b, BACK, pickImage, storageDelete } from './core.js';
import * as fMain from './f_main.js';
import * as fMisc from './f_misc.js';
import * as fBr from './f_br.js';
import * as fCs from './f_cs.js';
import * as fPo from './f_po.js';
import * as fRm from './f_rm.js';
import * as fAdmin from './f_admin.js';
import * as fDana from './f_dana.js';
import * as fInfo from './f_info.js'; 

const MODULES = [fMain, fMisc, fBr, fCs, fPo, fRm, fAdmin, fDana, fInfo];
const H = {}, T = {}, U = {};
const KEEP = ['m:w:', 'm:pt:save', 'm:an:ok', 'm:cc:ok', 'm:br:ayes', 'm:br:mok', 'm:wx:', 'm:sc:'];

for (const m of MODULES) {
  Object.assign(H, m.H || {}); 
  Object.assign(T, m.T || {}); 
  Object.assign(U, m.U || {});
  if (m.KEEP) KEEP.push(...m.KEEP);
}

const BACK_BTN = { inline_keyboard: [[b('⬅️ Menu Utama', 'm:main')]] };

const MAIN = {
  inline_keyboard: [
    [b('📊 Dashboard', 'm:dash')],
    [b('🏆 Manajemen Turnamen', 'm:cat:tour')],
    [b('💳 Transaksi & Peserta', 'm:cat:trx')],
    [b('👥 Komunitas & Data', 'm:cat:comm')],
    [b('⚙️ Sistem & Tools', 'm:cat:sys')],
  ],
};
const MAIN_TEXT = '<b>GH-T ARENA — Panel Super Admin</b>\nPilih Kategori Menu:';

const CAT_TOUR = { inline_keyboard: [
  [b('➕ Buat Turnamen', 'm:t:new'), b('📋 Daftar Turnamen', 'm:t')],
  [b('🎯 Kelola BR', 'm:br'), b('⚔️ Kelola CS', 'm:cs')],
  [b('🔑 Room ID', 'm:rm')], 
  [b('⬅️ Kembali', 'm:main')]
]};
const CAT_TRX = { inline_keyboard: [
  [b('✅ Verifikasi Pembayaran', 'm:vp'), b('💳 Verifikasi DANA', 'm:dc')],
  [b('💸 Pencairan Hadiah', 'm:po'), b('↩️ Pengajuan Mundur', 'm:wd')],
  [b('⏳ Waiting List', 'm:wl'), b('🎟️ Cek-in Tiket Offline', 'm:ticket')],
  [b('⬅️ Kembali', 'm:main')]
]};
const CAT_COMM = { inline_keyboard: [
  [b('👤 Cari Captain', 'm:cp'), b('🛡️ Cari Tim', 'm:tm')],
  [b('📣 Pengumuman', 'm:an'), b('📝 Template Pesan', 'm:adm:tmpl')],
  [b('🚫 Blacklist Player', 'm:adm:ban')], 
  [b('⬅️ Kembali', 'm:main')]
]};
const CAT_SYS = { inline_keyboard: [
  [b('⚙️ Pengaturan Web', 'm:set'), b('🩺 Health Check', 'm:health')],
  [b('🛠 Admin Tools', 'm:adm'), b('🤝 Kelola Sponsor', 'm:sponsor')],
  [b('🎯 Scrim Manager', 'm:scrim'), b('👑 Kelola VIP', 'm:vip')],
  [b('📦 Backup Project', 'm:backup'), b('📖 Panduan', 'm:info')],
  [b('⬅️ Kembali', 'm:main')]
]};

H.main = (env, chat, mid) => show(env, chat, mid, MAIN_TEXT, MAIN);

H.cat = (env, chat, mid, p) => {
  const v = p[2];
  if (v === 'tour') return show(env, chat, mid, '<b>🏆 Manajemen Turnamen</b>', CAT_TOUR);
  if (v === 'trx') return show(env, chat, mid, '<b>💳 Transaksi & Peserta</b>', CAT_TRX);
  if (v === 'comm') return show(env, chat, mid, '<b>👥 Komunitas & Data</b>', CAT_COMM);
  if (v === 'sys') return show(env, chat, mid, '<b>⚙️ Sistem & Tools</b>', CAT_SYS);
  return show(env, chat, mid, MAIN_TEXT, MAIN);
};

const stateKey = (s) => String(s).split(':')[0];

async function onCallback(env, cq) {
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  const chat = cq.message.chat.id, mid = cq.message.message_id, d = cq.data || '';
  const p = d.split(':');
  
  if (p[0] !== 'm') return;
  
  if (!KEEP.some((k) => d.startsWith(k))) await clearState(env, chat);
  
  if (d === 'm:main') return show(env, chat, mid, MAIN_TEXT, MAIN);
  
  const fn = H[p[1]];
  if (!fn) return show(env, chat, mid, '🚧 Menu ini belum dipasang di bot.', BACK_BTN);
  
  return fn(env, chat, mid, p);
}

async function onMessage(env, m) {
  const chat = m.chat.id, text = (m.text || '').trim();
  if (text === '/start' || text === '/menu') { await clearState(env, chat); return show(env, chat, null, MAIN_TEXT, MAIN); }
  if (text === '/batal') { await clearState(env, chat); return show(env, chat, null, 'Dibatalkan.', BACK_BTN); }
  if (text === '/panduan') { return H.info(env, chat, null); } 
  
  const st = await getState(env, chat);
  const img = pickImage(m);
  
  if (img && st) {
    const up = U[stateKey(st.state)];
    if (up) return up(env, chat, st, img);
  }
  if (!st) return (text || img) ? show(env, chat, null, 'Pilih lewat menu ya.', BACK_BTN) : undefined;
  if (!text) return show(env, chat, null, 'Kirim teks sesuai instruksi, atau /batal.', BACK_BTN);
  
  const fn = T[stateKey(st.state)];
  if (!fn) return show(env, chat, null, 'Langkah ini dijawab lewat tombol. Ketik /menu untuk kembali.', BACK_BTN);
  return fn(env, chat, st, text);
}

async function handle(env, u) {
  const cq = u.callback_query, msg = u.message;
  const from = cq?.from?.id ?? msg?.from?.id, chat = cq?.message?.chat?.id ?? msg?.chat?.id;
  
  if (!from || !chat) return;
  
  if (String(from) !== String(env.ADMIN_ID)) {
    if (cq) await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
    else await tg(env, 'sendMessage', { chat_id: chat, text: 'Bot ini khusus Super Admin.' });
    return;
  }
  
  if (!(await firstTime(env, u.update_id))) return;
  
  try {
    if (cq) await onCallback(env, cq);
    else if (msg) await onMessage(env, msg);
  } catch (e) {
    await tg(env, 'sendMessage', { chat_id: chat, text: '❌ ' + String(e?.message || e).slice(0, 300), reply_markup: BACK_BTN });
  }
}

async function runJobs(env) {
  const now = new Date().toISOString();
  const jobs = (await sb(env, 'GET', `jobs?status=eq.pending&kind=in.(telegram_admin,web_push)&run_after=lte.${encodeURIComponent(now)}&select=id,kind,payload&order=created_at.asc&limit=10`)) || [];
  for (const j of jobs) {
    const got = await sb(env, 'PATCH', `jobs?id=eq.${j.id}&status=eq.pending`, { status: 'running' }, 'return=representation').catch(() => null);
    if (!got?.[0]) continue;
    try {
      if (j.kind === 'telegram_admin') {
        const text = j.payload?.text;
        if (text) await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: String(text).slice(0, 3900) });
      }
      await rpc(env, 'sys_job_done', { p_id: j.id });
    } catch (e) {
      await rpc(env, 'sys_job_fail', { p_id: j.id, p_error: String(e?.message || e).slice(0, 300), p_permanent: false }).catch(() => null);
    }
  }
}

async function runFiles(env) {
  const files = (await rpc(env, 'sys_files_due', { p_limit: 20 })) || [];
  for (const f of files) {
    try {
      const ok = await storageDelete(env, f.bucket, f.path);
      if (ok) await rpc(env, 'sys_file_mark_deleted', { p_id: f.id });
      else await rpc(env, 'sys_file_mark_failed', { p_id: f.id, p_error: 'gagal' });
    } catch (e) {}
  }
}

async function cron(env, event) {
  const step = async (label, fn) => { try { await fn(); } catch (e) { console.log('cron', label, String(e?.message || e)); } };
  await step('heartbeat', () => rpc(env, 'sys_bot_heartbeat'));
  await step('jobs', () => runJobs(env));
  await step('files', () => runFiles(env));
  
  const minute = new Date(event?.scheduledTime || Date.now()).getUTCMinutes();
  if (minute === 0) await step('clean_chats', () => rpc(env, 'sys_clean_old_chats'));
  if (Math.floor(minute / 5) % 2 === 0) await step('housekeeping', () => rpc(env, 'sys_run_housekeeping'));
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('GH-T Arena bot OK');
    if (env.WEBHOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
    let u;
    try { u = await request.json(); } catch (e) { return new Response('bad request', { status: 400 }); }
    ctx.waitUntil(handle(env, u).catch((e) => console.log('handle', String(e?.message || e))));
    return new Response('ok');
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(cron(env, event)); },
};
