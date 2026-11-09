/**
 * app.js — Lógica de interfaz. Habla solo con api.js.
 */
import { api, getConfig, saveConfig, clearConfig, isConfigured, FIXED_URL } from './api.js';

// ---------- Utilidades ----------

const $ = (sel) => document.querySelector(sel);

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const money = (n) => clp.format(Number(n) || 0);

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function toast(msg, type = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = 'toast'), 3000);
}

function showView(id) {
  document.querySelectorAll('[data-view]').forEach((v) => v.classList.toggle('hidden', v.id !== id));
}

// ---------- Conexión (link mágico) ----------

const URL_RE = /^https:\/\/script\.google\.com\/.+\/exec$/;

/**
 * Lee un link mágico (…#u=URL&k=KEY) o una key suelta.
 * Devuelve { url, key } con lo que encuentre.
 */
function parseCredenciales(texto) {
  const t = String(texto || '').trim();
  if (!t) return {};
  const hash = t.includes('#') ? t.slice(t.indexOf('#') + 1) : '';
  if (hash) {
    const p = new URLSearchParams(hash);
    return { url: (p.get('u') || '').trim(), key: (p.get('k') || '').trim() };
  }
  if (URL_RE.test(t)) return { url: t };
  if (/^[\w-]{16,}$/.test(t)) return { key: t };
  return {};
}

/** Prueba la conexión y, si responde, la guarda */
async function conectar({ url, key }) {
  url = FIXED_URL || url || (getConfig() || {}).url || '';
  if (!URL_RE.test(url)) throw new Error('Falta la URL de la Web App');
  if (!key) throw new Error('Falta la API_KEY');
  await api.ping({ url, key });
  saveConfig(url, key);
}

