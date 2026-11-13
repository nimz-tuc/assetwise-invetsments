// Shared helpers: API client, formatting, icons, toasts. Everything else hangs off window.AW.
(() => {
  const TOKEN_KEY = 'assetwise_token';
    // Using a separate front-end tunnel (Live Server on 5500)? Put your BACKEND tunnel address here.
  // Leave it '' when you open the site from the backend address itself.
  const API_OVERRIDE = '';
  const API_BASE = API_OVERRIDE ? API_OVERRIDE.replace(/\/$/, '') + '/api'
    : location.port === '5500' ? `http://${location.hostname}:5000/api` : '/api';
  const AW = window.AW = {
    cfg: null, user: null, currency: 'USD', loaders: {}, leavers: {}, timers: {},
    getToken: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
    setToken: t => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} },
    onUnauthorized: () => {},
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  AW.$ = $; AW.$$ = $$;

  AW.esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  AW.api = async (path, { method = 'GET', body } = {}) => {
    const token = AW.getToken();
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try { res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('Cannot reach the AssetWise server. Check your connection and try again.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && path !== '/login') AW.onUnauthorized();
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status}).`);
    return data;
  };

  AW.money = n => `${AW.currency} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  AW.num = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  AW.pct = (n, d = 1) => `${Number(n) >= 0 ? '+' : ''}${Number(n || 0).toFixed(d)}%`;
  AW.date = v => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  AW.dateTime = v => {
    const d = new Date(v);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' – ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };
  AW.time = v => new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  AW.initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'AW';
  AW.METHOD = { paystack: 'Card (Paystack)', paypal: 'PayPal', mpesa: 'M-Pesa', usdt_trc20: 'USDT (TRC20)', usdc_erc20: 'USDC (ERC20)', usdt_erc20: 'USDT (ERC20)', wallet: 'Wallet' };

  AW.toast = (message, isError = false) => {
    const el = $('#toast'); el.textContent = message; el.classList.toggle('error', isError); el.classList.add('show');
    clearTimeout(AW.timers.toast); AW.timers.toast = setTimeout(() => el.classList.remove('show'), isError ? 4500 : 3000);
  };

  const ICONS = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    deposit: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 9v6M9 12.5l3 3 3-3"/>',
    withdraw: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 15V9M9 11.5l3-3 3 3"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14a5 5 0 0 1 4.5 5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    support: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M20 20c0 1.5-2 2-5 2"/>',
    logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    payments: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  };
  AW.icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  AW.hydrateIcons = (root = document) => $$('svg[data-icon]', root).forEach(s => { s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[s.dataset.icon] || ''; });

  AW.copy = async (text, okMsg = 'Copied.') => {
    try { await navigator.clipboard.writeText(text); AW.toast(okMsg); }
    catch { AW.toast('Copy failed. Select the text and copy it manually.', true); }
  };

  AW.hydrateIcons();
})();
