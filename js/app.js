/**
 * app.js — Lógica de interfaz. Habla solo con api.js.
 */
import { api, getConfig, saveConfig, clearConfig, isConfigured, FIXED_URL } from './api.js';

// ---------- Utilidades ----------

const $ = (sel) => document.querySelector(sel);

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const money = (n) => { const v = Math.round(Number(n) || 0); return v < 0 ? '−' + clp.format(-v) : clp.format(v); };

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


// ============================================================
//  DATOS Y PERÍODOS
// ============================================================

const st = {
  movs: [],
  metas: [],
  pres: [],
  cuentas: [],
  cuentasOk: true,
  periodo: 'mes',
  ambito: 'Personal',
  tab: 'inicio',
  tipIdx: 0,
};

const CATEGORIAS = {
  Gasto: [
    ['Supermercado', '🛒'], ['Comida', '🍽️'], ['Café', '☕'], ['Delivery', '🛵'],
    ['Transporte', '🚗'], ['Bencina', '⛽'], ['Hogar', '🏠'], ['Cuentas', '💡'],
    ['Salud', '💊'], ['Entretención', '🎬'], ['Suscripciones', '📺'], ['Ropa', '👕'],
    ['Mascota', '🐶'], ['Compras', '🛍️'], ['Transferencias', '↗️'], ['Otra', '✏️'],
  ],
  Ingreso: [
    ['Sueldo', '💼'], ['Clientes', '🏋️'], ['Transferencia', '💸'], ['Otro', '✏️'],
  ],
};
const HORMIGA_SUGERIDAS = ['Café', 'Delivery'];
const EMOJI = Object.fromEntries([...CATEGORIAS.Gasto, ...CATEGORIAS.Ingreso, ['Otros', '🏷️']]);
const emojiDe = (cat, tipo) => EMOJI[cat] || (tipo === 'Ingreso' ? '💰' : '🏷️');

const isoDe = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function lunesDe(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Rango [desde, hasta] en YYYY-MM-DD para un período. offset=-1 → período anterior */
function rango(periodo, offset = 0) {
  const hoy = new Date();
  if (periodo === 'hoy') {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + offset);
    return [isoDe(d), isoDe(d)];
  }
  if (periodo === 'semana') {
    const l = lunesDe(hoy);
    l.setDate(l.getDate() + offset * 7);
    const dom = new Date(l.getFullYear(), l.getMonth(), l.getDate() + 6);
    return [isoDe(l), isoDe(dom)];
  }
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + offset + 1, 0);
  return [isoDe(ini), isoDe(fin)];
}

const ambitoDe = (m) => m.ambito || 'Personal';

function movsDe(periodo, offset = 0, ambito = st.ambito) {
  const [a, b] = rango(periodo, offset);
  return st.movs.filter((m) => m.fecha >= a && m.fecha <= b && (ambito === 'Todo' || ambitoDe(m) === ambito));
}

/** Saldo actual = saldo inicial + movimientos registrados después de fijarlo */
function saldoCuenta(c) {
  let s = c.saldoInicial;
  for (const m of st.movs) {
    if (!m.creado || m.creado <= c.fechaInicial) continue;
    if (m.tipo === 'Traspaso') {
      if (m.cuenta === c.id) s -= m.monto;
      if (m.cuentaDestino === c.id) s += m.monto;
    } else if (m.cuenta === c.id) {
      s += m.tipo === 'Ingreso' ? m.monto : -m.monto;
    }
  }
  return s;
}

function patrimonio() {
  let total = 0, personal = 0, inmov = 0, deuda = 0;
  for (const c of st.cuentas) {
    const v = saldoCuenta(c);
    total += v;
    if (c.ambito === 'INMOV') inmov += v; else personal += v;
    if (v < 0) deuda += -v;
  }
  return { total, personal, inmov, deuda };
}

