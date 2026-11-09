// GH-T ARENA — Script OCR GitHub Actions
import { createClient } from '@supabase/supabase-js';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { analyzeBrOcr } from '../src/br-ocr-engine.js'; // Pastikan file ini ada di folder src/

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const matchId = process.env.MATCH_ID;

async function processOCR() {
  console.log(`Memulai OCR untuk Match ID: ${matchId || 'Semua yang menunggu'}`);
  
  // 1. Ambil gambar yang statusnya 'menunggu'
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
      
      // 2. Download gambar dari Storage Supabase
      const { data: fileData, error: dlError } = await supabase.storage.from('ocr-screenshots').download(up.storage_path);
      if (dlError) throw new Error(`Gagal download: ${dlError.message}`);
      
      const buffer = Buffer.from(await fileData.arrayBuffer());

      // 3. Pre-processing pakai Sharp (Grayscale + Normalisasi Kontras)
      const processedBuffer = await sharp(buffer)
        .grayscale()
        .normalize()
        .threshold(150) // Ubah jadi hitam putih tegas biar Tesseract gampang baca
        .toBuffer();

      // 4. Jalankan Tesseract OCR
      const { data } = await worker.recognize(processedBuffer);
      
      // 5. Update status jadi selesai
      await supabase.from('ocr_uploads').update({ status: 'selesai', error: null }).eq('id', up.id);

      // 6. Ambil data tim (untuk expectedTeams) & Map
      const { data: match } = await supabase.from('br_matches').select('tournament_id, game_maps(name)').eq('id', up.br_match_id).single();
      const { data: regs } = await supabase.from('registrations').select('id, team_name').eq('tournament_id', match.tournament_id).eq('status', 'resmi_terdaftar');
      
      const expectedTeams = regs.map(r => ({ registrationId: r.id, teamName: r.team_name, players: [] }));

      // 7. Kirim hasil teks ke br-ocr-engine.js (Otak lu)
      // Note: Tesseract.js v5 mengembalikan 'words' di dalam data.words
      const result = analyzeBrOcr({
        words: data.words || [], // Pastikan format words sesuai (x0, y0, x1, y1)
        expectedTeams,
        configuredMap: match.game_maps?.name || null
      });

      // 8. Simpan hasil analisa ke tabel ocr_drafts
      const draftData = {
        br_match_id: up.br_match_id,
        merged_data: { 
          map: result.map.detected, 
          map_expected: result.map.configured, 
          map_ok: result.map.detected === result.map.configured,
          rows: result.rows 
        },
        warnings: [...result.warnings, ...result.errors],
        status: 'draft',
        version: 1
      };
      
      // Cek jika draft sudah ada, update. Jika belum, insert.
      const { data: existing } = await supabase.from('ocr_drafts').select('id').eq('br_match_id', up.br_match_id).eq('status', 'draft').single();
      if (existing) {
        await supabase.from('ocr_drafts').update({ merged_data: draftData.merged_data, warnings: draftData.warnings, version: (existing.version||1)+1 }).eq('id', existing.id);
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
