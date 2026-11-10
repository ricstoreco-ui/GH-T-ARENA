// GH-T ARENA — BR OCR ENGINE (V3 - Anti Spasi)
export function analyzeBrOcr({
  words = [],
  expectedPlayers = [],
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

  // Fungsi pembersih: Hapus semua karakter non-alfanumerik (termasuk spasi)
  const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // 1. Kelompokin kata jadi baris
  const lines = [];
  const sortedWords = words.filter(w => w.text && w.confidence >= 30).sort((a, b) => a.bbox.y0 - b.bbox.y0); // Turunin confidence ke 30

  for (const w of sortedWords) {
    let line = lines.find(l => Math.abs(l.y - w.bbox.y0) < 20);
    if (!line) { line = { y: w.bbox.y0, words: [] }; lines.push(line); }
    line.words.push(w);
  }
  lines.sort((a, b) => a.y - b.y);
  lines.forEach(l => l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  // 2. Cari Nickname
  const foundPlayers = [];
  for (const line of lines) {
    const lineTextClean = clean(line.words.map(w => w.text).join(' '));
    
    for (const p of expectedPlayers) {
      const normP = clean(p.nickname);
      if (!normP) continue;
      
      // Cocokin tanpa spasi
      if (lineTextClean.includes(normP)) {
        // Cari Kill (Angka di baris yang sama)
        let kills = 0;
        for (const w of line.words) {
          if (/^\d+$/.test(w.text)) { // Kalau ada angka
            kills = parseInt(w.text, 10);
            break; 
          }
        }
        
        foundPlayers.push({
          registrationId: p.registrationId,
          teamName: p.teamName,
          nickname: p.nickname,
          kills: kills,
          yPos: line.y
        });
      }
    }
  }

  // 3. Gabungin per Tim
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
    // Cek biar nggak dobel
    if (!teams[p.registrationId].players.find(x => x.nickname === p.nickname)) {
      teams[p.registrationId].players.push({ nickname: p.nickname, kills: p.kills, played: true });
    }
    if (p.yPos < teams[p.registrationId].minY) teams[p.registrationId].minY = p.yPos;
  }

  // 4. Urutin peringkat
  const sortedTeams = Object.values(teams).sort((a, b) => a.minY - b.minY);

  // 5. Format draft
  const rows = sortedTeams.map((t, index) => {
    const totalKills = t.players.reduce((sum, p) => sum + p.kills, 0);
    return {
      registration_id: t.registrationId,
      team_name: t.teamName,
      presence: 'hadir',
      placement: index + 1,
      kills: totalKills,
      edited: false,
      conf: 90,
      flags: [],
      players: t.players
    };
  });

  // 6. Masukin tim yang nggak ketemu (Tapi jangan dobel)
  const regIdsFound = new Set(rows.map(r => r.registration_id));
  const allRegIds = new Set(expectedPlayers.map(p => p.registrationId));
  
  for (const regId of allRegIds) {
    if (!regIdsFound.has(regId)) {
      const teamName = expectedPlayers.find(p => p.registrationId === regId)?.teamName || 'Unknown';
      rows.push({
        registration_id: regId,
        team_name: teamName,
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

  return {
    success: rows.some(r => r.presence === 'hadir'),
    reviewRequired: true,
    canConfirm: false,
    map: { detected: null, configured: configuredMap, matches: [] },
    totalTeamsExpected: allRegIds.size,
    totalTeamsDetected: sortedTeams.length,
    rows: rows,
    errors,
    warnings
  };
}
