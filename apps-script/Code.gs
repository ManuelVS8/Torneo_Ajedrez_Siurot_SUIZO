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
// "F" al final = incomparecencia (cuenta los puntos, pero no la partida jugada: ni colores, ni Buchholz, ni rivales)
const RESULTADOS = ["", "1-0", "0-1", "1/2-1/2", "1-0F", "0-1F", "0-0F"];
const SHEET_HIST = "Historico";
const HEAD_HIST = ["Fecha", "Torneo", "Jugadores", "Campeón", "Datos"];
const MAX_HIST = 30;
// Desempates (en este orden). directo = enfrentamiento directo, bh1 = Buchholz sin el peor rival, bh = Buchholz,
// sb = Sonneborn-Berger, vict = nº de victorias, prog = puntuación progresiva
const DESEMP_DEF = "directo,bh1,bh,sb,vict";
const DESEMP_OK = ["directo", "bh1", "bh", "sb", "vict", "prog"];

// ---------- Puntos de entrada ----------
function doGet(e) {
  try {
    const a = (e && e.parameter && e.parameter.action) || "read";
    if (a === "ping") return out_({ status: "ok", t: Date.now() });
    if (a === "historial") return out_({ status: "success", lista: listHistorial_() });
    if (a === "archivo") return out_({ status: "success", db: readArchivo_(parseInt(e.parameter.n, 10)) });
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
      case "reset": archive_(ss); resetAll_(ss); break;
      case "setAusente": setAusente_(ss, p); break;
      case "addPlayer": extra = addPlayer_(ss, p); break;
      case "setDesempates": setDesempates_(ss, p); break;
      case "restore": extra = restore_(ss, p); break;
      case "getInscritos": extra = { inscritos: leerInscritos_(ss) }; break;
      case "addInscritos": extra = addInscritos_(ss, p); break;
      case "removeInscrito": extra = removeInscrito_(ss, p); break;
      case "clearInscritos": guardarInscritos_(ss, []); extra = { inscritos: [] }; break;
      case "archive": extra = { archived: archive_(ss) }; break;
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
// Tipos de mesa: rival > 0 partida normal · -1 descanso (1 punto) · -2 ausente (0) · -3 ausente con ½ punto
function esPartida_(m) { return m.player2Id > 0; }

function computeStats_(players, matches) {
  const st = {};
  players.forEach(function (p) { st[p.id] = { points: 0, bh: 0, bh1: 0, sb: 0, prog: 0, wins: 0, byes: 0, aus: 0, colors: "", opps: [], oppPts: [] }; });
  const rounds = {};
  matches.forEach(function (m) { (rounds[m.round] = rounds[m.round] || []).push(m); });
  Object.keys(rounds).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
    rounds[r].forEach(function (m) {
      const a = st[m.player1Id];
      if (!a) return;
      if (m.player2Id === -1) { a.byes++; a.points += 1; return; }
      if (m.player2Id === -2) { a.aus++; return; }
      if (m.player2Id === -3) { a.aus++; a.points += 0.5; return; }
      const b = st[m.player2Id];
      if (!b) return;
      const forf = /F$/.test(m.result);
      const res = m.result.replace("F", "");
      if (!forf) { a.colors += "B"; b.colors += "N"; a.opps.push(m.player2Id); b.opps.push(m.player1Id); }
      if (res === "1-0") { a.points += 1; if (!forf) a.wins++; }
      else if (res === "0-1") { b.points += 1; if (!forf) b.wins++; }
      else if (res === "1/2-1/2") { a.points += 0.5; b.points += 0.5; }
    });
    players.forEach(function (p) { st[p.id].prog += st[p.id].points; });
  });
  matches.forEach(function (m) {
    if (!esPartida_(m) || !m.result || /F$/.test(m.result)) return;
    const a = st[m.player1Id], b = st[m.player2Id];
    if (!a || !b) return;
    a.bh += b.points; b.bh += a.points;
    a.oppPts.push(b.points); b.oppPts.push(a.points);
    if (m.result === "1-0") a.sb += b.points;
    else if (m.result === "0-1") b.sb += a.points;
    else if (m.result === "1/2-1/2") { a.sb += b.points / 2; b.sb += a.points / 2; }
  });
  players.forEach(function (p) {
    const s = st[p.id];
    s.bh1 = s.oppPts.length ? s.bh - Math.min.apply(null, s.oppPts) : 0;
  });
  return st;
}

