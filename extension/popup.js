// extension/popup.js
// Captures the user's existing Surfer/Frase session cookies from this Chrome
// profile and forwards them to the WP Publisher dashboard for use in
// server-side extraction. Nothing is sent anywhere except your own dashboard.

const SOURCES = {
  surfer: { domains: ['.surferseo.com', 'app.surferseo.com', 'surferseo.com'], label: 'Surfer SEO' },
  frase: { domains: ['.frase.io', 'app.frase.io', 'frase.io'], label: 'Frase' },
};

const els = {
  projectName: document.getElementById('project-name'),
  projectHint: document.getElementById('project-hint'),
  surferStatus: document.getElementById('surfer-status'),
  fraseStatus: document.getElementById('frase-status'),
  connectSurfer: document.getElementById('connect-surfer'),
  connectFrase: document.getElementById('connect-frase'),
  toast: document.getElementById('toast'),
  appUrl: document.getElementById('app-url'),
  saveUrl: document.getElementById('save-url'),
};

let state = {
  appUrl: 'http://localhost:3030',
  projectId: null,
};

init();

async function init() {
  const stored = await chrome.storage.local.get(['appUrl']);
  if (stored.appUrl) state.appUrl = stored.appUrl;
  els.appUrl.value = state.appUrl;

  // Detect active project from the current tab if it's the dashboard.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.projectId = parseProjectId(tab?.url, state.appUrl);
  renderProject();

  if (state.projectId) {
    await refreshStatus();
    els.connectSurfer.disabled = false;
    els.connectFrase.disabled = false;
  }

  els.connectSurfer.addEventListener('click', () => connect('surfer'));
  els.connectFrase.addEventListener('click', () => connect('frase'));
  els.saveUrl.addEventListener('click', saveAppUrl);
}

function parseProjectId(url, appUrl) {
  if (!url || !appUrl) return null;
  try {
    const u = new URL(url);
    const base = new URL(appUrl);
    if (u.host !== base.host) return null;
    const m = u.pathname.match(/^\/wp-publisher\/([^/]+)\/?$/);
    if (!m) return null;
    const id = m[1];
    // Exclude reserved static segments
    if (['edit', 'logs', 'new'].includes(id)) return null;
    return id;
  } catch {
    return null;
  }
}

function renderProject() {
  if (state.projectId) {
    els.projectName.textContent = state.projectId;
    els.projectHint.textContent = 'Captured cookies will be saved to this project.';
  } else {
    els.projectName.textContent = 'No project selected';
    els.projectHint.innerHTML =
      'Open a project page in the dashboard, then click the extension. ' +
      `<br/>Expected URL: <code>${state.appUrl}/wp-publisher/{project-id}</code>`;
    document.getElementById('project-card').classList.add('warn');
  }
}

async function refreshStatus() {
  try {
    const res = await fetch(`${state.appUrl}/api/projects/${state.projectId}/connector`, {
      credentials: 'include',
    });
    if (res.status === 401) {
      setStatus('surfer', 'Sign in to the dashboard first', 'err');
      setStatus('frase', 'Sign in to the dashboard first', 'err');
      return;
    }
    if (!res.ok) {
      setStatus('surfer', 'Status check failed', 'err');
      setStatus('frase', 'Status check failed', 'err');
      return;
    }
    const data = await res.json();
    renderSourceStatus('surfer', data.surfer);
    renderSourceStatus('frase', data.frase);
  } catch (e) {
    setStatus('surfer', 'Cannot reach dashboard', 'err');
    setStatus('frase', 'Cannot reach dashboard', 'err');
  }
}

function renderSourceStatus(source, info) {
  if (!info?.connected) {
    setStatus(source, 'Not connected', 'miss');
    return;
  }
  const ageMin = info.ageSeconds ? Math.floor(info.ageSeconds / 60) : 0;
  const ageText =
    ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
  setStatus(source, `Connected · last refreshed ${ageText}`, 'ok');
}

function setStatus(source, text, tone) {
  const el = source === 'surfer' ? els.surferStatus : els.fraseStatus;
  el.textContent = text;
  el.className = 'status ' + (tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : 'miss');
}

async function connect(source) {
  if (!state.projectId) return;
  const btn = source === 'surfer' ? els.connectSurfer : els.connectFrase;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    const cookies = await collectCookies(SOURCES[source].domains);
    if (!cookies.length) {
      throw new Error(`No ${SOURCES[source].label} cookies found. Make sure you're logged in to ${SOURCES[source].label} in this Chrome profile, then try again.`);
    }
    const res = await fetch(
      `${state.appUrl}/api/projects/${state.projectId}/connector?source=${source}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies }),
      }
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast(`${SOURCES[source].label} connected.`, 'ok');
    await refreshStatus();
  } catch (e) {
    toast(`Failed: ${e.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function collectCookies(domains) {
  const seen = new Map();
  for (const d of domains) {
    const list = await chrome.cookies.getAll({ domain: d });
    for (const c of list) {
      const key = `${c.domain}|${c.path}|${c.name}`;
      seen.set(key, {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
      });
    }
  }
  return [...seen.values()];
}

function toast(msg, tone) {
  els.toast.textContent = msg;
  els.toast.className = 'toast ' + (tone === 'ok' ? 'ok' : 'err');
  els.toast.style.display = 'block';
  setTimeout(() => { els.toast.style.display = 'none'; }, 4000);
}

async function saveAppUrl() {
  const v = (els.appUrl.value || '').trim().replace(/\/+$/, '');
  if (!v) return;
  try {
    new URL(v);
  } catch {
    toast('Invalid URL', 'err');
    return;
  }
  // Request optional permission for this origin if not already granted.
  const granted = await chrome.permissions.request({ origins: [`${v}/*`] });
  if (!granted) {
    toast('Permission for that origin was denied.', 'err');
    return;
  }
  state.appUrl = v;
  await chrome.storage.local.set({ appUrl: v });
  toast('App URL saved. Reopen the popup on the project page.', 'ok');
}
