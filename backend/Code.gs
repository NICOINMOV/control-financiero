/**
 * ============================================================
 *  Control Financiero Personal — API (Google Apps Script)
 *  Base de datos: Google Sheets | Respuestas: JSON
 * ============================================================
 *
 *  ENDPOINTS
 *  GET  ?key=XXX&action=...
 *    - ping
 *    - getMovimientos   [&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tipo=Gasto&hormiga=Sí]
 *    - getPresupuesto   [&mes=YYYY-MM]   (Gastado_Actual se calcula en vivo)
 *    - getAhorros
 *    - getResumen       [&mes=YYYY-MM]   (totales del mes, semana, hormiga, por medio)
 *    - getCuentas       (saldo inicial y fecha de cada cuenta; el saldo actual lo calcula la app)
 *
 *  POST (body JSON enviado como text/plain para evitar CORS)
 *    { key, action, data }
 *    - addMovimiento     data: {fecha, categoria, tipo, medio, monto, descripcion, esHormiga}
 *    - updateMovimiento  data: {id, ...campos a cambiar}
 *    - deleteMovimiento  data: {id}
 *    - setPresupuesto    data: {categoria, limiteMensual}   (crea o actualiza)
 *    - deletePresupuesto data: {categoria}
 *    - addMeta           data: {nombre, montoObjetivo, montoActual, fechaLimite}
 *    - updateMeta        data: {id, ...campos a cambiar}
 *    - abonarMeta        data: {id, monto}
 *    - deleteMeta        data: {id}
 *    - addCuenta         data: {nombre, tipo, ambito, saldoInicial}
 *    - updateCuenta      data: {id, ...campos}  (saldoInicial reinicia el punto de partida)
 *    - deleteCuenta      data: {id}
 *
 *  Movimientos: Tipo Ingreso | Gasto | Traspaso (entre cuentas, no cuenta como gasto)
 *  Cuenta / Cuenta_Destino = ID de la cuenta;  Ambito = Personal | INMOV
 */

// ---------- CONFIGURACIÓN ----------

const SHEETS = {
  MOVIMIENTOS: 'Movimientos',
  PRESUPUESTO: 'Presupuesto',
  AHORROS: 'Ahorros',
  CUENTAS: 'Cuentas',
};

const HEADERS = {
  Movimientos: ['ID', 'Fecha', 'Categoría', 'Tipo', 'Medio', 'Monto', 'Descripción', 'Es_Hormiga', 'Creado', 'Cuenta', 'Cuenta_Destino', 'Ambito'],
  Presupuesto: ['Categoría', 'Limite_Mensual', 'Gastado_Actual'],
  Ahorros: ['ID', 'Meta_Nombre', 'Monto_Objetivo', 'Monto_Actual', 'Fecha_Limite'],
  Cuentas: ['ID', 'Nombre', 'Tipo', 'Ambito', 'Saldo_Inicial', 'Fecha_Inicial'],
};

const TIPOS = ['Ingreso', 'Gasto', 'Traspaso'];
const AMBITOS = ['Personal', 'INMOV'];
const MEDIOS = ['Débito', 'Crédito', 'Efectivo', 'Transferencia'];
const TZ = Session.getScriptTimeZone();

// ---------- SETUP (ejecutar UNA vez desde el editor) ----------

/**
 * Crea las pestañas con sus encabezados, formatos y validaciones.
 * Si una pestaña ya existe, solo revisa sus encabezados.
 */
function setupHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);

    const headers = HEADERS[name];
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#1f2937')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });

  // Formatos y validaciones de Movimientos
  const mov = ss.getSheetByName(SHEETS.MOVIMIENTOS);
  mov.getRange('B2:B').setNumberFormat('yyyy-mm-dd');
  mov.getRange('F2:F').setNumberFormat('#,##0');
  mov.getRange('I2:I').setNumberFormat('yyyy-mm-dd hh:mm');
  mov.getRange('D2:D').setDataValidation(listRule_(TIPOS));
  mov.getRange('E2:E').setDataValidation(listRule_(MEDIOS));
  mov.getRange('H2:H').setDataValidation(listRule_(['Sí', 'No']));

  const pre = ss.getSheetByName(SHEETS.PRESUPUESTO);
  pre.getRange('B2:C').setNumberFormat('#,##0');

  const cue = ss.getSheetByName(SHEETS.CUENTAS);
  cue.getRange('E2:E').setNumberFormat('#,##0');
  cue.getRange('F2:F').setNumberFormat('yyyy-mm-dd hh:mm');
  mov.getRange('L2:L').setDataValidation(listRule_(AMBITOS));

  const aho = ss.getSheetByName(SHEETS.AHORROS);
  aho.getRange('C2:D').setNumberFormat('#,##0');
  aho.getRange('E2:E').setNumberFormat('yyyy-mm-dd');

  // Elimina la "Hoja 1" vacía si existe
  const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  // Genera la API key si aún no existe
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) {
    props.setProperty('API_KEY', Utilities.getUuid());
  }
  Logger.log('Listo. Tu API_KEY es: ' + props.getProperty('API_KEY'));
}

function listRule_(values) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
}

// ---------- ENTRADA HTTP ----------

function doGet(e) {
  return handle_(function () {
    const p = (e && e.parameter) || {};
    checkKey_(p.key);

    switch (p.action) {
      case 'ping':           return { ok: true, time: new Date().toISOString() };
      case 'getMovimientos': return getMovimientos_(p);
      case 'getPresupuesto': return getPresupuesto_(p.mes);
      case 'getAhorros':     return getAhorros_();
      case 'getResumen':     return getResumen_(p.mes);
      case 'getCuentas':     return getCuentas_();
      default: throw new Error('Acción GET no válida: ' + p.action);
    }
  });
}