function totales(lista) {
  let ing = 0, gas = 0, hor = 0, nHor = 0;
  const porCat = {}, porMedio = {};
  for (const m of lista) {
    if (m.tipo === 'Traspaso') continue;
    if (m.tipo === 'Ingreso') { ing += m.monto; continue; }
    gas += m.monto;
    porCat[m.categoria] = (porCat[m.categoria] || 0) + m.monto;
    porMedio[m.medio] = (porMedio[m.medio] || 0) + m.monto;
    if (m.esHormiga) { hor += m.monto; nHor++; }
  }
  return { ing, gas, hor, nHor, bal: ing - gas, porCat, porMedio };
}

const nombreMes = () => new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(new Date());
const TXT = {
  mes: { en: 'este mes', label: () => `Balance de ${nombreMes()}` },
  semana: { en: 'esta semana', label: () => 'Balance de esta semana' },
  hoy: { en: 'hoy', label: () => 'Balance de hoy' },
};

function fechaCorta(iso) {
  const hoy = isoDe(new Date());
  const ayer = isoDe(new Date(Date.now() - 86400000));
  if (iso === hoy) return 'Hoy';
  if (iso === ayer) return 'Ayer';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// ============================================================
//  THOR: consejos según tus datos
// ============================================================

function consejos() {
  const p = st.periodo;
  const en = TXT[p].en;
  const t = totales(movsDe(p));
  const out = [];

  if (!st.movs.length) {
    return ['¡Guau! Registra tu primer gasto con el botón + y te ayudo a cuidar tus lucas.'];
  }

  // Alertas de presupuesto (siempre del mes)
  const tm = totales(movsDe('mes', 0, 'Todo'));
  for (const b of st.pres) {
    const usado = tm.porCat[b.categoria] || 0;
    const pc = pct(usado, b.limiteMensual);
    if (pc >= 100) out.push(`¡Ojo! Te pasaste del presupuesto de ${b.categoria}: llevas ${money(usado)} de ${money(b.limiteMensual)}.`);
    else if (pc >= 80) out.push(`Ya usaste el ${pc}% de tu presupuesto de ${b.categoria}. Te quedan ${money(b.limiteMensual - usado)}.`);
  }

  if (!t.ing && !t.gas) {
    out.push(`No hay movimientos ${en}. ¡Vas impecable!`);
  } else {
    if (p !== 'hoy' && t.bal < 0) out.push(`Cuidado: ${en} gastaste ${money(-t.bal)} más de lo que entró.`);

    if (t.hor > 0) {
      out.push(`Llevas ${money(t.hor)} en gastos hormiga ${en} (${t.nHor}). Si los bajas a la mitad, te ahorras ${money(t.hor / 2)}.`);
    }

    const top = Object.entries(t.porCat).sort((a, b) => b[1] - a[1])[0];
    if (top) out.push(`Tu mayor gasto ${en} es ${top[0]}: ${money(top[1])}.`);

    if (p === 'semana') {
      const antes = totales(movsDe('semana', -1)).gas;
      if (antes > 0) {
        const dif = antes - t.gas;
        out.push(dif >= 0
          ? `Esta semana llevas ${money(dif)} menos que la semana pasada. ¡Buen trabajo!`
          : `Esta semana llevas ${money(-dif)} más que la semana pasada.`);
      }
    }

    if (p === 'mes' && t.gas > 0) {
      out.push(`Tu promedio de gasto diario ${en} es ${money(t.gas / new Date().getDate())}.`);
    }

    const cred = t.porMedio['Crédito'] || 0;
    if (t.gas > 0 && pct(cred, t.gas) >= 50) {
      out.push(`El ${pct(cred, t.gas)}% de tus gastos ${en} fue con crédito. Recuerda que eso se paga después.`);
    }
  }

  if (st.ambito === 'INMOV' && (t.ing || t.gas)) {
    out.push(`INMOV ${en}: entró ${money(t.ing)} y salió ${money(t.gas)}. ${t.bal >= 0 ? 'El negocio va en verde. Stonks 📈' : 'Ojo, el negocio va en rojo. Not stonks 📉'}`);
  }
  if (st.cuentas.length) {
    const pt = patrimonio();
    out.push(`Entre todas tus cuentas tienes ${money(pt.total)}. Tu ahorro y tu negocio, juntos.`);
  }

  const meta = st.metas.find((m) => m.montoActual < m.montoObjetivo);
  if (meta) out.push(`Te faltan ${money(meta.montoObjetivo - meta.montoActual)} para tu meta "${meta.nombre}". ¡Tú puedes!`);
  else if (!st.metas.length) out.push('¿Y si creamos una meta de ahorro? Ve a Metas y elige para qué quieres juntar.');

  return out.length ? out : ['Todo en orden por aquí. ¡Sigue así!'];
}

function renderThor(animar = false) {
  const lista = consejos();
  const el = $('#thor-tip');
  el.textContent = lista[st.tipIdx % lista.length];
  if (animar) {
    el.classList.remove('tip-in');
    void el.offsetWidth;
    el.classList.add('tip-in');
  }
}

// ============================================================
//  PANTALLAS
// ============================================================

function renderInicio() {
  const p = st.periodo;
  const lista = movsDe(p);
  const t = totales(lista);

  $('#bal-label').textContent = TXT[p].label();
  $('#bal-total').textContent = money(t.bal);
  $('#bal-ing').textContent = money(t.ing);
  $('#bal-gas').textContent = money(t.gas);
  $('#bal-hor').textContent = money(t.hor);

  // Patrimonio (tarjeta que lleva a Cuentas)
  const ph = $('#patrimonio-home');
  if (st.cuentas.length) {
    const pt = patrimonio();
    ph.classList.remove('hidden');
    ph.innerHTML = `<div style="display:flex;flex-direction:column;gap:2px"><span class="muted xs">Tus cuentas (${st.cuentas.length})</span><span class="strong">Patrimonio total</span></div><span class="v">${money(pt.total)}</span>`;
  } else {
    ph.classList.add('hidden');
  }

  // Meta destacada
  const meta = st.metas.find((m) => m.montoActual < m.montoObjetivo) || st.metas[0];
  $('#meta-home').innerHTML = meta
    ? `<button type="button" class="card meta-card" data-goto="metas" style="width:100%;text-align:left;color:inherit">
        <div class="meta-top"><span class="strong">Meta: ${escapeHtml(meta.nombre)}</span><span class="meta-pct">${meta.progreso}%</span></div>
        <div class="bar"><div style="width:${meta.progreso}%"></div></div>
        <span class="muted xs">${money(meta.montoActual)} de ${money(meta.montoObjetivo)}${meta.fechaLimite ? ' · hasta ' + escapeHtml(fechaCorta(meta.fechaLimite)) : ''}</span>
      </button>`
    : `<button type="button" class="card meta-card" data-goto="metas" style="width:100%;text-align:left;color:inherit">
        <div class="meta-top"><span class="strong">Crea tu primera meta de ahorro</span><span class="meta-pct">+</span></div>
        <span class="muted xs">Vacaciones, un auto, un fondo de emergencia… THOR te acompaña.</span>
      </button>`;

  // Movimientos del período
  $('#mov-count').textContent = lista.length ? `${lista.length} en total` : '';
  $('#mov-list').innerHTML = lista.length
    ? lista.slice(0, 40).map(movHTML).join('')
    : `<div class="empty">No hay movimientos ${TXT[p].en}.<br>Toca el botón + para agregar uno.</div>`;
}

function movHTML(m) {
  if (m.tipo === 'Traspaso') {
    const o = cuentaPorId(m.cuenta), d = cuentaPorId(m.cuentaDestino);
    return `<div class="mov">
      <div class="mov-ico" aria-hidden="true">↔️</div>
      <div class="mov-txt">
        <span class="t">Traspaso${ambitoDe(m) === 'INMOV' ? '<span class="tag inmov">INMOV</span>' : ''}</span>
        <span class="s">${escapeHtml(fechaCorta(m.fecha))} · ${escapeHtml(o ? o.nombre : m.cuenta)} → ${escapeHtml(d ? d.nombre : m.cuentaDestino)}</span>
      </div>
      <span class="mov-amt neutral">${money(m.monto)}</span>
      <button type="button" class="mov-del" data-del="${escapeHtml(m.id)}" aria-label="Eliminar traspaso">✕</button>
    </div>`;
  }
  const gasto = m.tipo === 'Gasto';
  return `<div class="mov">
    <div class="mov-ico" aria-hidden="true">${emojiDe(m.categoria, m.tipo)}</div>
    <div class="mov-txt">
      <span class="t">${escapeHtml(m.categoria)}${m.esHormiga ? '<span class="badge">hormiga</span>' : ''}${ambitoDe(m) === 'INMOV' && st.ambito !== 'INMOV' ? '<span class="tag inmov">INMOV</span>' : ''}</span>
      <span class="s">${escapeHtml(fechaCorta(m.fecha))} · ${escapeHtml((cuentaPorId(m.cuenta) || {}).nombre || m.medio)}${m.descripcion ? ' · ' + escapeHtml(m.descripcion) : ''}</span>
    </div>
    <span class="mov-amt ${gasto ? 'red' : 'green'}">${gasto ? '−' : '+'}${money(m.monto)}</span>
    <button type="button" class="mov-del" data-del="${escapeHtml(m.id)}" aria-label="Eliminar movimiento">✕</button>
  </div>`;
}

function barrasHTML(obj, total) {
  const filas = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!filas.length) return `<div class="empty">Sin gastos ${TXT[st.periodo].en}.</div>`;
  const max = filas[0][1];
  return filas.map(([k, v]) => `<div class="stat-row">
      <div class="stat-head"><span>${emojiDe(k, 'Gasto')} ${escapeHtml(k)}</span><span class="v">${money(v)} <span class="muted xs">${pct(v, total)}%</span></span></div>
      <div class="bar"><div style="width:${pct(v, max)}%"></div></div>
    </div>`).join('');
}

