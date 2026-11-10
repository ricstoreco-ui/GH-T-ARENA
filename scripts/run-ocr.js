// GH-T ARENA — Script OCR GitHub Actions (V6 FINAL)
// GH-T ARENA — Script OCR GitHub Actions (V7 Debug)
import { createClient } from '@supabase/supabase-js';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { analyzeBrOcr } from '../src/br-ocr-engine.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const matchId = process.env.MATCH_ID;

async function processOCR() {
  console.log(`Memulai OCR untuk Match ID: ${matchId || 'Semua yang menunggu'}`);
  
  let query = supabase.from('ocr_uploads').select('*').eq('status', 'menunggu').limit(5);
  if (matchId) query = query.eq('br_match_id', matchId);
  
  const { data: uploads, error } = await query;
  if (error) throw new Error(`Gagal ambil data upload: ${error.message}`);
  if (!uploads || uploads.length === 0) {
    console.log('Tidak ada screenshot yang perlu diproses.');
    return;
  }

  const worker = await createWorker('eng');
  
  for (const up of uploads) {
    try {
      console.log(`Memproses: ${up.storage_path}`);
      
      const { data: fileData, error: dlError } = await supabase.storage.from('ocr-screenshots').download(up.storage_path);
      if (dlError) throw new Error(`Gagal download: ${dlError.message}`);
      
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const processedBuffer = await sharp(buffer).grayscale().normalize().toBuffer();
      
      const { data } = await worker.recognize(processedBuffer);
      
      // ==========================================
      // DEBUG: EKSTRAK DATA WORDS
      // ==========================================
      const allWords = [];
      if (data.blocks) {
        data.blocks.forEach(b => {
          b.paragraphs.forEach(p => {
            p.lines.forEach(l => {
              l.words.forEach(w => {
                allWords.push({ text: w.text, confidence: w.confidence, bbox: w.bbox });
              });
            });
          });
        });
      }

      console.log(`\n=========================================`);
      console.log(`📊 DEBUG INFO:`);
      console.log(`Total teks utuh: ${data.text.length} karakter`);
      console.log(`Total words (koordinat) yang kebaca: ${allWords.length}`);
      console.log(`Sampel 10 kata pertama:`, allWords.slice(0, 10));
      console.log(`=========================================\n`);

      await supabase.from('ocr_uploads').update({ status: 'selesai', error: null }).eq('id', up.id);

      const { data: match } = await supabase.from('br_matches').select('tournament_id').eq('id', up.br_match_id).single();
      const { data: regs } = await supabase.from('registrations').select('id, team_name').eq('tournament_id', match.tournament_id).eq('status', 'resmi_terdaftar');
      
      if (!regs || regs.length === 0) {
        console.log('❌ Gagal: Belum ada tim terdaftar.');
        continue;
      }

      const regIds = regs.map(r => r.id);
      const { data: players } = await supabase.from('registration_players').select('registration_id, nickname').in('registration_id', regIds);

      const expectedPlayers = (players || []).map(p => {
        const reg = regs.find(r => r.id === p.registration_id);
        return { registrationId: p.registration_id, teamName: reg.team_name, nickname: p.nickname };
      });

      console.log(`\n📋 DAFTAR PEMAIN YANG DICARI DI DATABASE:`);
      console.log(expectedPlayers.map(p => p.nickname).join(', '));
      console.log(`\n`);

      const result = analyzeBrOcr({
        words: allWords,
        expectedPlayers
      });

      const draftData = {
        br_match_id: up.br_match_id,
        merged_data: { rows: result.rows },
        warnings: [],
        status: 'draft',
        version: 1
      };
      
      const { data: existing } = await supabase.from('ocr_drafts').select('id').eq('br_match_id', up.br_match_id).eq('status', 'draft').single();
      if (existing) {
        await supabase.from('ocr_drafts').update({ merged_data: draftData.merged_data, version: (existing.version||1)+1 }).eq('id', existing.id);
      } else {
        await supabase.from('ocr_drafts').insert(draftData);
      }

      console.log(`✅ Sukses memproses ${up.storage_path}`);

    } catch (err) {
      console.error(`❌ Gagal memproses ${up.id}:`, err.message);
      await supabase.from('ocr_uploads').update({ status: 'gagal', error: err.message }).eq('id', up.id);
    }
  }

  await worker.terminate();
}

processOCR().catch(console.error);
