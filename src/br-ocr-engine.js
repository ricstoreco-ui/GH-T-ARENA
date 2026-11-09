/**
 * GH-T ARENA — BR OCR ENGINE
 * Pure JavaScript, no paid API or external dependency.
 *
 * Input:
 * {
 *   words: [{ text, confidence, bbox: { x0, y0, x1, y1 } }],
 *   expectedTeams: [{
 *     registrationId,
 *     teamName,
 *     players: [{ playerId, nickname }]
 *   }],
 *   configuredMap: "Bermuda"
 * }
 *
 * This module analyzes OCR output. It does not perform image OCR itself
 * and does not write to Supabase or confirm matches.
 */

const MAPS = {
  bermuda: ["bermuda"],
  purgatory: ["purgatory"],
  kalahari: ["kalahari"],
  alpine: ["alpine"],
  nexterra: ["nexterra", "nex terra"]
};

const MIN_WORD_CONFIDENCE = 45;
const MIN_TEAM_CONFIDENCE = 65;
const MIN_ROW_CONFIDENCE = 60;
const Y_LINE_TOLERANCE = 14;

function clean(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const x = clean(a);
  const y = clean(b);

  if (!x || !y) return 0;
  if (x === y) return 100;

  const rows = Array.from({ length: x.length + 1 }, (_, i) => [i]);

  for (let j = 0; j <= y.length; j++) rows[0][j] = j;

  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;

      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  const distance = rows[x.length][y.length];
  return Math.round((1 - distance / Math.max(x.length, y.length)) * 100);
}