// Para emparejar: puntos, Buchholz, victorias
function rankSort_(a, b) {
  return (b.points - a.points) || (b.bh - a.bh) || (b.wins - a.wins) || (a.id - b.id);
}

function parseDesemp_(s) {
  const out = [];
  String(s || "").split(",").forEach(function (k) {
    k = k.trim();
    if (DESEMP_OK.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k);
  });
  return out.length ? out : DESEMP_DEF.split(",");
}

// Clasificación: puntos y después los desempates elegidos, en orden.
function rankPlayers_(list, matches, crit) {
  const sorted = list.slice().sort(function (a, b) { return (b.points - a.points) || (a.id - b.id); });
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].points === sorted[i].points) j++;
    tieBreak_(sorted.slice(i, j), crit, matches).forEach(function (p) { out.push(p); });
    i = j;
  }
  return out;
}

function tieBreak_(group, crit, matches) {
  if (group.length <= 1) return group;
  if (!crit.length) return group.slice().sort(function (a, b) { return a.id - b.id; });
  const k = crit[0], rest = crit.slice(1), val = {};
  if (k === "directo") {
    const ids = {}, met = {};
    let n = 0;
    group.forEach(function (p) { ids[p.id] = true; val[p.id] = 0; });
    matches.forEach(function (m) {
      if (!ids[m.player1Id] || !ids[m.player2Id] || !m.result || /F$/.test(m.result)) return;
      const key = Math.min(m.player1Id, m.player2Id) + "-" + Math.max(m.player1Id, m.player2Id);
      if (!met[key]) { met[key] = true; n++; }
      if (m.result === "1-0") val[m.player1Id] += 1;
      else if (m.result === "0-1") val[m.player2Id] += 1;
      else { val[m.player1Id] += 0.5; val[m.player2Id] += 0.5; }
    });
    // Solo sirve si TODOS los empatados se han enfrentado entre sí
    if (n < group.length * (group.length - 1) / 2) group.forEach(function (p) { val[p.id] = 0; });
  } else {
    const f = k === "vict" ? "wins" : k;
    group.forEach(function (p) { val[p.id] = p[f]; });
  }
  const sorted = group.slice().sort(function (a, b) { return (val[b.id] - val[a.id]) || (a.id - b.id); });
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && val[sorted[j].id] === val[sorted[i].id]) j++;
    tieBreak_(sorted.slice(i, j), rest, matches).forEach(function (p) { out.push(p); });
    i = j;
  }
  return out;
}

function parseAusentes_(s) {
  const out = {};
  String(s || "").split(",").forEach(function (x) {
    const t = x.split(":");
    const id = parseInt(t[0], 10);
    if (id > 0) out[id] = t[1] === "h" ? "medio" : "cero";
  });
  return out;
}

function buildDb_(ss) { return buildDbFromRaw_(readRaw_(ss)); }

