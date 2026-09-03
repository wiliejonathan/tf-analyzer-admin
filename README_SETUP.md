# TF Analyzer Analyst — License Admin REV302

## Backend API
Sudah hardcoded ke:
https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec

## Publish GitHub Pages
1. Extract ZIP.
2. Upload isi folder `github-pages/` ke ROOT repo `tf-analyzer-admin`.
3. Replace file versi lama.
4. GitHub Settings → Pages → Deploy from branch `main` / root.
5. Tunggu GitHub Pages selesai deploy.
6. Buka halaman lalu lakukan hard refresh satu kali.

## Desain
- Primary brand: TF Analyzer Analyst
- Parent branding: SkillFusion, dibuat compact di kanan atas
- Desktop: sidebar + table
- Tablet: sidebar lebih kecil
- Mobile: navigation horizontal + user cards
- Tombol Refresh manual dihapus
- Auto refresh data setiap 30 detik setelah login
