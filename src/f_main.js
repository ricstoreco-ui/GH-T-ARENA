
// GH-T ARENA Bot — f_main_3.js
// Pendaftaran, Verifikasi Pembayaran, Pengumuman

import {
  esc, wib, rp, UUID, count, audit, sb, sbHeaders, b, BACK, show, ST, getT,
  notify, notifyRegistrants, notifNote,
  setState, getState, clearState, rpc, tg,
} from './core.js';

export const H = {};
export const T = {};

// Helper tampilan menu Telegram
const sh = (env, chat, mid, v) =>
  show(env, chat, mid, v.text, v.markup);

// ================= PENDAFTARAN & VERIFIKASI PEMBAYARAN =================

const RG_ST = [
  ['menunggu_verifikasi', '🕒 Menunggu Verifikasi'],
  ['menunggu_pembayaran', '💰 Menunggu Pembayaran'],
  ['data_belum_lengkap', '⚠️ Data Belum Lengkap'],
  ['resmi_terdaftar', '✅ Resmi Terdaftar'],
  ['ditolak', '🚫 Ditolak'],
  ['mengundurkan_diri', '↩️ Mengundurkan Diri'],
];

export const rgLabel = (s) =>
  (RG_ST.find((x) => x[0] === s) || [s, s])[1];

export async function getReg(env, rid) {
  if (!UUID.test(rid)) throw new Error('ID pendaftaran tidak valid');

  const rows = await sb(
    env,
    'GET',
    `registrations?id=eq.${rid}&select=*`
  );

  if (!rows?.[0]) throw new Error('Pendaftaran tidak ditemukan');

  return rows[0];
}

async function rgTournaments(env) {
  const [pending, rows] = await Promise.all([
    count(
      env,
      'registrations?status=eq.menunggu_verifikasi&select=id'
    ),
    sb(
      env,
      'GET',
      'tournaments?select=id,name,format,status&order=created_at.desc&limit=10'
    ),
  ]);

  const kb = (rows || []).map((t) => [
    b(
      `${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`,
      'm:rg:t:' + t.id
    ),
  ]);

  return {
    text:
      '<b>📝 Pendaftaran</b>\n' +
      (rows?.length ? 'Pilih turnamen:' : 'Belum ada turnamen.'),
    markup: {
      inline_keyboard: [
        [b(`💳 Menunggu Verifikasi (${pending})`, 'm:vp')],
        ...kb,
        ...BACK,
      ],
    },
  };
}

async function rgSummary(env, tid) {
  const t = await getT(env, tid);

  const rows =
    (await sb(
      env,
      'GET',
      `registrations?tournament_id=eq.${tid}&select=status&limit=1000`
    )) || [];

  const c = {};

  rows.forEach((r) => {
    c[r.status] = (c[r.status] || 0) + 1;
  });

  const kb = RG_ST
    .map(([k, l], i) =>
      c[k] ? [b(`${l} (${c[k]})`, `m:rg:l:${tid}:${i}`)] : null
    )
    .filter(Boolean);

  kb.push([
    b('🔄 Segarkan', 'm:rg:t:' + tid),
    b('⬅️ Daftar', 'm:rg'),
  ]);

  return {
    text:
      `<b>📝 Pendaftaran</b>\n${esc(t.name)}\n` +
      `Slot terisi: <b>${c.resmi_terdaftar || 0}/${t.total_slots}</b>\n\n` +
      RG_ST.map(([k, l]) => `${l}: <b>${c[k] || 0}</b>`).join('\n'),
    markup: { inline_keyboard: kb },
  };
}

async function rgList(env, tid, i) {
  const st = RG_ST[i];

  if (!st) throw new Error('Status tidak dikenal');
  if (!UUID.test(tid)) throw new Error('ID turnamen tidak valid');

  const rows =
    (await sb(
      env,
      'GET',
      `registrations?tournament_id=eq.${tid}&status=eq.${st[0]}&select=id,team_name&order=created_at.asc&limit=12`
    )) || [];

  const kb = rows.map((r) => [
    b(
      String(r.team_name || '(tanpa nama)').slice(0, 40),
      'm:rg:v:' + r.id
    ),
  ]);

  kb.push([b('⬅️ Kembali', 'm:rg:t:' + tid)]);

  return {
    text:
      `<b>${st[1]}</b>\n` +
      (rows.length ? 'Pilih tim (maks 12 pertama):' : 'Kosong.'),
    markup: { inline_keyboard: kb },
  };
}

