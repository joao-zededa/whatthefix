// Minimal SPA PKCE example using Authorization Code + PKCE with Okta
// Note: For real apps, prefer a maintained OIDC client library. This is illustrative.

(async () => {
  const oktaDomain = window.OKTA_ISSUER; // Set via inline script in HTML or bundler
  const clientId = window.OKTA_CLIENT_ID;
  const redirectUri = window.OKTA_REDIRECT_URI;
  const scope = window.OKTA_SCOPES || 'openid profile email';

  function base64UrlEncode(buffer) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function sha256(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
  }

  function randomString(length = 43) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) result += charset[randomValues[i] % charset.length];
    return result;
  }

  async function login() {
    const state = randomString(16);
    const nonce = randomString(16);
    const codeVerifier = randomString(64);
    const codeChallenge = await sha256(codeVerifier);
    sessionStorage.setItem('pkce_state', state);
    sessionStorage.setItem('pkce_nonce', nonce);
    sessionStorage.setItem('pkce_verifier', codeVerifier);
    const url = new URL(`${oktaDomain}/v1/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', scope);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    window.location.assign(url.toString());
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return null;
    const expectedState = sessionStorage.getItem('pkce_state');
    if (state !== expectedState) throw new Error('Invalid state');
    const codeVerifier = sessionStorage.getItem('pkce_verifier');
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', clientId);
    body.set('redirect_uri', redirectUri);
    body.set('code', code);
    body.set('code_verifier', codeVerifier);
    const tokenRes = await fetch(`${oktaDomain}/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenSet = await tokenRes.json();
    // Store only in memory (sessionStorage); avoid localStorage
    sessionStorage.setItem('access_token', tokenSet.access_token);
    sessionStorage.setItem('id_token', tokenSet.id_token);
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, document.title, url.toString());
    return tokenSet;
  }

  async function callProtected() {
    const token = sessionStorage.getItem('access_token');
    if (!token) throw new Error('Not authenticated');
    const res = await fetch('/auth/validate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  }

  window.SPA_PKCE = { login, handleCallback, callProtected };
})();


