/* Ajedrez Siurot · código compartido por index.html (público) y admin.html (gestión) */
(function () {
  'use strict';
  const S = (window.Siurot = {});

  // Dirección de la aplicación web del Script. Solo cambia si creas una implementación NUEVA.
  S.SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyc0KH3TgBhtkDVF2MZ6c7JKMyM3bsb8POxMm7Up0CaA1FtxV5pnfSZ4jQQGsT8T2bYxQ/exec';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  S.$ = $; S.$$ = $$;
  S.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  S.pts = (n) => String(n).replace('.', ',');

  // ---------- Iconos (SVG en línea, sin dependencias) ----------
  const ico = (d, vb) => `<svg viewBox="${vb || '0 0 24 24'}" aria-hidden="true">${d}</svg>`;
  S.I = {
    corona: ico('<path d="M3 8l4.5 4L12 4.5 16.5 12 21 8l-2 10H5L3 8z"/><rect x="5" y="19.2" width="14" height="2.2" rx="1.1"/>'),
    campana: ico('<path d="M12 22a2.4 2.4 0 002.4-2.4h-4.8A2.4 2.4 0 0012 22zm7-6V11a7 7 0 10-14 0v5l-2 2v1h18v-1l-2-2z"/>'),
    luna: ico('<path d="M20.5 14.5A8.5 8.5 0 119.5 3.5a7 7 0 0011 11z"/>'),
    recargar: ico('<path d="M17.65 6.35A8 8 0 104 12h2a6 6 0 111.76 4.24L10 14H4v6l2.35-2.35A8 8 0 1017.65 6.35z"/>'),
    lupa: ico('<path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 109.5 16a6.5 6.5 0 004.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/>'),
    mesas: ico('<path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>'),
    podio: ico('<path d="M8 11h8v10H8zM2 15h6v6H2zm14 3h6v3h-6zM12 2l1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6z"/>'),
    gente: ico('<path d="M16 11a3 3 0 100-6 3 3 0 000 6zM8 11a3 3 0 100-6 3 3 0 000 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.700-3.500-7-3.500z"/>'),
    info: ico('<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/>'),
    ajustes: ico('<path d="M19.4 13a7.600 7.600 0 000-2l2.100-1.600-2-3.500-2.500 1a7.700 7.700 0 00-1.700-1L15 3h-4l-.4 2.900a7.700 7.700 0 00-1.700 1l-2.500-1-2 3.500L6.600 11a7.600 7.600 0 000 2l-2.100 1.600 2 3.500 2.500-1c.5.400 1.100.7 1.700 1L11 21h4l.4-2.900c.6-.3 1.200-.6 1.700-1l2.500 1 2-3.500zM13 15.500a3.500 3.500 0 110-7 3.500 3.500 0 010 7z"/>'),
    ojo: ico('<path d="M12 5C7 5 2.700 8.100 1 12.500 2.700 16.900 7 20 12 20s9.300-3.100 11-7.500C21.300 8.100 17 5 12 5zm0 12.500a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/>'),
    ojoNo: ico('<path d="M12 7a5 5 0 015 5c0 .7-.2 1.400-.4 2l3 3C21.200 15.800 22.400 14.300 23 12.500 21.300 8.100 17 5 12 5c-1.300 0-2.600.2-3.800.6l2.200 2.200C11 7.200 11.500 7 12 7zM2 4.300l2.300 2.300C2.800 7.800 1.600 9.500 1 12.500 2.700 16.900 7 20 12 20c1.500 0 3-.3 4.300-.8l3 3 1.400-1.400L3.400 2.900 2 4.300zM7.500 9.800l1.500 1.500A3 3 0 009 12a3 3 0 003 3c.3 0 .5 0 .8-.1l1.500 1.500c-.7.400-1.500.6-2.300.6a5 5 0 01-5-5c0-.8.200-1.600.5-2.200z"/>'),
    instalar: ico('<path d="M5 20h14v-2H5zm7-16v9.200L8.400 9.600 7 11l5 5 5-5-1.400-1.400L13 13.200V4z"/>'),
    imprimir: ico('<path d="M19 8H5a3 3 0 00-3 3v6h4v4h12v-4h4v-6a3 3 0 00-3-3zm-3 11H8v-5h8zm3-7a1 1 0 110-2 1 1 0 010 2zM18 3H6v4h12z"/>'),
    peon: ico('<path d="M12 2a3.500 3.500 0 00-2.100 6.300C8.800 9 8 10 8 11.200c0 .8.300 1.500.9 2C7 14.200 6 16 6 18h12c0-2-1-3.800-2.900-4.800.6-.5.9-1.200.9-2C16 10 15.200 9 14.100 8.300A3.500 3.500 0 0012 2zM5 19.500h14V22H5z"/>')
  };
  S.chip = (c) => `<i class="chip ${c === 'N' ? 'n' : ''}" title="${c === 'N' ? 'Negras' : 'Blancas'}"></i>`;

  // ---------- Fechas ----------
  S.fecha = (iso) => {
    if (!iso) return '';
    const p = iso.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\./g, '');
  };
  S.fechaCorta = (iso) => {
    if (!iso) return '';
    const p = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(p[0], p[1] - 1, p[2])).replace(/\./g, '');
  };
  S.hace = (ts) => {
    if (!ts) return '';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'hace un momento';
    const m = Math.round(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} d`;
  };

  // ---------- Conexión con el Script ----------
  async function pedir(url, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts));
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Tardó demasiado. Comprueba la conexión.');
      if (e instanceof TypeError) throw new Error('Sin conexión con el servidor.');
      throw e;
    } finally { clearTimeout(t); }
  }
  S.api = {
    async leer() {
      const j = await pedir(S.SCRIPT_URL + '?action=read&t=' + Date.now());
      if (!j.db) throw new Error(j.message || 'Respuesta inesperada del servidor');
      return j.db;
    },
    async enviar(cuerpo) {
      const j = await pedir(S.SCRIPT_URL, { method: 'POST', body: JSON.stringify(cuerpo) });
      if (j.status === 'error') throw new Error(j.message || 'Error del servidor');
      return j;
    },
    async ping() { const t = Date.now(); await pedir(S.SCRIPT_URL + '?action=ping&t=' + t); return Date.now() - t; }
  };
  S.cache = {
    guardar(db) { try { localStorage.setItem('siurot_db', JSON.stringify({ db, t: Date.now() })); } catch (e) { /* sin espacio */ } },
    leer() { try { return JSON.parse(localStorage.getItem('siurot_db') || 'null'); } catch (e) { return null; } }
  };

  // ---------- Datos del torneo ----------
  S.jugadoresPorId = (db) => { const m = {}; db.players.forEach((p) => (m[p.id] = p)); return m; };
  S.partidasRonda = (db, r) => db.matches.filter((m) => m.round === r);
  S.ordenados = (db) => db.players.slice().sort((a, b) => a.pos - b.pos);
  S.estadoRonda = (db, r) => {
    if (r > db.currentRound) return 'futura';
    if (r < db.currentRound) return 'hecha';
    return db.roundDone ? 'hecha' : 'actual';
  };
  S.historial = (db, id) => {
    const por = S.jugadoresPorId(db);
    const out = [];
    db.matches.filter((m) => m.player1Id === id || m.player2Id === id).forEach((m) => {
      if (m.player2Id === -1) { out.push({ r: m.round, bye: true, res: 'd' }); return; }
      const blancas = m.player1Id === id;
      const rival = por[blancas ? m.player2Id : m.player1Id];
      let res = 'x';
      if (m.result === '1/2-1/2') res = 't';
      else if (m.result === '1-0') res = blancas ? 'g' : 'p';
      else if (m.result === '0-1') res = blancas ? 'p' : 'g';
      out.push({ r: m.round, rival: rival ? rival.name : '?', c: blancas ? 'B' : 'N', res, mesa: m.table });
    });
    return out;
  };
  const ETQ = { g: 'Ganó', p: 'Perdió', t: 'Tablas', x: 'Por jugar', d: 'Descanso +1' };
  S.etiquetaRes = (k) => ETQ[k];

  // ---------- Dibujo: mesa (tablero partido) ----------
  // opts: { admin, sigue (id), guardado:{clave:estado} }
  S.mesaHtml = (m, por, opts) => {
    opts = opts || {};
    const p1 = por[m.player1Id], p2 = por[m.player2Id];
    const esc = S.esc;
    if (m.player2Id === -1) {
      return `<article class="mesa bye"><div class="mesa-cab"><span>Mesa ${m.table}</span><em>descanso</em></div>
        <div class="tablero"><button class="lado descanso" data-act="jugador" data-id="${p1 ? p1.id : ''}">${S.I.luna}<span><b>${esc(p1 ? p1.name : '?')}</b><small>Descansa esta ronda y suma 1 punto</small></span></button></div></article>`;
    }
    const r = m.result;
    const est = { B: r === '1-0' ? 'gana' : r === '0-1' ? 'pierde' : r ? 'tablas' : '', N: r === '0-1' ? 'gana' : r === '1-0' ? 'pierde' : r ? 'tablas' : '' };
    const lado = (p, c) => {
      const e = est[c];
      const marca = e === 'gana' ? S.I.corona : e === 'tablas' ? '<span class="medio">½</span>' : '';
      const attrs = opts.admin
        ? `data-act="res" data-round="${m.round}" data-table="${m.table}" data-val="${c === 'B' ? '1-0' : '0-1'}" aria-pressed="${e === 'gana'}"`
        : `data-act="jugador" data-id="${p ? p.id : ''}"`;
      return `<button class="lado ${c === 'B' ? 'blancas' : 'negras'} ${e}" ${attrs}>
        <span class="lado-top">${S.chip(c)}<span>${c === 'B' ? 'Blancas' : 'Negras'}</span>${marca}</span>
        <b class="nombre">${esc(p ? p.name : '?')}</b>
        <span class="lado-pts num">${S.pts(p ? p.points : 0)} pts</span></button>`;
    };
    const mia = opts.sigue && (m.player1Id === opts.sigue || m.player2Id === opts.sigue);
    const pend = !r;
    const clave = m.round + '_' + m.table;
    const g = opts.guardado && opts.guardado[clave];
    const estado = g === 'guardando' ? 'guardando…' : g === 'error' ? 'sin guardar' : pend ? 'por jugar' : 'terminada';
    const centro = opts.admin
      ? `<button class="vs-btn" data-act="res" data-round="${m.round}" data-table="${m.table}" data-val="1/2-1/2" aria-pressed="${r === '1/2-1/2'}" aria-label="Tablas">½</button>`
      : '<span class="vs" aria-hidden="true"></span>';
    return `<article class="mesa ${pend ? 'pend' : 'hecha'} ${mia ? 'mia' : ''}" data-mesa="${clave}">
      <div class="mesa-cab"><span>Mesa ${m.table}</span><em ${g === 'error' ? 'style="color:var(--mal)"' : ''}>${estado}</em></div>
      <div class="tablero">${lado(p1, 'B')}${lado(p2, 'N')}${centro}</div></article>`;
  };

  // ---------- Dibujo: pasos de ronda ----------
  S.pasosHtml = (db, sel) => {
    let h = '';
    for (let r = 1; r <= db.totalRondas; r++) {
      const e = S.estadoRonda(db, r);
      const f = db.fechas[r] ? S.fechaCorta(db.fechas[r]) : '';
      h += `<button class="paso ${e} ${r === sel ? 'sel' : ''}" data-ronda="${r}" ${e === 'futura' ? 'disabled' : ''} aria-label="Ronda ${r}${f ? ', ' + f : ''}">
        <i>${e === 'hecha' ? '✓' : r}</i><small>${f || (e === 'futura' ? '' : 'R' + r)}</small></button>`;
    }
    return `<div class="pasos" role="group" aria-label="Rondas">${h}</div>`;
  };

  // ---------- Dibujo: clasificación ----------
  S.clasificacionHtml = (db, opts) => {
    opts = opts || {};
    const ord = S.ordenados(db);
    const esc = S.esc;
    let h = '';
    if (ord.length >= 3 && db.started) {
      const pod = (p, k) => `<div class="pod p${k}"><button data-act="jugador" data-id="${p.id}">${k === 1 ? S.I.corona.replace('<svg', '<svg class="corona"') : ''}<span class="nom">${esc(p.name)}</span><span class="pun num">${S.pts(p.points)} pts</span></button><div class="bloque">${k}</div></div>`;
      h += `<div class="podio">${pod(ord[1], 2)}${pod(ord[0], 1)}${pod(ord[2], 3)}</div>`;
    }
    h += '<table class="tabla"><thead><tr><th>Puesto y nombre</th><th class="r">Puntos</th><th class="r">Buchholz</th></tr></thead><tbody>';
    ord.forEach((p) => {
      h += `<tr><td colspan="3"><button class="fila-j ${opts.sigue === p.id ? 'yo' : ''} ${p.retired ? 'ret' : ''}" data-act="jugador" data-id="${p.id}">
        <span class="pos num">${p.pos}</span><span class="n">${esc(p.name)}${p.retired ? '<small>retirado</small>' : ''}</span>
        <span class="p num">${S.pts(p.points)}</span><span class="b num">${S.pts(Math.round(p.buchholz * 10) / 10)}</span></button></td></tr>`;
    });
    return h + '</tbody></table><p class="nota">Si hay empate a puntos, gana quien ha tenido rivales más fuertes (Buchholz), y después quien tiene más victorias.</p>';
  };

  // ---------- Dibujo: ficha de jugador ----------
  S.fichaHtml = (db, p, extra) => {
    const esc = S.esc;
    const h = S.historial(db, p.id);
    let lis = h.map((x) => x.bye
      ? `<li><span class="r">R${x.r}</span><span class="v">Descansó</span><span class="res d">${ETQ.d}</span></li>`
      : `<li><span class="r">R${x.r}</span>${S.chip(x.c)}<span class="v">${esc(x.rival)} <small>(mesa ${x.mesa})</small></span><span class="res ${x.res}">${ETQ[x.res]}</span></li>`).join('');
    if (!lis) lis = '<li><span class="v">Todavía no ha jugado.</span></li>';
    const col = (p.colors || '').split('').map((c) => S.chip(c)).join('');
    return `<div class="asa"></div><h2>${esc(p.name)}</h2>
      <p class="sub">Puesto ${p.pos} de ${db.players.length}${p.retired ? ' · retirado' : ''}</p>
      <div class="datos"><div><b class="num">${S.pts(p.points)}</b><span>Puntos</span></div><div><b class="num">${S.pts(Math.round(p.buchholz * 10) / 10)}</b><span>Buchholz</span></div><div><b class="num">${p.wins}</b><span>Victorias</span></div></div>
      <ul class="hist">${lis}</ul>
      ${col ? `<div class="colores" aria-label="Colores jugados">${col}</div>` : ''}
      ${extra || ''}`;
  };

  // ---------- Navegación: el botón Atrás retrocede pantalla a pantalla ----------
  const capas = [];
  let alCambiarPestana = null;
  S.nav = {
    iniciar(pestana, cb) {
      alCambiarPestana = cb;
      history.replaceState({ tab: pestana }, '');
      window.addEventListener('popstate', (e) => {
        if (capas.length) { const f = capas.pop(); f(); return; }
        const t = e.state && e.state.tab;
        if (t && alCambiarPestana) alCambiarPestana(t, true);
      });
    },
    pestana(nombre) { history.pushState({ tab: nombre }, ''); },
    abrirCapa(cerrar) { capas.push(cerrar); history.pushState({ capa: capas.length }, ''); },
    cerrarCapa() { if (capas.length) history.back(); }
  };

  // ---------- Hoja inferior y diálogos propios (nada de alert/confirm del navegador) ----------
  // Cada ventana tiene su propia capa, así se pueden apilar (ficha → confirmación) y Atrás las cierra de una en una.
  S.hoja = function (html, alCerrar) {
    const c = document.createElement('div');
    c.className = 'capa';
    c.innerHTML = `<div class="hoja" role="dialog" aria-modal="true">${html}</div>`;
    c.addEventListener('click', (e) => { if (e.target === c) S.nav.cerrarCapa(); });
    document.body.appendChild(c);
    S.nav.abrirCapa(() => { c.remove(); if (alCerrar) alCerrar(); });
    return c.firstElementChild;
  };
  S.hayVentana = () => !!document.querySelector('.capa');
  S.cerrarHoja = () => S.nav.cerrarCapa();

  // confirmar({titulo, texto, ok, peligro, escribir}) -> Promise<boolean>
  S.confirmar = function (o) {
    return new Promise((resolve) => {
      let hecho = false;
      const fin = (v) => { if (!hecho) { hecho = true; resolve(v); } };
      const esc = S.esc;
      const caja = S.hoja(`<div class="asa"></div><h2>${esc(o.titulo)}</h2><p class="sub">${esc(o.texto || '')}</p>
        ${o.escribir ? `<label class="sub" for="conf-in">Escribe <b>${esc(o.escribir)}</b> para continuar</label><input id="conf-in" class="campo" autocomplete="off" autocapitalize="characters">` : ''}
        <div class="btns dos"><button class="btn sec" data-r="no">Cancelar</button><button class="btn ${o.peligro ? 'mal' : ''}" data-r="si" ${o.escribir ? 'disabled' : ''}>${esc(o.ok || 'Aceptar')}</button></div>`, () => fin(false));
      const si = $('[data-r=si]', caja);
      if (o.escribir) $('#conf-in', caja).addEventListener('input', (e) => { si.disabled = e.target.value.trim().toUpperCase() !== o.escribir.toUpperCase(); });
      caja.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        fin(b.dataset.r === 'si'); S.cerrarHoja();
      });
    });
  };
  S.aviso = function (titulo, texto) {
    return new Promise((resolve) => {
      const caja = S.hoja(`<div class="asa"></div><h2>${S.esc(titulo)}</h2><div class="sub">${texto}</div><div class="btns"><button class="btn" data-r="ok">Entendido</button></div>`, resolve);
      caja.addEventListener('click', (e) => { if (e.target.closest('[data-r]')) S.cerrarHoja(); });
    });
  };
  let toastT = null;
  S.toast = function (msg, tipo) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast ' + (tipo || '');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, tipo === 'mal' ? 5000 : 2600);
  };
  S.confeti = function () {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('div'); c.className = 'confeti';
    const col = ['#ffc83d', '#ff6a2b', '#0db4cf', '#17824a', '#fbf4e4'];
    for (let i = 0; i < 46; i++) {
      const e = document.createElement('i');
      e.style.left = Math.random() * 100 + '%'; e.style.background = col[i % col.length];
      e.style.animationDuration = 2.4 + Math.random() * 2.2 + 's'; e.style.animationDelay = Math.random() * 0.8 + 's';
      c.appendChild(e);
    }
    document.body.appendChild(c); setTimeout(() => c.remove(), 6000);
  };

  // ---------- Instalar la app (diálogo nativo de Chrome) ----------
  let diferido = null;
  const esiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const enApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function pintarInstalar() {
    $$('[data-instalar]').forEach((b) => { b.hidden = !diferido; });
    $$('[data-ios]').forEach((b) => { b.hidden = !(esiOS && !enApp()); });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); diferido = e; S.instalable = true; pintarInstalar(); });
  window.addEventListener('appinstalled', () => { diferido = null; pintarInstalar(); S.toast('App instalada', 'ok'); });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-instalar]') || !diferido) return;
    diferido.prompt();
    try { await diferido.userChoice; } catch (x) { /* ignorar */ }
    diferido = null; pintarInstalar();
  });
  S.pintarInstalar = pintarInstalar;

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { }));
  }

  // ---------- Diagnóstico (?diag) ----------
  S.diag = async function () {
    const d = document.createElement('div'); d.className = 'diag';
    d.innerHTML = '<h2>Diagnóstico de la app</h2><div>Comprobando…</div>';
    document.body.appendChild(d);
    const filas = [];
    const f = (ok, txt, info) => filas.push(`<div><span class="${ok ? 'si' : 'no'}">${ok ? 'OK' : (info ? 'INFO' : 'FALLO')}</span> ${S.esc(txt)}</div>`);
    const base = location.href.split('?')[0].replace(/[^/]*$/, '');
    const archivos = ['manifest.json', 'manifest-admin.json', 'sw.js', 'estilo.css', 'comun.js', 'iconos/icon-192.png', 'iconos/icon-512.png', 'iconos/icon-maskable-512.png', 'iconos/icon-180.png'];
    for (const a of archivos) {
      try { const r = await fetch(base + a + '?d=' + Date.now(), { cache: 'no-store' }); f(r.ok, `${a} → ${r.status}`); } catch (e) { f(false, `${a} → no se pudo descargar`); }
    }
    f(location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname), 'Conexión segura (https): ' + location.protocol);
    if ('serviceWorker' in navigator) {
      const r = await navigator.serviceWorker.getRegistration();
      f(!!r, r ? 'Service worker registrado (' + (r.active ? 'activo' : 'instalando') + '), ámbito ' + r.scope : 'Service worker sin registrar');
    } else f(false, 'Este navegador no admite service worker');
    f(!!S.instalable, S.instalable ? 'Chrome ofrece instalar la app (beforeinstallprompt recibido)' : 'Chrome aún no ofrece instalar (puede tardar unos segundos o ya está instalada)', true);
    f(enApp(), enApp() ? 'Se está ejecutando como app instalada' : 'Se está ejecutando en el navegador', true);
    try { const ms = await S.api.ping(); f(true, 'Script de Google responde en ' + ms + ' ms'); } catch (e) { f(false, 'Script de Google: ' + e.message); }
    try { const l = await S.api.leer(); f(true, `Datos del torneo: ${l.players.length} jugadores, ${l.matches.length} partidas`); } catch (e) { f(false, 'Lectura de datos: ' + e.message); }
    const c = S.cache.leer();
    f(!!c, c ? 'Copia sin conexión guardada ' + S.hace(c.t) : 'Aún no hay copia sin conexión');
    d.innerHTML = '<h2>Diagnóstico de la app</h2>' + filas.join('') + '<div class="btns"><button class="btn" id="diag-x">Cerrar</button></div>';
    d.querySelector('#diag-x').onclick = () => { d.remove(); history.replaceState(history.state, '', location.pathname); };
  };
  if (/[?&]diag\b/.test(location.search)) window.addEventListener('load', () => S.diag());

  document.addEventListener('DOMContentLoaded', pintarInstalar);
})();