function buildDbFromRaw_(raw) {
  const st = computeStats_(raw.players, raw.matches);
  const crit = parseDesemp_(raw.cfg.Desempates);
  const players = raw.players.map(function (p) {
    const s = st[p.id];
    return { id: p.id, name: p.name, retired: p.retired, points: s.points, buchholz: s.bh, bh1: s.bh1, sb: s.sb, prog: s.prog, wins: s.wins, byes: s.byes, aus: s.aus, colors: s.colors, pos: 0 };
  });
  rankPlayers_(players, raw.matches, crit).forEach(function (p, i) { p.pos = i + 1; });
  let currentRound = 0;
  raw.matches.forEach(function (m) { if (m.round > currentRound) currentRound = m.round; });
  const total = parseInt(raw.cfg.TotalRondas || "0", 10) || 0;
  let lastDone = currentRound > 0;
  raw.matches.forEach(function (m) { if (m.round === currentRound && esPartida_(m) && !m.result) lastDone = false; });
  const fechas = {};
  Object.keys(raw.cfg).forEach(function (k) {
    if (k.indexOf("Fecha_") === 0 && raw.cfg[k]) fechas[k.slice(6)] = raw.cfg[k];
  });
  const aus = parseAusentes_(raw.cfg.Ausentes);
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
    desempates: crit,
    ausentes: Object.keys(aus).map(function (id) { return { id: parseInt(id, 10), tipo: aus[id] }; }),
    updated: parseInt(raw.cfg.Actualizado || "0", 10) || 0
  };
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

// ---------- Inscripción: lista de jugadores guardada ANTES de crear el torneo ----------
// Se guarda en Configuracion (clave "Inscritos", un nombre por línea). No es pública: solo la ve quien tiene la clave.
function leerInscritos_(ss) {
  const t = readConfig_(ss).Inscritos || "";
  return t.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
}
function guardarInscritos_(ss, lista) { setConfig_(ss, "Inscritos", lista.join("\n")); }
function claveNombre_(n) { return String(n).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim(); }
function addInscritos_(ss, p) {
  const actual = leerInscritos_(ss);
  const nuevos = (Array.isArray(p.nombres) ? p.nombres : []).map(function (x) { return String(x).replace(/\s+/g, " ").trim().slice(0, 40); }).filter(Boolean);
  if (!nuevos.length) throw new Error("No hay nombres que añadir.");
  const vistos = {}, rep = [];
  actual.forEach(function (n) { vistos[claveNombre_(n)] = true; });
  nuevos.forEach(function (n) { const k = claveNombre_(n); if (vistos[k]) rep.push(n); vistos[k] = true; });
  if (rep.length) throw new Error("Ya está en la lista: " + rep.join(", ") + ". Añade la inicial del apellido para distinguirlos.");
  if (actual.length + nuevos.length > 200) throw new Error("Máximo 200 jugadores.");
  const lista = actual.concat(nuevos);
  guardarInscritos_(ss, lista);
  return { inscritos: lista };
}
function removeInscrito_(ss, p) {
  const k = claveNombre_(p.nombre || "");
  let quitado = false;
  const lista = leerInscritos_(ss).filter(function (n) { if (!quitado && claveNombre_(n) === k) { quitado = true; return false; } return true; });
  guardarInscritos_(ss, lista);
  return { inscritos: lista };
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
  const archived = archive_(ss);
  ps.getRange(1, 1, 1, HEAD_PLAYERS.length).setValues([HEAD_PLAYERS]);
  rs.getRange(1, 1, 1, HEAD_ROUNDS.length).setValues([HEAD_ROUNDS]);
  clearBody_(ps); clearBody_(rs);
  ps.getRange(2, 1, n, 7).setValues(names.map(function (x) { return [x, 0, 0, 0, 0, "", false]; }));
  rs.getRange(1, 5, rs.getMaxRows(), 1).setNumberFormat("@");
  cs.clearContents();
  cs.getRange(1, 2, cs.getMaxRows(), 1).setNumberFormat("@");
  const cfg = [["Parametro", "Valor"], ["RondaActual", "1"], ["TotalRondas", String(rondas)],
    ["Nombre", String(p.nombre || "Torneo de ajedrez").slice(0, 60)], ["Aviso", ""], ["Desempates", DESEMP_DEF], ["Actualizado", String(Date.now())]];
  cs.getRange(1, 1, cfg.length, 2).setValues(cfg);
  if (p.fecha) setFecha_(ss, { round: 1, fecha: p.fecha });
  const warnings = generateRound_(ss);
  return { warnings: warnings, archived: archived };
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
  const ins = readConfig_(ss).Inscritos || "";   // la lista de apuntados sobrevive a "borrar el torneo"
  clearBody_(ps); clearBody_(rs);
  cs.clearContents();
  cs.getRange(1, 1, 1, 2).setValues([["Parametro", "Valor"]]);
  if (ins) setConfig_(ss, "Inscritos", ins);
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
    if (m.round === last && esPartida_(m) && !m.result) throw new Error("Faltan resultados en la ronda " + last + ".");
  });
  const target = last + 1;
  if (total && target > total) throw new Error("El torneo ya tiene todas sus rondas.");
  const st = computeStats_(raw.players, raw.matches);
  const aus = parseAusentes_(raw.cfg.Ausentes);
  const active = raw.players.filter(function (p) { return !p.retired && !aus[p.id]; }).map(function (p) {
    const s = st[p.id];
    return { id: p.id, name: p.name, points: s.points, bh: s.bh, wins: s.wins, byes: s.byes, colors: s.colors, opps: s.opps };
  });
  if (active.length < 2) throw new Error("Quedan menos de 2 jugadores activos.");
  const res = pairRound_(active);
  const rows = [];
  res.pairs.forEach(function (pr, i) { rows.push([target, i + 1, pr.white, pr.black, ""]); });
  if (res.bye) rows.push([target, rows.length + 1, res.bye, -1, "1-0"]);
  raw.players.forEach(function (p) {
    if (p.retired || !aus[p.id]) return;
    rows.push([target, rows.length + 1, p.id, aus[p.id] === "medio" ? -3 : -2, aus[p.id] === "medio" ? "1/2-1/2" : "0-1"]);
  });
  const rs = getSheet_(ss, SHEET_ROUNDS, HEAD_ROUNDS);
  const start = Math.max(rs.getLastRow(), 1) + 1;
  const rng = rs.getRange(start, 1, rows.length, 5);
  rs.getRange(start, 5, rows.length, 1).setNumberFormat("@");
  rng.setValues(rows);
  setConfig_(ss, "RondaActual", target);
  setConfig_(ss, "Ausentes", "");
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
  if (parseInt(d[row][3], 10) <= 0) throw new Error("Esa mesa no tiene resultado (descanso o ausencia).");
  rs.getRange(row + 2, 5).setNumberFormat("@").setValue(result);
  d[row][4] = result;
  let done = true, last = 0;
  d.forEach(function (r) { if (r[0] > last) last = r[0]; });
  d.forEach(function (r) { if (r[0] === last && parseInt(r[3], 10) > 0 && !r[4]) done = false; });
  if (done || parseInt(p.round, 10) < last) mirror_(ss);
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

