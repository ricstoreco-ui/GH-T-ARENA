// GH-T ARENA — Script OCR GitHub Actions (V17 - Multi-Model Fallback)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const matchId = process.env.MATCH_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// LIST MODEL CADANGAN (Dari yang paling stabil & sepi)
const GEMINI_MODELS = [
  'gemini-3.5-flash-lite',      // Pilihan utama (paling ringan & jarang 503)
  'gemini-3.1-flash-lite',       // Cadangan 1
  'gemini-flash-lite-latest'     // Cadangan 2 (latest lite)
];

// Fungsi Kirim Notif ke Telegram
async function sendTelegramMessage(text) {
  if (!process.env.BOT_TOKEN || !process.env.ADMIN_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.ADMIN_ID, text: text, parse_mode: 'HTML' })
    });
  } catch (e) { console.error('Gagal kirim pesan Telegram', e); }
}

// Fungsi Panggil Gemini dengan Multi-Model Fallback + Timeout
async function callGeminiWithFallback(prompt, base64Image) {
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const modelName = GEMINI_MODELS[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // Timeout 45 detik

    try {
      console.log(`🤖 Mencoba model: ${modelName}...`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64Image } }] }],
          generationConfig: { temperature: 0.1 }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`✅ Model ${modelName} berhasil merespon!`);
        return await response.json();
      }

      const errorText = await response.text();
      
      // Kalau 503 (server penuh), coba model selanjutnya
      if (response.status === 503) {
        console.log(`⚠️ Model ${modelName} penuh (503). Pindah ke model cadangan...`);
        continue; 
      }
      
      // Kalau error lain (400, 403, 404, dll), langung gagal
      throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
      
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        console.log(`⚠️ Model ${modelName} timeout. Pindah ke model cadangan...`);
        continue;
      }
      if (i === GEMINI_MODELS.length - 1) throw e;
      console.log(`⚠️ Error pada ${modelName}: ${e.message}. Pindah model...`);
    }
  }
  
  throw new Error('Semua model Gemini sedang sibuk. Coba lagi nanti.');
}

async function processOCR() {
  console.log(`Memulai OCR (Gemini) untuk Match ID: ${matchId || 'Semua yang menunggu'}`);
  
  let query = supabase.from('ocr_uploads').select('*').eq('status', 'menunggu').limit(5);
  if (matchId) query = query.eq('br_match_id', matchId);
  
  const { data: uploads, error } = await query;
  if (error) throw new Error(`Gagal ambil data upload: ${error.message}`);
  if (!uploads || uploads.length === 0) {
    console.log('Tidak ada screenshot yang perlu diproses.');
    return;
  }

  for (const up of uploads) {
    try {
      console.log(`Memproses: ${up.storage_path}`);
      
      const { data: fileData, error: dlError } = await supabase.storage.from('ocr-screenshots').download(up.storage_path);
      if (dlError) throw new Error(`Gagal download: ${dlError.message}`);
      
      const base64Image = Buffer.from(await fileData.arrayBuffer()).toString('base64');

      const prompt = `Analisa screenshot Free Fire ini. 
Kembalikan HANYA JSON array valid (tanpa markdown, tanpa teks lain). 
Format: [{"nickname": "NamaPlayer", "kills": 0}]. 
Baca semua player dan angka kill (Abates) di sebelah kanan namanya. Jika tidak ada kill, tulis 0.`;

      const result = await callGeminiWithFallback(prompt, base64Image);

      let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      console.log('RAW GEMINI RESPONSE:', textResponse);

      let geminiData = [];
      try {
        geminiData = JSON.parse(textResponse);
      } catch (e) {
        throw new Error('Gagal parse JSON dari Gemini: ' + textResponse);
      }

      await supabase.from('ocr_uploads').update({ status: 'selesai', error: null }).eq('id', up.id);

      const { data: match } = await supabase.from('br_matches').select('tournament_id').eq('id', up.br_match_id).single();
      const { data: regs } = await supabase.from('registrations').select('id, team_name').eq('tournament_id', match.tournament_id).eq('status', 'resmi_terdaftar');
      
      if (!regs || regs.length === 0) throw new Error('Belum ada tim terdaftar.');

      const regIds = regs.map(r => r.id);
      const { data: players } = await supabase.from('registration_players').select('registration_id, nickname').in('registration_id', regIds);

      const expectedPlayers = (players || []).map(p => {
        const reg = regs.find(r => r.id === p.registration_id);
        return { registrationId: p.registration_id, teamName: reg.team_name, nickname: p.nickname.toLowerCase() };
      });

      const teams = {};
      geminiData.forEach(item => {
        const nick = item.nickname.toLowerCase();
        const matchedPlayer = expectedPlayers.find(p => nick.includes(p.nickname) || p.nickname.includes(nick));
        
        if (matchedPlayer) {
          if (!teams[matchedPlayer.registrationId]) {
            teams[matchedPlayer.registrationId] = { id: matchedPlayer.registrationId, name: matchedPlayer.teamName, players: [] };
          }
          teams[matchedPlayer.registrationId].players.push({ nickname: item.nickname, kills: item.kills, played: true });
        }
      });

      const rows = Object.values(teams).map((t, idx) => {
        const totalKills = t.players.reduce((sum, p) => sum + p.kills, 0);
        return { registration_id: t.id, team_name: t.name, presence: 'hadir', placement: idx + 1, kills: totalKills, players: t.players };
      });

      const foundIds = new Set(rows.map(r => r.registration_id));
      regs.forEach(r => {
        if (!foundIds.has(r.id)) rows.push({ registration_id: r.id, team_name: r.team_name, presence: 'tidak_terdeteksi', placement: null, kills: 0, players: [] });
      });

      const draftData = { br_match_id: up.br_match_id, merged_data: { rows: rows }, warnings: [], status: 'draft', version: 1 };
      
      const { data: existing } = await supabase.from('ocr_drafts').select('id').eq('br_match_id', up.br_match_id).eq('status', 'draft').single();
      if (existing) {
        await supabase.from('ocr_drafts').update({ merged_data: draftData.merged_data, version: (existing.version||1)+1 }).eq('id', existing.id);
      } else {
        await supabase.from('ocr_drafts').insert(draftData);
      }

      console.log(`✅ Sukses memproses dengan Gemini: ${up.storage_path}`);
      await sendTelegramMessage(`✅ <b>OCR Berhasil!</b>\nGambar ${up.storage_path.split('/').pop()} sudah diproses. Silakan cek menu Draft OCR di Bot.`);

    } catch (err) {
      console.error(`❌ Gagal memproses ${up.id}:`, err.message);
      await supabase.from('ocr_uploads').update({ status: 'gagal', error: err.message }).eq('id', up.id);
      await sendTelegramMessage(`❌ <b>OCR Gagal!</b>\nAlasan: ${err.message}`);
    }
  }
}

processOCR().catch(console.error);
