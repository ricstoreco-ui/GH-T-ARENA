// GH-T ARENA — BR OCR ENGINE (V4 - Fuzzy Matching)
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

  const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Fungsi buat ngecek kemiripan dua kata (Levenshtein)
  function isSimilar(str1, str2) {
    if (str1 === str2) return true;
    if (str1.includes(str2) || str2.includes(str1)) return true;
    const track = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    for (let i = 0; i <= str1.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= str2.length; j += 1) track[j][0] = j;
    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + indicator);
      }
    }
    const dist = track[str2.length][str1.length];
    return dist <= Math.max(2, Math.floor(Math.max(str1.length, str2.length) * 0.3)); // Toleransi typo 30%
  }

  const lines = [];
  const sortedWords = words.filter(w => w.text && w.confidence >= 20).sort((a, b) => a.bbox.y0 - b.bbox.y0);

  for (const w of sortedWords) {
    let line = lines.find(l => Math.abs(l.y - w.bbox.y0) < 20);
    if (!line) { line = { y: w.bbox.y0, words: [] }; lines.push(line); }
    line.words.push(w);
  }
  lines.sort((a, b) => a.y - b.y);
  lines.forEach(l => l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  const foundPlayers = [];
  for (const line of lines) {
    for (const p of expectedPlayers) {
      const normP = clean(p.nickname);
      if (!normP) continue;

      // Cek tiap kata di baris ini, ada yang mirip nggak?
      let matchedWord = line.words.find(w => isSimilar(clean(w.text), normP));
      
      if (matchedWord) {
        // Cari angka Kill di baris yang sama
        let kills = 0;
        for (const w of line.words) {
          if (/^\d+$/.test(w.text)) { // Kalau ada angka
            kills = parseInt(w.text, 10);
            break; 
          }
        }
        
        // Biar nggak dobel masukin player yang sama
        if (!foundPlayers.find(x => x.nickname === p.nickname)) {
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
  }

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

  const sortedTeams = Object.values(teams).sort((a, b) => a.minY - b.minY);

  const rows = sortedTeams.map((t, index) => {
    const totalKills = t.players.reduce((sum, p) => sum + p.kills, 0);
    return {
      registration_id: t.registrationId,
      team_name: t.teamName,
      presence: 'hadir',
      placement: index + 1,
      kills: totalKills,
      edited: false,
      conf: 80,
      flags: [],
      players: t.players
    };
  });

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
