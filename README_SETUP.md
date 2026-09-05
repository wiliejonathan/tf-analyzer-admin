# TF Analyzer Analyst — License Admin REV308

## Isi paket
- `index.html`, `styles.css`, `app.js`, `config.js` — frontend GitHub Pages.
- `assets/` — logo WebP ringan dari REV306.
- `TF_Analyzer_Apps_Script_REV308_RESET_ALL.gs` — backend lengkap dengan command `update_email`, `delete_user`, dan `reset_all`.

## 1. Deploy Backend Google Apps Script
1. Buka project Apps Script TF Analyzer yang saat ini dipakai.
2. Backup source lama.
3. Gunakan source `TF_Analyzer_Apps_Script_REV308_RESET_ALL.gs` dari paket ini.
4. Deploy → Manage deployments → Edit/New version → Web app.
5. Pastikan akses deployment sama seperti deployment sebelumnya.
6. Salin URL Web App yang berakhiran `/exec`.

## 2. Set API Frontend
Buka `config.js` dan pastikan `apiUrl` berisi URL `/exec` dari deployment aktif.

## 3. Publish GitHub Pages
Upload file frontend berikut ke root repo admin:
- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- folder `assets/`

Kemudian lakukan hard refresh browser.

## Fitur Manajemen User REV308
- **RESET ALL**: reset slot PC + Mobile seluruh user sekaligus, status menjadi OFFLINE.
- Reset massal tidak menghapus token, email, plan, LICENSE_ID, atau masa aktif.
- Pencil di kiri email → edit email user.
- Email baru dicek format dan duplikat di backend.
- TOKEN, LICENSE_ID, plan dan device tidak diubah ketika email diganti.
- X setelah Update → popup **No | Confirm**.
- Hanya **Confirm** yang mengirim command delete ke backend.
- Delete menghapus row user/license sehingga token/license tersebut tidak lagi terdaftar.