// ---------- Ausencias, altas tardías, desempates ----------
// value: "" (juega) · "cero" (ausente, 0 puntos) · "medio" (ausente con ½ punto)
function setAusente_(ss, p) {
  const raw = readRaw_(ss);
  const id = parseInt(p.id, 10);
  const pl = raw.players.filter(function (x) { return x.id === id; })[0];
  if (!pl || pl.retired) throw new Error("Jugador no válido");
  const v = String(p.value || "");
  if (["", "cero", "medio"].indexOf(v) < 0) throw new Error("Valor no válido");
  const aus = parseAusentes_(raw.cfg.Ausentes);
  if (v) aus[id] = v; else delete aus[id];
  setConfig_(ss, "Ausentes", Object.keys(aus).map(function (k) { return k + ":" + (aus[k] === "medio" ? "h" : "0"); }).join(","));
  return null;
}

function normNombre_(n) { return String(n).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(); }

function addPlayer_(ss, p) {
  const raw = readRaw_(ss);
  if (!raw.matches.length) throw new Error("Primero hay que crear el torneo.");
  const name = String(p.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) throw new Error("Escribe el nombre.");
  if (raw.players.length >= 200) throw new Error("Máximo 200 jugadores.");
  if (raw.players.some(function (x) { return normNombre_(x.name) === normNombre_(name); })) throw new Error("Ya hay un jugador con ese nombre. Añade el curso para distinguirlos.");
  const half = Number(p.puntos) === 0.5;
  const ps = getSheet_(ss, SHEET_PLAYERS, HEAD_PLAYERS);
  const id = ps.getLastRow();
  ps.getRange(id + 1, 1, 1, 7).setValues([[name, 0, 0, 0, 0, "", false]]);
  const maxT = {}, cur = {};
  raw.matches.forEach(function (m) { maxT[m.round] = Math.max(maxT[m.round] || 0, m.table); cur[m.round] = true; });
  const rows = [];
  Object.keys(cur).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
    rows.push([r, maxT[r] + 1, id, half ? -3 : -2, half ? "1/2-1/2" : "0-1"]);
  });
  const rs = getSheet_(ss, SHEET_ROUNDS, HEAD_ROUNDS);
  const start = Math.max(rs.getLastRow(), 1) + 1;
  rs.getRange(start, 5, rows.length, 1).setNumberFormat("@");
  rs.getRange(start, 1, rows.length, 5).setValues(rows);
  mirror_(ss);
  return null;
}