function renderStats() {
  const t = totales(movsDe(st.periodo));
  $('#stats-cat').innerHTML = barrasHTML(t.porCat, t.gas);
  $('#stats-medio').innerHTML = barrasHTML(t.porMedio, t.gas).replace(/🏷️ /g, '');
}

function renderMetas() {
  $('#metas-list').innerHTML = st.metas.length
    ? st.metas.map((m) => `<div class="card meta-card">
        <div class="meta-top"><h2>${escapeHtml(m.nombre)}</h2><span class="meta-pct">${m.progreso}%</span></div>
        <div class="bar"><div style="width:${m.progreso}%"></div></div>
        <div class="meta-top">
          <span class="muted xs">${money(m.montoActual)} de ${money(m.montoObjetivo)}${m.fechaLimite ? ' · hasta ' + escapeHtml(fechaCorta(m.fechaLimite)) : ''}</span>
          <button type="button" class="link-btn" data-meta-del="${escapeHtml(m.id)}">Eliminar</button>
        </div>
        <form class="meta-actions" data-abonar="${escapeHtml(m.id)}">
          <input class="input" name="monto" type="number" inputmode="numeric" min="1" placeholder="Monto a abonar" aria-label="Monto a abonar a ${escapeHtml(m.nombre)}" required />
          <button type="submit" class="btn-small gold-fill">Abonar</button>
        </form>
      </div>`).join('')
    : `<div class="card"><div class="empty">Aún no tienes metas. Crea la primera aquí abajo.</div></div>`;
}

