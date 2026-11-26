// Sign in / create account / session handling.
(() => {
  const { $ } = AW;
  const gate = $('#authGate'), app = $('#appShell'), loginForm = $('#loginForm'), registerForm = $('#registerForm'), message = $('#authMessage');

  const showMessage = (text, isError = false) => { message.textContent = text; message.classList.toggle('error', isError); };
  function setMode(mode) {
    const reg = mode === 'register';
    loginForm.hidden = reg; registerForm.hidden = !reg;
    $('#showLogin').classList.toggle('selected', !reg); $('#showRegister').classList.toggle('selected', reg);
    $('#authTitle').textContent = reg ? 'Create your account' : 'Welcome back';
    $('#authSubtitle').textContent = reg ? 'Join AssetWise Investments in a minute.' : 'Sign in to your AssetWise account.';
    showMessage('');
  }

  async function enterApp(user) {
    try { await AW.start(user); gate.hidden = true; app.hidden = false; }
    catch (e) { leave(e.message, true); }
  }
  function leave(text, isError = false) {
    AW.stop(); AW.setToken(null); AW.user = null;
    app.hidden = true; gate.hidden = false; setMode('login'); $('#loginPassword').value = ''; showMessage(text || '', isError);
  }
  AW.onUnauthorized = () => { if (!app.hidden) leave('Your session has expired. Please sign in again.', true); };

  $('#showLogin').addEventListener('click', () => setMode('login'));
  $('#showRegister').addEventListener('click', () => setMode('register'));
  $('#logoutButton').addEventListener('click', () => leave('You have signed out.'));

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…'; showMessage('');
    try {
      const r = await AW.api('/login', { method: 'POST', body: { email: $('#loginEmail').value.trim(), password: $('#loginPassword').value } });
      AW.setToken(r.token);
      const me = await AW.api('/me');
      $('#loginPassword').value = '';
      await enterApp(me.user);
    } catch (err) { showMessage(err.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });

  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = registerForm.querySelector('button[type=submit]');
    const email = $('#registerEmail').value.trim(), password = $('#registerPassword').value;
    btn.disabled = true; btn.textContent = 'Creating account…'; showMessage('');
    try {
      await AW.api('/register', { method: 'POST', body: { full_name: $('#registerName').value.trim(), email, password, phone: $('#registerPhone').value.trim(), referral_code: $('#registerRef').value.trim() } });
      const r = await AW.api('/login', { method: 'POST', body: { email, password } });
      AW.setToken(r.token);
      const me = await AW.api('/me');
      registerForm.reset();
      await enterApp(me.user);
    } catch (err) { showMessage(err.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Create account'; }
  });

  // Boot: a stored token is only trusted after the server confirms it.
  (async () => {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) { $('#registerRef').value = ref.slice(0, 12); setMode('register'); }
    if (!AW.getToken()) return;
    try { const me = await AW.api('/me'); await enterApp(me.user); }
    catch { AW.setToken(null); }
  })();
})();