function setDesempates_(ss, p) {
  const l = Array.isArray(p.lista) ? p.lista : [];
  if (!l.length || l.some(function (k) { return DESEMP_OK.indexOf(k) < 0; })) throw new Error("Desempates no válidos");
  setConfig_(ss, "Desempates", l.join(","));
  return null;
}

// ---------- Archivo de torneos y copia de seguridad ----------
function snapshotFromRaw_(raw) {
  const fechas = {};
  Object.keys(raw.cfg).forEach(function (k) { if (k.indexOf("Fecha_") === 0 && raw.cfg[k]) fechas[k.slice(6)] = raw.cfg[k]; });
  return {
    v: 1, nombre: raw.cfg.Nombre || "", aviso: raw.cfg.Aviso || "",
    total: parseInt(raw.cfg.TotalRondas || "0", 10) || 0,
    desempates: raw.cfg.Desempates || DESEMP_DEF, fechas: fechas,
    players: raw.players.map(function (x) { return [x.id, x.name, x.retired ? 1 : 0]; }),
    matches: raw.matches.map(function (m) { return [m.round, m.table, m.player1Id, m.player2Id, m.result]; })
  };
}

function rawFromSnapshot_(s) {
  const cfg = { TotalRondas: String(s.total || 0), Nombre: s.nombre || "", Aviso: s.aviso || "", Desempates: s.desempates || DESEMP_DEF, Actualizado: "0" };
  Object.keys(s.fechas || {}).forEach(function (k) { cfg["Fecha_" + k] = s.fechas[k]; });
  return {
    cfg: cfg,
    players: s.players.map(function (x) { return { id: x[0], name: x[1], retired: x[2] === 1 }; }),
    matches: s.matches.map(function (m) { return { id: "m_" + m[0] + "_" + m[1], round: m[0], table: m[1], player1Id: m[2], player2Id: m[3], result: String(m[4] || "") }; })
  };
}

// Guarda una copia del torneo actual en la hoja "Historico" (si tiene partidas)
function archive_(ss) {
  const raw = readRaw_(ss);
  if (!raw.matches.length) return false;
  const snap = snapshotFromRaw_(raw);
  const db = buildDbFromRaw_(raw);
  const champ = db.finished ? (db.players.filter(function (x) { return x.pos === 1; })[0] || {}).name : "(sin terminar)";
  const hs = getSheet_(ss, SHEET_HIST, HEAD_HIST);
  const row = Math.max(hs.getLastRow(), 1) + 1;
  hs.getRange(row, 1, 1, 5).setNumberFormat("@").setValues([[new Date().toISOString().slice(0, 10), snap.nombre || "Torneo", String(db.players.length), champ || "", JSON.stringify(snap)]]);
  const extra = hs.getLastRow() - 1 - MAX_HIST;
  if (extra > 0) hs.deleteRows(2, extra);
  return true;
}