function linkMagico() {
  const c = getConfig();
  if (!c || !c.key) return '';
  const p = new URLSearchParams({ u: c.url, k: c.key });
  return `${location.origin}${location.pathname}#${p}`;
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ---------- Vista: Configuración ----------

function initSetup() {
  const form = $('#setup-form');
  const cfg = getConfig();

  if (FIXED_URL) {
    $('#url-field').classList.add('hidden');
    form.url.required = false;
    form.url.value = FIXED_URL;
  } else if (cfg) {
    form.url.value = cfg.url;
  }

  // Botón principal: lee el link del portapapeles y conecta
  $('#btn-pegar').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    let texto = '';
    try {
      texto = await navigator.clipboard.readText();
    } catch {
      $('#manual').open = true;
      toast('No pude leer el portapapeles. Pega el link abajo.', 'error');
      return;
    }
    const cred = parseCredenciales(texto);
    if (!cred.key) {
      toast('Lo copiado no es tu link de conexión', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Conectando…';
    try {
      await conectar(cred);
      toast('Conectado correctamente');
      startApp();
    } catch (err) {
      toast(`No se pudo conectar: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Pegar link y conectar';
    }
  });

  // Ingreso manual: acepta la key sola o el link mágico completo
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const desdeKey = parseCredenciales(form.key.value);
    const cred = {
      url: desdeKey.url || form.url.value.trim(),
      key: desdeKey.key || form.key.value.trim(),
    };

    btn.disabled = true;
    btn.textContent = 'Verificando…';
    try {
      await conectar(cred);
      form.key.value = '';
      toast('Conectado correctamente');
      startApp();
    } catch (err) {
      toast(`No se pudo conectar: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Conectar';
    }
  });
}

/** Si la app se abrió con un link mágico, conecta sola y borra la key de la barra */
async function conectarDesdeLink() {
  if (!location.hash.includes('k=')) return false;
  const cred = parseCredenciales(location.href);
  history.replaceState(null, '', location.pathname + location.search);
  if (!cred.key) return false;
  try {
    await conectar(cred);
    toast('Conectado correctamente');
    return true;
  } catch (err) {
    toast(`El link no funcionó: ${err.message}`, 'error');
    return false;
  }
}

// ---------- Vista: Dashboard ----------

async function loadResumen() {
  const r = await api.getResumen();
  $('#kpi-ingresos').textContent = money(r.ingresosMes);
  $('#kpi-gastos').textContent = money(r.gastosMes);
  const bal = $('#kpi-balance');
  bal.textContent = money(r.balanceMes);
  bal.classList.toggle('text-red-600', r.balanceMes < 0);
  bal.classList.toggle('text-emerald-600', r.balanceMes >= 0);
  $('#kpi-semana').textContent = money(r.semana.gastos);
  $('#kpi-hormiga').textContent = `${money(r.hormiga.totalMes)} · ${r.hormiga.cantidadMes} gastos`;
  $('#kpi-credito').textContent = money(r.gastosPorMedio['Crédito']);
}

async function loadMovimientos() {
  const lista = await api.getMovimientos();
  const tbody = $('#mov-body');

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400">Aún no hay movimientos</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.slice(0, 20).map((m) => `
    <tr class="border-t border-slate-100">
      <td class="py-2 pr-3 text-slate-500 whitespace-nowrap">${escapeHtml(m.fecha)}</td>
      <td class="py-2 pr-3">
        ${escapeHtml(m.categoria)}
        ${m.esHormiga ? '<span class="badge-hormiga">hormiga</span>' : ''}
        <div class="text-xs text-slate-400">${escapeHtml(m.descripcion)}</div>
      </td>
      <td class="py-2 pr-3 text-slate-500">${escapeHtml(m.medio)}</td>
      <td class="py-2 pr-3 text-right font-medium ${m.tipo === 'Gasto' ? 'text-red-600' : 'text-emerald-600'} whitespace-nowrap">
        ${m.tipo === 'Gasto' ? '−' : '+'}${money(m.monto)}
      </td>
      <td class="py-2 text-right">
        <button class="text-slate-300 hover:text-red-500" data-delete="${escapeHtml(m.id)}" title="Eliminar">✕</button>
      </td>
    </tr>`).join('');
}

async function refresh() {
  try {
    await Promise.all([loadResumen(), loadMovimientos()]);
  } catch (err) {
    toast(err.message, 'error');
    if (err.message === 'No autorizado') logout();
  }
}

function initMovimientoForm() {
  const form = $('#mov-form');
  form.fecha.value = hoyISO();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const mov = {
      fecha: form.fecha.value,
      tipo: form.tipo.value,
      categoria: form.categoria.value,
      medio: form.medio.value,
      monto: Number(form.monto.value),
      descripcion: form.descripcion.value,
      esHormiga: form.esHormiga.checked,
    };

    if (!(mov.monto > 0)) return toast('Ingresa un monto mayor a 0', 'error');

    btn.disabled = true;
    try {
      await api.addMovimiento(mov);
      toast('Movimiento guardado');
      form.reset();
      form.fecha.value = hoyISO();
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $('#mov-body').addEventListener('click', async (e) => {
    const id = e.target.dataset.delete;
    if (!id) return;
    e.target.disabled = true;
    try {
      await api.deleteMovimiento(id);
      toast('Movimiento eliminado');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  });
}

// ---------- Sesión ----------

function logout() {
  clearConfig();
  showView('view-setup');
}

function startApp() {
  showView('view-app');
  refresh();
}

// ---------- Arranque ----------

document.addEventListener('DOMContentLoaded', async () => {
  initSetup();
  initMovimientoForm();
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-refresh').addEventListener('click', refresh);
  $('#btn-link').addEventListener('click', async () => {
    const link = linkMagico();
    if (!link) return toast('Conéctate primero', 'error');
    (await copiarTexto(link))
      ? toast('Link copiado. Guárdalo en un lugar privado.')
      : toast('No se pudo copiar el link', 'error');
  });

  await conectarDesdeLink();
  isConfigured() ? startApp() : showView('view-setup');
});