async function rgPending(env) {
  const rows =
    (await sb(
      env,
      'GET',
      'registrations?status=eq.menunggu_verifikasi&select=id,team_name,tournament_id&order=created_at.asc&limit=10'
    )) || [];

  let names = {};

  if (rows.length) {
    const ids = [...new Set(rows.map((r) => r.tournament_id))];

    const ts =
      (await sb(
        env,
        'GET',
        `tournaments?id=in.(${ids.join(',')})&select=id,name`
      )) || [];

    names = Object.fromEntries(ts.map((t) => [t.id, t.name]));
  }

  const kb = rows.map((r) => [
    b(
      `${String(r.team_name || '?').slice(0, 20)} · ${String(names[r.tournament_id] || '?').slice(0, 18)}`,
      'm:rg:v:' + r.id
    ),
  ]);

  kb.push([b('🔄 Segarkan', 'm:vp')], ...BACK);

  return {
    text:
      '<b>💳 Verifikasi Pembayaran</b>\n' +
      (rows.length
        ? 'Menunggu verifikasi (10 terlama):'
        : 'Tidak ada yang menunggu verifikasi. 🎉'),
    markup: { inline_keyboard: kb },
  };
}

export async function rgDetail(env, rid, notice) {
  const r = await getReg(env, rid);

  const [t, prof, pays] = await Promise.all([
    getT(env, r.tournament_id),

    sb(
      env,
      'GET',
      `profiles?id=eq.${r.owner_id}&select=username,whatsapp`
    ).catch(() => []),

    sb(
      env,
      'GET',
      `payments?registration_id=eq.${rid}&select=method,amount,status,proof_path,proof_deleted_at,reject_reason&order=created_at.desc&limit=1`
    ).catch(() => []),
  ]);

  const pay = pays?.[0];
  const pf = prof?.[0];

  const hasProof = !!(
    pay?.proof_path && !pay?.proof_deleted_at
  );

  const L = [
    `<b>📝 ${esc(r.team_name)}</b>`,
    `Turnamen: ${esc(t.name)}`,
    `Status: ${rgLabel(r.status)}`,
    `Captain: ${esc(pf?.username || '-')} · WA: ${esc(pf?.whatsapp || '-')}`,
    `Biaya: ${rp(r.fee_amount)} · Metode: ${esc(r.payment_method || '-')}`,
  ];

  if (pay) {
    L.push(
      `Pembayaran: ${esc(pay.status)}${
        hasProof
          ? ' · bukti ada'
          : pay.proof_deleted_at
            ? ' · bukti sudah dihapus'
            : ' · belum ada bukti'
      }`
    );
  }

  if (pay?.reject_reason) {
    L.push(`Alasan tolak bayar: ${esc(pay.reject_reason)}`);
  }

  if (r.incomplete_reason) {
    L.push(`Alasan data belum lengkap: ${esc(r.incomplete_reason)}`);
  }

  if (r.reject_reason) {
    L.push(`Alasan ditolak: ${esc(r.reject_reason)}`);
  }

  if (r.competition_status && r.competition_status !== 'aktif') {
    L.push(`Status kompetisi: ${esc(r.competition_status)}`);
  }

  if (r.withdraw_requested_at) {
    L.push(
      `⚠️ Mengajukan mundur ${wib(r.withdraw_requested_at)}${
        r.withdraw_reason ? ': ' + esc(r.withdraw_reason) : ''
      }`
    );
  }

  const kb = [];

  if (r.status === 'menunggu_verifikasi') {
    kb.push([
      b('✅ Verifikasi', 'm:rg:ok:' + rid),
      b('❌ Tolak Pembayaran', 'm:rg:no:' + rid),
    ]);
  }

  if (hasProof) {
    kb.push([b('📷 Lihat Bukti', 'm:rg:pf:' + rid)]);
  }

  if (
    [
      'menunggu_pembayaran',
      'menunggu_verifikasi',
      'data_belum_lengkap',
    ].includes(r.status)
  ) {
    const row = [];

    if (r.status !== 'data_belum_lengkap') {
      row.push(b('⚠️ Data Belum Lengkap', 'm:rg:inc:' + rid));
    }

    row.push(b('🚫 Tolak Pendaftaran', 'm:rg:rj:' + rid));
    kb.push(row);
  }

  if (
    r.withdraw_requested_at &&
    r.status !== 'mengundurkan_diri'
  ) {
    kb.push([
      b('↩️ Proses Pengajuan Mundur', 'm:wd:v:' + rid),
    ]);
  }

  kb.push([
    b('🔄 Segarkan', 'm:rg:v:' + rid),
    b('⬅️ Kembali', 'm:rg:t:' + r.tournament_id),
  ]);

  return {
    text: (notice ? notice + '\n\n' : '') + L.join('\n'),
    markup: { inline_keyboard: kb },
  };
}

