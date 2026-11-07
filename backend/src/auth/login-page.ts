const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export interface LoginFormValues {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  email?: string;
  error?: string;
}

export function renderLoginPage(values: LoginFormValues): string {
  const error = values.error
    ? `<p class="error" role="alert" data-testid="error-banner">${escapeHtml(values.error)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MedApp — Sign in</title>
<style>
  body { font-family: system-ui, sans-serif; background:#f4f6f8; margin:0; display:flex; min-height:100vh; align-items:center; justify-content:center; }
  main { background:#fff; padding:2rem; border-radius:12px; box-shadow:0 10px 30px rgba(15,23,42,.12); width:min(380px, 92vw); }
  h1 { font-size:1.25rem; margin:0 0 .25rem; color:#0f172a; }
  p.hint { color:#475569; font-size:.875rem; margin:0 0 1rem; }
  label { display:block; font-size:.8rem; color:#334155; margin:.75rem 0 .25rem; font-weight:600; }
  input { width:100%; box-sizing:border-box; padding:.6rem .7rem; border:1px solid #cbd5e1; border-radius:8px; font-size:.95rem; }
  button { width:100%; margin-top:1.25rem; padding:.7rem; border:0; border-radius:8px; background:#1d4ed8; color:#fff; font-size:.95rem; font-weight:600; cursor:pointer; }
  .error { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:.6rem .75rem; border-radius:8px; font-size:.85rem; }
</style>
</head>
<body>
<main>
  <h1>MedApp</h1>
  <p class="hint">Sign in to continue to the clinical portal.</p>
  ${error}
  <form method="post" action="/auth/login" autocomplete="on">
    <input type="hidden" name="client_id" value="${escapeHtml(values.clientId)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(values.redirectUri)}" />
    <input type="hidden" name="code_challenge" value="${escapeHtml(values.codeChallenge)}" />
    <input type="hidden" name="state" value="${escapeHtml(values.state)}" />
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required autocomplete="username" data-testid="login-email" value="${escapeHtml(values.email ?? '')}" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" data-testid="login-password" />
    <button type="submit" data-testid="login-submit">Sign in</button>
  </form>
</main>
</body>
</html>`;
}
