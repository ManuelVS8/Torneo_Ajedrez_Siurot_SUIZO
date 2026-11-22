/**
 * Ajedrez Siurot · Torneo suizo
 * Google Apps Script (aplicación web) + Hoja de cálculo como base de datos.
 *
 * - Lectura pública (GET): cualquiera puede ver el torneo, sin poder cambiar nada.
 * - Escritura (POST): exige CLAVE_ADMIN, que solo vive aquí, en el servidor.
 * - Los puntos y el Buchholz se calculan SIEMPRE a partir de las partidas
 *   (hoja "Rondas"); las columnas de "Jugadores" son solo un reflejo para verlo en Sheets.
 */

// ====== CONFIGURACIÓN (edita estas dos líneas) ======
const SPREADSHEET_ID = "1F_t7y1HgwdOiC7t1CziTGkWaBhYWQFc-VUnTskeVmCU";
const CLAVE_ADMIN = "CAMBIA-ESTA-CLAVE";   // <- pon aquí tu clave nueva (no la subas a ningún sitio)
// ====================================================

const SHEET_PLAYERS = "Jugadores";
const SHEET_ROUNDS = "Rondas";
const SHEET_CONFIG = "Configuracion";
const HEAD_PLAYERS = ["Nombre", "Puntos", "Buchholz", "Victorias", "Descansos", "Colores", "Retirado"];
const HEAD_ROUNDS = ["Ronda", "Mesa", "Blancas", "Negras", "Resultado"];
const CACHE_KEY = "db_v3";
const CACHE_SECONDS = 30;
const MAX_FALLOS = 5;
const BLOQUEO_SEGUNDOS = 600;
const RESULTADOS = ["", "1-0", "0-1", "1/2-1/2"];

