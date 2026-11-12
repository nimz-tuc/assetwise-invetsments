// Administrator pages: overview, customer-care inbox (replying to customers), payments, customers, packages.
(() => {
  const { $, $$, esc, api, money } = AW;
  const badge = s => `<span class="badge ${esc(s)}">${esc(s.charAt(0).toUpperCase() + s.slice(1))}</span>`;
  const stopTimers = (...names) => names.forEach(n => clearInterval(AW.timers[n]));

  /* ---------------- overview ---------------- */
  AW.loaders['admin-overview'] = async () => {
    const s = await api('/admin/stats');
    AW.currency = s.currency;
    const card = (label, value, note) => `<article class="stat"><div><small>${label}</small><strong>${value}</strong>${note ? `<span class="hint">${note}</span>` : ''}</div></article>`;
    $('#adminStats').innerHTML = [
      card('Customers', s.users.total, `${s.users.new_30d} joined in the last 30 days`),
      card('Deposits received', money(s.deposits_total)),
      card('Withdrawals paid', money(s.withdrawals_total)),
      card('Customer wallet balances', money(s.customer_wallet_total), 'Owed to customers on demand'),
      card('Active investments', s.active_investments, `${money(s.active_principal)} invested`),
      card('Returns owed at maturity', money(s.pending_returns), 'Profit on active investments'),
      card('Pending deposits', s.pending_deposits, 'Waiting for your confirmation'),
      card('Pending withdrawals', s.pending_withdrawals, 'Waiting to be paid out'),
      card('Chats awaiting reply', s.support_awaiting),
    ].join('');
  };

  /* ---------------- customer care inbox ---------------- */
  let thread = null, tLast = 0; const tSeen = new Set();
  const msgHtml = m => `<div class="msg ${m.sender_role === 'admin' ? 'mine' : 'theirs'}">${esc(m.body)}<small>${esc(AW.time(m.created_at))}</small></div>`;

  async function loadThreads() {
    if (document.hidden) return;
    const { threads } = await api('/admin/support/threads');
    $('#adminThreads').innerHTML = threads.length ? threads.map(t => `<button class="thread ${String(t.user_id) === String(thread) ? 'sel' : ''}" data-uid="${esc(t.user_id)}">
      <span class="avatar gold">${esc(AW.initials(t.full_name))}</span>
      <span><b>${esc(t.full_name)}</b><small>${t.last_sender === 'admin' ? 'You: ' : ''}${esc(t.last_body)}</small></span>
      <span class="when">${esc(AW.time(t.last_at))}${t.unread ? `<br><span class="dot">${t.unread}</span>` : ''}</span></button>`).join('')
      : '<p class="empty-note">No customer messages yet.</p>';
  }
  function addMsgs(list) {
    const body = $('#adminChatMessages'), fresh = list.filter(m => !tSeen.has(m.id));
    if (!fresh.length) return;
    body.querySelector('.chat-empty')?.remove();
    const near = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    fresh.forEach(m => { tSeen.add(m.id); tLast = Math.max(tLast, m.id); body.insertAdjacentHTML('beforeend', msgHtml(m)); });
    if (near) body.scrollTop = body.scrollHeight;
  }
  async function pollThread() {
    if (!thread || document.hidden) return;
    const r = await api(`/admin/support/threads/${encodeURIComponent(thread)}/messages?after=${tLast}`);
    addMsgs(r.messages);
  }
  async function openThread(uid) {
    thread = uid; tSeen.clear(); tLast = 0; $('#adminChatMessages').innerHTML = '';
    const r = await api(`/admin/support/threads/${encodeURIComponent(uid)}/messages`);
    $('#adminChatName').textContent = r.customer.full_name;
    $('#adminChatMeta').textContent = [r.customer.email, r.customer.phone].filter(Boolean).join(' · ');
    $('#adminChatAvatar').textContent = AW.initials(r.customer.full_name);
    addMsgs(r.messages); $('#adminChatMessages').scrollTop = $('#adminChatMessages').scrollHeight;
    $('#adminChatInput').disabled = false; $('#adminChatForm button').disabled = false; $('#adminChatInput').focus();
    loadThreads(); AW.pollBadges && AW.pollBadges();
  }
  AW.loaders['admin-support'] = async () => {
    await loadThreads();
    stopTimers('adminThreads', 'adminThread');
    AW.timers.adminThreads = setInterval(() => loadThreads().catch(() => {}), 6000);
    AW.timers.adminThread = setInterval(() => pollThread().catch(() => {}), 3000);
  };
  AW.leavers['admin-support'] = () => stopTimers('adminThreads', 'adminThread');
  $('#adminThreads').addEventListener('click', e => { const b = e.target.closest('[data-uid]'); if (b) openThread(b.dataset.uid).catch(err => AW.toast(err.message, true)); });
  $('#adminChatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#adminChatInput'), text = input.value.trim(); if (!text || !thread) return;
    const btn = $('#adminChatForm button'); btn.disabled = true;
    try {
      const r = await api(`/admin/support/threads/${encodeURIComponent(thread)}/reply`, { method: 'POST', body: { body: text } });
      input.value = ''; addMsgs([r.message]); $('#adminChatMessages').scrollTop = $('#adminChatMessages').scrollHeight; loadThreads();
      AW.pollBadges && AW.pollBadges();
    } catch (err) { AW.toast(err.message, true); } finally { btn.disabled = false; input.focus(); }
  });

  /* ---------------- deposits & withdrawals ---------------- */
  async function loadPayments() {
    const status = $('#adminTxFilter').value, q = status ? `&status=${status}` : '';
    const [d, w] = await Promise.all([api('/admin/transactions?type=deposit' + q), api('/admin/transactions?type=withdrawal' + q)]);
    const rows = [...d.transactions, ...w.transactions].sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || new Date(b.created_at) - new Date(a.created_at));
    $('#adminTxRows').innerHTML = rows.length ? rows.map(t => {
      const detail = t.type === 'deposit' ? t.reference : t.destination;
      return `<tr><td>${esc(t.full_name)}<br><small class="hint">${esc(t.email)}${t.phone ? ' · ' + esc(t.phone) : ''}</small></td><td>${esc(t.type)}</td>
        <td class="${Number(t.amount) > 0 ? 'positive' : 'negative'}">${money(Math.abs(t.amount))}</td><td>${esc(AW.METHOD[t.method] || '')}</td><td><code>${esc(detail || '')}</code></td>
        <td>${esc(AW.dateTime(t.created_at))}</td><td>${badge(t.status)}</td>
        <td>${t.status === 'pending' ? `<button class="btn btn-gold btn-sm" data-act="approve" data-id="${esc(t.id)}">${t.type === 'deposit' ? 'Confirm' : 'Mark paid'}</button> <button class="btn btn-danger btn-sm" data-act="reject" data-id="${esc(t.id)}">Reject</button>` : ''}</td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">Nothing to show.</td></tr>`;
    rows.forEach(t => { /* keep for confirm dialogs */ payCache[t.id] = t; });
  }
  const payCache = {};
  AW.loaders['admin-payments'] = loadPayments;
  $('#adminTxFilter').addEventListener('change', () => loadPayments().catch(e => AW.toast(e.message, true)));
  $('#adminTxRows').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const t = payCache[b.dataset.id]; if (!t) return;
    const amt = money(Math.abs(t.amount));
    try {
      if (b.dataset.act === 'approve') {
        const msg = t.type === 'deposit' ? `Confirm that ${amt} was received from ${t.full_name} (${AW.METHOD[t.method]} ref ${t.reference})?\n\nTheir wallet will be credited immediately.`
          : `Confirm you have paid ${amt} to ${t.destination} (${AW.METHOD[t.method]})?`;
        if (!confirm(msg)) return;
        const note = t.type === 'withdrawal' ? prompt('Payout reference (optional):') : null;
        AW.toast((await api(`/admin/transactions/${t.id}/approve`, { method: 'POST', body: { note } })).message);
      } else {
        const reason = prompt(`Reject this ${t.type} of ${amt}? Enter a reason for the customer's record:`, '');
        if (reason === null) return;
        AW.toast((await api(`/admin/transactions/${t.id}/reject`, { method: 'POST', body: { reason } })).message);
      }
      loadPayments(); AW.pollBadges && AW.pollBadges();
    } catch (err) { AW.toast(err.message, true); loadPayments(); }
  });

  /* ---------------- customers ---------------- */
  async function loadUsers() {
    const r = await api('/admin/users?q=' + encodeURIComponent($('#adminUserSearch').value.trim()));
    $('#adminUserRows').innerHTML = r.users.length ? r.users.map(u => `<tr><td>${esc(u.full_name)}${u.role === 'admin' ? ' <span class="badge">admin</span>' : ''}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '—')}</td>
      <td>${money(u.balance)}</td><td>${money(u.invested)}</td><td>${esc(AW.date(u.created_at))}</td><td><span class="badge ${u.status === 'active' ? '' : 'rejected'}">${u.status === 'active' ? 'Active' : 'Suspended'}</span></td>
      <td>${u.role === 'admin' ? '' : `<button class="btn btn-outline btn-sm" data-uid="${esc(u.id)}" data-status="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>`}</td></tr>`).join('')
      : `<tr><td colspan="8" class="empty">No customers found.</td></tr>`;
  }
  AW.loaders['admin-users'] = loadUsers;
  let st; $('#adminUserSearch').addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => loadUsers().catch(() => {}), 300); });
  $('#adminUserRows').addEventListener('click', async e => {
    const b = e.target.closest('[data-uid]'); if (!b) return;
    if (!confirm(`${b.dataset.status === 'suspended' ? 'Suspend' : 'Reactivate'} this customer?`)) return;
    try { await api(`/admin/users/${encodeURIComponent(b.dataset.uid)}`, { method: 'PATCH', body: { status: b.dataset.status } }); AW.toast('Customer updated.'); loadUsers(); }
    catch (err) { AW.toast(err.message, true); }
  });

  /* ---------------- packages ---------------- */
  AW.loaders['admin-packages'] = async () => {
    const r = await api('/admin/packages');
    $('#adminPkgRows').innerHTML = r.packages.map(p => `<tr data-id="${esc(p.id)}"><td><b>${esc(p.name)}</b></td>
      <td><input data-f="minimum_amount" value="${esc(Number(p.minimum_amount))}" size="8"></td>
      <td><input data-f="maximum_amount" value="${p.maximum_amount === null ? '' : esc(Number(p.maximum_amount))}" size="8" placeholder="no limit"></td>
      <td><input data-f="duration_days" value="${esc(p.duration_days)}" size="3"></td>
      <td><input data-f="projected_return_rate" value="${esc(Number(p.projected_return_rate))}" size="4"></td>
      <td><input type="checkbox" data-f="is_active" ${p.is_active ? 'checked' : ''}></td>
      <td><button class="btn btn-gold btn-sm" data-save="1">Save</button></td></tr>`).join('');
  };
  $('#adminPkgRows').addEventListener('click', async e => {
    const b = e.target.closest('[data-save]'); if (!b) return;
    const tr = b.closest('tr'), v = f => tr.querySelector(`[data-f="${f}"]`);
    const body = { minimum_amount: v('minimum_amount').value.trim(), maximum_amount: v('maximum_amount').value.trim(), duration_days: v('duration_days').value.trim(), projected_return_rate: v('projected_return_rate').value.trim(), is_active: v('is_active').checked };
    try { await api(`/admin/packages/${encodeURIComponent(tr.dataset.id)}`, { method: 'PUT', body }); AW.toast('Package saved.'); }
    catch (err) { AW.toast(err.message, true); }
  });
})();
