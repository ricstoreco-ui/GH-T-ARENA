// GH-T ARENA Bot — f_info.js: Menu Panduan & Info
import { b, BACK, show } from './core.js';

export const H = {};

H.info = async (env, chat, mid) => {
  const text = `<b>📖 Panduan Super Admin</b>\n\n` +
    `Berikut alur kerja singkat untuk mengelola turnamen:\n\n` +
    `<b>1. Turnamen BR (Battle Royale)</b>\n` +
    `Buat Turnamen > Set Status Berlangsung > Buka Kelola BR > Pilih Match > Upload Screenshot > Konfirmasi Draft OCR > Finalisasi.\n\n` +
    `<b>2. Turnamen CS (Clash Squad)</b>\n` +
    `Buat Turnamen > Set Status Berlangsung > Buka Kelola CS > Buat Bracket (Undi) > Pilih Match > Pilih Pemenang (Otomatis Maju).\n\n` +
    `<b>3. Pendaftaran & Pembayaran</b>\n` +
    `Menu Pendaftaran > Cek Bukti Bayar > Klik Verifikasi. Slot otomatis bertambah.\n\n` +
    `<b>4. Pencairan Hadiah</b>\n` +
    `Setelah turnamen Selesai > Buka menu Pencairan > Proses transfer DANA > Tandai Sudah Dibayar.`;
    
  return show(env, chat, mid, text, { inline_keyboard: [[b('⬅️ Menu Utama', 'm:main')]] });
};
