/**
 * app.js — Lógica de interfaz. Habla solo con api.js.
 */
import { api, getConfig, saveConfig, clearConfig, isConfigured } from './api.js';

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

// ---------- Vista: Configuración ----------

function initSetup() {
  const form = $('#setup-form');
  const cfg = getConfig();
  if (cfg) {
    form.url.value = cfg.url;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = form.url.value.trim();
    const key = form.key.value.trim();
    const btn = form.querySelector('button');

    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
      toast('La URL debe terminar en /exec', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Verificando…';
    try {
      await api.ping({ url, key }); // prueba antes de guardar
      saveConfig(url, key);
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

document.addEventListener('DOMContentLoaded', () => {
  initSetup();
  initMovimientoForm();
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-refresh').addEventListener('click', refresh);

  isConfigured() ? startApp() : showView('view-setup');
});
