/**
 * api.js — Capa de comunicación con la API de Google Apps Script.
 * Única parte de la app que sabe de URLs, keys y fetch.
 */

import { API_URL } from './config.js';

const STORAGE_KEY = 'cf_config_v1';

/** URL fija de config.js (vacía si aún no se configuró) */
export const FIXED_URL = /^https:\/\/script\.google\.com\/.+\/exec$/.test(API_URL) ? API_URL : '';

// ---------- Configuración (URL + API_KEY en localStorage) ----------

export function getConfig() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const url = FIXED_URL || (saved && saved.url) || '';
  const key = (saved && saved.key) || '';
  return url || key ? { url, key } : null;
}

export function saveConfig(url, key) {
  const config = { url: (FIXED_URL || url).trim(), key: key.trim() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return config;
}

export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isConfigured() {
  const c = getConfig();
  return Boolean(c && c.url && c.key);
}

// ---------- Llamadas HTTP ----------

class ApiError extends Error {}

async function parse(res) {
  if (!res.ok) throw new ApiError(`Error de red (${res.status})`);
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error || 'Error desconocido');
  return json.data;
}

function requireConfig(override) {
  const c = override || getConfig();
  if (!c || !c.url || !c.key) throw new ApiError('La app no está configurada');
  return c;
}

/** GET ?action=...&key=...&otrosParametros */
export async function apiGet(action, params = {}, override) {
  const { url, key } = requireConfig(override);
  const qs = new URLSearchParams({ action, key, ...params });
  const res = await fetch(`${url}?${qs}`, { method: 'GET', redirect: 'follow' });
  return parse(res);
}

/** POST con body JSON enviado como text/plain (evita el preflight CORS) */
export async function apiPost(action, data = {}) {
  const { url, key } = requireConfig();
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key, action, data }),
  });
  return parse(res);
}

// ---------- Endpoints con nombre (lo que usa app.js) ----------

export const api = {
  ping: (override) => apiGet('ping', {}, override),

  getMovimientos: (filtros = {}) => apiGet('getMovimientos', filtros),
  addMovimiento: (mov) => apiPost('addMovimiento', mov),
  updateMovimiento: (mov) => apiPost('updateMovimiento', mov),
  deleteMovimiento: (id) => apiPost('deleteMovimiento', { id }),

  getPresupuesto: (mes) => apiGet('getPresupuesto', mes ? { mes } : {}),
  setPresupuesto: (categoria, limiteMensual) => apiPost('setPresupuesto', { categoria, limiteMensual }),
  deletePresupuesto: (categoria) => apiPost('deletePresupuesto', { categoria }),

  getAhorros: () => apiGet('getAhorros'),
  addMeta: (meta) => apiPost('addMeta', meta),
  updateMeta: (meta) => apiPost('updateMeta', meta),
  abonarMeta: (id, monto) => apiPost('abonarMeta', { id, monto }),
  deleteMeta: (id) => apiPost('deleteMeta', { id }),

  getResumen: (mes) => apiGet('getResumen', mes ? { mes } : {}),
};

export { ApiError };
