// GH-T ARENA — BR OCR ENGINE (V8 - Layout Aware)
export function analyzeBrOcr({ words = [], expectedPlayers = [] } = {}) {
  const errors = [];
  const warnings = [];

  if (!expectedPlayers.length) {
    return { success: false, reviewRequired: true, canConfirm: false, errors: ["Belum ada pemain terdaftar."], warnings, rows: [] };
  }

  const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function isSimilar(str1, str2) {
    if (!str1 || !str2) return false;
    if (str1 === str2) return true;
    if (str1.includes(str2) || str2.includes(str1)) return true;
    if (Math.abs(str1.length - str2.length) > 4) return false;

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
    return dist <= Math.max(1, Math.floor(Math.max(str1.length, str2.length) * 0.35)); 
  }

  // 1. Filter kata-kata
  const cleanWords = words.filter(w => w.text && w.confidence >= 10);
  const foundPlayers = [];

  // 2. Cari tiap nama pemain
  for (const p of expectedPlayers) {
    const normP = clean(p.nickname);
    if (!normP) continue;

    // Cari kata yang cocok sama nickname
    const nameWord = cleanWords.find(w => isSimilar(clean(w.text), normP));
    
    if (nameWord) {
      let kills = 0;
      let closestDist = 9999;

      // Cari angka di sebelah kanan nama ini (Jarak Y maksimal 20px)
      for (const w of cleanWords) {
        if (w === nameWord) continue;
        
        // Angka murni
        if (/^\d+$/.test(w.text)) {
          // Posisi Y harus sejajar (satu baris)
          const yDiff = Math.abs(w.bbox.y0 - nameWord.bbox.y0);
          // Posisi X harus di kanan nama
          const xDiff = w.bbox.x0 - nameWord.bbox.x1;

          if (yDiff < 20 && xDiff > -10 && xDiff < 200) {
            // Ambil angka yang paling dekat dengan nama
            if (xDiff < closestDist) {
              closestDist = xDiff;
              kills = parseInt(w.text, 10);
            }
          }
        }
      }

      // Simpan data
      if (!foundPlayers.find(x => x.nickname === p.nickname)) {
        foundPlayers.push({
          registrationId: p.registrationId,
          teamName: p.teamName,
          nickname: p.nickname,
          kills: kills,
          yPos: nameWord.bbox.y0,
          xPos: nameWord.bbox.x0
        });
      }
    }
  }

  // 3. Gabungin per Tim (Berdasarkan Y terkecil milik pemain di tim itu)
  const teams = {};
  for (const p of foundPlayers) {
    if (!teams[p.registrationId]) {
      teams[p.registrationId] = {
        registrationId: p.registrationId,
        teamName: p.teamName,
        minY: p.yPos,
        minX: p.xPos,
        players: []
      };
    }
    teams[p.registrationId].players.push({ nickname: p.nickname, kills: p.kills, played: true });
    
    // Tim dapet posisi Y paling atas dari pemainnya
    if (p.yPos < teams[p.registrationId].minY) {
      teams[p.registrationId].minY = p.yPos;
      teams[p.registrationId].minX = p.xPos;
    }
  }

  // 4. Urutin Tim (Rank 1-5 Kiri, 6-11 Kanan)
  // Kita sort berdasarkan Y dulu. Kalau Y-nya sama (kiri dan kanan sejajar), kita sort berdasarkan X (kiri dulu).
  const sortedTeams = Object.values(teams).sort((a, b) => {
    if (Math.abs(a.minY - b.minY) < 30) { 
      return a.minX - b.minX; // Kalau sejajar, kiri dapet rank lebih dulu
    }
    return a.minY - b.minY;
  });

  // 5. Format Output
  const rows = sortedTeams.map((t, index) => {
    const totalKills = t.players.reduce((sum, p) => sum + p.kills, 0);
    return {
      registration_id: t.registrationId,
      team_name: t.teamName,
      presence: 'hadir',
      placement: index + 1,
      kills: totalKills,
      edited: false,
      conf: 85,
      flags: [],
      players: t.players
    };
  });

  // 6. Masukin tim yang nggak ketemu
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
    rows: rows,
    errors,
    warnings
  };
}
