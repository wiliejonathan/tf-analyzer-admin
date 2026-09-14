# Member Skill Fusion — REV312

This revision adds a separate **Member Skill Fusion** module to the existing TF Analyzer Analyst admin dashboard without changing the existing license-user workflow.

## What is included

- New sidebar parent menu: **Member Skill Fusion**
  - Dashboard (default when parent is opened)
  - + Tambah User
  - Manajemen User
- Dashboard cards: Total User, User Online, Pending, Suspended.
- Online-member list based on active session heartbeat.
- Member actions: Activate, Suspend, Activate Again, Send Status Email, Remove.
- Google Account registration and login.
- Owner approval workflow.
- Owner email when a new registration is waiting for approval.
- Member email when account is activated / status email is resent.
- Sliding idle timeout: **10 minutes**.
- Session token is hashed before being stored in Google Sheet.
- `memberarea-guard-widget.html` verifies the session before showing the member page.

## Files

- `member-skill-fusion.js` — Admin UI module.
- `member-skill-fusion.css` — Admin UI styling.
- `Member_Skill_Fusion_Backend.gs` — Standalone Apps Script API + Google Sheet database.
- `member-auth-widget.html` — HTML widget for Login / Register with Google.
- `memberarea-guard-widget.html` — Session guard to paste into the Memberarea page.
- `config.js` — loads the Member Skill Fusion admin module; set `memberApiUrl` after Apps Script deployment.

## 1. Deploy Apps Script

1. Open Google Apps Script and create a new standalone project.
2. Paste `Member_Skill_Fusion_Backend.gs` into `Code.gs`.
3. Run `setupMemberSkillFusion()` once and approve Google permissions.
   - The script automatically creates a spreadsheet named **Skill Fusion Members**.
   - It automatically creates `SF_Members`, `SF_Sessions`, and `SF_Audit` sheets.
4. Open **Project Settings → Script Properties** and set:
   - `ADMIN_DASHBOARD_KEY` = use the same Admin Dashboard Key as the current TF Analyzer admin.
   - `SF_GOOGLE_CLIENT_ID` = Google OAuth Web Client ID.
   - Optional: `SF_OWNER_EMAIL` (default: `wiliejonathan1999@gmail.com`).
   - Optional: `SF_MEMBER_REDIRECT_URL` (default: `https://skillfusion.framer.website/Memberarea`).
   - Optional: `SF_LOGIN_PAGE_URL` = the Framer page containing `member-auth-widget.html`.
   - Optional: `SF_ADMIN_DASHBOARD_URL` (default: `https://wiliejonathan.github.io/tf-analyzer-admin/`).
5. Deploy → **New deployment → Web app**.
   - Execute as: **Me**.
   - Who has access: **Anyone**.
6. Copy the final `/exec` URL.
7. Put that URL in `config.js` as `memberApiUrl`.
8. Put the same URL in `member-auth-widget.html` and `memberarea-guard-widget.html`.

## 2. Create Google OAuth Client ID

In Google Cloud Console:

1. Create/select a project.
2. Configure OAuth consent screen.
3. Create **OAuth Client ID → Web application**.
4. Add the actual origin where the Google button runs. Start with:
   - `https://skillfusion.framer.website`
   - `https://wiliejonathan.github.io` (for GitHub Pages testing if needed)
5. Copy the client ID ending in `.apps.googleusercontent.com`.
6. Save it as `SF_GOOGLE_CLIENT_ID` in Apps Script Script Properties.
7. Put it in `member-auth-widget.html` under `googleClientId`.

> If Framer renders the HTML Embed inside a different iframe origin, Google may report an origin mismatch. In that case host the auth widget on an approved origin (for example GitHub Pages or a custom Skill Fusion domain) and embed that page instead. The backend does not need to change.

## 3. Framer widgets

### Login/Register page
Paste the entire contents of `member-auth-widget.html` into the red login box area.

### Protected `/Memberarea` page
Paste `memberarea-guard-widget.html` into the Memberarea page and set its `loginUrl` to the page containing the login widget.

The guard keeps the page hidden until the current session is validated. It sends a heartbeat while the user is active and logs the user out after 10 minutes of inactivity.

## Important security note — Framer URL protection

The client-side guard prevents ordinary copy/paste access, but **a public Framer origin is still not a true server-side protected resource**. Anyone who deliberately disables JavaScript or retrieves the public page source may still reach static content.

For strong protection, the Member Area should be served behind a domain you control and an edge/server gate. Recommended next phase:

- Use a custom member subdomain, e.g. `member.<your-domain>`.
- Put it behind Cloudflare.
- Validate the Skill Fusion session at the edge and store the authenticated session in an `HttpOnly; Secure; SameSite` cookie.
- Do not leave a separate public Framer origin containing the protected content.

Cloudflare is therefore recommended for the final anti-copy / anti-bypass requirement.

## Session rules

- Login requires a valid Google ID token whose audience matches `SF_GOOGLE_CLIENT_ID`.
- Email must be Google-verified.
- Unknown email → user must Register.
- Register → `PENDING` + owner notification email.
- `ACTIVE` → login allowed.
- `SUSPENDED` → login denied and active sessions are invalidated.
- Remove → member row is deleted and sessions are invalidated.
- Session expires after 10 minutes without user activity.
- Admin dashboard considers a user online when the session heartbeat is recent (90 seconds).
