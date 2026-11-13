// Customer-facing pages. All data comes from the API; nothing here is mocked.
(() => {
  const { $, $$, esc, api, money, icon } = AW;
  let packages = [], summary = null, currentPage = 'dashboard', depositMethod = 'usdt_trc20', txCache = [], perfPoints = [];
  const chatSeen = new Set(); let chatLast = 0;
  // Paystack sends the customer back to the site with ?reference=... after they pay.
  const returnRef = (() => { const q = new URLSearchParams(location.search); return q.get('reference') || q.get('trxref') || ''; })();
  // PayPal sends the customer back with ?pp=return&token=ORDER_ID (or ?pp=cancel if they backed out).
  const paypalReturn = (() => { const q = new URLSearchParams(location.search); return q.get('pp') ? { state: q.get('pp'), order: q.get('token') || '' } : null; })();

  const rate = r => String(Number(r));
  const amountOf = v => String(v || '').replace(/[,\s]/g, '');
  const badge = s => `<span class="badge ${esc(s)}">${esc(s.charAt(0).toUpperCase() + s.slice(1))}</span>`;
  const thumb = k => `<i class="${esc(k || 'none')}"></i>`;
  const busy = async (btn, fn) => { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } };

  /* ---------------- navigation ---------------- */
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }
  function showPage(page) {
    if (page.startsWith('admin-') && (!AW.user || AW.user.role !== 'admin')) return;
    if (AW.leavers[currentPage]) AW.leavers[currentPage]();
    currentPage = page;
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    $$('.nav-link[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    closeSidebar(); window.scrollTo({ top: 0 });
    if (AW.loaders[page]) AW.loaders[page]().catch(e => AW.toast(e.message, true));
  }
  AW.showPage = showPage;
  AW.currentPage = () => currentPage;

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-page]');
    if (nav) { e.preventDefault(); showPage(nav.dataset.page); }
    const inv = e.target.closest('[data-invest]');
    if (inv) openInvest(inv.dataset.invest);
    const fund = e.target.closest('[data-fund]');
    if (fund) { depositMethod = fund.dataset.fund; showPage('deposit'); }
  });
  $('#mobileMenu').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#scrim').classList.toggle('show'); });
  $('#scrim').addEventListener('click', closeSidebar);

  /* ---------------- packages ---------------- */
  async function loadPackages() { packages = (await api('/packages')).packages; }
  const pkgCard = p => `<article class="pkg">
    <div class="pkg-img ${esc(p.image_key || 'none')}">${p.is_popular ? '<span class="tag">Popular</span>' : ''}</div>
    <div class="pkg-body"><h3>${esc(p.name)}</h3>
      <div class="pkg-ret"><strong>${rate(p.projected_return_rate)}%</strong><span>Expected Return<br>(${p.duration_days} Days)</span></div>
      <ul><li><i>${icon('check')}</i>Min: ${AW.currency} ${AW.num(p.minimum_amount)}</li>
          <li><i>${icon('check')}</i>Max: ${p.maximum_amount === null ? 'No limit' : AW.currency + ' ' + AW.num(p.maximum_amount)}</li>
          <li><i>${icon('check')}</i>Paid at maturity</li></ul>
      <button class="btn btn-gold" data-invest="${esc(p.id)}">Invest Now ${icon('arrow')}</button></div></article>`;
  const renderPackages = () => {
    const html = packages.length ? packages.map(pkgCard).join('') : '<p class="empty-note">No packages are open right now.</p>';
    $('#dashboardPackages').innerHTML = html; $('#marketPackages').innerHTML = html;
  };

  /* ---------------- transactions rendering ---------------- */
  const txLabel = t => t.type === 'deposit' ? `Deposit via ${AW.METHOD[t.method] || t.method}`
    : t.type === 'withdrawal' ? `Withdrawal to ${AW.METHOD[t.method] || t.method}`
    : t.type === 'investment' ? `Investment: ${(t.note || '').replace(/ investment$/, '')}` : (t.note || 'Payout');
  const txRow = t => {
    const pos = Number(t.amount) > 0;
    const cls = t.status === 'pending' ? 'pending' : (t.status === 'rejected' || t.status === 'failed') ? 'bad' : pos ? '' : 'out';
    return `<div class="act"><span class="act-ic ${cls}">${icon(pos ? 'down' : 'up')}</span>
      <div class="act-copy"><b>${esc(txLabel(t))}</b><small>${esc(AW.dateTime(t.created_at))}</small></div>
      <span class="act-amt ${pos ? 'positive' : 'negative'}">${pos ? '+' : '-'}${esc(money(Math.abs(t.amount)))}${t.status !== 'completed' ? `<small class="${t.status === 'pending' ? '' : 'negative'}">${esc(t.status)}</small>` : ''}</span></div>`;
  };
  const emptyAct = msg => `<p class="empty-note">${msg}</p>`;

  /* ---------------- dashboard ---------------- */
  async function refreshSummary() {
    summary = await api('/dashboard');
    $('#topBalance').textContent = money(summary.balance);
    $('#topPortfolio').textContent = money(summary.portfolio_value);
    $('#statBalance').textContent = money(summary.balance);
    $('#statEarnings').textContent = money(summary.total_earnings);
    $('#statEarningsPct').textContent = AW.pct(summary.earnings_pct).replace('+', '');
    $('#statActive').textContent = summary.active_count;
    $('#withdrawBalance').textContent = money(summary.balance);
    $('#dashInvestments').innerHTML = summary.active_investments.length ? summary.active_investments.map(i => {
      const pct = Number(i.amount) ? (Number(i.profit_so_far) / Number(i.amount)) * 100 : 0;
      return `<tr><td><span class="pk">${thumb(i.image_key)}${esc(i.package_name)}</span></td><td>${money(i.amount)}</td><td>${money(i.current_value)}</td>
        <td class="positive">${AW.pct(pct)} <small class="hint">of ${rate(i.return_rate)}%</small></td><td>${esc(AW.date(i.matures_at))}</td><td>${badge('active')}</td></tr>`;
    }).join('') : `<tr><td colspan="6" class="empty">You have no active investments yet. Pick a package below to get started.</td></tr>`;
    $('#recentTransactions').innerHTML = summary.recent_transactions.length ? summary.recent_transactions.map(txRow).join('') : emptyAct('No transactions yet. Make your first deposit to begin.');
    setBadge('#navSupportCount', currentPage === 'support' ? 0 : summary.unread_support);
    if (!AW.user || AW.user.role !== 'admin') setBadge('#bellCount', currentPage === 'support' ? 0 : summary.unread_support);
  }
  AW.refreshSummary = refreshSummary;
  function setBadge(sel, n) { const el = $(sel); el.textContent = n > 99 ? '99+' : n; el.hidden = !n; }

  function drawChart() {
    const el = $('#perfChart'), pts = perfPoints;
    if (!pts.length || !pts.some(p => p.invested > 0)) {
      el.innerHTML = '<div class="empty">Your performance chart appears here after your first investment.</div>'; return;
    }
    const vals = pts.map(p => p.pct), maxV = Math.max(5, Math.ceil(Math.max(...vals) / 5) * 5);
    const W = Math.max(el.clientWidth - 44, 200), H = 140, pad = 6;
    const X = i => pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * (W - 12) + 6;
    const Y = v => H - pad - (v / maxV) * (H - pad * 2);
    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const step = Math.ceil(pts.length / 10);
    const dots = vals.map((v, i) => (i % step === 0 || i === vals.length - 1) ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4.5" fill="#6be58a" stroke="#0a2a1b" stroke-width="2"/>` : '').join('');
    const grid = [0, 1, 2, 3, 4].map(k => `<line x1="0" x2="${W}" y1="${(pad + k * (H - pad * 2) / 4).toFixed(1)}" y2="${(pad + k * (H - pad * 2) / 4).toFixed(1)}" stroke="#ffffff14"/>`).join('');
    const labels = [4, 3, 2, 1, 0].map(k => `<span>${(maxV * k / 4).toFixed(maxV % 4 ? 1 : 0).replace(/\.0$/, '')}%</span>`).join('');
    el.innerHTML = `<div class="y">${labels}</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Portfolio return over time">
      <defs><linearGradient id="pf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5be07c" stop-opacity=".35"/><stop offset="1" stop-color="#5be07c" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${line} L${X(vals.length - 1).toFixed(1)} ${H - pad} L${X(0).toFixed(1)} ${H - pad}Z" fill="url(#pf)"/>
      <path d="${line}" fill="none" stroke="#4fd36b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
  }
  async function loadPerformance() {
    const r = await api('/performance?days=' + $('#chartRange').value);
    perfPoints = r.points; $('#perfPct').textContent = AW.pct(r.latest_pct); drawChart();
  }
  $('#chartRange').addEventListener('change', () => loadPerformance().catch(e => AW.toast(e.message, true)));
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => currentPage === 'dashboard' && drawChart(), 150); });

  AW.loaders.dashboard = async () => { await loadPackages(); renderPackages(); await Promise.all([refreshSummary(), loadPerformance()]); };

  /* ---------------- investments ---------------- */
  async function loadInvestments() {
    await loadPackages(); renderPackages();
    const all = (await api('/investments')).investments;
    const active = all.filter(i => i.status === 'active');
    $('#invCapital').textContent = money(active.reduce((s, i) => s + Number(i.amount), 0));
    $('#invValue').textContent = money(active.reduce((s, i) => s + Number(i.current_value), 0));
    $('#invEarnings').textContent = money(all.reduce((s, i) => s + Number(i.profit_so_far), 0));
    const f = $('#invFilter').value, rows = f ? all.filter(i => i.status === f) : all;
    $('#invRows').innerHTML = rows.length ? rows.map(i => `<tr><td><span class="pk">${thumb(i.image_key)}${esc(i.package_name)}</span></td><td>${esc(AW.date(i.started_at))}</td>
      <td>${money(i.amount)}</td><td>${money(i.current_value)}</td><td class="positive">+${money(i.profit_so_far)}</td><td>${esc(AW.date(i.matures_at))}</td><td>${badge(i.status)}</td></tr>`).join('')
      : `<tr><td colspan="7" class="empty">Nothing here yet.</td></tr>`;
    refreshSummary();
  }
  AW.loaders.investments = loadInvestments;
  $('#invFilter').addEventListener('change', () => loadInvestments().catch(e => AW.toast(e.message, true)));

  /* ---- invest modal ---- */
  let modalPkg = null;
  function openInvest(id) {
    modalPkg = packages.find(p => String(p.id) === String(id)); if (!modalPkg) return;
    const p = modalPkg;
    $('#modalTitle').textContent = 'Invest in ' + p.name;
    $('#investSummary').innerHTML = `<div><small>Expected return</small><b>${rate(p.projected_return_rate)}%</b></div><div><small>Term</small><b>${p.duration_days} days</b></div>
      <div><small>Minimum</small><b>${AW.num(p.minimum_amount)}</b></div><div><small>Wallet balance</small><b>${money(summary ? summary.balance : 0)}</b></div>`;
    $('#investAmount').value = ''; updatePreview(); $('#modalBackdrop').classList.add('show'); setTimeout(() => $('#investAmount').focus(), 50);
  }
  function updatePreview() {
    const p = modalPkg, v = amountOf($('#investAmount').value), box = $('#investPreview');
    if (!p || !/^\d+(\.\d{1,2})?$/.test(v) || !(Number(v) > 0)) { box.innerHTML = '<small class="hint">Enter an amount to see your expected return.</small>'; return; }
    const amt = Number(v), profit = Math.round(amt * Number(p.projected_return_rate)) / 100, end = new Date(Date.now() + p.duration_days * 864e5);
    box.innerHTML = `<div><span>Expected return</span><b>+${money(profit)}</b></div><div><span>Total paid at maturity</span><b>${money(amt + profit)}</b></div><div><span>Maturity date</span><b>${esc(AW.date(end))}</b></div>`;
  }
  $('#investAmount').addEventListener('input', updatePreview);
  const closeModal = () => $('#modalBackdrop').classList.remove('show');
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('#investForm').addEventListener('submit', async e => {
    e.preventDefault();
    await busy($('#investSubmit'), async () => {
      try {
        const r = await api('/investments', { method: 'POST', body: { package_id: modalPkg.id, amount: amountOf($('#investAmount').value) } });
        closeModal(); AW.toast(`Investment created. It matures on ${AW.date(r.investment.matures_at)}.`);
        await refreshSummary(); if (currentPage === 'investments') loadInvestments(); if (currentPage === 'dashboard') loadPerformance();
      } catch (err) { AW.toast(err.message, true); }
    });
  });

  /* ---------------- deposit ---------------- */
  function renderDeposit() {
    $$('#depositTabs button').forEach(b => b.classList.toggle('selected', b.dataset.method === depositMethod));
    const pay = AW.cfg.pay, box = $('#depositInstructions'), m = depositMethod;
    $('#depositRefLabel').textContent = 'Transaction hash (TXID)';
    $('#depositRef').placeholder = 'Paste the transaction hash';
    let ready = true;
    const online = m === 'paystack' || m === 'paypal';
    $('#depositRefWrap').hidden = online; $('#depositRef').required = !online;
    $('#depositSubmit').textContent = m === 'paypal' ? 'Pay with PayPal' : m === 'paystack' ? 'Continue to secure payment' : 'Submit deposit';
    $('#depositSubmit').classList.toggle('btn-paypal', m === 'paypal'); $('#depositSubmit').classList.toggle('btn-gold', m !== 'paypal');
    $('#depositHint').textContent = m === 'paypal' ? 'You will be taken to PayPal to pay, then returned here. Your wallet is credited automatically.'
      : m === 'paystack' ? 'You will be taken to Paystack to pay by card, then returned here. Your wallet is credited automatically.' : 'Only submit a payment you have already made. Each hash can be used once.';
    $('#depositHint').textContent += ` Deposits: ${AW.currency} ${AW.num(AW.cfg.min_deposit)} – ${AW.currency} ${AW.num(AW.cfg.max_deposit)}.`;
    if (m === 'paystack') {
      if (!AW.cfg.paystack.enabled) { ready = false; box.innerHTML = '<div class="warn">Online payments are not set up yet. Use another method or contact support.</div>'; }
      else box.innerHTML = '<div class="grow"><b>Pay instantly by card</b><ol><li>Enter the amount below and continue.</li><li>On the secure Paystack page, enter your card details.</li><li>You return here and your wallet is credited automatically.</li></ol></div>';
    } else if (m === 'paypal') {
      if (!AW.cfg.paypal.enabled) { ready = false; box.innerHTML = '<div class="warn">PayPal payments are not set up yet. Use another method or contact support.</div>'; }
      else box.innerHTML = '<div class="grow"><b>Pay with your PayPal account</b><ol><li>Enter the amount below and click Pay with PayPal.</li><li>Log in to PayPal (or pay by card as a PayPal guest if offered) and approve the payment.</li><li>You return here and your wallet is credited automatically.</li></ol></div>';
    } else {
      const addr = pay[m].address, net = m === 'usdt_trc20' ? 'TRON (TRC20)' : 'Ethereum (ERC20)', coin = m === 'usdt_trc20' ? 'USDT' : 'USDC';
      if (!addr) { ready = false; box.innerHTML = `<div class="warn">The ${esc(coin)} (${esc(net)}) deposit address has not been set up yet. Please contact support before sending any money.</div>`; }
      else {
        box.innerHTML = `<div class="grow"><b>Send ${esc(coin)} on the ${esc(net)} network only</b>
          <div class="addr"><code>${esc(addr)}</code><button type="button" class="btn btn-outline btn-sm" id="copyAddr">Copy</button></div>
          <p class="hint">Sending on any other network can result in permanent loss of funds. After sending, paste the transaction hash below.</p></div>`;
        $('#copyAddr').addEventListener('click', () => AW.copy(addr, 'Address copied.'));
      }
    }
    $('#depositForm button[type=submit]').disabled = !ready;
  }
  async function loadDeposit() {
    renderDeposit();
    const r = await api('/transactions?type=deposit&limit=20');
    $('#depositHistory').innerHTML = r.transactions.length ? r.transactions.map(txRow).join('') : emptyAct('Your deposits will appear here.');
  }
  AW.loaders.deposit = loadDeposit;
  $('#depositTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { depositMethod = b.dataset.method; renderDeposit(); } });
  $('#depositForm').addEventListener('submit', async e => {
    e.preventDefault();
    await busy($('#depositForm button[type=submit]'), async () => {
      try {
        if (depositMethod === 'paystack') {
          const p = await api('/deposits/paystack', { method: 'POST', body: { amount: amountOf($('#depositAmount').value) } });
          if (!/^https:\/\//.test(p.authorization_url)) throw new Error('Unexpected response from the payment provider.');
          location.href = p.authorization_url; return;
        }
        if (depositMethod === 'paypal') {
          const p = await api('/deposits/paypal', { method: 'POST', body: { amount: amountOf($('#depositAmount').value) } });
          if (!/^https:\/\/([a-z0-9-]+\.)*paypal\.com\//i.test(p.approve_url)) throw new Error('Unexpected response from the payment provider.');
          location.href = p.approve_url; return;
        }
        const r = await api('/deposits', { method: 'POST', body: { method: depositMethod, amount: amountOf($('#depositAmount').value), reference: $('#depositRef').value.trim() } });
        AW.toast(r.message); $('#depositAmount').value = ''; $('#depositRef').value = ''; loadDeposit(); refreshSummary();
      } catch (err) { AW.toast(err.message, true); }
    });
  });

  /* ---------------- withdraw ---------------- */
  function renderWithdrawForm() {
    const m = $('#withdrawMethod').value;
    $('#withdrawDestLabel').textContent = m === 'paypal' ? 'PayPal email address' : m === 'usdt_trc20' ? 'TRON (TRC20) wallet address' : 'Ethereum (ERC20) wallet address (USDC)';
    $('#withdrawDest').placeholder = m === 'paypal' ? 'you@example.com' : m === 'usdt_trc20' ? 'T...' : '0x...';
    $('#withdrawDest').type = m === 'paypal' ? 'email' : 'text'; $('#withdrawDest').inputMode = m === 'paypal' ? 'email' : 'text';
    $('#withdrawHint').textContent = m === 'paypal' ? 'Use the email of the PayPal account that should receive the money. Double-check it: payments to a wrong address cannot be recovered. The amount is reserved in your wallet while we process the request; if declined it is returned.'
      : 'The amount is reserved in your wallet while we process the request. If a request is declined it is returned to your wallet.';
  }
  AW.loaders.withdraw = async () => {
    renderWithdrawForm();
    const [, r] = await Promise.all([refreshSummary(), api('/transactions?type=withdrawal&limit=20')]);
    $('#withdrawHistory').innerHTML = r.transactions.length ? r.transactions.map(txRow).join('') : emptyAct('Your withdrawals will appear here.');
  };
  $('#withdrawMethod').addEventListener('change', renderWithdrawForm);
  $('#withdrawForm').addEventListener('submit', async e => {
    e.preventDefault();
    await busy($('#withdrawForm button[type=submit]'), async () => {
      try {
        const r = await api('/withdrawals', { method: 'POST', body: { method: $('#withdrawMethod').value, destination: $('#withdrawDest').value.trim(), amount: amountOf($('#withdrawAmount').value) } });
        AW.toast(r.message); $('#withdrawAmount').value = ''; AW.loaders.withdraw();
      } catch (err) { AW.toast(err.message, true); }
    });
  });

  /* ---------------- transactions ---------------- */
  async function loadTransactions() {
    const r = await api('/transactions?limit=500&type=' + encodeURIComponent($('#transactionFilter').value));
    txCache = r.transactions;
    $('#transactionRows').innerHTML = txCache.length ? txCache.map(t => `<tr><td>${esc(t.public_ref)}</td><td>${esc(txLabel(t))}</td><td>${esc(AW.dateTime(t.created_at))}</td>
      <td>${esc(AW.METHOD[t.method] || '—')}</td><td class="${Number(t.amount) > 0 ? 'positive' : 'negative'}">${Number(t.amount) > 0 ? '+' : '-'}${money(Math.abs(t.amount))}</td><td>${badge(t.status)}</td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">No transactions found.</td></tr>`;
  }
  AW.loaders.transactions = loadTransactions;
  $('#transactionFilter').addEventListener('change', () => loadTransactions().catch(e => AW.toast(e.message, true)));
  $('#exportTransactions').addEventListener('click', () => {
    if (!txCache.length) return AW.toast('There are no transactions to export.', true);
    const text = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    const rows = [['Reference', 'Type', 'Date', 'Method', 'Amount (' + AW.currency + ')', 'Status'].map(text).join(','),
      ...txCache.map(t => [text(t.public_ref), text(txLabel(t)), text(new Date(t.created_at).toISOString()), text(AW.METHOD[t.method] || ''), Number(t.amount).toFixed(2), text(t.status)].join(','))];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'assetwise-transactions.csv'; a.click(); URL.revokeObjectURL(url);
  });

  /* ---------------- referrals ---------------- */
  AW.loaders.referrals = async () => {
    const r = await api('/referrals');
    $('#refCode').textContent = r.code; $('#refLink').value = `${location.origin}/?ref=${r.code}`; $('#refCount').textContent = r.count;
    $('#refList').innerHTML = r.referred.length ? r.referred.map(p => `<div class="act"><span class="avatar gold">${esc(AW.initials(p.first_name))}</span><div class="act-copy"><b>${esc(p.first_name)}</b><small>Joined ${esc(AW.date(p.created_at))}</small></div></div>`).join('') : emptyAct('Nobody has joined with your link yet.');
  };
  $('#copyRef').addEventListener('click', () => AW.copy($('#refLink').value, 'Referral link copied.'));

  /* ---------------- settings ---------------- */
  AW.loaders.settings = async () => { $('#setName').value = AW.user.full_name || ''; $('#setEmail').value = AW.user.email || ''; $('#setPhone').value = AW.user.phone || ''; };
  AW.applyUser = u => { AW.user = { ...AW.user, ...u }; $('#welcomeName').textContent = AW.user.full_name; $('#avatar').textContent = AW.initials(AW.user.full_name); };
  $('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    await busy($('#settingsForm button'), async () => {
      try { const r = await api('/me', { method: 'PATCH', body: { full_name: $('#setName').value, phone: $('#setPhone').value } }); AW.applyUser(r.user); AW.toast('Profile updated.'); }
      catch (err) { AW.toast(err.message, true); }
    });
  });
  $('#passwordForm').addEventListener('submit', async e => {
    e.preventDefault();
    await busy($('#passwordForm button'), async () => {
      try { await api('/me/password', { method: 'POST', body: { current_password: $('#pwCurrent').value, new_password: $('#pwNew').value } }); e.target.reset(); AW.toast('Password updated.'); }
      catch (err) { AW.toast(err.message, true); }
    });
  });

  /* ---------------- customer care chat ---------------- */
  const msgHtml = m => `<div class="msg ${m.sender_role === 'customer' ? 'mine' : 'theirs'}">${esc(m.body)}<small>${m.sender_role === 'admin' ? 'AssetWise Support · ' : ''}${esc(AW.time(m.created_at))}</small></div>`;
  function addMessages(list) {
    const body = $('#chatMessages'), fresh = list.filter(m => !chatSeen.has(m.id));
    if (!fresh.length) return;
    body.querySelector('.chat-empty')?.remove();
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    fresh.forEach(m => { chatSeen.add(m.id); chatLast = Math.max(chatLast, m.id); body.insertAdjacentHTML('beforeend', msgHtml(m)); });
    if (nearBottom) body.scrollTop = body.scrollHeight;
  }
  async function pollChat() {
    if (document.hidden) return;
    const r = await api(`/support/messages?after=${chatLast}&mark_read=1`);
    addMessages(r.messages); setBadge('#navSupportCount', 0); if (AW.user.role !== 'admin') setBadge('#bellCount', 0);
  }
  AW.loaders.support = async () => {
    chatSeen.clear(); chatLast = 0; $('#chatMessages').innerHTML = '';
    const email = AW.cfg.support_email;
    $('#contactInfo').innerHTML = `${email ? `<div><b>Email</b><small>${esc(email)}</small></div>` : ''}<div><b>Live chat</b><small>Message us here. Replies from our team appear in this conversation.</small></div>`;
    const r = await api('/support/messages?mark_read=1');
    if (!r.messages.length) $('#chatMessages').innerHTML = '<div class="chat-empty">Send us a message and our team will reply right here.</div>';
    else { addMessages(r.messages); $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight; }
    setBadge('#navSupportCount', 0); if (AW.user.role !== 'admin') setBadge('#bellCount', 0);
    clearInterval(AW.timers.chat); AW.timers.chat = setInterval(() => pollChat().catch(() => {}), 4000);
  };
  AW.leavers.support = () => clearInterval(AW.timers.chat);
  $('#chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#chatInput'), text = input.value.trim(); if (!text) return;
    const btn = $('#chatForm button'); btn.disabled = true;
    try {
      const r = await api('/support/messages', { method: 'POST', body: { body: text } });
      input.value = ''; const body = $('#chatMessages'); body.querySelector('.chat-empty')?.remove();
      if (!chatSeen.has(r.message.id)) { chatSeen.add(r.message.id); chatLast = Math.max(chatLast, r.message.id); body.insertAdjacentHTML('beforeend', msgHtml(r.message)); }
      body.scrollTop = body.scrollHeight;
    } catch (err) { AW.toast(err.message, true); } finally { btn.disabled = false; input.focus(); }
  });

  /* ---------------- bell / badges ---------------- */
  async function pollBadges() {
    if (document.hidden || !AW.user) return;
    if (AW.user.role === 'admin') {
      const s = await api('/admin/stats'), pay = s.pending_deposits + s.pending_withdrawals;
      setBadge('#navAdminSupport', s.support_awaiting); setBadge('#navAdminPay', pay); setBadge('#bellCount', s.support_awaiting + pay);
    } else {
      const n = await api('/notifications'), count = currentPage === 'support' ? 0 : n.unread_support;
      setBadge('#navSupportCount', count); setBadge('#bellCount', count);
    }
  }
  AW.pollBadges = pollBadges;
  $('#notifications').addEventListener('click', () => {
    const n = Number($('#bellCount').textContent) || 0;
    if (!n) return AW.toast("You're all caught up.");
    if (AW.user.role === 'admin') showPage(Number($('#navAdminSupport').textContent) ? 'admin-support' : 'admin-payments'); else showPage('support');
  });

  async function handlePaymentReturn(ref) {
    history.replaceState({}, '', location.pathname); // tidy the address bar
    if (!/^AWPS[A-Za-z0-9]+$/.test(ref)) return;
    try {
      let r = await api('/deposits/paystack/verify?reference=' + encodeURIComponent(ref));
      // Card payments can take a few seconds to settle; check again briefly before giving up.
      for (let i = 0; i < 4 && r.status === 'pending'; i++) { await new Promise(ok => setTimeout(ok, 3000)); r = await api('/deposits/paystack/verify?reference=' + encodeURIComponent(ref)); }
      if (r.status === 'completed') AW.toast('Payment received. Your wallet has been credited.');
      else if (r.status === 'pending') AW.toast('We have not received confirmation yet. Your wallet updates automatically once Paystack confirms.');
      else AW.toast('That payment was not completed.', true);
      refreshSummary();
    } catch (e) { AW.toast(e.message, true); }
  }

  async function handlePaypalReturn({ state, order }) {
    history.replaceState({}, '', location.pathname); // tidy the address bar
    if (state === 'cancel') { AW.toast('PayPal payment cancelled. You have not been charged.'); return; }
    if (!/^[A-Za-z0-9]{10,40}$/.test(order)) return;
    try {
      let r = await api('/deposits/paypal/capture', { method: 'POST', body: { order_id: order } });
      for (let i = 0; i < 3 && r.status === 'pending'; i++) { await new Promise(ok => setTimeout(ok, 3000)); r = await api('/deposits/paypal/capture', { method: 'POST', body: { order_id: order } }); }
      if (r.status === 'completed') AW.toast('Payment received. Your wallet has been credited.');
      else if (r.status === 'pending') AW.toast('We have not received confirmation yet. Your wallet updates automatically once PayPal confirms.');
      else AW.toast('That payment was not completed.', true);
      refreshSummary(); if (currentPage === 'deposit') loadDeposit();
    } catch (e) { AW.toast(e.message, true); }
  }

  /* ---------------- start / stop ---------------- */
  AW.start = async user => {
    AW.user = user;
    AW.cfg = (await api('/config'));
    AW.currency = AW.cfg.currency;
    $$('.cur').forEach(s => s.textContent = AW.currency);
    AW.applyUser(user);
    $('#adminNav').hidden = user.role !== 'admin';
    depositMethod = AW.cfg.paypal.enabled ? 'paypal' : 'usdt_trc20';
    showPage('dashboard');
    if (returnRef) handlePaymentReturn(returnRef);
    if (paypalReturn) handlePaypalReturn(paypalReturn);
    clearInterval(AW.timers.badges); AW.timers.badges = setInterval(() => pollBadges().catch(() => {}), 15000);
    pollBadges().catch(() => {});
  };
  AW.stop = () => { Object.values(AW.timers).forEach(t => clearInterval(t)); summary = null; packages = []; currentPage = 'dashboard'; };
})();
