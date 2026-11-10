// GH-T ARENA — BR OCR ENGINE (V6 FINAL - Fokus Nickname & Kills)
export function analyzeBrOcr({ words = [], expectedPlayers = [] } = {}) {
  const errors = [];
  const warnings = [];

  if (!expectedPlayers.length) {
    return { success: false, reviewRequired: true, canConfirm: false, errors: ["Belum ada pemain terdaftar."], warnings, rows: [] };
  }

  // 1. Fungsi pembersih teks: ubah ke lowercase, buang semua simbol & spasi
  const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // 2. Algoritma Levenshtein (ngecek kemiripan kata)
  function isSimilar(str1, str2) {
    if (!str1 || !str2) return false;
    if (str1 === str2) return true;
    if (str1.includes(str2) || str2.includes(str1)) return true;
    
    // Kalau panjang string beda jauh, langsung tolak
    if (Math.abs(str1.length - str2.length) > 4) return false;

    const track = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    for (let i = 0; i <= str1.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= str2.length; j += 1) track[j][0] = j;
    
    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1, 
          track[j - 1][i] + 1, 
          track[j - 1][i - 1] + indicator
        );
      }
    }
    const dist = track[str2.length][str1.length];
    // Toleransi typo 40% (Misal BLACK vs BLACKT = beda 1 huruf, aman)
    return dist <= Math.max(1, Math.floor(Math.max(str1.length, str2.length) * 0.4)); 
  }

  // 3. Kelompokin kata jadi baris (Berdasarkan koordinat Y)
  const lines = [];
  const sortedWords = words.filter(w => w.text && w.confidence >= 10).sort((a, b) => a.bbox.y0 - b.bbox.y0);

  for (const w of sortedWords) {
    // Gabungin kata ke baris yang sama kalau beda tinggi (Y) maksimal 20 pixel
    let line = lines.find(l => Math.abs(l.y - w.bbox.y0) < 20);
    if (!line) { line = { y: w.bbox.y0, words: [] }; lines.push(line); }
    line.words.push(w);
  }
  
  // Urutin baris dari atas ke bawah, dan kata dari kiri ke kanan
  lines.sort((a, b) => a.y - b.y);
  lines.forEach(l => l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  // 4. Cocokin nama pemain
  const foundPlayers = [];
  for (const line of lines) {
    for (const p of expectedPlayers) {
      const normP = clean(p.nickname);
      if (!normP) continue;

      // Cari kata di baris ini yang mirip sama nickname
      let matchedIndex = line.words.findIndex(w => isSimilar(clean(w.text), normP));
      
      if (matchedIndex !== -1) {
        let kills = 0;
        let playerX = line.words[matchedIndex].bbox.x0;

        // Cari angka Kill di SEBELAH KANAN nickname
        for (let i = matchedIndex + 1; i < line.words.length; i++) {
          let w = line.words[i];
          // Kalau ketemu angka murni (0-99), dan posisinya di kanan nama
          if (/^\d{1,2}$/.test(w.text) && w.bbox.x0 > playerX) { 
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

  // 5. Gabungin data per Tim (Registration ID)
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
    // Simpen Y paling atas buat nentuin Rank Tim
    if (p.yPos < teams[p.registrationId].minY) teams[p.registrationId].minY = p.yPos;
  }

  // 6. Urutin Tim berdasarkan posisi Y (paling atas = Rank 1)
  const sortedTeams = Object.values(teams).sort((a, b) => a.minY - b.minY);

  // 7. Format jadi Draft Rows
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

  // 8. Masukin tim yang nggak ketemu sama sekali di SS
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