function renderPres() {
  const tm = totales(movsDe('mes', 0, 'Todo'));
  $('#pres-list').innerHTML = st.pres.length
    ? st.pres.map((b) => {
        const usado = tm.porCat[b.categoria] || 0;
        const pc = pct(usado, b.limiteMensual);
        const cls = pc >= 100 ? 'over' : pc >= 80 ? 'warn' : '';
        return `<div class="stat-row">
          <div class="stat-head"><span>${emojiDe(b.categoria, 'Gasto')} ${escapeHtml(b.categoria)}</span><span class="v">${money(usado)} <span class="muted xs">/ ${money(b.limiteMensual)}</span></span></div>
          <div class="bar ${cls}"><div style="width:${Math.min(100, pc)}%"></div></div>
          <div class="stat-head"><span class="muted xs">${pc >= 100 ? 'Te pasaste por ' + money(usado - b.limiteMensual) : 'Quedan ' + money(b.limiteMensual - usado)}</span>
          <button type="button" class="link-btn" data-pres-del="${escapeHtml(b.categoria)}">Quitar</button></div>
        </div>`;
      }).join('')
    : `<div class="empty">Sin límites todavía.</div>`;

  const cats = new Set(CATEGORIAS.Gasto.map((c) => c[0]).filter((c) => c !== 'Otra'));
  st.movs.forEach((m) => m.tipo === 'Gasto' && cats.add(m.categoria));
  $('#pres-cat').innerHTML = [...cats].map((c) => `<option>${escapeHtml(c)}</option>`).join('');
}

