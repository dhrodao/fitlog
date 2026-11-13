import { api, errorMessage } from '../api.js';
import { currentTheme, toggleTheme } from '../theme.js';
import { esc, icon, setLoading, toast } from '../ui.js';

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (window.__googleScriptPromise) return window.__googleScriptPromise;

  window.__googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google'));
    document.head.append(script);
  });

  return window.__googleScriptPromise;
}

function renderAccessCheckError(container, ctx) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="row-between">
        <div class="login-brand">
          <span class="brand-mark">${icon('dumbbell', 21, 2.2)}</span>
          <span>Fitlog</span>
        </div>
        <button type="button" class="icon-btn surface" data-theme-toggle aria-label="Cambiar tema">
          ${icon(currentTheme() === 'dark' ? 'sun' : 'moon', 19)}
        </button>
      </div>

      <div class="card" style="margin-top:24px">
        <div class="empty">
          <div class="empty-icon">${icon('info', 22)}</div>
          <h3>No se pudo comprobar el acceso</h3>
          <p>Revisa tu conexión e inténtalo de nuevo.</p>
          <button type="button" class="btn btn-secondary btn-sm" data-retry-config>Reintentar</button>
        </div>
      </div>
    </div>
  `;

  const themeListener = () => {
    const button = container.querySelector('[data-theme-toggle]');
    if (button) {
      button.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon', 19);
    }
  };
  window.addEventListener('themechange', themeListener);
  container
    .querySelector('[data-theme-toggle]')
    .addEventListener('click', () => toggleTheme());

  const retry = container.querySelector('[data-retry-config]');
  retry.addEventListener('click', async () => {
    setLoading(retry, true, 'Reintentando...');
    try {
      await ctx.refreshAuthConfig();
      ctx.refresh();
    } catch (error) {
      setLoading(retry, false);
      toast(errorMessage(error), 'error');
    }
  });

  return () => {
    window.removeEventListener('themechange', themeListener);
  };
}

export async function render(container, ctx) {
  let config = ctx.authConfig;
  if (!config) {
    if (ctx.authConfigError) return renderAccessCheckError(container, ctx);
    try {
      config = await ctx.refreshAuthConfig();
    } catch {
      return renderAccessCheckError(container, ctx);
    }
  }

  const googleEnabled = Boolean(config.googleEnabled && config.googleClientId);
  const devEnabled = Boolean(config.devLoginEnabled);

  container.innerHTML = `
    <div class="login-screen">
      <div class="row-between">
        <div class="login-brand">
          <span class="brand-mark">${icon('dumbbell', 21, 2.2)}</span>
          <span>Fitlog</span>
        </div>
        <button type="button" class="icon-btn surface" data-theme-toggle aria-label="Cambiar tema">
          ${icon(currentTheme() === 'dark' ? 'sun' : 'moon', 19)}
        </button>
      </div>

      <div class="login-hero">
        <span class="badge badge-accent">${icon('sparkles', 11)} Tu progreso, sin ruido</span>
        <h1 class="login-title">Entrena con<br /><span class="gradient-text">intención.</span></h1>
        <p class="login-sub">Registra cada serie, sigue tus rutinas y observa cómo mejora tu fuerza semana a semana.</p>
      </div>

      <div class="login-features">
        <div class="login-feature">${icon('dumbbell', 17)} Series y pesos</div>
        <div class="login-feature">${icon('chart', 17)} Progreso visual</div>
        <div class="login-feature">${icon('list', 17)} Rutinas propias</div>
        <div class="login-feature">${icon('scale', 17)} Peso corporal</div>
      </div>

      <div class="login-panel">
        <div class="google-slot" id="google-slot"></div>
        <div id="login-error"></div>
        ${googleEnabled && devEnabled ? '<div class="login-divider">o</div>' : ''}
        ${
          devEnabled
            ? `<button type="button" class="btn btn-secondary btn-block" data-dev-login>
                 ${icon('play', 17)} Entrar en modo demo
               </button>`
            : ''
        }
        ${
          !googleEnabled && !devEnabled
            ? `<div class="notice danger">${icon('info', 17)} El acceso no está configurado. Define GOOGLE_CLIENT_ID en el servidor.</div>`
            : ''
        }
        <p class="login-note">Tus datos se guardan únicamente en tu servidor personal. Catálogo de ejercicios: free-exercise-db · Unlicense.</p>
      </div>
    </div>
  `;

  const googleSlot = container.querySelector('#google-slot');
  const errorSlot = container.querySelector('#login-error');
  let googleInitialized = false;

  const showError = (message) => {
    errorSlot.innerHTML = message
      ? `<div class="notice danger">${icon('info', 17)} ${esc(message)}</div>`
      : '';
  };

  container.querySelector('[data-theme-toggle]').addEventListener('click', () => {
    toggleTheme();
  });

  const themeListener = () => {
    const button = container.querySelector('[data-theme-toggle]');
    if (button) {
      button.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon', 19);
    }
    if (googleInitialized) renderGoogleButton();
  };
  window.addEventListener('themechange', themeListener);

  const handleCredential = async (response) => {
    showError('');
    try {
      const { user } = await api.auth.google(response.credential);
      ctx.completeLogin(user);
    } catch (error) {
      showError(errorMessage(error));
    }
  };

  function renderGoogleButton() {
    if (!googleEnabled || !window.google?.accounts?.id) return;
    const width = Math.min(Math.max(googleSlot.clientWidth || 320, 240), 400);
    googleSlot.innerHTML = '';
    window.google.accounts.id.renderButton(googleSlot, {
      type: 'standard',
      theme: currentTheme() === 'dark' ? 'filled_black' : 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'left',
      width,
    });
  }

  if (googleEnabled) {
    try {
      await loadGoogleScript();
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: handleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleInitialized = true;
      renderGoogleButton();
    } catch (error) {
      showError(
        'No se pudo cargar el acceso con Google. Puedes usar el modo demo si está disponible.'
      );
    }
  }

  const devButton = container.querySelector('[data-dev-login]');
  devButton?.addEventListener('click', async () => {
    showError('');
    setLoading(devButton, true, 'Entrando...');
    try {
      const { user } = await api.auth.dev();
      toast(`Hola, ${user.name}`, 'success');
      ctx.completeLogin(user);
    } catch (error) {
      setLoading(devButton, false);
      showError(errorMessage(error));
    }
  });

  return () => {
    window.removeEventListener('themechange', themeListener);
  };
}
