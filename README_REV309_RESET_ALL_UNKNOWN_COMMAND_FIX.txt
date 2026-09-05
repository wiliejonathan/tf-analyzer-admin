TF Analyzer Admin REV309 — RESET ALL UNKNOWN_ADMIN_COMMAND FIX

Masalah:
- Tombol RESET ALL mengirim command reset_all.
- Deployment Apps Script lama membalas UNKNOWN_ADMIN_COMMAND karena belum mengenal bulk command tersebut.

Perbaikan REV309:
- Coba reset_all terlebih dahulu (fast bulk path).
- Jika response UNKNOWN_ADMIN_COMMAND, otomatis fallback tanpa meminta user mengulang:
  1. Ambil semua LICENSE_ID.
  2. Jalankan reset_pc.
  3. Jalankan reset_mobile.
  4. Lanjut ke seluruh user.
- Maksimal 2 worker paralel agar lebih cepat namun tidak terlalu membebani Apps Script.
- Menampilkan hasil partial jika ada satu device/user yang gagal.
- Token, email, plan, LICENSE_ID, dan expiry tetap dipertahankan.

Backend REV309 tetap disertakan agar deployment baru dapat memakai bulk reset_all secara langsung.