const TIPO_ICO = { Billetera: '👛', Ahorro: '🏦', Negocio: '🏋️', 'Crédito': '💳', 'Inversión': '📈' };

function renderCuentas() {
  const pt = patrimonio();
  $('#patri-total').textContent = money(pt.total);
  $('#patri-personal').textContent = money(pt.personal);
  $('#patri-inmov').textContent = money(pt.inmov);
  $('#patri-deuda').textContent = money(pt.deuda);
  if (!st.cuentasOk) {
    $('#cuentas-list').innerHTML = `<div class="card"><div class="empty">Para ver tus cuentas, actualiza el Code.gs en Google Apps Script (te dejé los pasos).</div></div>`;
    return;
  }
  $('#cuentas-list').innerHTML = st.cuentas.length
    ? st.cuentas.map((c) => {
        const v = saldoCuenta(c);
        return `<div class="card cuenta-card">
          <div class="cuenta-top">
            <div class="mov-ico" aria-hidden="true">${TIPO_ICO[c.tipo] || '🏦'}</div>
            <div class="mov-txt">
              <span class="t">${escapeHtml(c.nombre)}${c.ambito === 'INMOV' ? '<span class="tag inmov">INMOV</span>' : ''}</span>
              <span class="s">${escapeHtml(c.tipo)}</span>
            </div>
            <span class="cuenta-saldo ${v < 0 ? 'red' : ''}">${money(v)}</span>
          </div>
          <form class="meta-actions" data-ajustar="${escapeHtml(c.id)}">
            <input class="input" name="saldo" type="number" inputmode="numeric" placeholder="Saldo real hoy" aria-label="Saldo real de ${escapeHtml(c.nombre)}" required />
            <button type="submit" class="btn-small">Ajustar</button>
          </form>
          <div class="stat-head"><span class="muted xs">${c.tipo === 'Crédito' ? 'Saldo negativo = lo que debes' : 'Ajusta si no calza con tu banco'}</span>
            <button type="button" class="link-btn" data-cuenta-del="${escapeHtml(c.id)}">Eliminar</button></div>
        </div>`;
      }).join('')
    : `<div class="card"><div class="empty">Aún no tienes cuentas. Agrega la primera aquí abajo.</div></div>`;
}

function renderTodo() {
  renderCuentas();
  renderThor();
  renderInicio();
  renderStats();
  renderMetas();
  renderPres();
}

// ============================================================
//  NAVEGACIÓN
// ============================================================

const TITULOS = { inicio: 'Pesito', stats: 'Gráficos', cuentas: 'Mis cuentas', metas: 'Metas de ahorro', presupuesto: 'Presupuesto' };

function irA(tab) {
  st.tab = tab;
  document.querySelectorAll('[data-tab]').forEach((el) => el.classList.toggle('hidden', el.id !== `tab-${tab}`));
  document.querySelectorAll('.tabbar [data-goto]').forEach((b) => b.classList.toggle('active', b.dataset.goto === tab));
  $('#periodos').classList.toggle('hidden', !(tab === 'inicio' || tab === 'stats'));
  $('#ambitos').classList.toggle('hidden', !(tab === 'inicio' || tab === 'stats'));
  $('#titulo').textContent = TITULOS[tab];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días, Nico' : h < 20 ? 'Buenas tardes, Nico' : 'Buenas noches, Nico';
}

// ============================================================
//  CARGA
// ============================================================

let refrescando = false;

