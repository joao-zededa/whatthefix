Okta OIDC SSO Integration Guide

Overview
- Production-ready Okta SSO using OpenID Connect.
- Backend: Authorization Code flow with PKCE, secure sessions, refresh rotation, RBAC.
- SPA example: PKCE with in-memory storage; token validation endpoint.

Okta admin configuration
1) Create app integration
   - Type: OIDC - Web (for backend) with Authorization Code + PKCE
   - Sign-in redirect URIs: `${BASE_URL}/auth/callback`
   - Sign-out redirect URIs: `${BASE_URL}/`
   - Assign users/groups to the app
2) Add custom claims (optional)
   - Claim name: `groups` (or use built-in)
   - Include in: ID token
   - Value: Groups expression or regex (e.g., `startsWith("App-")`)
3) Scopes
   - `openid profile email groups offline_access`
4) CORS
   - Add your frontend origin(s) to Okta Trusted Origins (CORS) if SPA will call Okta APIs directly.

Environment configuration
- Copy `.env.example` to `.env` and set values per environment.
- Local: `BASE_URL=http://localhost:3000`, `SECURE_COOKIES=false`, `TRUST_PROXY=false`.
- Staging/Prod: use your domain, set `SECURE_COOKIES=true`, `TRUST_PROXY=true` if behind proxy, strong `SESSION_SECRET`.

Routes added
- `GET /auth/login`: start OIDC login (state, nonce, PKCE, redirect)
- `GET /auth/callback`: validate state/nonce, exchange code, set session, map groups->roles
- `GET /auth/me`: current session profile (no tokens)
- `POST /auth/refresh`: refresh token rotation
- `GET /auth/logout`: Okta + local logout
- `POST /auth/validate`: validate bearer access token (for SPA PKCE)
- `GET /api/protected`: protected example, requires role `admin` or `editor`

Security best practices
- State and nonce validated
- HTTP-only, SameSite cookies; secure cookies in prod
- No tokens in localStorage; session only stores refresh token server-side
- Token validation for SPA through `/auth/validate` checks iss/aud/exp/nbf via JWKS
- Refresh token rotation honored when Okta returns new refresh token

RBAC mapping
- Configure `OKTA_GROUP_ROLE_MAP`, e.g. `admin:App-Admins|SuperUsers,editor:Editors`
- Middleware `requireRole('admin')` guards endpoints

SPA PKCE example
- `public/pkce-spa.js` exposes `SPA_PKCE.login()` and `SPA_PKCE.handleCallback()`.
- Tokens are stored in `sessionStorage` (not persistent). Use `/auth/validate` to check.

Google OIDC (optional)
- Create OAuth 2.0 Client ID (Web) in Google Cloud Console.
- Authorized redirect URI: `${BASE_URL}/auth/google/callback`.
- Env vars:
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_SCOPES=openid profile email offline_access
GOOGLE_POST_LOGOUT_REDIRECT_URI=
```
- Login URL: `/auth/google/login` (button added in the header). Claims `email` and `hd` can be mapped to roles via `GOOGLE_EMAIL_ROLE_MAP` and `GOOGLE_HD_ROLE_MAP`.

Sequence diagrams

Login (Auth Code + PKCE)
```text
User -> Frontend: Click Login
Frontend -> Backend: GET /auth/login
Backend -> Okta: Authorization Request (state, nonce, code_challenge)
Okta -> Backend: Redirect with code + state
Backend -> Okta: Token Request (code + code_verifier)
Okta -> Backend: id_token, access_token, refresh_token
Backend -> Session: create user session (no tokens to client)
Backend -> Frontend: 302 /
```

Token refresh
```text
Frontend -> Backend: POST /auth/refresh (cookie)
Backend -> Okta: Refresh Token grant
Okta -> Backend: new access/refresh (rotated)
Backend -> Session: update refresh token
Backend -> Frontend: 200 {expires_at}
```

Logout
```text
Frontend -> Backend: GET /auth/logout
Backend -> Okta: End Session (id_token_hint, post_logout_redirect_uri)
Okta -> Frontend: 302 /
```

Silent renew (SPA)
```text
Frontend -> Okta: refresh via iframe or hidden window using prompt=none (library-specific)
Okta -> Frontend: returns new tokens if session valid
Frontend -> Backend: POST /auth/validate (optional)
```

Troubleshooting
- invalid_client: Check `OKTA_CLIENT_ID/SECRET` and app type (Web)
- invalid_grant: Code reused or verifier mismatch; ensure same code_verifier and redirect URI
- state mismatch: Same-site cookie, domain, or session misconfig; verify `sameSite` and proxy settings
- nonce mismatch: Clock skew or token replay; ensure single callback per auth
- CORS errors: add origins to Okta Trusted Origins and server CORS `CORS_ORIGIN`
- 401 on protected: session missing or role mapping incorrect; confirm `OKTA_GROUP_ROLE_MAP`

Run locally
1) `cp .env.example .env` and fill values
2) `npm install`
3) `npm run dev`
4) Visit `http://localhost:3000`, click Login

Deploy
- Provide environment variables via secret manager
- Ensure HTTPS and `SECURE_COOKIES=true`, `TRUST_PROXY=true`
- Configure Okta redirect/sign-out URIs to your domain

Tests
- `jest` and `supertest` used; see `tests/auth.test.js`


