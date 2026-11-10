// GH-T ARENA — BR OCR ENGINE (V2 - Nickname Based)
export function analyzeBrOcr({
  words = [],
  expectedPlayers = [], // Array: { registrationId, teamName, nickname }
  configuredMap = null
} = {}) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(words) || !Array.isArray(expectedPlayers)) {
    return { success: false, reviewRequired: true, canConfirm: false, errors: ["Format input tidak valid."], warnings, rows: [] };
  }

  if (!expectedPlayers.length) {
    return { success: false, reviewRequired: true, canConfirm: false, errors: ["Belum ada pemain terdaftar di turnamen ini."], warnings, rows: [] };
  }

  // 1. Bersihin & kelompokin kata jadi baris
  const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const lines = [];
  const sortedWords = words.filter(w => w.text && w.confidence >= 40).sort((a, b) => a.bbox.y0 - b.bbox.y0);

  for (const w of sortedWords) {
    let line = lines.find(l => Math.abs(l.y - w.bbox.y0) < 20);
    if (!line) { line = { y: w.bbox.y0, words: [] }; lines.push(line); }
    line.words.push(w);
  }
  lines.sort((a, b) => a.y - b.y);
  lines.forEach(l => l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  // 2. Cari Nickname yang cocok di tiap baris
  const foundPlayers = [];
  for (const line of lines) {
    const lineText = line.words.map(w => w.text).join(' ');
    let bestMatch = null;
    
    for (const p of expectedPlayers) {
      const normP = clean(p.nickname);
      const normLine = clean(lineText);
      if (!normP) continue;
      
      // Cek kemiripan sederhana
      if (normLine.includes(normP) || normP.includes(normLine)) {
        const score = 100;
        if (!bestMatch || score > bestMatch.score) bestMatch = { player: p, score };
      }
    }

    if (bestMatch) {
      // 3. Cari Kill (Angka di baris yang sama)
      let kills = 0;
      let xNick = line.words.find(w => clean(w.text) === clean(bestMatch.player.nickname))?.bbox.x0 || line.words[0].bbox.x0;
      
      for (const w of line.words) {
        if (/^\d+$/.test(w.text) && w.bbox.x0 > xNick) {
          kills = parseInt(w.text, 10);
          break; // Angka pertama setelah nickname dianggap kill
        }
      }
      
      foundPlayers.push({
        registrationId: bestMatch.player.registrationId,
        teamName: bestMatch.player.teamName,
        nickname: bestMatch.player.nickname,
        kills: kills,
        yPos: line.y
      });
    }
  }

  // 4. Gabungin data per Tim (Registration ID)
  const teams = {};
  for (const p of foundPlayers) {
    if (!teams[p.registrationId]) {
      teams[p.registrationId] = {
        registrationId: p.registrationId,
        teamName: p.teamName,
        minY: p.yPos,
        players: []
      };
    }
    teams[p.registrationId].players.push({ nickname: p.nickname, kills: p.kills, played: true });
    if (p.yPos < teams[p.registrationId].minY) teams[p.registrationId].minY = p.yPos;
  }

  // 5. Urutin peringkat berdasarkan posisi Y (paling atas = Rank 1)
  const sortedTeams = Object.values(teams).sort((a, b) => a.minY - b.minY);

  // 6. Format buat draft bot
  const rows = sortedTeams.map((t, index) => {
    const totalKills = t.players.reduce((sum, p) => sum + p.kills, 0);
    return {
      registration_id: t.registrationId,
      team_name: t.teamName,
      presence: 'hadir',
      placement: index + 1, // Peringkat berdasarkan urutan Y
      kills: totalKills,
      edited: false,
      conf: 90,
      flags: [],
      players: t.players
    };
  });

  // Tambahin tim yang nggak ketemu di gambar
  for (const p of expectedPlayers) {
    if (!teams[p.registrationId]) {
      // Cek biar nggak dobel masukin
      if (!rows.find(r => r.registration_id === p.registrationId)) {
        rows.push({
          registration_id: p.registrationId,
          team_name: p.teamName,
          presence: 'tidak_terdeteksi',
          placement: null,
          kills: 0,
          edited: false,
          conf: 0,
          flags: ['Tim tidak terlihat di screenshot'],
          players: []
        });
      }
    }
  }

  // Urutin lagi biar tim yang hadir di atas
  rows.sort((a, b) => {
    if (a.presence === 'hadir' && b.presence !== 'hadir') return -1;
    if (a.presence !== 'hadir' && b.presence === 'hadir') return 1;
    return (a.placement || 99) - (b.placement || 99);
  });

  return {
    success: rows.some(r => r.presence === 'hadir'),
    reviewRequired: true,
    canConfirm: false,
    map: { detected: null, configured: configuredMap, matches: [] }, // Map skip dulu
    totalTeamsExpected: new Set(expectedPlayers.map(p => p.registrationId)).size,
    totalTeamsDetected: sortedTeams.length,
    rows: rows,
    errors,
    warnings
  };
}