// ---------- Puntos de entrada ----------
function doGet(e) {
  try {
    const a = (e && e.parameter && e.parameter.action) || "read";
    if (a === "ping") return out_({ status: "ok", t: Date.now() });
    if (a !== "read") return out_({ status: "error", message: "Para modificar datos hay que usar el panel de administración." });
    return ContentService.createTextOutput(readPublicText_()).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error(err);
    return out_({ status: "error", message: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    let p;
    try { p = JSON.parse(e.postData.contents); } catch (x) { throw new Error("Petición no válida"); }
    return out_(handleAction_(p));
  } catch (err) {
    console.error(err);
    return out_({ status: "error", message: String(err.message || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleAction_(p) {
  const a = p.action;
  if (a === "read") return JSON.parse(readPublicText_());
  checkKey_(p.key);
  if (a === "login") return { status: "ok" };
  return withLock_(function () {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let extra = null;
    switch (a) {
      case "create": extra = createTournament_(ss, p); break;
      case "nextRound": extra = nextRound_(ss, p); break;
      case "undoRound": extra = undoRound_(ss); break;
      case "setResult": extra = setResult_(ss, p); break;
      case "setFecha": extra = setFecha_(ss, p); break;
      case "setAviso": setConfig_(ss, "Aviso", String(p.texto || "").slice(0, 300)); break;
      case "setNombre": setConfig_(ss, "Nombre", String(p.texto || "").slice(0, 60)); break;
      case "setRondas": extra = setRondas_(ss, p); break;
      case "setRetirado": extra = setRetirado_(ss, p); break;
      case "reset": resetAll_(ss); break;
      default: throw new Error("Acción desconocida");
    }
    touch_(ss);
    const res = { status: "ok" };
    if (a !== "setResult") res.db = buildDb_(ss);
    if (extra) for (const k in extra) res[k] = extra[k];
    return res;
  });
}

// ---------- Seguridad ----------
function checkKey_(key) {
  if (CLAVE_ADMIN === "CAMBIA-ESTA-CLAVE") throw new Error("Falta configurar CLAVE_ADMIN en el Script.");
  const cache = CacheService.getScriptCache();
  const fails = parseInt(cache.get("fallos") || "0", 10);
  if (fails >= MAX_FALLOS) throw new Error("Demasiados intentos fallidos. Espera 10 minutos.");
  if (typeof key !== "string" || key !== CLAVE_ADMIN) {
    cache.put("fallos", String(fails + 1), BLOQUEO_SEGUNDOS);
    throw new Error("Clave incorrecta");
  }
  if (fails > 0) cache.remove("fallos");
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function touch_(ss) {
  setConfig_(ss, "Actualizado", String(Date.now()));
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// ---------- Hojas ----------
function getSheet_(ss, name, head) {
  let s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  if (s.getLastRow() === 0) s.getRange(1, 1, 1, head.length).setValues([head]);
  return s;
}

function clearBody_(s) {
  const rows = s.getMaxRows() - 1;
  if (rows > 0) s.getRange(2, 1, rows, s.getMaxColumns()).clearContent();
}

function readConfig_(ss) {
  const s = ss.getSheetByName(SHEET_CONFIG);
  const map = {};
  if (!s || s.getLastRow() < 1) return map;
  s.getRange(1, 1, s.getLastRow(), 2).getValues().forEach(function (r) {
    if (r[0] !== "" && r[0] !== "Parametro") map[String(r[0])] = r[1] === null || r[1] === undefined ? "" : String(r[1]);
  });
  return map;
}

function setConfig_(ss, key, value) {
  const s = getSheet_(ss, SHEET_CONFIG, ["Parametro", "Valor"]);
  const last = s.getLastRow();
  let row = 0;
  if (last >= 1) {
    const keys = s.getRange(1, 1, last, 1).getValues();
    for (let i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) { row = i + 1; break; }
  }
  if (!row) { row = Math.max(last, 1) + 1; s.getRange(row, 1).setValue(key); }
  s.getRange(row, 2).setNumberFormat("@").setValue(String(value));
}

function readRaw_(ss) {
  const cfg = readConfig_(ss);
  const players = [];
  const ps = ss.getSheetByName(SHEET_PLAYERS);
  if (ps && ps.getLastRow() > 1) {
    const d = ps.getRange(2, 1, ps.getLastRow() - 1, 7).getValues();
    for (let i = 0; i < d.length; i++) {
      if (String(d[i][0]).trim() !== "") players.push({ id: i + 1, name: String(d[i][0]).trim(), retired: d[i][6] === true });
    }
  }
  const matches = [];
  const rs = ss.getSheetByName(SHEET_ROUNDS);
  if (rs && rs.getLastRow() > 1) {
    const d = rs.getRange(2, 1, rs.getLastRow() - 1, 5).getValues();
    for (let i = 0; i < d.length; i++) {
      if (d[i][0] === "" || d[i][0] === null) continue;
      matches.push({
        id: "m_" + d[i][0] + "_" + d[i][1],
        round: parseInt(d[i][0], 10),
        table: parseInt(d[i][1], 10),
        player1Id: parseInt(d[i][2], 10),
        player2Id: parseInt(d[i][3], 10),
        result: String(d[i][4] || "")
      });
    }
  }
  matches.sort(function (a, b) { return (a.round - b.round) || (a.table - b.table); });
  return { cfg: cfg, players: players, matches: matches };
}

// ---------- Estadísticas (única fuente de verdad: las partidas) ----------
function computeStats_(players, matches) {
  const st = {};
  players.forEach(function (p) { st[p.id] = { points: 0, bh: 0, wins: 0, byes: 0, colors: "", opps: [] }; });
  matches.forEach(function (m) {
    const a = st[m.player1Id];
    if (!a) return;
    if (m.player2Id === -1) { a.byes++; a.points += 1; return; }
    const b = st[m.player2Id];
    if (!b) return;
    a.colors += "B"; b.colors += "N";
    a.opps.push(m.player2Id); b.opps.push(m.player1Id);
    if (m.result === "1-0") { a.points += 1; a.wins++; }
    else if (m.result === "0-1") { b.points += 1; b.wins++; }
    else if (m.result === "1/2-1/2") { a.points += 0.5; b.points += 0.5; }
  });
  matches.forEach(function (m) {
    if (m.player2Id === -1 || !m.result) return;
    const a = st[m.player1Id], b = st[m.player2Id];
    if (!a || !b) return;
    a.bh += b.points; b.bh += a.points;
  });
  return st;
}

function rankSort_(a, b) {
  return (b.points - a.points) || (b.bh - a.bh) || (b.wins - a.wins) || (a.id - b.id);
}

function buildDb_(ss) {
  const raw = readRaw_(ss);
  const st = computeStats_(raw.players, raw.matches);
  const players = raw.players.map(function (p) {
    const s = st[p.id];
    return { id: p.id, name: p.name, retired: p.retired, points: s.points, buchholz: s.bh, wins: s.wins, byes: s.byes, colors: s.colors, pos: 0 };
  });
  players.slice().sort(rankSort_with_).forEach(function (p, i) { p.pos = i + 1; });
  let currentRound = 0;
  raw.matches.forEach(function (m) { if (m.round > currentRound) currentRound = m.round; });
  const total = parseInt(raw.cfg.TotalRondas || "0", 10) || 0;
  let lastDone = currentRound > 0;
  raw.matches.forEach(function (m) { if (m.round === currentRound && m.player2Id !== -1 && !m.result) lastDone = false; });
  const fechas = {};
  Object.keys(raw.cfg).forEach(function (k) {
    if (k.indexOf("Fecha_") === 0 && raw.cfg[k]) fechas[k.slice(6)] = raw.cfg[k];
  });
  return {
    players: players,
    matches: raw.matches,
    started: raw.matches.length > 0,
    currentRound: currentRound,
    totalRondas: total,
    finished: total > 0 && currentRound >= total && lastDone,
    roundDone: lastDone,
    nombre: raw.cfg.Nombre || "Torneo de ajedrez",
    aviso: raw.cfg.Aviso || "",
    fechas: fechas,
    updated: parseInt(raw.cfg.Actualizado || "0", 10) || 0
  };
}

function rankSort_with_(a, b) {
  return (b.points - a.points) || (b.buchholz - a.buchholz) || (b.wins - a.wins) || (a.id - b.id);
}

function readPublicText_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) return hit;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const txt = JSON.stringify({ status: "success", db: buildDb_(ss) });
  if (txt.length < 90000) cache.put(CACHE_KEY, txt, CACHE_SECONDS);
  return txt;
}

// Refleja puntos/Buchholz en la hoja "Jugadores" (solo para consultarla a mano)
function mirror_(ss) {
  const raw = readRaw_(ss);
  const st = computeStats_(raw.players, raw.matches);
  const ps = ss.getSheetByName(SHEET_PLAYERS);
  if (!ps || ps.getLastRow() < 2) return;
  const n = ps.getLastRow() - 1;
  const nums = [], cols = [];
  for (let i = 1; i <= n; i++) {
    const s = st[i];
    nums.push(s ? [s.points, s.bh, s.wins, s.byes] : ["", "", "", ""]);
    cols.push([s ? s.colors : ""]);
  }
  ps.getRange(2, 2, n, 4).setNumberFormat("General").setValues(nums);
  ps.getRange(2, 6, n, 1).setNumberFormat("@").setValues(cols);
}

// ---------- Crear torneo ----------
function createTournament_(ss, p) {
  let names = (Array.isArray(p.players) ? p.players : []).map(function (x) { return String(x).replace(/\s+/g, " ").trim(); }).filter(Boolean);
  if (names.length < 4) throw new Error("Hacen falta al menos 4 jugadores.");
  if (names.length > 200) throw new Error("Máximo 200 jugadores.");
  const seen = {}, dup = [];
  names.forEach(function (n) {
    const k = n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (seen[k]) dup.push(n); seen[k] = true;
  });
  if (dup.length) throw new Error("Nombres repetidos: " + dup.join(", ") + ". Añade el curso para distinguirlos.");
  const n = names.length;
  let rondas = parseInt(p.rondas, 10);
  if (!rondas) rondas = Math.max(2, Math.ceil(Math.log(n) / Math.LN2));
  rondas = Math.max(1, Math.min(rondas, maxRondas_(n)));
  names = shuffle_(names);

  const ps = getSheet_(ss, SHEET_PLAYERS, HEAD_PLAYERS);
  const rs = getSheet_(ss, SHEET_ROUNDS, HEAD_ROUNDS);
  const cs = getSheet_(ss, SHEET_CONFIG, ["Parametro", "Valor"]);
  ps.getRange(1, 1, 1, HEAD_PLAYERS.length).setValues([HEAD_PLAYERS]);
  rs.getRange(1, 1, 1, HEAD_ROUNDS.length).setValues([HEAD_ROUNDS]);
  clearBody_(ps); clearBody_(rs);
  ps.getRange(2, 1, n, 7).setValues(names.map(function (x) { return [x, 0, 0, 0, 0, "", false]; }));
  rs.getRange(1, 5, rs.getMaxRows(), 1).setNumberFormat("@");
  cs.clearContents();
  cs.getRange(1, 2, cs.getMaxRows(), 1).setNumberFormat("@");
  const cfg = [["Parametro", "Valor"], ["RondaActual", "1"], ["TotalRondas", String(rondas)],
    ["Nombre", String(p.nombre || "Torneo de ajedrez").slice(0, 60)], ["Aviso", ""], ["Actualizado", String(Date.now())]];
  cs.getRange(1, 1, cfg.length, 2).setValues(cfg);
  if (p.fecha) setFecha_(ss, { round: 1, fecha: p.fecha });
  const warnings = generateRound_(ss);
  return { warnings: warnings };
}

// Un suizo no debe tener más rondas que la mitad de jugadores (si no, es casi un todos-contra-todos y habría repeticiones)
function maxRondas_(n) {
  return Math.max(2, Math.min(12, Math.floor(n / 2)));
}

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function resetAll_(ss) {
  const ps = getSheet_(ss, SHEET_PLAYERS, HEAD_PLAYERS);
  const rs = getSheet_(ss, SHEET_ROUNDS, HEAD_ROUNDS);
  const cs = getSheet_(ss, SHEET_CONFIG, ["Parametro", "Valor"]);
  clearBody_(ps); clearBody_(rs);
  cs.clearContents();
  cs.getRange(1, 1, 1, 2).setValues([["Parametro", "Valor"]]);
}

// ---------- Rondas ----------
function nextRound_(ss, p) {
  const warnings = generateRound_(ss);
  if (p.fecha) {
    const raw = readRaw_(ss);
    let r = 0; raw.matches.forEach(function (m) { if (m.round > r) r = m.round; });
    setFecha_(ss, { round: r, fecha: p.fecha });
  }
  return { warnings: warnings };
}

function generateRound_(ss) {
  const raw = readRaw_(ss);
  const total = parseInt(raw.cfg.TotalRondas || "0", 10) || 0;
  let last = 0;
  raw.matches.forEach(function (m) { if (m.round > last) last = m.round; });
  raw.matches.forEach(function (m) {
    if (m.round === last && m.player2Id !== -1 && !m.result) throw new Error("Faltan resultados en la ronda " + last + ".");
  });
  const target = last + 1;
  if (total && target > total) throw new Error("El torneo ya tiene todas sus rondas.");
  const st = computeStats_(raw.players, raw.matches);
  const active = raw.players.filter(function (p) { return !p.retired; }).map(function (p) {
    const s = st[p.id];
    return { id: p.id, name: p.name, points: s.points, bh: s.bh, wins: s.wins, byes: s.byes, colors: s.colors, opps: s.opps };
  });
  if (active.length < 2) throw new Error("Quedan menos de 2 jugadores activos.");
  const res = pairRound_(active);
  const rows = [];
  res.pairs.forEach(function (pr, i) { rows.push([target, i + 1, pr.white, pr.black, ""]); });
  if (res.bye) rows.push([target, res.pairs.length + 1, res.bye, -1, "1-0"]);
  const rs = getSheet_(ss, SHEET_ROUNDS, HEAD_ROUNDS);
  const start = Math.max(rs.getLastRow(), 1) + 1;
  const rng = rs.getRange(start, 1, rows.length, 5);
  rs.getRange(start, 5, rows.length, 1).setNumberFormat("@");
  rng.setValues(rows);
  setConfig_(ss, "RondaActual", target);
  mirror_(ss);
  return res.warnings.map(function (w) { return "Ronda " + target + ": " + w; });
}

function undoRound_(ss) {
  const rs = ss.getSheetByName(SHEET_ROUNDS);
  if (!rs || rs.getLastRow() < 2) throw new Error("No hay rondas.");
  const d = rs.getRange(2, 1, rs.getLastRow() - 1, 5).getValues();
  let last = 0;
  d.forEach(function (r) { if (r[0] !== "" && r[0] > last) last = r[0]; });
  if (last <= 1) throw new Error("La ronda 1 no se puede deshacer; crea el torneo de nuevo si hace falta.");
  const keep = d.filter(function (r) { return r[0] !== "" && r[0] < last; });
  clearBody_(rs);
  if (keep.length) {
    rs.getRange(2, 5, keep.length, 1).setNumberFormat("@");
    rs.getRange(2, 1, keep.length, 5).setValues(keep);
  }
  setConfig_(ss, "RondaActual", last - 1);
  setConfig_(ss, "Fecha_" + last, "");
  mirror_(ss);
  return null;
}

function setResult_(ss, p) {
  const result = String(p.result || "");
  if (RESULTADOS.indexOf(result) < 0) throw new Error("Resultado no válido");
  const rs = ss.getSheetByName(SHEET_ROUNDS);
  if (!rs || rs.getLastRow() < 2) throw new Error("No hay partidas.");
  const d = rs.getRange(2, 1, rs.getLastRow() - 1, 5).getValues();
  let row = -1;
  for (let i = 0; i < d.length; i++) {
    if (parseInt(d[i][0], 10) === parseInt(p.round, 10) && parseInt(d[i][1], 10) === parseInt(p.table, 10)) { row = i; break; }
  }
  if (row < 0) throw new Error("No existe esa mesa.");
  if (parseInt(d[row][3], 10) === -1) throw new Error("La mesa de descanso no tiene resultado.");
  rs.getRange(row + 2, 5).setNumberFormat("@").setValue(result);
  d[row][4] = result;
  let done = true, last = 0;
  d.forEach(function (r) { if (r[0] > last) last = r[0]; });
  d.forEach(function (r) { if (r[0] === last && parseInt(r[3], 10) !== -1 && !r[4]) done = false; });
  if (done) mirror_(ss);
  return { roundDone: done };
}

function setFecha_(ss, p) {
  const f = String(p.fecha || "");
  if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error("Fecha no válida");
  const r = parseInt(p.round, 10);
  if (!r || r < 1 || r > 200) throw new Error("Ronda no válida");
  setConfig_(ss, "Fecha_" + r, f);
  return null;
}

function setRondas_(ss, p) {
  const raw = readRaw_(ss);
  let cur = 0; raw.matches.forEach(function (m) { if (m.round > cur) cur = m.round; });
  const n = parseInt(p.rondas, 10);
  const max = maxRondas_(raw.players.length);
  if (!n || n < Math.max(cur, 1) || n > max) throw new Error("Número de rondas no válido (de " + Math.max(cur, 1) + " a " + max + ").");
  setConfig_(ss, "TotalRondas", n);
  return null;
}

function setRetirado_(ss, p) {
  const id = parseInt(p.id, 10);
  const ps = ss.getSheetByName(SHEET_PLAYERS);
  if (!ps || !id || id + 1 > ps.getLastRow()) throw new Error("Jugador no válido");
  ps.getRange(id + 1, 7).setValue(p.value === true);
  return null;
}

// ---------- Emparejamiento suizo ----------
// Colores: nadie juega 3 seguidas con el mismo color y se intenta que el balance no pase de ±2.
// Si no hay forma de cumplirlo se relaja por niveles (y se avisa), nunca se repite rival salvo en el último nivel.
function colorNeed_(p, strictDiff) {
  const c = p.colors, n = c.length;
  const w = (c.match(/B/g) || []).length;
  const diff = w - (n - w);
  const last2 = c.slice(-2), last = c.slice(-1);
  if (last2 === "BB") return { c: "N", abs: true, s: 3 };
  if (last2 === "NN") return { c: "B", abs: true, s: 3 };
  if (diff >= 2) return { c: "N", abs: !!strictDiff, s: 2 };
  if (diff <= -2) return { c: "B", abs: !!strictDiff, s: 2 };
  if (diff > 0) return { c: "N", abs: false, s: 1 };
  if (diff < 0) return { c: "B", abs: false, s: 1 };
  if (last === "B") return { c: "N", abs: false, s: 0.5 };
  if (last === "N") return { c: "B", abs: false, s: 0.5 };
  return null;
}

function compatible_(p, q, level) {
  if (level < 3 && p.oppSet[q.id]) return false;
  if (level <= 1) {
    const a = colorNeed_(p, level === 0), b = colorNeed_(q, level === 0);
    if (a && b && a.abs && b.abs && a.c === b.c) return false;
  }
  return true;
}

function findMatching_(list, level, limit) {
  const n = list.length, used = [], pairs = [];
  for (let i = 0; i < n; i++) used.push(false);
  let nodes = 0, aborted = false;

  function candidates(i) {
    const group = [];
    for (let k = i; k < n; k++) if (!used[k] && list[k].points === list[i].points) group.push(k);
    const ideal = Math.floor(group.length / 2);
    const gi = {};
    group.forEach(function (k, x) { gi[k] = x; });
    const out = [];
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const same = list[j].points === list[i].points;
      out.push({ j: j, a: same ? 0 : list[i].points - list[j].points, b: same ? Math.abs(gi[j] - ideal) : j, c: same ? gi[j] : 0 });
    }
    out.sort(function (x, y) { return (x.a - y.a) || (x.b - y.b) || (x.c - y.c); });
    return out;
  }

  function rec() {
    if (aborted) return false;
    let i = 0;
    while (i < n && used[i]) i++;
    if (i >= n) return true;
    if (++nodes > limit) { aborted = true; return false; }
    used[i] = true;
    const cs = candidates(i);
    for (let x = 0; x < cs.length; x++) {
      const j = cs[x].j;
      if (!compatible_(list[i], list[j], level)) continue;
      used[j] = true; pairs.push([i, j]);
      if (rec()) return true;
      pairs.pop(); used[j] = false;
      if (aborted) break;
    }
    used[i] = false;
    return false;
  }
  return rec() ? pairs.map(function (pr) { return [list[pr[0]], list[pr[1]]]; }) : null;
}

function assignColors_(a, b, table) {
  const na = colorNeed_(a, true), nb = colorNeed_(b, true);
  const wa = na ? (na.c === "B" ? na.s : -na.s) : 0;  // >0: quiere blancas
  const wb = nb ? (nb.c === "B" ? nb.s : -nb.s) : 0;
  const d = wa - wb;
  if (d > 0) return { white: a, black: b };
  if (d < 0) return { white: b, black: a };
  return table % 2 === 1 ? { white: a, black: b } : { white: b, black: a };
}

function pairRound_(players) {
  const ranked = players.slice().sort(rankSort_);
  ranked.forEach(function (p) { p.oppSet = {}; p.opps.forEach(function (o) { p.oppSet[o] = true; }); });
  const odd = ranked.length % 2 === 1;
  for (let level = 0; level <= 3; level++) {
    let byeOrder = [null];
    if (odd) {
      const fromBottom = ranked.slice().reverse();
      byeOrder = fromBottom.filter(function (p) { return p.byes === 0; });
      if (!byeOrder.length) byeOrder = fromBottom;
      byeOrder = byeOrder.slice(0, 8);
    }
    for (let k = 0; k < byeOrder.length; k++) {
      const b = byeOrder[k];
      const rest = b ? ranked.filter(function (p) { return p !== b; }) : ranked;
      const m = findMatching_(rest, level, 30000);
      if (!m) continue;
      m.sort(function (x, y) { return rest.indexOf(x[0]) - rest.indexOf(y[0]); });
      const warnings = [];
      const pairs = m.map(function (pr, i) {
        const c = assignColors_(pr[0], pr[1], i + 1);
        if ((c.white.colors + "B").slice(-3) === "BBB") warnings.push(c.white.name + " juega 3 veces seguidas con blancas");
        if ((c.black.colors + "N").slice(-3) === "NNN") warnings.push(c.black.name + " juega 3 veces seguidas con negras");
        if (c.white.oppSet[c.black.id]) warnings.push(c.white.name + " y " + c.black.name + " ya habían jugado entre sí");
        return { white: c.white.id, black: c.black.id };
      });
      if (b && b.byes > 0) warnings.push(b.name + " descansa por segunda vez");
      return { pairs: pairs, bye: b ? b.id : null, warnings: warnings };
    }
  }
  throw new Error("No se pudo emparejar la ronda. Revisa los jugadores retirados.");
}