async function refresh(manual = false) {
  if (refrescando) return;
  refrescando = true;
  const btn = $('#btn-refresh');
  btn.classList.add('spinning');
  btn.disabled = true;
  const minimo = new Promise((r) => setTimeout(r, manual ? 700 : 0));
  try {
    const cuentasP = api.getCuentas().then((c) => { st.cuentasOk = true; return c; }).catch(() => { st.cuentasOk = false; return []; });
    const [movs, metas, pres, cuentas] = await Promise.all([api.getMovimientos(), api.getAhorros(), api.getPresupuesto(), cuentasP, minimo]);
    st.cuentas = cuentas;
    st.movs = movs;
    st.metas = metas;
    st.pres = pres;
    renderTodo();
    if (manual) toast('Actualizado');
  } catch (err) {
    toast(err.message, 'error');
    if (err.message === 'No autorizado') logout();
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
    refrescando = false;
  }
}

// ============================================================
//  HOJAS (nuevo movimiento, ajustes)
// ============================================================

function abrir(id) {
  $(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function cerrar(id) {
  $(id).classList.add('hidden');
  document.body.style.overflow = '';
}

function cuentaPorId(id) { return st.cuentas.find((c) => c.id === id); }
function cuentaDefault() {
  return (st.cuentas.find((c) => c.tipo === 'Billetera') || st.cuentas[0] || {}).id || '';
}

function chipsCuentas(cont, seleccion, excluir) {
  $(cont).innerHTML = st.cuentas.filter((c) => c.id !== excluir).map((c) =>
    `<button type="button" class="chip${c.id === seleccion ? ' active' : ''}" data-cuenta="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}</button>`).join('');
}

/** Elegir cuenta: ajusta medio (CMR = Crédito) y si es de INMOV */
function setCuenta(id) {
  const form = $('#mov-form');
  form.cuenta.value = id;
  const c = cuentaPorId(id);
  if (c) {
    form.esInmov.checked = c.ambito === 'INMOV';
    if (c.tipo === 'Crédito') setMedio('Crédito');
    else if (form.medio.value === 'Crédito') setMedio('Débito');
  }
  chipsCuentas('#cuenta-chips', id);
  if (form.tipo.value === 'Traspaso') {
    if (form.cuentaDestino.value === id) form.cuentaDestino.value = '';
    chipsCuentas('#destino-chips', form.cuentaDestino.value, id);
  }
}

function setMedio(medio) {
  const form = $('#mov-form');
  form.medio.value = medio;
  document.querySelectorAll('#medio-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.medio === medio));
}

function setTipo(tipo) {
  const form = $('#mov-form');
  form.tipo.value = tipo;
  const tras = tipo === 'Traspaso';
  document.querySelectorAll('#tipo-seg button').forEach((b) => b.classList.toggle('active', b.dataset.tipo === tipo));
  $('#hormiga-row').classList.toggle('hidden', tipo !== 'Gasto');
  $('#cat-field').classList.toggle('hidden', tras);
  $('#medio-field').classList.toggle('hidden', tras);
  $('#inmov-row').classList.toggle('hidden', tras);
  $('#destino-field').classList.toggle('hidden', !tras);
  $('#cuenta-field').classList.toggle('hidden', !st.cuentas.length);
  $('#cuenta-label').textContent = tras ? 'Desde' : tipo === 'Ingreso' ? 'Llega a la cuenta' : 'Sale de la cuenta';
  if (tipo !== 'Gasto') form.esHormiga.checked = false;
  form.cuentaDestino.value = '';
  renderChips();
  setCuenta(form.cuenta.value || cuentaDefault());
}

function renderChips() {
  const form = $('#mov-form');
  const lista = CATEGORIAS[form.tipo.value] || CATEGORIAS.Gasto;
  $('#cat-chips').innerHTML = lista.map(([n, e]) =>
    `<button type="button" class="chip" data-cat="${escapeHtml(n)}"><span aria-hidden="true">${e}</span>${escapeHtml(n)}</button>`).join('');
  form.categoria.value = '';
  $('#cat-otra').classList.add('hidden');
  $('#cat-otra').value = '';
}

function resetMovForm(tipo = 'Gasto') {
  const form = $('#mov-form');
  form.reset();
  form.fecha.value = hoyISO();
  form.cuenta.value = '';
  setMedio('Débito');
  setTipo(tipo);
}

function initMovSheet() {
  const form = $('#mov-form');
  resetMovForm();

  $('#btn-nuevo').addEventListener('click', () => {
    resetMovForm();
    abrir('#sheet-mov');
    setTimeout(() => form.monto.focus(), 250);
  });
  $('#btn-traspaso').addEventListener('click', () => {
    resetMovForm('Traspaso');
    abrir('#sheet-mov');
  });

  $('#tipo-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tipo]');
    if (b) setTipo(b.dataset.tipo);
  });

  $('#cuenta-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cuenta]');
    if (b) setCuenta(b.dataset.cuenta);
  });
  $('#destino-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cuenta]');
    if (!b) return;
    form.cuentaDestino.value = b.dataset.cuenta;
    chipsCuentas('#destino-chips', b.dataset.cuenta, form.cuenta.value);
  });

  $('#cat-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#cat-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    const cat = chip.dataset.cat;
    const otra = cat === 'Otra' || cat === 'Otro';
    $('#cat-otra').classList.toggle('hidden', !otra);
    if (otra) {
      form.categoria.value = '';
      $('#cat-otra').focus();
    } else {
      form.categoria.value = cat;
      if (form.tipo.value === 'Gasto' && HORMIGA_SUGERIDAS.includes(cat)) form.esHormiga.checked = true;
    }
  });
  $('#cat-otra').addEventListener('input', (e) => { form.categoria.value = e.target.value.trim(); });

  $('#medio-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-medio]');
    if (chip) setMedio(chip.dataset.medio);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const tras = form.tipo.value === 'Traspaso';
    const mov = {
      fecha: form.fecha.value,
      tipo: form.tipo.value,
      categoria: tras ? 'Traspaso' : form.categoria.value,
      medio: tras ? 'Transferencia' : form.medio.value,
      monto: Number(form.monto.value),
      descripcion: form.descripcion.value,
      esHormiga: form.esHormiga.checked,
      cuenta: form.cuenta.value,
      cuentaDestino: tras ? form.cuentaDestino.value : '',
      ambito: form.esInmov.checked ? 'INMOV' : 'Personal',
    };
    if (!(mov.monto > 0)) return toast('Ingresa un monto mayor a 0', 'error');
    if (!mov.categoria) return toast('Elige una categoría', 'error');
    if (tras && (!mov.cuenta || !mov.cuentaDestino)) return toast('Elige la cuenta de origen y la de destino', 'error');
    if (tras) {
      const o = cuentaPorId(mov.cuenta), d = cuentaPorId(mov.cuentaDestino);
      if (!mov.descripcion) mov.descripcion = `${o ? o.nombre : ''} → ${d ? d.nombre : ''}`;
      mov.ambito = (o && o.ambito === 'INMOV') || (d && d.ambito === 'INMOV') ? 'INMOV' : 'Personal';
    }

    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await api.addMovimiento(mov);
      cerrar('#sheet-mov');
      toast(tras ? 'Traspaso guardado' : mov.tipo === 'Gasto' ? 'Gasto guardado' : 'Ingreso guardado');
      st.tipIdx = 0;
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}