function doPost(e) {
  return handle_(function () {
    if (!e || !e.postData) throw new Error('Body vacío');
    const body = JSON.parse(e.postData.contents);
    checkKey_(body.key);
    const d = body.data || {};

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      switch (body.action) {
        case 'addMovimiento':     return addMovimiento_(d);
        case 'updateMovimiento':  return updateRow_(SHEETS.MOVIMIENTOS, d.id, mapMovimiento_(d, true));
        case 'deleteMovimiento':  return deleteRow_(SHEETS.MOVIMIENTOS, d.id);
        case 'setPresupuesto':    return setPresupuesto_(d);
        case 'deletePresupuesto': return deletePresupuesto_(d.categoria);
        case 'addMeta':           return addMeta_(d);
        case 'updateMeta':        return updateRow_(SHEETS.AHORROS, d.id, mapMeta_(d, true));
        case 'abonarMeta':        return abonarMeta_(d);
        case 'deleteMeta':        return deleteRow_(SHEETS.AHORROS, d.id);
        case 'addCuenta':         return addCuenta_(d);
        case 'updateCuenta':      return updateRow_(SHEETS.CUENTAS, d.id, mapCuenta_(d, true));
        case 'deleteCuenta':      return deleteRow_(SHEETS.CUENTAS, d.id);
        default: throw new Error('Acción POST no válida: ' + body.action);
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function handle_(fn) {
  let out;
  try {
    out = { success: true, data: fn() };
  } catch (err) {
    out = { success: false, error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(key) {
  const real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real) throw new Error('API no configurada. Ejecuta setupHojas() en el editor.');
  if (key !== real) throw new Error('No autorizado');
}

// ---------- HELPERS DE HOJA ----------

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('No existe la pestaña "' + name + '". Ejecuta setupHojas().');
  return sh;
}

/** Devuelve las filas como objetos {Encabezado: valor, _row: n} */
function readAll_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  return values
    .map(function (r, i) {
      const o = { _row: i + 2 };
      headers.forEach(function (h, j) { o[h] = r[j]; });
      return o;
    })
    .filter(function (o) { return o[headers[0]] !== ''; });
}

function findRowById_(name, id) {
  if (!id) throw new Error('Falta id');
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

/** Actualiza solo las columnas presentes en `fields` ({Encabezado: valor}) */
function updateRow_(name, id, fields) {
  const row = findRowById_(name, id);
  if (row < 0) throw new Error('No se encontró el registro ' + id);
  const sh = sheet_(name);
  const headers = HEADERS[name];
  Object.keys(fields).forEach(function (h) {
    const col = headers.indexOf(h);
    if (col >= 0) sh.getRange(row, col + 1).setValue(fields[h]);
  });
  return { id: id, updated: Object.keys(fields) };
}

function deleteRow_(name, id) {
  const row = findRowById_(name, id);
  if (row < 0) throw new Error('No se encontró el registro ' + id);
  sheet_(name).deleteRow(row);
  return { id: id, deleted: true };
}

function newId_() {
  return Utilities.getUuid().split('-')[0] + Date.now().toString(36);
}

// ---------- PARSEO / VALIDACIÓN ----------

function serialToDate_(n) {
  return new Date(Math.round((n - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);
}

function fmtDate_(v) {
  if (!v) return '';
  if (typeof v === 'number') v = serialToDate_(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function fmtDateTime_(v) {
  if (!v) return '';
  if (typeof v === 'number') v = serialToDate_(v);
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

/** Acepta 'YYYY-MM-DD' y lo convierte a Date local (evita desfase UTC) */
function parseDate_(s) {
  if (s instanceof Date) return s;
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error('Fecha inválida (usa YYYY-MM-DD): ' + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function parseMonto_(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw new Error('Monto inválido: ' + v);
  return n;
}

function parseSiNo_(v) {
  return v === true || v === 'Sí' || v === 'Si' || v === 'sí' || v === 'si' ? 'Sí' : 'No';
}

function inList_(v, list, campo) {
  if (list.indexOf(v) < 0) throw new Error(campo + ' debe ser: ' + list.join(', '));
  return v;
}

/** Convierte data del frontend a {Encabezado: valor}. partial=true para updates */
function mapMovimiento_(d, partial) {
  const f = {};
  if (!partial || d.fecha !== undefined)       f['Fecha'] = parseDate_(d.fecha);
  if (!partial || d.categoria !== undefined)   f['Categoría'] = String(d.categoria || '').trim() || 'Sin categoría';
  if (!partial || d.tipo !== undefined)        f['Tipo'] = inList_(d.tipo, TIPOS, 'Tipo');
  if (!partial || d.medio !== undefined)       f['Medio'] = inList_(d.medio || 'Transferencia', MEDIOS, 'Medio');
  if (!partial || d.monto !== undefined)       f['Monto'] = parseMonto_(d.monto);
  if (!partial || d.descripcion !== undefined) f['Descripción'] = String(d.descripcion || '');
  if (!partial || d.esHormiga !== undefined)   f['Es_Hormiga'] = parseSiNo_(d.esHormiga);
  if (!partial || d.cuenta !== undefined)      f['Cuenta'] = String(d.cuenta || '');
  if (!partial || d.cuentaDestino !== undefined) f['Cuenta_Destino'] = String(d.cuentaDestino || '');
  if (!partial || d.ambito !== undefined)      f['Ambito'] = AMBITOS.indexOf(d.ambito) >= 0 ? d.ambito : 'Personal';
  if (f['Tipo'] === 'Traspaso' && (!f['Cuenta'] || !f['Cuenta_Destino'])) throw new Error('Un traspaso necesita cuenta de origen y destino');
  return f;
}

function mapMeta_(d, partial) {
  const f = {};
  if (!partial || d.nombre !== undefined)        f['Meta_Nombre'] = String(d.nombre || '').trim();
  if (!partial || d.montoObjetivo !== undefined) f['Monto_Objetivo'] = parseMonto_(d.montoObjetivo);
  if (!partial || d.montoActual !== undefined)   f['Monto_Actual'] = parseMonto_(d.montoActual || 0);
  if (!partial || d.fechaLimite !== undefined)   f['Fecha_Limite'] = d.fechaLimite ? parseDate_(d.fechaLimite) : '';
  if (!partial && !f['Meta_Nombre']) throw new Error('La meta necesita un nombre');
  return f;
}

function movToJson_(o) {
  return {
    id: String(o['ID']),
    fecha: fmtDate_(o['Fecha']),
    categoria: o['Categoría'],
    tipo: o['Tipo'],
    medio: o['Medio'],
    monto: Number(o['Monto']) || 0,
    descripcion: o['Descripción'],
    esHormiga: o['Es_Hormiga'] === 'Sí',
    creado: fmtDateTime_(o['Creado']),
    cuenta: String(o['Cuenta'] || ''),
    cuentaDestino: String(o['Cuenta_Destino'] || ''),
    ambito: o['Ambito'] || 'Personal',
  };
}

// ---------- MOVIMIENTOS ----------

function getMovimientos_(p) {
  let list = readAll_(SHEETS.MOVIMIENTOS).map(movToJson_);
  if (p.desde)   list = list.filter(function (m) { return m.fecha >= p.desde; });
  if (p.hasta)   list = list.filter(function (m) { return m.fecha <= p.hasta; });
  if (p.tipo)    list = list.filter(function (m) { return m.tipo === p.tipo; });
  if (p.hormiga) list = list.filter(function (m) { return m.esHormiga === (parseSiNo_(p.hormiga) === 'Sí'); });
  list.sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
  return list;
}

function addMovimiento_(d) {
  const f = mapMovimiento_(d, false);
  const id = newId_();
  const row = HEADERS.Movimientos.map(function (h) {
    if (h === 'ID') return id;
    if (h === 'Creado') return new Date();
    return f[h];
  });
  sheet_(SHEETS.MOVIMIENTOS).appendRow(row);
  return { id: id };
}

// ---------- PRESUPUESTO ----------

function mesActual_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
}

function gastosPorCategoria_(mes) {
  const totals = {};
  readAll_(SHEETS.MOVIMIENTOS).forEach(function (o) {
    const m = movToJson_(o);
    if (m.tipo === 'Gasto' && m.fecha.slice(0, 7) === mes) {
      totals[m.categoria] = (totals[m.categoria] || 0) + m.monto;
    }
  });
  return totals;
}

/** Calcula Gastado_Actual del mes, lo escribe en la hoja y lo devuelve */
function getPresupuesto_(mes) {
  mes = mes || mesActual_();
  const gastos = gastosPorCategoria_(mes);
  const sh = sheet_(SHEETS.PRESUPUESTO);
  const rows = readAll_(SHEETS.PRESUPUESTO);

  const result = rows.map(function (o) {
    const limite = Number(o['Limite_Mensual']) || 0;
    const gastado = gastos[o['Categoría']] || 0;
    return {
      categoria: o['Categoría'],
      limiteMensual: limite,
      gastadoActual: gastado,
      disponible: limite - gastado,
      porcentaje: limite > 0 ? Math.round((gastado / limite) * 100) : 0,
      _row: o._row,
    };
  });

  // Solo se sincroniza la columna en la hoja cuando se consulta el mes actual
  if (mes === mesActual_() && result.length) {
    result.forEach(function (r) { sh.getRange(r._row, 3).setValue(r.gastadoActual); });
  }
  return result.map(function (r) { delete r._row; return r; });
}

function setPresupuesto_(d) {
  const cat = String(d.categoria || '').trim();
  if (!cat) throw new Error('Falta categoría');
  const limite = parseMonto_(d.limiteMensual);
  const sh = sheet_(SHEETS.PRESUPUESTO);
  const existing = readAll_(SHEETS.PRESUPUESTO).filter(function (o) { return o['Categoría'] === cat; })[0];
  if (existing) {
    sh.getRange(existing._row, 2).setValue(limite);
    return { categoria: cat, updated: true };
  }
  sh.appendRow([cat, limite, 0]);
  return { categoria: cat, created: true };
}

function deletePresupuesto_(cat) {
  const existing = readAll_(SHEETS.PRESUPUESTO).filter(function (o) { return o['Categoría'] === cat; })[0];
  if (!existing) throw new Error('No existe la categoría ' + cat);
  sheet_(SHEETS.PRESUPUESTO).deleteRow(existing._row);
  return { categoria: cat, deleted: true };
}

// ---------- AHORROS ----------

function getAhorros_() {
  return readAll_(SHEETS.AHORROS).map(function (o) {
    const obj = Number(o['Monto_Objetivo']) || 0;
    const act = Number(o['Monto_Actual']) || 0;
    return {
      id: String(o['ID']),
      nombre: o['Meta_Nombre'],
      montoObjetivo: obj,
      montoActual: act,
      fechaLimite: fmtDate_(o['Fecha_Limite']),
      progreso: obj > 0 ? Math.min(100, Math.round((act / obj) * 100)) : 0,
    };
  });
}

function addMeta_(d) {
  const f = mapMeta_(d, false);
  const id = newId_();
  const row = HEADERS.Ahorros.map(function (h) { return h === 'ID' ? id : f[h]; });
  sheet_(SHEETS.AHORROS).appendRow(row);
  return { id: id };
}

function abonarMeta_(d) {
  const row = findRowById_(SHEETS.AHORROS, d.id);
  if (row < 0) throw new Error('No se encontró la meta ' + d.id);
  const monto = Number(d.monto);
  if (!isFinite(monto)) throw new Error('Monto inválido');
  const cell = sheet_(SHEETS.AHORROS).getRange(row, 4);
  const nuevo = Math.max(0, (Number(cell.getValue()) || 0) + monto);
  cell.setValue(nuevo);
  return { id: d.id, montoActual: nuevo };
}

// ---------- CUENTAS ----------

function mapCuenta_(d, partial) {
  const f = {};
  if (!partial || d.nombre !== undefined)       f['Nombre'] = String(d.nombre || '').trim();
  if (!partial || d.tipo !== undefined)         f['Tipo'] = String(d.tipo || 'Ahorro');
  if (!partial || d.ambito !== undefined)       f['Ambito'] = AMBITOS.indexOf(d.ambito) >= 0 ? d.ambito : 'Personal';
  if (!partial || d.saldoInicial !== undefined) f['Saldo_Inicial'] = Number(d.saldoInicial) || 0;
  if (!partial || d.saldoInicial !== undefined) f['Fecha_Inicial'] = new Date(); // ajustar saldo = nuevo punto de partida
  if (!partial && !f['Nombre']) throw new Error('La cuenta necesita un nombre');
  return f;
}

function getCuentas_() {
  return readAll_(SHEETS.CUENTAS).map(function (o) {
    return {
      id: String(o['ID']),
      nombre: o['Nombre'],
      tipo: o['Tipo'],
      ambito: o['Ambito'] || 'Personal',
      saldoInicial: Number(o['Saldo_Inicial']) || 0,
      fechaInicial: fmtDateTime_(o['Fecha_Inicial']),
    };
  });
}

function addCuenta_(d) {
  const f = mapCuenta_(d, false);
  const id = newId_();
  const row = HEADERS.Cuentas.map(function (h) { return h === 'ID' ? id : f[h]; });
  sheet_(SHEETS.CUENTAS).appendRow(row);
  return { id: id };
}

// ---------- RESUMEN (dashboard) ----------

function getResumen_(mes) {
  mes = mes || mesActual_();
  const all = readAll_(SHEETS.MOVIMIENTOS).map(movToJson_);
  const delMes = all.filter(function (m) { return m.fecha.slice(0, 7) === mes; });

  // Semana actual (lunes a domingo)
  const hoy = new Date();
  const dia = (hoy.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dia);
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  const desde = fmtDate_(lunes), hasta = fmtDate_(domingo);
  const semana = all.filter(function (m) { return m.fecha >= desde && m.fecha <= hasta; });

  function sum(list, pred) {
    return list.reduce(function (a, m) { return pred(m) ? a + m.monto : a; }, 0);
  }
  const esGasto = function (m) { return m.tipo === 'Gasto'; };
  const esIngreso = function (m) { return m.tipo === 'Ingreso'; };

  const porCategoria = {};
  delMes.filter(esGasto).forEach(function (m) {
    porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + m.monto;
  });

  const porMedio = {};
  MEDIOS.forEach(function (md) {
    porMedio[md] = sum(delMes, function (m) { return esGasto(m) && m.medio === md; });
  });

  const ingresos = sum(delMes, esIngreso);
  const gastos = sum(delMes, esGasto);

  return {
    mes: mes,
    ingresosMes: ingresos,
    gastosMes: gastos,
    balanceMes: ingresos - gastos,
    semana: {
      desde: desde,
      hasta: hasta,
      ingresos: sum(semana, esIngreso),
      gastos: sum(semana, esGasto),
    },
    hormiga: {
      totalMes: sum(delMes, function (m) { return esGasto(m) && m.esHormiga; }),
      cantidadMes: delMes.filter(function (m) { return esGasto(m) && m.esHormiga; }).length,
    },
    gastosPorMedio: porMedio,
    gastosPorCategoria: porCategoria,
  };
}

// ============================================================
//  ALERTAS DE THOR POR CORREO
//  1) Ejecuta activarAlertasThor() UNA vez desde el editor (pide permiso para enviar correos).
//  2) Cada noche a las 21:00 THOR revisa tus números y te escribe SOLO si hay algo nuevo.
//  Para apagarlo: ejecuta desactivarAlertasThor().
// ============================================================

const APP_URL = 'https://nicoinmov.github.io/control-financiero/';
const THOR_IMG = APP_URL + 'icons/icon-192.png';

function activarAlertasThor() {
  desactivarAlertasThor();
  ScriptApp.newTrigger('revisarAlertasThor').timeBased().everyDays(1).atHour(21).create();
  revisarAlertasThor();
  Logger.log('Listo: THOR te escribirá cada noche si hay algo que avisar.');
}

function desactivarAlertasThor() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarAlertasThor') ScriptApp.deleteTrigger(t);
  });
}

function money_(n) {
  const v = Math.round(Number(n) || 0);
  const s = '$' + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v < 0 ? '−' + s : s;
}

/** Calcula las alertas del mes en curso */
function calcularAlertasThor_() {
  const mes = mesActual_();
  const hoy = new Date();
  const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const quedan = diasMes - hoy.getDate();
  const movs = readAll_(SHEETS.MOVIMIENTOS).map(movToJson_).filter(function (m) { return m.fecha.slice(0, 7) === mes; });
  let cuentas = [];
  try { cuentas = getCuentas_(); } catch (e) { cuentas = []; }
  const ahorroIds = cuentas.filter(function (c) { return c.tipo === 'Ahorro'; }).map(function (c) { return c.id; });

  const alertas = []; // { clave, texto }

  // Presupuestos
  const porCat = {};
  movs.forEach(function (m) { if (m.tipo === 'Gasto') porCat[m.categoria] = (porCat[m.categoria] || 0) + m.monto; });
  let pres = [];
  try { pres = readAll_(SHEETS.PRESUPUESTO); } catch (e) { pres = []; }
  pres.forEach(function (o) {
    const cat = o['Categoría'], lim = Number(o['Limite_Mensual']) || 0, usado = porCat[cat] || 0;
    if (!lim) return;
    const pc = Math.round((usado / lim) * 100);
    if (pc >= 100) alertas.push({ clave: mes + '|pres100|' + cat, texto: 'Te pasaste ' + money_(usado - lim) + ' en ' + cat + '. Pero tranquilo, el presupuesto era solo una sugerencia, ¿no? 🙃' });
    else if (pc >= 80) alertas.push({ clave: mes + '|pres80|' + cat, texto: 'Vas en el ' + pc + '% de ' + cat + ' y quedan ' + quedan + ' días del mes. Haz la matemática… yo ya la hice. 🧮' });
  });

  // Gastos personales vs ingresos personales
  let ing = 0, gas = 0;
  movs.forEach(function (m) {
    if ((m.ambito || 'Personal') !== 'Personal') return;
    if (m.tipo === 'Ingreso') ing += m.monto;
    if (m.tipo === 'Gasto') gas += m.monto;
  });
  if (gas > ing) {
    const tramo = Math.floor((gas - ing) / 100000); // avisa de nuevo cada $100.000 más en rojo
    alertas.push({ clave: mes + '|rojo|' + tramo, texto: 'Este mes gastaste ' + money_(gas - ing) + ' más de lo que entró. Not stonks 📉. Tus ahorros te miran nerviosos.' });
  }

  // Ahorro protegido tocado
  let sacado = 0;
  movs.forEach(function (m) {
    if (ahorroIds.indexOf(m.cuenta) < 0) return;
    if (m.tipo === 'Gasto') sacado += m.monto;
    if (m.tipo === 'Traspaso' && ahorroIds.indexOf(m.cuentaDestino) < 0) sacado += m.monto;
  });
  if (sacado > 0) alertas.push({ clave: mes + '|ahorro|' + sacado, texto: 'Salieron ' + money_(sacado) + ' de tu ahorro protegido este mes. Espero que haya sido una emergencia de verdad. 👀' });

  // Hormiga
  const hormiga = movs.filter(function (m) { return m.tipo === 'Gasto' && m.esHormiga; });
  if (hormiga.length >= 8) {
    const total = hormiga.reduce(function (s, m) { return s + m.monto; }, 0);
    alertas.push({ clave: mes + '|hormiga|' + Math.floor(hormiga.length / 8), texto: hormiga.length + ' gastos hormiga este mes (' + money_(total) + '). Las hormigas te lo agradecen, tu bolsillo no. 🐜' });
  }

  return alertas;
}

/** Envía por correo solo las alertas que aún no se han avisado */
function revisarAlertasThor() {
  const props = PropertiesService.getScriptProperties();
  let enviadas = {};
  try { enviadas = JSON.parse(props.getProperty('THOR_ENVIADAS') || '{}'); } catch (e) { enviadas = {}; }
  const mes = mesActual_();
  Object.keys(enviadas).forEach(function (k) { if (k.indexOf(mes) !== 0) delete enviadas[k]; }); // limpia meses anteriores

  const nuevas = calcularAlertasThor_().filter(function (a) { return !enviadas[a.clave]; });
  if (!nuevas.length) return { enviadas: 0 };

  const items = nuevas.map(function (a) {
    return '<li style="margin:0 0 12px;line-height:1.45">' + a.texto + '</li>';
  }).join('');
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0B0F17;color:#F1F5F9;padding:24px;border-radius:20px">' +
    '<img src="' + THOR_IMG + '" width="72" height="72" style="border-radius:18px;border:2px solid #F5B82E" alt="THOR">' +
    '<h2 style="color:#F5B82E;margin:16px 0 8px">THOR tiene algo que decirte</h2>' +
    '<ul style="padding-left:18px;margin:0 0 20px">' + items + '</ul>' +
    '<a href="' + APP_URL + '" style="display:inline-block;background:#F5B82E;color:#0B0F17;padding:12px 20px;border-radius:12px;font-weight:bold;text-decoration:none">Abrir Pesito</a>' +
    '</div>';

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: '🐶 THOR: ' + (nuevas.length === 1 ? 'tenemos que hablar' : nuevas.length + ' cosas que tenemos que hablar'),
    htmlBody: html,
    body: nuevas.map(function (a) { return '• ' + a.texto; }).join('\n') + '\n\n' + APP_URL,
  });

  nuevas.forEach(function (a) { enviadas[a.clave] = true; });
  props.setProperty('THOR_ENVIADAS', JSON.stringify(enviadas));
  return { enviadas: nuevas.length };
}
