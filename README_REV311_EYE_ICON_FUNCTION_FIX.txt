TF Analyzer Admin REV311 — Admin Key Eye Icon Function Fix

Perbaikan:
- Tombol show/hide Admin Dashboard Key memakai SVG inline asli, bukan emoji/font icon.
- Menghilangkan kotak abu-abu/default browser pada tombol mata.
- Klik/tap benar-benar toggle input password <-> text.
- State ikon mata terbuka/tertutup diset langsung oleh JavaScript dan tetap disinkronkan dengan aria-label/title.
- styles.css, config.js, dan app.js diberi cache-buster ?v=311 agar GitHub Pages/browser tidak memakai asset REV310 yang tersimpan di cache.
- Fitur Remember REV310 dan Reset ALL REV309 tetap dipertahankan.

Deploy:
Replace seluruh file frontend dari paket ini pada folder GitHub Pages tf-analyzer-admin. Tidak perlu mengubah Apps Script hanya untuk perbaikan ikon mata.