/** Botones que piden un segundo toque para confirmar (sin ventanas emergentes) */
function confirmarDosToques(btn, textoConfirmar) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  const original = btn.textContent;
  btn.textContent = textoConfirmar;
  btn.classList.add('confirm');
  setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.armed;
    btn.textContent = original;
    btn.classList.remove('confirm');
  }, 3000);
  return false;
}

function initAcciones() {
  // Borrar movimiento
  $('#mov-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn || !confirmarDosToques(btn, '¿Borrar?')) return;
    btn.disabled = true;
    try {
      await api.deleteMovimiento(btn.dataset.del);
      toast('Movimiento eliminado');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  // Metas: abonar y eliminar
  $('#metas-list').addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-abonar]');
    if (!f) return;
    e.preventDefault();
    const monto = Number(f.monto.value);
    if (!(monto > 0)) return;
    const b = f.querySelector('button');
    b.disabled = true;
    try {
      await api.abonarMeta(f.dataset.abonar, monto);
      toast(`¡${money(monto)} abonados! THOR está orgulloso`);
      refresh();
    } catch (err) {
      toast(err.message, 'error');
      b.disabled = false;
    }
  });
  $('#metas-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-meta-del]');
    if (!btn || !confirmarDosToques(btn, '¿Seguro?')) return;
    try {
      await api.deleteMeta(btn.dataset.metaDel);
      toast('Meta eliminada');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#meta-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const b = f.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      await api.addMeta({
        nombre: f.nombre.value.trim(),
        montoObjetivo: Number(f.montoObjetivo.value),
        montoActual: Number(f.montoActual.value || 0),
        fechaLimite: f.fechaLimite.value || '',
      });
      f.reset();
      toast('Meta creada');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  });

  // Cuentas: ajustar saldo, eliminar, agregar
  $('#cuentas-list').addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-ajustar]');
    if (!f) return;
    e.preventDefault();
    const b = f.querySelector('button');
    b.disabled = true;
    try {
      await api.updateCuenta({ id: f.dataset.ajustar, saldoInicial: Number(f.saldo.value) });
      toast('Saldo ajustado');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
      b.disabled = false;
    }
  });
  $('#cuentas-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cuenta-del]');
    if (!btn || !confirmarDosToques(btn, '¿Seguro?')) return;
    try {
      await api.deleteCuenta(btn.dataset.cuentaDel);
      toast('Cuenta eliminada');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#cuenta-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const b = f.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      await api.addCuenta({ nombre: f.nombre.value.trim(), tipo: f.tipo.value, ambito: f.ambito.value, saldoInicial: Number(f.saldo.value || 0) });
      f.reset();
      toast('Cuenta agregada');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  });

  // Presupuesto
  $('#pres-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const b = f.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      await api.setPresupuesto(f.categoria.value, Number(f.limite.value));
      f.limite.value = '';
      toast('Límite guardado');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  });
  $('#pres-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pres-del]');
    if (!btn || !confirmarDosToques(btn, '¿Seguro?')) return;
    try {
      await api.deletePresupuesto(btn.dataset.presDel);
      toast('Límite quitado');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ============================================================
//  SESIÓN Y ARRANQUE
// ============================================================

function logout() {
  clearConfig();
  cerrar('#sheet-ajustes');
  showView('view-setup');
}

function startApp() {
  showView('view-app');
  $('#saludo').textContent = saludo();
  irA('inicio');
  refresh();
}

document.addEventListener('DOMContentLoaded', async () => {
  initSetup();
  initMovSheet();
  initAcciones();

  // Sin zoom con pellizco
  ['gesturestart', 'gesturechange'].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

  // Navegación (barra inferior y tarjetas con data-goto)
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) irA(g.dataset.goto);
  });

  // Pestañas Mes / Semana / Hoy
  $('#periodos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-periodo]');
    if (!b) return;
    st.periodo = b.dataset.periodo;
    st.tipIdx = 0;
    document.querySelectorAll('#periodos button').forEach((x) => x.classList.toggle('active', x === b));
    renderTodo();
    renderThor(true);
  });

  // Personal / INMOV / Todo
  $('#ambitos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ambito]');
    if (!b) return;
    st.ambito = b.dataset.ambito;
    st.tipIdx = 0;
    document.querySelectorAll('#ambitos button').forEach((x) => x.classList.toggle('active', x === b));
    renderTodo();
    renderThor(true);
  });

  // THOR: tocar para otro consejo
  $('#thor').addEventListener('click', () => {
    st.tipIdx++;
    renderThor(true);
  });

  // Hojas: cerrar con ✕ o tocando fuera
  document.querySelectorAll('.sheet-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => {
      if (e.target === bd || e.target.closest('[data-close]')) cerrar('#' + bd.id);
    });
  });

  $('#btn-refresh').addEventListener('click', () => refresh(true));
  $('#btn-ajustes').addEventListener('click', () => abrir('#sheet-ajustes'));
  $('#btn-logout').addEventListener('click', logout);
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