const RR = {
  no: {
    title: 'Tolak Pembayaran',
    from: ['menunggu_verifikasi'],
  },

  inc: {
    title: 'Tandai Data Belum Lengkap',
    from: ['menunggu_pembayaran', 'menunggu_verifikasi'],
  },

  rj: {
    title: 'Tolak Pendaftaran',
    from: [
      'menunggu_pembayaran',
      'menunggu_verifikasi',
      'data_belum_lengkap',
    ],
  },
};

async function rgProof(env, chat, rid) {
  if (!UUID.test(rid)) {
    throw new Error('ID pendaftaran tidak valid');
  }

  const pays = await sb(
    env,
    'GET',
    `payments?registration_id=eq.${rid}&select=proof_path,proof_deleted_at,amount&order=created_at.desc&limit=1`
  );

  const pay = pays?.[0];

  if (!pay?.proof_path || pay.proof_deleted_at) {
    return tg(env, 'sendMessage', {
      chat_id: chat,
      text: 'Belum ada bukti bayar (atau sudah dihapus otomatis).',
    });
  }

  const path = pay.proof_path
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const r = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/sign/payment-proofs/${path}`,
    {
      method: 'POST',
      headers: sbHeaders(env),
      body: JSON.stringify({ expiresIn: 300 }),
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!r.ok || !j.signedURL) {
    throw new Error(
      'Gagal membuat link bukti: ' +
      (j.message || j.error || r.status)
    );
  }

  const link = j.signedURL.startsWith('http')
    ? j.signedURL
    : env.SUPABASE_URL +
      (j.signedURL.startsWith('/storage/v1')
        ? ''
        : '/storage/v1') +
      j.signedURL;

  const sent = await tg(env, 'sendPhoto', {
    chat_id: chat,
    photo: link,
    caption: `Bukti bayar · ${rp(pay.amount)}`,
  });

  if (!sent.ok) {
    await tg(env, 'sendMessage', {
      chat_id: chat,
      text:
        'Gagal kirim foto (' +
        (sent.description || '?') +
        '). Link bukti (berlaku 5 menit):\n' +
        link,
    });
  }
}

H.rg = async (env, chat, mid, p) => {
  const a = p[2];
  const id = p[3];

  if (!a) {
    return sh(env, chat, mid, await rgTournaments(env));
  }

  if (a === 't') {
    return sh(env, chat, mid, await rgSummary(env, id));
  }

  if (a === 'l') {
    return sh(
      env,
      chat,
      mid,
      await rgList(env, id, Number(p[4]))
    );
  }

  if (a === 'v') {
    return sh(env, chat, mid, await rgDetail(env, id));
  }

  if (a === 'ok') {
    const r = await getReg(env, id);

    if (r.status !== 'menunggu_verifikasi') {
      throw new Error(
        'Status bukan Menunggu Verifikasi (sekarang: ' +
        r.status +
        ')'
      );
    }

    return show(
      env,
      chat,
      mid,
      `<b>Verifikasi pembayaran?</b>\nTim: ${esc(r.team_name)}\nBiaya: ${rp(r.fee_amount)}\nTim jadi ✅ Resmi Terdaftar dan slot bertambah. Pastikan bukti sudah dicek.`,
      {
        inline_keyboard: [[
          b('✅ Ya, verifikasi', 'm:rg:oy:' + id),
          b('✖️ Batal', 'm:rg:v:' + id),
        ]],
      }
    );
  }

  if (a === 'oy') {
    const r = await getReg(env, id);

    if (r.status !== 'menunggu_verifikasi') {
      throw new Error(
        'Status bukan Menunggu Verifikasi (sekarang: ' +
        r.status +
        ')'
      );
    }

    await rpc(env, 'admin_verify_payment', {
      p_registration: id,
    });

    const t = await getT(env, r.tournament_id);

    const ok = await notify(
      env,
      r.owner_id,
      'pembayaran',
      'Pembayaran terverifikasi',
      `Tim ${r.team_name} resmi terdaftar di ${t.name}.`,
      r.tournament_id
    );

    return sh(
      env,
      chat,
      mid,
      await rgDetail(
        env,
        id,
        '✅ Pembayaran terverifikasi.\n' +
        (ok
          ? '🔔 Notifikasi terkirim ke Captain.'
          : '⚠️ Notifikasi ke Captain GAGAL dikirim.')
      )
    );
  }

  if (a === 'no' || a === 'inc' || a === 'rj') {
    const r = await getReg(env, id);

    if (!RR[a].from.includes(r.status)) {
      throw new Error(
        'Aksi ini tidak berlaku untuk status ' + r.status
      );
    }

    await setState(env, chat, 'rr', {
      rid: id,
      act: a,
    });

    return show(
      env,
      chat,
      mid,
      `<b>${RR[a].title}</b>\nTim: ${esc(r.team_name)}\nKetik <b>alasan</b> (dikirim ke Captain):`,
      {
        inline_keyboard: [[
          b('✖️ Batal', 'm:rg:v:' + id),
        ]],
      }
    );
  }

  if (a === 'pf') {
    return rgProof(env, chat, id);
  }
};

H.vp = async (env, chat, mid) =>
  sh(env, chat, mid, await rgPending(env));

T.rr = async (env, chat, st, text) => {
  const { rid, act } = st.data || {};

  if (!RR[act]) {
    throw new Error('Sesi tidak valid');
  }

  if (text.length < 3 || text.length > 300) {
    return show(
      env,
      chat,
      null,
      '❌ Alasan 3 sampai 300 karakter. Ketik lagi atau /batal.',
      {
        inline_keyboard: [[
          b('✖️ Batal', 'm:rg:v:' + rid),
        ]],
      }
    );
  }

  const r = await getReg(env, rid);

  if (!RR[act].from.includes(r.status)) {
    throw new Error(
      'Aksi ini tidak berlaku untuk status ' + r.status
    );
  }

  const t = await getT(env, r.tournament_id);

  await clearState(env, chat);

  let kind;
  let title;
  let body;

  if (act === 'no') {
    await rpc(env, 'admin_reject_payment', {
      p_registration: rid,
      p_reason: text,
    });

    kind = 'pembayaran';
    title = 'Pembayaran ditolak';
    body =
      `Pembayaran tim ${r.team_name} di ${t.name} ditolak. Alasan: ${text}`;
  } else if (act === 'inc') {
    await rpc(env, 'admin_mark_incomplete', {
      p_registration: rid,
      p_reason: text,
    });

    kind = 'pendaftaran';
    title = 'Data pendaftaran belum lengkap';
    body =
      `Tim ${r.team_name} di ${t.name}: ${text}. Hubungi admin lewat WhatsApp untuk melengkapi.`;
  } else {
    await rpc(env, 'admin_reject_registration', {
      p_registration: rid,
      p_reason: text,
    });

    kind = 'pendaftaran';
    title = 'Pendaftaran ditolak';
    body =
      `Pendaftaran tim ${r.team_name} di ${t.name} ditolak. Alasan: ${text}`;
  }

  const ok = await notify(
    env,
    r.owner_id,
    kind,
    title,
    body,
    r.tournament_id
  );

  return sh(
    env,
    chat,
    null,
    await rgDetail(
      env,
      rid,
      `✅ ${RR[act].title} berhasil.\n` +
      (ok
        ? '🔔 Notifikasi terkirim ke Captain.'
        : '⚠️ Notifikasi ke Captain GAGAL dikirim.')
    )
  );
};

// ================= PENGUMUMAN =================

const CAN = [
  b('✖️ Batal', 'm:an:x'),
];

async function anList(env) {
  const rows =
    (await sb(
      env,
      'GET',
      'announcements?select=id,title,tournament_id&order=created_at.desc&limit=8'
    )) || [];

  const kb = rows.map((a) => [
    b(
      `${a.tournament_id ? '🏆' : '🌐'} ${String(a.title).slice(0, 32)}`,
      'm:an:v:' + a.id
    ),
  ]);

  return {
    text:
      '<b>📣 Pengumuman</b>\n' +
      (rows.length ? '8 terbaru:' : 'Belum ada pengumuman.'),

    markup: {
      inline_keyboard: [
        [b('➕ Buat Pengumuman', 'm:an:new')],
        ...kb,
        ...BACK,
      ],
    },
  };
}

async function anView(env, id, notice) {
  if (!UUID.test(id)) {
    throw new Error('ID pengumuman tidak valid');
  }

  const rows = await sb(
    env,
    'GET',
    `announcements?id=eq.${id}&select=*`
  );

  const a = rows?.[0];

  if (!a) {
    throw new Error('Pengumuman tidak ditemukan');
  }

  let target = '🌐 Umum (website)';

  if (a.tournament_id) {
    const t = await getT(env, a.tournament_id).catch(() => null);

    target =
      '🏆 ' + esc(t?.name || '(turnamen dihapus)');
  }

  return {
    text:
      (notice ? notice + '\n\n' : '') +
      `<b>📣 ${esc(a.title)}</b>\n` +
      `Untuk: ${target}\n` +
      `Dibuat: ${wib(a.created_at)}\n\n` +
      `${esc(a.body)}`,

    markup: {
      inline_keyboard: [
        [b('🗑 Hapus', 'm:an:d:' + id)],
        [b('⬅️ Daftar', 'm:an')],
      ],
    },
  };
}

H.an = async (env, chat, mid, p) => {
  const a = p[2];
  const id = p[3];

  if (!a || a === 'x') {
    return sh(env, chat, mid, await anList(env));
  }

  if (a === 'v') {
    return sh(env, chat, mid, await anView(env, id));
  }

  if (a === 'new') {
    const rows =
      (await sb(
        env,
        'GET',
        'tournaments?select=id,name,format,status&order=created_at.desc&limit=8'
      )) || [];

    const kb = rows.map((t) => [
      b(
        `${(ST[t.status] || ['❔'])[0]} ${t.format} · ${String(t.name).slice(0, 28)}`,
        'm:an:t:' + t.id
      ),
    ]);

    return show(
      env,
      chat,
      mid,
      '<b>➕ Buat Pengumuman</b>\nUntuk siapa?\n\n🌐 Umum: tampil di website saja.\n🏆 Turnamen: website + notifikasi ke Captain tim Resmi Terdaftar.',
      {
        inline_keyboard: [
          [b('🌐 Umum (website saja)', 'm:an:g')],
          ...kb,
          CAN,
        ],
      }
    );
  }

  if (a === 'g') {
    await setState(env, chat, 'an_title', {
      tid: null,
    });

    return show(
      env,
      chat,
      mid,
      '<b>➕ Pengumuman Umum</b>\nKetik <b>judul</b> (maks 100 karakter):',
      { inline_keyboard: [CAN] }
    );
  }

  if (a === 't') {
    const t = await getT(env, id);

    await setState(env, chat, 'an_title', {
      tid: id,
      tname: t.name,
    });

    return show(
      env,
      chat,
      mid,
      `<b>➕ Pengumuman: ${esc(t.name)}</b>\nKetik <b>judul</b> (maks 100 karakter):`,
      { inline_keyboard: [CAN] }
    );
  }

  if (a === 'ok') {
    const st = await getState(env, chat);

    if (!st || st.state !== 'an_conf') {
      return show(
        env,
        chat,
        mid,
        'Sesi kedaluwarsa. Buat pengumuman lagi.',
        {
          inline_keyboard: [
            [b('➕ Buat Pengumuman', 'm:an:new')],
            ...BACK,
          ],
        }
      );
    }

    const d = st.data;

    await clearState(env, chat);

    const rows = await sb(
      env,
      'POST',
      'announcements',
      {
        tournament_id: d.tid || null,
        title: d.title,
        body: d.body,
      },
      'return=representation'
    );

    const aid = rows?.[0]?.id;

    let note =
      '✅ Pengumuman tersimpan dan tampil di website.';

    if (d.tid) {
      const n = await notifyRegistrants(
        env,
        d.tid,
        'pengumuman',
        d.title,
        d.body
      );

      note += '\n' + notifNote(n);
    } else {
      note +=
        '\nℹ️ Pengumuman umum tidak dikirim sebagai notifikasi.';
    }

    await audit(
      env,
      'buat_pengumuman',
      'announcements',
      d.title,
      aid,
      null,
      { tournament_id: d.tid || null }
    );

    return sh(
      env,
      chat,
      mid,
      await anView(env, aid, note)
    );
  }

  if (a === 'd') {
    return show(
      env,
      chat,
      mid,
      '<b>Hapus pengumuman ini dari website?</b>\nNotifikasi yang sudah terkirim tetap ada di Captain.',
      {
        inline_keyboard: [[
          b('🗑 Ya, hapus', 'm:an:dy:' + id),
          b('✖️ Batal', 'm:an:v:' + id),
        ]],
      }
    );
  }

  if (a === 'dy') {
    const rows = await sb(
      env,
      'GET',
      `announcements?id=eq.${id}&select=title,tournament_id`
    );

    if (!rows?.[0]) {
      throw new Error('Pengumuman tidak ditemukan');
    }

    await sb(
      env,
      'DELETE',
      `announcements?id=eq.${id}`
    );

    await audit(
      env,
      'hapus_pengumuman',
      'announcements',
      rows[0].title,
      id,
      rows[0],
      null
    );

    const v = await anList(env);

    return show(
      env,
      chat,
      mid,
      '🗑 Pengumuman dihapus dari website.\n\n' + v.text,
      v.markup
    );
  }
};

T.an_title = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 100) {
    return show(
      env,
      chat,
      null,
      '❌ Judul 3 sampai 100 karakter. Ketik lagi atau /batal.',
      { inline_keyboard: [CAN] }
    );
  }

  await setState(env, chat, 'an_body', {
    ...st.data,
    title: text,
  });

  return show(
    env,
    chat,
    null,
    'Ketik <b>isi pengumuman</b> (maks 1000 karakter):',
    { inline_keyboard: [CAN] }
  );
};

T.an_body = async (env, chat, st, text) => {
  if (text.length < 3 || text.length > 1000) {
    return show(
      env,
      chat,
      null,
      '❌ Isi 3 sampai 1000 karakter. Ketik lagi atau /batal.',
      { inline_keyboard: [CAN] }
    );
  }

  const d = {
    ...st.data,
    body: text,
  };

  await setState(env, chat, 'an_conf', d);

  let who =
    '🌐 Umum (website saja, tanpa notifikasi)';

  if (d.tid) {
    const n = await count(
      env,
      `registrations?tournament_id=eq.${d.tid}&status=eq.resmi_terdaftar&select=id`
    );

    who =
      `🏆 ${esc(d.tname)}\nNotifikasi ke Captain dari ${n} tim Resmi Terdaftar`;
  }

  return show(
    env,
    chat,
    null,
    `<b>Konfirmasi pengumuman</b>\nUntuk: ${who}\n\n<b>${esc(d.title)}</b>\n${esc(d.body)}\n\nKirim?`,
    {
      inline_keyboard: [[
        b('✅ Kirim', 'm:an:ok'),
        b('✖️ Batal', 'm:an:x'),
      ]],
    }
  );
};