function normalizeWords(words = []) {
  return words
    .filter(word => word && typeof word.text === "string")
    .map(word => ({
      text: word.text.trim(),
      normalized: clean(word.text),
      confidence: Number(word.confidence ?? 0),
      x0: Number(word.bbox?.x0 ?? 0),
      y0: Number(word.bbox?.y0 ?? 0),
      x1: Number(word.bbox?.x1 ?? 0),
      y1: Number(word.bbox?.y1 ?? 0)
    }))
    .filter(word => word.text && word.confidence >= MIN_WORD_CONFIDENCE)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

function groupLines(words) {
  const lines = [];

  for (const word of words) {
    let line = lines.find(item =>
      Math.abs(item.centerY - (word.y0 + word.y1) / 2)
        <= Y_LINE_TOLERANCE
    );

    if (!line) {
      line = {
        centerY: (word.y0 + word.y1) / 2,
        words: []
      };
      lines.push(line);
    }

    line.words.push(word);
    line.words.sort((a, b) => a.x0 - b.x0);

    line.text = line.words.map(item => item.text).join(" ");
    line.confidence = Math.round(
      line.words.reduce((sum, item) => sum + item.confidence, 0)
      / line.words.length
    );
  }

  return lines.sort((a, b) => a.centerY - b.centerY);
}

function detectMap(words) {
  const text = clean(words.map(word => word.text).join(" "));
  const matches = [];

  for (const [map, aliases] of Object.entries(MAPS)) {
    for (const alias of aliases) {
      if (text.includes(clean(alias))) {
        matches.push(map);
        break;
      }
    }
  }

  return {
    detected: matches.length === 1 ? matches[0] : null,
    matches,
    ambiguous: matches.length > 1
  };
}

function detectColumns(lines) {
  const headers = lines.filter(line => {
    const text = clean(line.text);
    return (
      /\b(rank|place|placement|position|pos)\b/.test(text) ||
      /\b(kill|kills|elimination|eliminations)\b/.test(text)
    );
  });

  if (!headers.length) {
    return {
      valid: false,
      reason: "Header placement/kill tidak ditemukan."
    };
  }

  const headerWords = headers.flatMap(line => line.words);

  const placementWords = headerWords.filter(word =>
    /\b(rank|place|placement|position|pos)\b/.test(word.normalized)
  );

  const killWords = headerWords.filter(word =>
    /\b(kill|kills|elimination|eliminations)\b/.test(word.normalized)
  );

  if (!placementWords.length || !killWords.length) {
    return {
      valid: false,
      reason: "Kolom placement atau kill tidak terdeteksi."
    };
  }

  const averageX = items =>
    items.reduce((sum, word) => sum + (word.x0 + word.x1) / 2, 0)
    / items.length;

  const placementX = averageX(placementWords);
  const killX = averageX(killWords);

  if (Math.abs(placementX - killX) < 5) {
    return {
      valid: false,
      reason: "Posisi kolom placement dan kill terlalu berdekatan."
    };
  }

  return {
    valid: true,
    placementX,
    killX
  };
}

function matchTeam(line, expectedTeams) {
  let best = null;

  for (const team of expectedTeams) {
    const score = similarity(line.text, team.teamName);

    if (!best || score > best.score) {
      best = { team, score };
    }
  }

  return best;
}

function findNumericWord(line, targetX) {
  const candidates = line.words
    .map(word => ({
      word,
      value: Number(word.normalized.replace(/[^\d]/g, "")),
      distance: Math.abs((word.x0 + word.x1) / 2 - targetX)
    }))
    .filter(item =>
      /^\d+$/.test(item.word.normalized) &&
      Number.isInteger(item.value)
    )
    .sort((a, b) => a.distance - b.distance);

  if (!candidates.length) return null;

  if (
    candidates.length > 1 &&
    Math.abs(candidates[0].distance - candidates[1].distance) < 3
  ) {
    return null;
  }

  return candidates[0];
}

function validateRows(rows, expectedTeams) {
  const errors = [];

  const seenRegistrations = new Set();
  const seenPlacements = new Set();

  for (const row of rows) {
    if (seenRegistrations.has(row.registrationId)) {
      errors.push(`Tim terdeteksi lebih dari sekali: ${row.teamName}`);
    }

    seenRegistrations.add(row.registrationId);

    if (!Number.isInteger(row.placement) ||
        row.placement < 1 ||
        row.placement > expectedTeams.length) {
      errors.push(`Placement tidak valid: ${row.teamName}`);
    }

    if (seenPlacements.has(row.placement)) {
      errors.push(`Placement ganda: ${row.placement}`);
    }

    seenPlacements.add(row.placement);

    if (!Number.isInteger(row.kills) || row.kills < 0) {
      errors.push(`Kill tidak valid: ${row.teamName}`);
    }
  }

  return errors;
}

export function analyzeBrOcr({
  words = [],
  expectedTeams = [],
  configuredMap = null
} = {}) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(words) || !Array.isArray(expectedTeams)) {
    return {
      success: false,
      reviewRequired: true,
      canConfirm: false,
      errors: ["Format input OCR tidak valid."],
      warnings,
      rows: []
    };
  }

  if (!expectedTeams.length) {
    return {
      success: false,
      reviewRequired: true,
      canConfirm: false,
      errors: ["Data tim resmi tidak tersedia."],
      warnings,
      rows: []
    };
  }

  const normalizedWords = normalizeWords(words);
  const lines = groupLines(normalizedWords);

  const mapResult = detectMap(normalizedWords);

  if (!mapResult.detected) {
    errors.push("Map tidak berhasil dideteksi dengan pasti.");
  }

  const normalizedConfiguredMap = clean(configuredMap);

  if (normalizedConfiguredMap && mapResult.detected) {
    const expectedMap = clean(configuredMap).replace(/\s/g, "");

    if (expectedMap !== mapResult.detected.replace(/\s/g, "")) {
      errors.push(
        `Map screenshot berbeda. Match: ${configuredMap}, ` +
        `Screenshot: ${mapResult.detected}`
      );
    }
  }

  if (mapResult.ambiguous) {
    errors.push("Terdapat lebih dari satu kemungkinan map.");
  }

  const columns = detectColumns(lines);

  if (!columns.valid) {
    errors.push(columns.reason);
  }

  const rows = [];

  if (columns.valid) {
    for (const line of lines) {
      const match = matchTeam(line, expectedTeams);

      if (!match || match.score < MIN_TEAM_CONFIDENCE) continue;

      const placement = findNumericWord(line, columns.placementX);
      const kills = findNumericWord(line, columns.killX);

      if (!placement || !kills) {
        warnings.push(
          `Data placement/kill perlu diperiksa: ${match.team.teamName}`
        );
        continue;
      }

      rows.push({
        registrationId: match.team.registrationId,
        teamName: match.team.teamName,
        placement: placement.value,
        kills: kills.value,
        confidence: Math.min(
          match.score,
          line.confidence,
          placement.word.confidence,
          kills.word.confidence
        ),
        status: "review"
      });
    }
  }

  if (rows.length !== expectedTeams.length) {
    warnings.push(
      `Jumlah tim terbaca ${rows.length} dari ${expectedTeams.length}.`
    );
  }

  for (const team of expectedTeams) {
    if (!rows.some(row => row.registrationId === team.registrationId)) {
      warnings.push(`Tim belum terdeteksi: ${team.teamName}`);
    }
  }

  for (const row of rows) {
    if (row.confidence < MIN_ROW_CONFIDENCE) {
      warnings.push(`Confidence rendah: ${row.teamName}`);
    }
  }

  errors.push(...validateRows(rows, expectedTeams));

  const canConfirm =
    errors.length === 0 &&
    warnings.length === 0 &&
    rows.length === expectedTeams.length;

  return {
    success: errors.length === 0,
    reviewRequired: !canConfirm,
    canConfirm,
    map: {
      detected: mapResult.detected,
      configured: configuredMap,
      matches: mapResult.matches
    },
    totalTeamsExpected: expectedTeams.length,
    totalTeamsDetected: rows.length,
    rows,
    errors,
    warnings
  };
}

export function calculateBrPoints({
  placement,
  kills,
  pointTable
} = {}) {
  if (!Number.isInteger(placement) || placement < 1) {
    throw new Error("Placement tidak valid.");
  }

  if (!Number.isInteger(kills) || kills < 0) {
    throw new Error("Kill tidak valid.");
  }

  if (!Array.isArray(pointTable)) {
    throw new Error("Point table tidak valid.");
  }

  const entry = pointTable.find(
    item => Number(item.placement) === placement
  );

  if (!entry) {
    throw new Error(`Poin placement ${placement} tidak ditemukan.`);
  }

  const placementPoints = Number(entry.points);

  if (!Number.isFinite(placementPoints) || placementPoints < 0) {
    throw new Error("Nilai placement points tidak valid.");
  }

  return {
    placementPoints,
    killPoints: kills,
    totalPoints: placementPoints + kills
  };
}