function listHistorial_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hs = ss.getSheetByName(SHEET_HIST);
  const out = [];
  if (!hs || hs.getLastRow() < 2) return out;
  const d = hs.getRange(2, 1, hs.getLastRow() - 1, 4).getValues();
  for (let i = d.length - 1; i >= 0; i--) out.push({ n: i + 2, fecha: String(d[i][0]), nombre: String(d[i][1]), jugadores: String(d[i][2]), campeon: String(d[i][3]) });
  return out;
}

function readArchivo_(n) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hs = ss.getSheetByName(SHEET_HIST);
  if (!hs || !n || n < 2 || n > hs.getLastRow()) throw new Error("Ese torneo no existe.");
  const snap = JSON.parse(hs.getRange(n, 5).getValue());
  const db = buildDbFromRaw_(rawFromSnapshot_(snap));
  db.archivo = true;
  return db;
}

function restore_(ss, p) {
  const s = p.datos;
  if (!s || s.v !== 1 || !Array.isArray(s.players) || !Array.isArray(s.matches)) throw new Error("El archivo de copia no es válido.");
  if (s.players.length < 4 || s.players.length > 200) throw new Error("Copia no válida (jugadores).");
  let maxId = 0;
  s.players.forEach(function (x) { if (!(x[0] > 0) || typeof x[1] !== "string" || !x[1].trim()) throw new Error("Copia no válida (jugador)."); maxId = Math.max(maxId, x[0]); });
  if (maxId > 400) throw new Error("Copia no válida (ids).");
  let rondaMax = 0;
  s.matches.forEach(function (m) {
    if (!(m[0] > 0) || !(m[1] > 0) || !(m[2] > 0 && m[2] <= maxId) || !(m[3] <= maxId && m[3] !== 0 && m[3] >= -3) || RESULTADOS.indexOf(String(m[4] || "")) < 0) throw new Error("Copia no válida (partida).");
    rondaMax = Math.max(rondaMax, m[0]);
  });
  archive_(ss);
  const ps = getSheet_(ss, SHEET_PLAYERS, HEAD_PLAYERS);
  const rs = getSheet_(ss, SHEET_ROUNDS, HEAD_ROUNDS);
  const cs = getSheet_(ss, SHEET_CONFIG, ["Parametro", "Valor"]);
  clearBody_(ps); clearBody_(rs);
  const rowsP = [];
  for (let i = 1; i <= maxId; i++) rowsP.push(["", 0, 0, 0, 0, "", false]);
  s.players.forEach(function (x) { rowsP[x[0] - 1] = [String(x[1]).slice(0, 60), 0, 0, 0, 0, "", x[2] === 1]; });
  ps.getRange(2, 1, rowsP.length, 7).setValues(rowsP);
  const rowsR = s.matches.map(function (m) { return [m[0], m[1], m[2], m[3], String(m[4] || "")]; });
  if (rowsR.length) {
    rs.getRange(2, 5, rowsR.length, 1).setNumberFormat("@");
    rs.getRange(2, 1, rowsR.length, 5).setValues(rowsR);
  }
  cs.clearContents();
  cs.getRange(1, 2, cs.getMaxRows(), 1).setNumberFormat("@");
  const cfg = [["Parametro", "Valor"], ["RondaActual", String(rondaMax)], ["TotalRondas", String(parseInt(s.total, 10) || rondaMax)],
    ["Nombre", String(s.nombre || "Torneo de ajedrez").slice(0, 60)], ["Aviso", String(s.aviso || "").slice(0, 300)],
    ["Desempates", parseDesemp_(s.desempates).join(",")], ["Actualizado", String(Date.now())]];
  Object.keys(s.fechas || {}).forEach(function (k) { if (/^\d+$/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(s.fechas[k]))) cfg.push(["Fecha_" + k, String(s.fechas[k])]); });
  cs.getRange(1, 1, cfg.length, 2).setValues(cfg);
  mirror_(ss);
  return null;
}
