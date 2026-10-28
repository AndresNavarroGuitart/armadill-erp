/* Prototipo de interfaz. Sin backend: todo en memoria con datos de ejemplo (datos.js). */
(function () {
  'use strict';
  const D = window.DATOS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
  const COMPACTO = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
  const fmt = (centavos) => ARS.format(centavos / 100);
  const corto = (pesos) => '$ ' + COMPACTO.format(pesos);
  const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
  const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

  /* ---------- íconos ---------- */
  const P = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    plus: 'M12 5v14M5 12h14',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3',
    sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
    moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
    chev: 'M6 9l6 6 6-6',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
    cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    arrow: 'M7 17L17 7M8 7h9v9',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
    x: 'M6 6l12 12M18 6L6 18',
    coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7',
    history: 'M12 7v5l3 2M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5',
    download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
    trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    cart: 'M3 4h2l2.4 11.2a2 2 0 002 1.6h7.5a2 2 0 002-1.5L21 8H6M10 21a1 1 0 100-2 1 1 0 000 2zM17 21a1 1 0 100-2 1 1 0 000 2z',
    box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
    wallet: 'M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2zM16 14h2',
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;

  /* ---------- estado ---------- */
  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const sumarDias = (n) => { const d = new Date(hoy); d.setDate(d.getDate() + n); return d; };
  const mesAnio = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const estado = { empresaId: Number(leer('proto_empresa')) || 1, fac: null };
  const empresa = () => D.empresas.find((e) => e.id === estado.empresaId);
  const CAPITAL = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- navegación ---------- */
  /* zona 1: módulos de trabajo; zona 2: estudio y control. "grupo" resalta el módulo al que pertenece una pantalla suelta. */
  const VISTAS = {
    inicio: { titulo: 'Inicio', icono: 'home', zona: 1, montar: vInicio },
    ventas: { titulo: 'Ventas', icono: 'trend', zona: 1, modulo: true },
    compras: { titulo: 'Compras', icono: 'cart', zona: 1, modulo: true },
    finanzas: { titulo: 'Finanzas', icono: 'wallet', zona: 1, modulo: true },
    estudio: { titulo: 'Estudio', icono: 'grid', zona: 2, montar: vEstudio },
    trazabilidad: { titulo: 'Trazabilidad', icono: 'history', zona: 2, montar: vTrazabilidad },
    nueva: { titulo: 'Nueva factura', icono: 'plus', grupo: 'ventas', montar: vNueva },
  };
  function pintarNav(actual) {
    [1, 2].forEach((z) => {
      $('#nav' + (z === 1 ? '' : '2')).innerHTML = Object.entries(VISTAS).filter(([, v]) => v.zona === z).map(([k, v]) =>
        `<button data-ir="${k}" data-tip="${v.titulo}" aria-label="${v.titulo}" ${k === actual ? 'aria-current="page"' : ''}>${ic(v.icono)}</button>`).join('');
    });
  }
  function render() {
    let partes = location.hash.replace('#/', '').split('/').filter(Boolean);
    if (partes[0] === 'comprobantes') partes = ['ventas', 'facturas'];
    const nombre = VISTAS[partes[0]] ? partes[0] : 'inicio', vista = VISTAS[nombre], actual = vista.grupo || nombre, root = $('#vista');
    const montar = () => {
      pintarNav(actual);
      if (vista.modulo) {
        if (root._mod && root._mod.nombre === nombre && root._mod.empresaId === estado.empresaId) { root._mod.cambiar(partes); return; }
        root._mod = null; root.innerHTML = ''; MOD.montar(root, nombre, partes);
      } else { root._mod = null; root.innerHTML = ''; vista.montar(root); }
      window.scrollTo(0, 0);
    };
    if (document.startViewTransition && !reducir) document.startViewTransition(montar); else montar();
  }
  const ir = (n) => { if (location.hash === '#/' + n) render(); else location.hash = '#/' + n; };

  /* ---------- barra superior ---------- */
  function pintarTopbar() {
    const e = empresa();
    $('#empresaBtn').innerHTML = `<span class="avatar t${e.tono}">${esc(e.ini)}</span><span class="t"><b>${esc(e.nombre)}</b><span>${esc(e.cuit)} · ${D.condicion[e.cond]}</span></span>${ic('chev')}`;
    $('#periodo span').textContent = CAPITAL(mesAnio) + ' · abierto';
    $('#abrirPaleta').innerHTML = `${ic('search')}<span>Buscar o ejecutar…</span><kbd>Ctrl K</kbd>`;
    $('#tema').innerHTML = ic(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
    pintarCampana();
  }
  function cambiarEmpresa(id) {
    estado.empresaId = id; estado.fac = null; guardar('proto_empresa', id);
    registrar('acceso', 'Cambió a la empresa ' + empresa().nombre, 'CUIT ' + empresa().cuit);
    pintarTopbar(); cerrarPop(); render();
    toast('Ahora trabajás en ' + empresa().nombre);
  }
  function abrirPop() {
    const pop = $('#popEmpresa'); const b = $('#empresaBtn').getBoundingClientRect();
    pop.style.left = Math.max(12, b.left + scrollX) + 'px'; pop.style.top = b.bottom + scrollY + 8 + 'px';
    pop.innerHTML = `<h6>Empresas del estudio</h6>` + D.empresas.map((e) =>
      `<button class="op" data-emp="${e.id}" role="option" ${e.id === estado.empresaId ? 'aria-selected="true"' : ''}><span class="avatar t${e.tono}">${esc(e.ini)}</span><span class="t"><b>${esc(e.nombre)}</b><span>${esc(e.cuit)} · ${e.cond === 'RI' ? 'Resp. Inscripto' : 'Monotributo'}</span></span>${semaforo(e).punto}</button>`).join('') +
      `<h6>Vista global</h6><button class="op" data-ir="estudio">${ic('grid')}<span class="t"><b>Cartera del estudio</b><span>Semáforo de todas las empresas</span></span></button>`;
    $('#popNotif').hidden = true; pop.hidden = false; $('#empresaBtn').setAttribute('aria-expanded', 'true');
  }
  function cerrarPop() { $('#popEmpresa').hidden = true; $('#popNotif').hidden = true; $('#empresaBtn').setAttribute('aria-expanded', 'false'); $('#campana').setAttribute('aria-expanded', 'false'); }

  /* ---------- utilidades visuales ---------- */
  function semaforo(e) {
    const m = Math.min(...e.venc.map((v) => v.dias));
    if (m < 0 || e.vencido > 4) return { nivel: 'r', texto: 'Atención', punto: '<span class="sem r" style="width:10px;height:10px;border-radius:50%;background:var(--bad)"></span>' };
    if (m <= 5) return { nivel: 'y', texto: 'Vence pronto', punto: '<span class="sem y" style="width:10px;height:10px;border-radius:50%;background:var(--warn)"></span>' };
    return { nivel: 'g', texto: 'Al día', punto: '<span class="sem g" style="width:10px;height:10px;border-radius:50%;background:var(--ok)"></span>' };
  }
  function spark(datos, color = 'var(--brand)') {
    const min = Math.min(...datos), max = Math.max(...datos), n = datos.length - 1;
    const pts = datos.map((v, i) => `${(i / n) * 100},${30 - ((v - min) / (max - min || 1)) * 28 - 1}`).join(' ');
    return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function anillo(pct, color) {
    const c = 2 * Math.PI * 16;
    return `<div class="ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" stroke="var(--line)"/><circle class="f" cx="20" cy="20" r="16" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg><span>${Math.round(pct * 100)}</span></div>`;
  }
  function contar(el, hasta, formato) {
    if (reducir) { el.textContent = formato(hasta); return; }
    const t0 = performance.now(), dur = 900;
    (function paso(t) {
      const p = Math.min(1, (t - t0) / dur), k = 1 - Math.pow(1 - p, 3);
      el.textContent = formato(hasta * k);
      if (p < 1) requestAnimationFrame(paso);
    })(t0);
  }
  function grafico(el, serie, etiquetas, formato) {
    const W = 640, H = 220, min = Math.min(...serie) * 0.92, max = Math.max(...serie) * 1.04, n = serie.length - 1;
    const x = (i) => (i / n) * W, y = (v) => H - ((v - min) / (max - min)) * (H - 16) - 8;
    const lin = serie.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolución">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".32"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#12c99b"/><stop offset="1" stop-color="#2a73e8"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" stroke="var(--line)" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/>`).join('')}
      <path d="${lin} L${W},${H} L0,${H} Z" fill="url(#${id})"/>
      <path class="trazo" d="${lin}" fill="none" stroke="url(#${id}l)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" ${reducir ? '' : 'pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"'}>
        ${reducir ? '' : '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="1.1s" fill="freeze" calcMode="spline" keySplines=".2 .8 .2 1" keyTimes="0;1"/>'}</path></svg>
      <div class="cursor"></div><div class="punto"></div><div class="tip"></div>`;
    const cur = $('.cursor', el), pt = $('.punto', el), tip = $('.tip', el);
    el.onpointermove = (ev) => {
      const r = el.getBoundingClientRect(), i = Math.max(0, Math.min(n, Math.round(((ev.clientX - r.left) / r.width) * n)));
      const px = (i / n) * r.width, py = (y(serie[i]) / H) * r.height;
      cur.style.left = px + 'px'; pt.style.left = px + 'px'; pt.style.top = py + 'px';
      tip.style.left = Math.max(60, Math.min(r.width - 60, px)) + 'px'; tip.innerHTML = `<b>${formato(serie[i])}</b> · ${etiquetas(i)}`;
    };
  }

  /* ---------- agenda: vencimientos del estudio y eventos propios ---------- */
  const TIPOS_EV = { imp: 'Impuesto', lab: 'Laboral', est: 'Estudio', reu: 'Reunión', otro: 'Otro' };
  const AVISOS = [[0, 'El mismo día'], [1, '1 día antes'], [3, '3 días antes'], [7, '7 días antes']];
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const isoLocal = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const diasDe = (isoF) => Math.round((new Date(isoF + 'T00:00:00') - hoy0) / 864e5);
  const relDias = (d) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : d === -1 ? 'ayer' : d > 0 ? 'en ' + d + ' días' : 'hace ' + -d + ' días');
  /* Los eventos propios se guardan solo en este navegador (comodidad del prototipo); nunca llevan datos reales. */
  const cargarEventos = () => { try { const r = JSON.parse(leer('proto_eventos') || '[]'); return Array.isArray(r) ? r.filter((x) => x && typeof x.titulo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) && D.empresas.some((e) => e.id === x.emp)).map((x) => ({ ...x, titulo: x.titulo.slice(0, 80), nota: String(x.nota || '').slice(0, 300) })) : []; } catch (err) { return []; } };
  let eventosPropios = cargarEventos();
  const guardarEventos = () => guardar('proto_eventos', JSON.stringify(eventosPropios));
  function eventosDe(e) {
    const std = e.venc.map((v, i) => ({ key: 's:' + e.id + ':' + i, emp: e.id, nombre: v.nombre, dias: v.dias, tipo: v.tipo, hecho: !!v.hecho, aviso: 7, hora: '', nota: '', propio: false, ref: v }));
    const pro = eventosPropios.filter((x) => x.emp === e.id).map((x) => ({ key: 'p:' + x.id, emp: e.id, nombre: x.titulo, dias: diasDe(x.fecha), tipo: x.tipo, hecho: !!x.hecho, aviso: x.aviso, hora: x.hora || '', nota: x.nota || '', propio: true, ref: x }));
    return [...std, ...pro].sort((a, b) => a.dias - b.dias || a.hora.localeCompare(b.hora));
  }
  const todosEventos = () => D.empresas.flatMap(eventosDe);
  /* de lo más próximo a lo más antiguo: primero lo que viene (el más cercano arriba), después lo ya vencido (el más reciente arriba) */
  const ordenNotif = (l) => [...l.filter((x) => x.dias >= 0).sort((a, b) => a.dias - b.dias || a.hora.localeCompare(b.hora)), ...l.filter((x) => x.dias < 0).sort((a, b) => b.dias - a.dias || b.hora.localeCompare(a.hora))];
  const enAviso = (x) => !x.hecho && x.dias <= x.aviso;
  function pintarCampana() {
    const b = $('#campana'); if (!b) return; const alertas = todosEventos().filter(enAviso), n = alertas.length, urgente = alertas.some((x) => x.dias <= 0);
    b.innerHTML = ic('bell') + (n ? `<i class="badge ${urgente ? 'bad' : ''}">${n > 9 ? '9+' : n}</i>` : ''); b.setAttribute('aria-label', n ? `Notificaciones: ${n} evento${n === 1 ? '' : 's'} para atender` : 'Notificaciones: sin eventos para atender');
  }
  function abrirNotif() {
    const pop = $('#popNotif'), b = $('#campana').getBoundingClientRect(), ancho = Math.min(410, innerWidth - 24), solo = !!estado.notifSolo;
    const lista = ordenNotif((solo ? eventosDe(empresa()) : todosEventos()).filter((x) => !x.hecho && x.dias >= -30 && x.dias <= 14)).slice(0, 40);
    pop.style.width = ancho + 'px'; pop.style.left = Math.max(12, Math.min(b.right + scrollX - ancho, innerWidth - ancho - 12)) + 'px'; pop.style.top = b.bottom + scrollY + 8 + 'px';
    let seccion = '';
    const item = (x) => { const f = sumarDias(x.dias), emp = D.empresas.find((e) => e.id === x.emp), clase = x.dias < 0 ? 'ya' : x.dias <= 3 ? 'urg' : '';
      return `<button class="op notif ${clase}" data-ev="${x.key}"><span class="nf-f"><small>${f.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')}</small><b>${f.getDate()}</b></span><span class="t"><b>${esc(x.nombre)}</b><span>${solo ? '' : esc(emp.nombre) + ' · '}${x.hora ? x.hora + ' · ' : ''}${relDias(x.dias)}${x.propio ? ' · propio' : ''}</span></span></button>`; };
    pop.innerHTML = `<div class="notif-h"><h6>Próximas 2 semanas</h6><div class="seg" role="group" aria-label="Alcance"><button data-notif-alc="todas" aria-pressed="${!solo}">Todo el estudio</button><button data-notif-alc="una" aria-pressed="${solo}">Esta empresa</button></div></div>
      <div class="notif-l">${lista.length ? lista.map((x) => { const sec = x.dias >= 0 ? 'Próximos' : 'Vencidos'; const h = sec !== seccion ? `<h6>${(seccion = sec)}</h6>` : ''; return h + item(x); }).join('') : '<div class="vacio" style="padding:22px">No hay eventos próximos ni vencidos.</div>'}</div>
      <button class="op" data-nuevo-evento style="margin-top:4px;border-top:1px solid var(--line);border-radius:0 0 12px 12px">${ic('plus')}<span class="t"><b>Agregar evento</b></span></button>`;
    $('#popEmpresa').hidden = true; pop.hidden = false; $('#campana').setAttribute('aria-expanded', 'true');
  }
  function abrirDlg(html) { const d = $('#detalle'); $('#detalleBody').innerHTML = html; if (!d.open) d.showModal(); $$('[data-cerrar]', d).forEach((b) => b.addEventListener('click', () => d.close())); return d; }
  const XBTN = `<button class="icon-btn" data-cerrar aria-label="Cerrar" style="width:34px;height:34px">${ic('x')}</button>`;
  const refrescarAgenda = () => { pintarCampana(); if ((location.hash.replace('#/', '') || 'inicio') === 'inicio') render(); };
  function verEvento(key) {
    const x = todosEventos().find((v) => v.key === key); if (!x) return;
    const emp = D.empresas.find((e) => e.id === x.emp), f = sumarDias(x.dias), dlg = abrirDlg(`<header class="det-h"><div><small>${TIPOS_EV[x.tipo] || 'Vencimiento'}${x.propio ? ' · evento propio' : ' · vencimiento del estudio'}</small><h4>${esc(x.nombre)}</h4></div><span class="pill ${x.hecho ? '' : x.dias < 0 ? 'bad' : x.dias <= 3 ? 'warn' : 'blue'}"><i></i>${x.hecho ? 'Cumplido' : relDias(x.dias)}</span>${XBTN}</header>
      <div class="partes"><div><small>Fecha</small><b>${esc(CAPITAL(f.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })))}</b></div><div><small>Hora</small><b>${x.hora || 'Todo el día'}</b></div><div><small>Empresa</small><b>${esc(emp.nombre)}</b></div><div><small>Aviso</small><b>${(AVISOS.find((a) => a[0] === x.aviso) || [0, x.aviso + ' días antes'])[1]}</b></div></div>
      ${x.nota ? `<p style="margin:0;color:var(--ink-2)">${esc(x.nota)}</p>` : ''}
      <footer class="det-f"><button class="btn primary" data-ev-hecho>${x.hecho ? 'Reabrir' : 'Marcar cumplido'}</button>${x.propio ? '<button class="btn" data-ev-edit>Editar</button><button class="btn" data-ev-del>Eliminar</button>' : ''}${x.emp !== estado.empresaId ? '<button class="btn" data-ev-ir>Ir a la empresa</button>' : ''}<button class="btn" data-cerrar>Cerrar</button></footer>`);
    $('[data-ev-hecho]', dlg).addEventListener('click', () => { x.ref.hecho = !x.hecho; if (x.propio) guardarEventos(); registrar('maestros', (x.hecho ? 'Reabrió' : 'Marcó como cumplido') + ' el evento "' + x.nombre + '"', emp.nombre + ' · ' + f.toLocaleDateString('es-AR'), { emp: emp.id }); dlg.close(); toast(x.hecho ? 'Evento reabierto' : 'Marcado como cumplido'); refrescarAgenda(); });
    const ed = $('[data-ev-edit]', dlg); if (ed) ed.addEventListener('click', () => formEvento(x.ref));
    const del = $('[data-ev-del]', dlg); if (del) del.addEventListener('click', () => { eventosPropios = eventosPropios.filter((v) => v !== x.ref); guardarEventos(); registrar('maestros', 'Eliminó el evento "' + x.nombre + '"', emp.nombre + ' · ' + f.toLocaleDateString('es-AR'), { emp: emp.id }); dlg.close(); toast('Evento eliminado'); refrescarAgenda(); });
    const ira = $('[data-ev-ir]', dlg); if (ira) ira.addEventListener('click', () => { dlg.close(); cambiarEmpresa(x.emp); ir('inicio'); });
  }
  function formEvento(previo) {
    const e = previo ? D.empresas.find((v) => v.id === previo.emp) : empresa(), opt = (l, sel) => l.map(([v, t]) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${t}</option>`).join('');
    const dlg = abrirDlg(`<header class="det-h"><div><small>Calendario</small><h4>${previo ? 'Editar evento' : 'Agregar evento'}</h4></div>${XBTN}</header>
      <div class="form-aj"><label class="ancho">Título<input class="in" id="evTit" maxlength="80" value="${esc(previo ? previo.titulo : '')}" placeholder="Por ejemplo: Reunión con el cliente" autocomplete="off"></label>
        <label>Fecha<input class="in" type="date" id="evFecha" value="${previo ? previo.fecha : isoLocal(hoy0)}"></label><label>Hora (opcional)<input class="in" type="time" id="evHora" value="${previo ? previo.hora || '' : ''}"></label>
        <label>Tipo<select class="in" id="evTipo">${opt(Object.entries(TIPOS_EV).filter(([k]) => k !== 'imp' || true), previo ? previo.tipo : 'reu')}</select></label>
        <label>Avisarme<select class="in" id="evAviso">${opt(AVISOS, previo ? previo.aviso : 1)}</select></label>
        <label class="ancho">Empresa<select class="in" id="evEmp">${opt(D.empresas.map((v) => [v.id, v.nombre]), e.id)}</select></label>
        <label class="ancho">Nota (opcional)<input class="in" id="evNota" maxlength="300" value="${esc(previo ? previo.nota || '' : '')}" autocomplete="off"></label></div>
      <div id="evErr"></div>
      <footer class="det-f"><button class="btn primary" id="evOk">${previo ? 'Guardar cambios' : 'Agregar al calendario'}</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const val = () => { const t = $('#evTit', dlg).value.trim(), f = $('#evFecha', dlg).value, d = f ? diasDe(f) : null;
      const m = t.length < 3 ? 'Escribí un título de al menos 3 letras' : !f ? 'Elegí la fecha' : d < -60 ? 'La fecha es demasiado antigua (más de 60 días atrás)' : d > 730 ? 'La fecha está a más de dos años' : '';
      $('#evErr', dlg).innerHTML = m ? `<div class="chequeo no" style="margin:0">${ic('alert')}<span>${m}</span></div>` : d != null && d < 0 ? `<div class="chequeo ok" style="margin:0">${ic('alert')}<span>La fecha ya pasó: va a figurar como vencido.</span></div>` : ''; $('#evOk', dlg).disabled = !!m; return !m; };
    ['evTit', 'evFecha'].forEach((id) => $('#' + id, dlg).addEventListener('input', val)); val();
    $('#evOk', dlg).addEventListener('click', () => {
      if (!val()) return; const datos = { emp: Number($('#evEmp', dlg).value), titulo: $('#evTit', dlg).value.trim(), fecha: $('#evFecha', dlg).value, hora: $('#evHora', dlg).value, tipo: $('#evTipo', dlg).value, aviso: Number($('#evAviso', dlg).value), nota: $('#evNota', dlg).value.trim() };
      const emp = D.empresas.find((v) => v.id === datos.emp);
      if (previo) { const cambios = []; [['Título', 'titulo'], ['Fecha', 'fecha'], ['Hora', 'hora'], ['Empresa', 'emp']].forEach(([t, k]) => { if (previo[k] !== datos[k]) cambios.push([t, String(k === 'emp' ? D.empresas.find((v) => v.id === previo.emp).nombre : previo[k] || '—'), String(k === 'emp' ? emp.nombre : datos[k] || '—')]); }); Object.assign(previo, datos); registrar('maestros', 'Modificó el evento "' + datos.titulo + '"', emp.nombre, { emp: emp.id, cambios }); toast('Evento actualizado'); }
      else { eventosPropios.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), hecho: false, ...datos }); registrar('maestros', 'Agregó el evento "' + datos.titulo + '" al calendario', emp.nombre + ' · ' + new Date(datos.fecha + 'T12:00').toLocaleDateString('es-AR') + (datos.hora ? ' · ' + datos.hora : ''), { emp: emp.id }); toast('Evento agregado a ' + emp.nombre + ' · te avisa ' + (AVISOS.find((a) => a[0] === datos.aviso)[1]).toLowerCase() + ' en la campana'); }
      guardarEventos(); dlg.close(); refrescarAgenda();
    });
  }

  /* ---------- vista: inicio ---------- */
  function vInicio(root) {
    const e = empresa(), ri = e.cond === 'RI';
    const varVentas = ((e.ventasMes - e.ventasPrev) / e.ventasPrev) * 100;
    const diaIva = e.venc[0];
    const tareas = [
      { t: ri ? 'Presentar IVA' : 'Pagar monotributo', s: diaIva.dias < 0 ? `Venció hace ${-diaIva.dias} días` : `Vence en ${diaIva.dias} días`, p: Math.max(.08, Math.min(.95, 1 - diaIva.dias / 20)), c: diaIva.dias <= 3 ? 'var(--warn)' : 'var(--brand)', go: 'finanzas/impuestos' },
      { t: 'Conciliar el banco', s: `${e.conciliar} movimientos sin conciliar`, p: Math.max(.1, 1 - e.conciliar / 40), c: 'var(--accent)', go: 'finanzas/tesoreria' },
      { t: 'Reclamar cobranzas', s: `${e.vencido} facturas vencidas`, p: Math.max(.1, 1 - e.vencido / 8), c: e.vencido > 3 ? 'var(--bad)' : 'var(--cyan)', go: 'ventas/clientes' },
    ];
    const agenda = eventosDe(e).filter((x) => x.dias >= -7).slice(0, 8);
    const saludo = hoy.getHours() < 12 ? 'Buen día' : hoy.getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';
    root.innerHTML = `
      <section class="hero rise">
        <div><h1>${saludo}, Andrés.<br><em>${esc(e.nombre)}</em> en una mirada.</h1>
        <p>${tareas.filter((t) => t.p < .75).length ? `Tenés <b>${tareas.filter((t) => t.p < .75).length === 1 ? '1 cosa' : tareas.filter((t) => t.p < .75).length + ' cosas'}</b> para mirar hoy. Lo demás está en orden.` : 'Todo está en orden por hoy.'}</p></div>
        <div class="acciones"><button class="btn primary" data-ir="nueva">${ic('plus')} Nueva factura</button><button class="btn" data-ir="finanzas/tesoreria/cobros">${ic('coin')} Registrar cobro</button><button class="btn" data-ir="finanzas/tesoreria">${ic('bank')} Conciliar</button></div>
      </section>
      <section class="grid">
        <article class="card kpi s3 rise" style="--d:1"><h3>Ventas del mes</h3>${spark(e.ventas)}<div class="v" data-cuenta="${e.ventasMes}" data-f="corto">$ 0</div><div class="d"><b class="${varVentas >= 0 ? 'up' : 'down'}">${varVentas >= 0 ? '▲' : '▼'} ${Math.abs(varVentas).toFixed(1).replace('.', ',')}%</b> vs. mes anterior</div></article>
        <article class="card kpi s3 rise" style="--d:2"><h3>${ri ? 'IVA a pagar' : 'Cuota del mes'}</h3>${spark(e.ventas.map((v) => v * .1).reverse(), 'var(--accent)')}<div class="v" data-cuenta="${ri ? e.ivaPagar : 38000}" data-f="corto">$ 0</div><button class="accion" data-ir="finanzas/impuestos">${ri ? 'Ver posición de IVA' : 'Ver detalle'} ${ic('arrow')}</button></article>
        <article class="card kpi s3 rise" style="--d:3"><h3>Caja y bancos</h3>${spark(e.flujo, 'var(--cyan)')}<div class="v" data-cuenta="${e.caja}" data-f="corto">$ 0</div><div class="d">${e.conciliar} movimientos por conciliar</div></article>
        <article class="card kpi s3 rise" style="--d:4"><h3>Por cobrar</h3>${spark(e.ventas.slice().reverse(), 'var(--brand)')}<div class="v" data-cuenta="${e.porCobrar}" data-f="corto">$ 0</div><div class="d"><b class="${e.vencido > 3 ? 'down' : ''}">${e.vencido} vencidas</b></div></article>

        <article class="card s8 rise" style="--d:5">
          <div class="cabecera-chart"><div><h3>${ic('bank')} Caja y bancos · últimos 30 días</h3><div class="sub">Pasá el cursor para ver cada día</div></div>
          <div class="seg" role="group" aria-label="Serie"><button aria-pressed="true" data-serie="caja">Caja</button><button aria-pressed="false" data-serie="ventas">Ventas</button></div></div>
          <div class="chart" id="grafico"></div><div class="ejes" id="ejes" style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:8px"></div>
        </article>
        <article class="card s4 rise" style="--d:6"><h3>${ic('bolt')} Para hoy</h3>
          ${tareas.map((t) => `<button class="tarea" data-ir="${t.go}">${anillo(t.p, t.c)}<span class="t"><b>${t.t}</b><span>${t.s}</span></span>${ic('arrow')}</button>`).join('')}
        </article>

        <article class="card s7 rise" style="--d:7"><div class="cabecera-chart"><div><h3>${ic('cal')} Próximos vencimientos</h3><div class="sub">Tocá uno para ver el detalle o marcarlo como cumplido</div></div><button class="btn sm" data-nuevo-evento>${ic('plus')} Agregar evento</button></div>
          <div class="venc">${agenda.map((x) => { const f = sumarDias(x.dias); return `<button class="v ${x.hecho ? 'hecho' : x.dias < 0 ? 'ya' : x.dias <= 5 ? 'urg' : ''}" data-ev="${x.key}"><small>${f.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')}</small><span class="dia">${f.getDate()}</span><b>${esc(x.nombre)}</b><small style="text-transform:none">${x.hecho ? 'cumplido' : (x.hora ? x.hora + ' · ' : '') + (x.dias < 0 ? 'vencido' : relDias(x.dias))}</small>${x.propio ? '<i class="mio" title="Evento propio"></i>' : ''}</button>`; }).join('') || '<div class="vacio">No hay vencimientos próximos.</div>'}</div>
        </article>
        <article class="card s5 rise" style="--d:8"><h3>Actividad reciente</h3>
          <div style="margin-top:6px">${e.comp.slice(0, 4).map((c, i) => `<div class="act"><span class="pt ${i % 2 ? 'b' : ''}">${ic('receipt')}</span><span class="t"><b>Factura ${c.letra} ${c.nro}</b><span>${esc(c.cliente)} · ${c.dias === 0 ? 'hoy' : 'hace ' + c.dias + ' d'}</span></span><b class="num">${ARS.format(c.total)}</b></div>`).join('')}</div>
        </article>
      </section>
      <p class="pie-proto">Prototipo con datos de ejemplo · la marca y la paleta son provisorias</p>`;
    $$('[data-cuenta]', root).forEach((el) => contar(el, Number(el.dataset.cuenta), (v) => corto(v)));
    const dias30 = (i) => sumarDias(i - 29).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    const meses = (i) => { const d = new Date(hoy); d.setMonth(d.getMonth() - (11 - i)); return CAPITAL(d.toLocaleDateString('es-AR', { month: 'short' })); };
    const pintarSerie = (cual) => {
      const caja = cual === 'caja';
      grafico($('#grafico'), caja ? e.flujo : e.ventas, caja ? dias30 : meses, (v) => corto(v));
      $('#ejes').innerHTML = caja ? `<span>${dias30(0)}</span><span>${dias30(15)}</span><span>Hoy</span>` : `<span>${meses(0)}</span><span>${meses(6)}</span><span>${meses(11)}</span>`;
    };
    pintarSerie('caja');
    $$('[data-serie]', root).forEach((b) => b.addEventListener('click', () => { $$('[data-serie]', root).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintarSerie(b.dataset.serie); }));
  }

  /* ---------- vista: estudio ---------- */
  function vEstudio(root) {
    const orden = { r: 0, y: 1, g: 2 };
    const lista = D.empresas.map((e) => ({ e, s: semaforo(e) })).sort((a, b) => orden[a.s.nivel] - orden[b.s.nivel]);
    const cuenta = (n) => lista.filter((x) => x.s.nivel === n).length;
    root.innerHTML = `
      <section class="hero rise"><div><h1>Tu <em>cartera</em>, ordenada por urgencia.</h1><p>Lo que más apremia aparece primero. Entrá a cualquier empresa con un clic.</p></div>
        <div class="resumen"><span class="pill bad"><i></i>${cuenta('r')} con atención</span><span class="pill warn"><i></i>${cuenta('y')} vencen pronto</span><span class="pill"><i></i>${cuenta('g')} al día</span></div></section>
      <section class="cartera">${lista.map(({ e, s }, i) => {
        const prox = e.venc[0];
        return `<button class="card emp rise" style="--d:${i}" data-emp="${e.id}" data-entrar="1">
          <header><span class="avatar t${e.tono}">${esc(e.ini)}</span><span class="t"><b>${esc(e.nombre)}</b><span>${esc(e.cuit)} · ${e.cond === 'RI' ? 'Resp. Inscripto' : 'Monotributo'}</span></span><span class="sem ${s.nivel}"></span></header>
          <div class="datos"><div><small>Ventas del mes</small><b class="num">${corto(e.ventasMes)}</b></div><div><small>Por cobrar</small><b class="num">${corto(e.porCobrar)}</b></div></div>
          <footer><span>${esc(prox.nombre)}</span><span class="pill ${s.nivel === 'r' ? 'bad' : s.nivel === 'y' ? 'warn' : ''}">${prox.dias < 0 ? 'vencido' : prox.dias === 0 ? 'hoy' : 'en ' + prox.dias + ' d'}</span></footer></button>`;
      }).join('')}</section>`;
  }

  /* ---------- factura: cálculo ---------- */
  const TASAS = { '21': 21, '10.5': 10.5, '27': 27, '5': 5, '2.5': 2.5, '0': 0 };
  const ETIQ_AL = { '21': 'IVA 21 %', '10.5': 'IVA 10,5 %', '27': 'IVA 27 %', '5': 'IVA 5 %', '2.5': 'IVA 2,5 %', '0': 'IVA 0 %', ex: 'Exento', ng: 'No gravado' };
  const CODIGO = { A: '001', B: '006', C: '011' };
  function nuevaFactura() {
    return { cliente: null, concepto: 'Productos', fecha: iso(hoy), desde: iso(hoy), hasta: iso(hoy), vto: iso(sumarDias(10)), moneda: 'ARS', cot: 1, items: [{ art: '', cant: 1, precio: 0, al: '21' }] };
  }
  function letraPara(emp, cli) {
    if (emp.cond === 'MT') return 'C';
    if (!cli) return null;
    return cli.iva === 'RI' || cli.iva === 'MT' ? 'A' : 'B';
  }
  function calcular(f, letra) {
    const grupos = new Map(); let exento = 0, noGrav = 0, neto = 0;
    const lineas = f.items.map((it) => {
      const imp = Math.round(Number(it.cant || 0) * Number(it.precio || 0) * 100);
      if (letra === 'C') { neto += imp; return { ...it, imp }; }
      if (it.al === 'ex') exento += imp; else if (it.al === 'ng') noGrav += imp;
      else { grupos.set(it.al, (grupos.get(it.al) || 0) + imp); neto += imp; }
      return { ...it, imp };
    });
    const ivas = [...grupos].map(([al, base]) => ({ al, base, iva: Math.round((base * TASAS[al]) / 100) })).sort((a, b) => TASAS[b.al] - TASAS[a.al]);
    const totIva = ivas.reduce((s, x) => s + x.iva, 0);
    const total = letra === 'C' ? neto : neto + exento + noGrav + totIva;
    const sumaRenglones = lineas.reduce((s, l) => s + l.imp, 0) + totIva;
    return { lineas, ivas, neto, exento, noGrav, totIva, total, coincide: letra === 'C' ? total === sumaRenglones - totIva : total === sumaRenglones };
  }

  /* ---------- vista: nueva factura ---------- */
  function vNueva(root) {
    const e = empresa(); if (!estado.fac) estado.fac = nuevaFactura(); const f = estado.fac;
    root.innerHTML = `
      <section class="hero rise"><div><h1>Nueva <em>factura</em></h1><p>El tipo de comprobante se elige solo según el cliente. A la derecha ves cómo queda, en vivo.</p></div></section>
      <div class="fac">
        <div class="col">
          <section class="card paso rise" style="--d:1"><h3><span class="n">1</span> Cliente</h3>
            <div class="campo combo" id="comboCli"><label for="cli">¿A quién le facturás?</label><input class="in" id="cli" autocomplete="off" placeholder="Escribí un nombre o documento…" role="combobox" aria-expanded="false"><ul id="listaCli" hidden role="listbox"></ul></div>
            <div id="selCli"></div></section>
          <section class="card paso rise" style="--d:2"><h3><span class="n">2</span> Datos del comprobante</h3>
            <div class="tres"><div class="campo"><label for="fecha">Fecha</label><input class="in" type="date" id="fecha" value="${f.fecha}"></div>
              <div class="campo"><label for="concepto">Concepto</label><select class="in" id="concepto">${['Productos', 'Servicios', 'Productos y servicios'].map((c) => `<option ${c === f.concepto ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
              <div class="campo"><label for="moneda">Moneda</label><select class="in" id="moneda"><option value="ARS">Pesos (ARS)</option><option value="DOL" ${f.moneda === 'DOL' ? 'selected' : ''}>Dólares (USD)</option></select></div></div>
            <div class="tres" id="serv" hidden><div class="campo"><label for="desde">Servicio desde</label><input class="in" type="date" id="desde" value="${f.desde}"></div><div class="campo"><label for="hasta">Servicio hasta</label><input class="in" type="date" id="hasta" value="${f.hasta}"></div><div class="campo"><label for="vto">Vencimiento de pago</label><input class="in" type="date" id="vto" value="${f.vto}"></div></div>
            <div class="campo" id="cotizacion" hidden style="max-width:240px"><label for="cot">Cotización del día</label><input class="in" type="number" step="0.01" id="cot" value="${f.cot}"></div></section>
          <section class="card paso rise" style="--d:3"><h3><span class="n">3</span> Renglones</h3>
            <div id="renglones" style="display:grid;gap:8px"></div>
            <button class="btn sm agregar" id="agregar">${ic('plus')} Agregar renglón</button></section>
        </div>
        <aside class="card papel rise" style="--d:2" id="papel"></aside>
      </div>
      <div class="barra rise" style="--d:4"><div class="tot"><small id="barraTipo"></small><b class="num" id="barraTotal"></b></div>
        <button class="btn" id="borrador">Guardar borrador</button><button class="btn primary" id="emitirBtn">${ic('bolt')} Emitir y pedir CAE</button></div>
      <datalist id="arts">${D.articulos.map((a) => `<option value="${esc(a.n)}">`).join('')}</datalist>`;

    /* cliente */
    const inCli = $('#cli'), ul = $('#listaCli');
    const pintarCli = () => {
      const c = f.cliente;
      $('#selCli').innerHTML = c ? `<div class="sel"><span class="avatar t2">${esc(c.n.split(' ').slice(0, 2).map((p) => p[0]).join(''))}</span><span class="t"><b>${esc(c.n)}</b><span>${esc(c.doc)} · ${D.condicion[c.iva]}</span></span><span class="tipo-auto">Factura <b>${letraPara(e, c)}</b></span><button class="icon-btn" id="quitarCli" aria-label="Quitar cliente" style="width:32px;height:32px">${ic('x')}</button></div>` : e.cond === 'MT' ? `<div class="sel"><span class="t"><b>Sos monotributista</b><span>Todas tus facturas son tipo C, sin discriminar IVA.</span></span><span class="tipo-auto">Factura <b>C</b></span></div>` : '';
      inCli.style.display = c ? 'none' : ''; $('label[for=cli]').style.display = c ? 'none' : '';
      const q = $('#quitarCli'); if (q) q.onclick = () => { f.cliente = null; pintarCli(); recalcular(); inCli.focus(); };
    };
    const abrirLista = () => {
      const t = inCli.value.toLowerCase();
      const r = empresa().clientes.filter((c) => (c.n + c.doc).toLowerCase().includes(t));
      ul.innerHTML = r.map((c, i) => `<li role="option" data-i="${empresa().clientes.indexOf(c)}" ${i === 0 ? 'aria-selected="true"' : ''}><span><b>${esc(c.n)}</b><br><small>${esc(c.doc)}</small></span><span class="pill ${c.iva === 'RI' ? '' : 'blue'}">${D.condicion[c.iva]}</span></li>`).join('') || '<li>Sin resultados</li>';
      ul.hidden = false; inCli.setAttribute('aria-expanded', 'true');
    };
    const elegir = (i) => { f.cliente = empresa().clientes[i]; ul.hidden = true; inCli.value = ''; pintarCli(); recalcular(); };
    inCli.addEventListener('focus', abrirLista); inCli.addEventListener('input', abrirLista);
    inCli.addEventListener('keydown', (ev) => {
      const items = $$('li[data-i]', ul), cur = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = (cur + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, k) => x.setAttribute('aria-selected', k === n)); }
      if (ev.key === 'Enter' && items[cur]) { ev.preventDefault(); elegir(Number(items[cur].dataset.i)); }
      if (ev.key === 'Escape') ul.hidden = true;
    });
    ul.addEventListener('mousedown', (ev) => { const li = ev.target.closest('li[data-i]'); if (li) { ev.preventDefault(); elegir(Number(li.dataset.i)); } });
    inCli.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; }, 120));

    /* datos */
    const sync = () => {
      f.fecha = $('#fecha').value; f.concepto = $('#concepto').value; f.moneda = $('#moneda').value; f.cot = Number($('#cot').value) || 1;
      f.desde = $('#desde').value; f.hasta = $('#hasta').value; f.vto = $('#vto').value;
      $('#serv').hidden = f.concepto === 'Productos'; $('#cotizacion').hidden = f.moneda === 'ARS'; recalcular();
    };
    ['fecha', 'concepto', 'moneda', 'cot', 'desde', 'hasta', 'vto'].forEach((id) => $('#' + id).addEventListener('input', sync));

    /* renglones */
    const cab = `<div class="reng cab"><span>Artículo o servicio</span><span>Cant.</span><span>Precio</span><span>Alícuota</span><span style="text-align:right">Importe</span><span></span></div>`;
    const renglon = (it, i) => `<div class="reng" data-i="${i}"><input class="in art" list="arts" placeholder="Artículo o servicio…" value="${esc(it.art)}" aria-label="Artículo"><input class="in cant" type="number" min="0" step="any" value="${it.cant}" aria-label="Cantidad"><input class="in precio" type="number" min="0" step="any" value="${it.precio || ''}" placeholder="0,00" aria-label="Precio"><select class="in al" aria-label="Alícuota">${Object.entries(ETIQ_AL).map(([k, v]) => `<option value="${k}" ${k === it.al ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="sub num">$ 0,00</span><button class="x" aria-label="Quitar renglón">${ic('trash')}</button></div>`;
    const pintarRenglones = () => { $('#renglones').innerHTML = cab + f.items.map(renglon).join(''); recalcular(); };
    const rEl = $('#renglones');
    rEl.addEventListener('input', (ev) => {
      const fila = ev.target.closest('.reng[data-i]'); if (!fila) return; const it = f.items[Number(fila.dataset.i)];
      it.art = $('.art', fila).value; it.cant = $('.cant', fila).value; it.precio = $('.precio', fila).value; it.al = $('.al', fila).value;
      if (ev.target.classList.contains('art')) { const a = D.articulos.find((x) => x.n === it.art); if (a) { it.precio = MOD.precio(e, a, f.cliente); it.al = a.al; $('.precio', fila).value = it.precio; $('.al', fila).value = a.al; } }
      recalcular();
    });
    rEl.addEventListener('click', (ev) => { const b = ev.target.closest('.x'); if (!b) return; const i = Number(b.closest('.reng').dataset.i); f.items.splice(i, 1); if (!f.items.length) f.items.push({ art: '', cant: 1, precio: 0, al: '21' }); pintarRenglones(); });
    rEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.classList.contains('precio')) { ev.preventDefault(); agregar(); } });
    const agregar = () => { f.items.push({ art: '', cant: 1, precio: 0, al: '21' }); pintarRenglones(); $$('.art', rEl).pop().focus(); };
    $('#agregar').addEventListener('click', agregar);

    /* vista previa y chequeos */
    function recalcular() {
      const letra = letraPara(e, f.cliente), c = calcular(f, letra || 'A'), ver = letra || '·', mon = f.moneda === 'DOL' ? 'USD' : 'ARS';
      $$('.reng[data-i]', rEl).forEach((fila, i) => { $('.sub', fila).textContent = fmt(c.lineas[i].imp); $('.al', fila).style.visibility = letra === 'C' ? 'hidden' : ''; });
      const cli = f.cliente, serv = f.concepto !== 'Productos';
      const fechaOk = Math.abs((new Date(f.fecha) - hoy) / 864e5) <= 10, servOk = !serv || (f.desde && f.hasta && f.vto && f.desde <= f.hasta);
      const hayImporte = c.total > 0;
      const chk = [
        [letra ? 'ok' : 'no', letra ? `Tipo de comprobante: Factura ${letra} (código ${CODIGO[letra]})` : 'Elegí un cliente para definir el tipo de comprobante'],
        [cli || letra === 'C' ? 'ok' : 'no', cli ? `Condición IVA del receptor informada: ${D.condicion[cli.iva]} (RG 5616)` : letra === 'C' ? 'Condición IVA del receptor: se pedirá al emitir (RG 5616)' : 'Falta la condición IVA del receptor (RG 5616)'],
        [hayImporte ? 'ok' : 'no', hayImporte ? 'Importes cargados' : 'Cargá al menos un renglón con importe'],
        [servOk ? 'ok' : 'no', serv ? (servOk ? 'Fechas de servicio completas' : 'Servicios: completá desde, hasta y vencimiento') : 'Concepto sin fechas de servicio'],
        [fechaOk ? 'ok' : 'av', fechaOk ? `Fecha dentro del período abierto (${CAPITAL(mesAnio)})` : 'Fecha lejana: revisá el período'],
        [c.coincide ? 'ok' : 'no', 'El total es exactamente la suma de los renglones'],
      ];
      const error = chk.some((x) => x[0] === 'no');
      const filas = c.lineas.filter((l) => l.imp > 0 || l.art);
      const arca = { ImpNeto: c.neto, ImpIVA: c.totIva, ImpTotConc: c.noGrav, ImpOpEx: c.exento, ImpTrib: 0, ImpTotal: c.total };
      $('#papel').innerHTML = `
        <div class="cab"><div class="emi"><b>${esc(e.nombre)}</b><span>CUIT ${esc(e.cuit)} · ${D.condicion[e.cond]}</span><span>Punto de venta 0003 · ${new Date(f.fecha + 'T12:00').toLocaleDateString('es-AR')}</span></div><div class="letra-grande"><b>${ver}</b><small>${letra ? 'COD. ' + CODIGO[letra] : ''}</small></div></div>
        <div class="cuerpo"><div><small style="color:var(--muted)">Cliente</small><br><b>${cli ? esc(cli.n) : '— sin elegir —'}</b>${cli ? `<br><span style="color:var(--ink-2)">${esc(cli.doc)} · ${D.condicion[cli.iva]}</span>` : ''}</div>
          <table><thead><tr><th>Detalle</th><th>Cant.</th><th>${letra === 'C' ? 'Importe' : 'Neto'}</th></tr></thead><tbody>${filas.length ? filas.map((l) => `<tr><td>${esc(l.art || 'Renglón sin detalle')}</td><td class="num">${esc(l.cant)}</td><td class="num">${fmt(l.imp)}</td></tr>`).join('') : '<tr><td colspan="3" style="color:var(--muted)">Los renglones aparecen acá a medida que los cargás.</td></tr>'}</tbody></table>
          <div class="totales num">${letra === 'C' ? '' : `<div><span>Importe neto gravado</span><span>${fmt(c.neto)}</span></div>${c.ivas.map((x) => `<div><span>IVA ${String(TASAS[x.al]).replace('.', ',')} %</span><span>${fmt(x.iva)}</span></div>`).join('')}${c.exento ? `<div><span>Operaciones exentas</span><span>${fmt(c.exento)}</span></div>` : ''}${c.noGrav ? `<div><span>No gravado</span><span>${fmt(c.noGrav)}</span></div>` : ''}`}<div class="total"><span>Total</span><span>${fmt(c.total)}</span></div>${f.moneda === 'DOL' ? `<div><span>Equivale a (ARS)</span><span>${fmt(Math.round(c.total * f.cot))}</span></div>` : ''}</div></div>
        <div class="chequeos">${chk.map(([k, t]) => `<div class="${k}">${ic(k === 'ok' ? 'check' : 'alert')}<span style="color:var(--ink-2)">${t}</span></div>`).join('')}</div>
        <details class="arca"><summary>Cómo se lo enviamos a ARCA</summary><pre>${Object.entries(arca).map(([k, v]) => `${k.padEnd(11)} ${(v / 100).toFixed(2).padStart(12)}`).join('\n')}</pre></details>`;
      $('#barraTipo').textContent = letra ? `Factura ${letra} · ${mon}` : 'Elegí un cliente'; $('#barraTotal').textContent = fmt(c.total);
      $('#emitirBtn').disabled = error;
    }
    $('#borrador').addEventListener('click', () => {
      registrar('comprobantes', 'Guardó borrador de factura', (f.cliente ? f.cliente.n : 'Sin cliente') + ' · ' + f.items.length + ' renglón' + (f.items.length === 1 ? '' : 'es'));
      toast('Borrador guardado (simulado)');
    });
    $('#emitirBtn').addEventListener('click', emitirSimulado);
    pintarCli(); pintarRenglones(); sync();
  }

  function emitirSimulado() {
    const dlg = $('#emitir'), body = $('#emitirBody');
    const pasos = ['Validando contra las reglas', 'Firmando el pedido (WSAA)', 'Solicitando el CAE a ARCA', 'Registrando el asiento contable'];
    body.innerHTML = `<h4>Emitiendo…</h4><div class="sub" style="color:var(--muted)">Simulación del prototipo: todavía no hay conexión con ARCA.</div><div class="pasos">${pasos.map((p) => `<div><i></i>${p}</div>`).join('')}</div>`;
    if (!dlg.open) dlg.showModal();
    const filas = $$('.pasos div', body); let n = 0;
    const siguiente = () => {
      if (n > 0) { filas[n - 1].className = 'hecho'; filas[n - 1].firstChild.innerHTML = ic('check'); }
      if (n < filas.length) { filas[n].className = 'on'; n += 1; setTimeout(siguiente, reducir ? 80 : 700); return; }
      const cae = String(Math.floor(70000000000000 + Math.random() * 9999999999999));
      const e = empresa(), f = estado.fac, letra = letraPara(e, f.cliente) || 'C', c = calcular(f, letra);
      const nro = '0003-' + String(Math.max(...e.comp.map((x) => Number(x.nro.slice(5)))) + 1).padStart(8, '0'), cliente = f.cliente ? f.cliente.n : 'Consumidor Final';
      const items = f.items.filter((i) => i.art || Number(i.precio)).map((i) => ({ art: i.art || 'Renglón sin detalle', cod: (D.articulos.find((a) => a.n === i.art) || {}).cod || '', cant: Number(i.cant) || 0, precio: Number(i.precio) || 0, al: i.al }));
      e.comp.unshift({ letra, cliente, dias: 0, nro, items, total: c.total / 100, estado: 'Autorizado' });
      registrar('comprobantes', `Emitió Factura ${letra} ${nro}`, `${cliente} · ${fmt(c.total)} · CAE ${cae} (simulado)`);
      MOD.alFacturar(f.origen, `${letra} ${nro}`, c.total / 100, cliente);
      body.innerHTML = `<h4>Factura ${letra} autorizada</h4><div class="sub" style="color:var(--muted);margin-bottom:14px">Simulado · el CAE de abajo es inventado.</div><div class="cae"><small style="color:var(--ink-2)">CAE</small><b>${cae}</b><small style="color:var(--ink-2)">Vence ${sumarDias(10).toLocaleDateString('es-AR')}</small></div><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="otra">Hacer otra</button><button class="btn primary" id="verLista">Ver comprobantes</button></div>`;
      $('#otra').onclick = () => { estado.fac = null; dlg.close(); render(); };
      $('#verLista').onclick = () => { estado.fac = null; dlg.close(); ir('ventas/facturas'); };
    };
    siguiente();
  }

  /* ---------- trazabilidad ---------- */
  /* Registro de solo lectura: cada movimiento queda encadenado con el anterior mediante una huella.
     La huella de acá es demostrativa; en el producto la calcula el servidor (SHA-256) sobre la tabla `auditoria`. */
  const USUARIO = D.usuarios[0];
  const bit = D.bitacora; /* el más nuevo primero */
  const usuarioDe = (id) => D.usuarios.find((u) => u.id === id);
  const RES = { ok: ['Correcto', ''], rechazo: ['Rechazado', 'bad'], fallo: ['Fallido', 'warn'] };
  const fnv = (s, semilla) => { let h = semilla >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const huella = (previa, ev) => { const s = previa + '|' + [ev.ts, ev.u, ev.emp, ev.cat, ev.accion, ev.detalle, ev.res].join('|'); return fnv(s, 2166136261) + fnv(s, 3266489917); };
  (function encadenar() { let previa = ''; for (let i = bit.length - 1; i >= 0; i--) { bit[i].hp = previa; bit[i].h = previa = huella(previa, bit[i]); } })();
  function verificarCadena() {
    let previa = '';
    for (let i = bit.length - 1; i >= 0; i--) { if (bit[i].hp !== previa || bit[i].h !== huella(previa, bit[i])) return bit[i].id; previa = bit[i].h; }
    return -1;
  }
  function registrar(cat, accion, detalle, extra = {}) {
    const prev = bit[0];
    const ev = { id: (prev ? prev.id : 0) + 1, ts: Date.now(), u: USUARIO.id, emp: estado.empresaId, cat, accion, detalle, res: 'ok', ip: '203.0.113.24', disp: 'Este navegador', ...extra, hp: prev ? prev.h : '' };
    ev.h = huella(ev.hp, ev); bit.unshift(ev); return ev;
  }
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();
  function cuando(ts) {
    const d = new Date(ts), ayer = sumarDias(-1);
    const dia = mismoDia(d, hoy) ? 'Hoy' : mismoDia(d, ayer) ? 'Ayer' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '');
    return { dia, hora: d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), largo: d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  const codigo = (ev) => 'TR-' + String(ev.id).padStart(6, '0');
  const nombreEmpresa = (id) => { const e = D.empresas.find((x) => x.id === id); return e ? e.nombre : 'Estudio (sin empresa)'; };

  function vTrazabilidad(root) {
    const f = { cat: 'todas', per: '7', u: '', emp: '', q: '', max: 40 };
    const inicioHoy = new Date(hoy); inicioHoy.setHours(0, 0, 0, 0);
    const desde = () => (f.per === 'hoy' ? inicioHoy.getTime() : inicioHoy.getTime() - (Number(f.per) - 1) * 864e5);
    root.innerHTML = `
      <section class="hero rise"><div><h1>Trazabilidad de <em>movimientos</em></h1><p>Quién hizo qué, sobre qué empresa y cuándo. Es un registro de solo lectura: nadie puede editarlo ni borrarlo.</p></div>
        <div class="acciones"><button class="btn" id="verificar">${ic('lock')} Verificar integridad</button><button class="btn" id="exportar">${ic('download')} Exportar CSV</button></div></section>
      <div class="filtros rise" style="--d:1" role="group" aria-label="Tipo de actividad">${[['todas', 'Todas'], ...Object.entries(D.categorias)].map(([k, v]) => `<button class="f" data-cat="${k}" aria-pressed="${k === 'todas'}">${v}</button>`).join('')}</div>
      <div class="filtros rise" style="--d:2">
        <div class="seg" role="group" aria-label="Período">${[['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días']].map(([k, v]) => `<button data-per="${k}" aria-pressed="${k === f.per}">${v}</button>`).join('')}</div>
        <select class="in" id="fUsuario" aria-label="Usuario"><option value="">Todos los usuarios</option>${D.usuarios.map((u) => `<option value="${u.id}">${esc(u.n)}</option>`).join('')}</select>
        <select class="in" id="fEmpresa" aria-label="Empresa"><option value="">Todas las empresas</option><option value="est">Sin empresa (del estudio)</option>${D.empresas.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select>
        <input id="fq" placeholder="Buscar por ID, actividad, cliente o número…" aria-label="Buscar en la trazabilidad"></div>
      <div class="resumen rise" style="--d:3" id="resumenTraza"></div>
      <div class="card lista traza rise" style="--d:4" id="listaTraza"></div>
      <p class="pie-proto">${ic('lock')} Cada registro lleva una huella encadenada con el anterior: si alguien alterara uno, la verificación lo detecta.</p>`;

    const filtrados = () => {
      const t = f.q.toLowerCase(), d0 = desde();
      return bit.filter((ev) => ev.ts >= d0 && (f.cat === 'todas' || ev.cat === f.cat) && (!f.u || ev.u === Number(f.u))
        && (!f.emp || (f.emp === 'est' ? ev.emp == null : ev.emp === Number(f.emp)))
        && (!t || (codigo(ev) + ' ' + ev.accion + ' ' + ev.detalle + ' ' + usuarioDe(ev.u).n + ' ' + nombreEmpresa(ev.emp)).toLowerCase().includes(t)));
    };
    const detalle = (ev) => {
      const u = usuarioDe(ev.u), c = cuando(ev.ts);
      return `<dl>
        <div><dt>Fecha y hora</dt><dd>${esc(CAPITAL(c.largo))}, ${c.hora}</dd></div>
        <div><dt>Usuario</dt><dd>${esc(u.n)} · ${esc(u.rol)}</dd></div>
        <div><dt>Empresa</dt><dd>${esc(nombreEmpresa(ev.emp))}</dd></div>
        <div><dt>Origen</dt><dd>${esc(ev.ip)} · ${esc(ev.disp)}</dd></div>
        <div><dt>ID</dt><dd><code class="id-traza">${codigo(ev)}</code> · ${esc(D.categorias[ev.cat])}</dd></div>
        <div><dt>Resultado</dt><dd>${RES[ev.res][0]}</dd></div></dl>
        ${ev.cambios ? `<table class="cambios"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>${ev.cambios.map(([k, a, b]) => `<tr><td>${esc(k)}</td><td class="antes">${esc(a)}</td><td class="desp">${esc(b)}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="huella"><span>Huella <code>${ev.h}</code></span><span>Anterior <code>${ev.hp || '— inicio del registro —'}</code></span></div>`;
    };
    const pintar = () => {
      const filas = filtrados(), shown = filas.slice(0, f.max), mal = filas.filter((x) => x.res !== 'ok').length;
      $('#resumenTraza').innerHTML = `<span class="pill blue"><i></i>${filas.length} movimiento${filas.length === 1 ? '' : 's'}</span><span class="pill"><i></i>${new Set(filas.map((x) => x.u)).size} usuario${new Set(filas.map((x) => x.u)).size === 1 ? '' : 's'}</span>${mal ? `<span class="pill bad"><i></i>${mal} con problemas</span>` : ''}`;
      $('#listaTraza').innerHTML = filas.length ? `<div class="ev cab"><span>ID</span><span>Fecha y hora</span><span>Usuario</span><span>Actividad</span><span>Empresa</span><span>Resultado</span></div>` + shown.map((ev) => {
        const u = usuarioDe(ev.u), c = cuando(ev.ts);
        return `<article class="ev" data-res="${ev.res}"><button class="ev-f" aria-expanded="false" aria-controls="det${ev.id}">
          <span class="ev-id num">${codigo(ev)}</span>
          <span class="ev-cuando num"><b>${c.dia}</b><small>${c.hora}</small></span>
          <span class="ev-u"><span class="avatar t${u.tono}">${esc(u.ini)}</span><span class="t"><b>${esc(u.n)}</b><span>${esc(u.rol)}</span></span></span>
          <span class="ev-act"><b>${esc(ev.accion)}</b><span>${esc(ev.detalle)}</span></span>
          <span class="ev-emp">${esc(nombreEmpresa(ev.emp))}</span>
          <span class="ev-res"><span class="pill ${RES[ev.res][1]}"><i></i>${RES[ev.res][0]}</span></span></button>
          <div class="ev-det" id="det${ev.id}" hidden>${detalle(ev)}</div></article>`;
      }).join('') + (filas.length > shown.length ? `<button class="btn mas" id="verMas">Ver ${Math.min(40, filas.length - shown.length)} más · quedan ${filas.length - shown.length}</button>` : '') : `<div class="vacio">No hay movimientos con ese filtro.</div>`;
    };
    pintar();

    $$('[data-cat]', root).forEach((b) => b.addEventListener('click', () => { f.cat = b.dataset.cat; f.max = 40; $$('[data-cat]', root).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }));
    $$('[data-per]', root).forEach((b) => b.addEventListener('click', () => { f.per = b.dataset.per; f.max = 40; $$('[data-per]', root).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }));
    $('#fUsuario', root).addEventListener('change', (ev) => { f.u = ev.target.value; f.max = 40; pintar(); });
    $('#fEmpresa', root).addEventListener('change', (ev) => { f.emp = ev.target.value; f.max = 40; pintar(); });
    $('#fq', root).addEventListener('input', (ev) => { f.q = ev.target.value; f.max = 40; pintar(); });
    $('#listaTraza', root).addEventListener('click', (ev) => {
      if (ev.target.closest('#verMas')) { f.max += 40; pintar(); return; }
      const b = ev.target.closest('.ev-f'); if (!b) return;
      const abierto = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', !abierto); $('#' + b.getAttribute('aria-controls')).hidden = abierto;
    });
    $('#verificar', root).addEventListener('click', () => {
      const mal = verificarCadena(), n = bit.length;
      toast(mal < 0 ? `Registro íntegro: ${n} movimientos verificados` : `Se detectó una alteración en el registro N° ${mal}`);
      registrar('seguridad', 'Verificó la integridad de la trazabilidad', mal < 0 ? n + ' registros, sin alteraciones' : 'Alteración detectada en el registro N° ' + mal, { emp: null, res: mal < 0 ? 'ok' : 'fallo' });
      pintar();
    });
    $('#exportar', root).addEventListener('click', () => {
      const filas = filtrados();
      /* los valores que empiezan con = + - @ se neutralizan para que Excel no los ejecute como fórmula */
      const q = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const pad = (n) => String(n).padStart(2, '0');
      const lineas = [['ID', 'Fecha', 'Hora', 'Usuario', 'Rol', 'Empresa', 'Categoría', 'Actividad', 'Detalle', 'Resultado', 'IP', 'Huella']].concat(filas.map((ev) => {
        const d = new Date(ev.ts), u = usuarioDe(ev.u);
        return [codigo(ev), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, cuando(ev.ts).hora, u.n, u.rol, nombreEmpresa(ev.emp), D.categorias[ev.cat], ev.accion, ev.detalle, RES[ev.res][0], ev.ip, ev.h];
      })).map((l) => l.map(q).join(';')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + lineas], { type: 'text/csv;charset=utf-8' }));
      a.download = 'trazabilidad-' + iso(hoy) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      registrar('seguridad', 'Exportó la trazabilidad a CSV', filas.length + ' movimientos', { emp: null });
      toast(filas.length + ' movimientos exportados'); pintar();
    });
  }

  /* ---------- paleta de comandos ---------- */
  let paletaSel = 0, paletaItems = [];
  function comandos() {
    const nav = [...Object.entries(VISTAS).filter(([k]) => k !== 'nueva').map(([k, v]) => ({ g: 'Ir a', t: v.titulo, ic: v.icono, f: () => ir(k) })),
      ...MOD.rutas.map((r) => ({ g: 'Ir a', t: r.t, ic: r.ruta.startsWith('ventas') ? 'trend' : r.ruta.startsWith('compras') ? (r.ruta.includes('stock') ? 'box' : 'cart') : 'wallet', f: () => ir(r.ruta) }))];
    const acc = [
      { g: 'Acciones', t: 'Agregar evento al calendario', ic: 'cal', f: () => formEvento() },
      { g: 'Acciones', t: 'Emitir factura nueva', ic: 'plus', f: () => { estado.fac = null; ir('nueva'); } },
      { g: 'Acciones', t: document.documentElement.dataset.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro', ic: 'sun', f: alternarTema },
    ];
    const emps = D.empresas.map((e) => ({ g: 'Cambiar de empresa', t: e.nombre, s: e.cuit, ic: 'grid', f: () => cambiarEmpresa(e.id) }));
    const clis = empresa().clientes.map((c) => ({ g: 'Clientes', t: c.n, s: c.doc, ic: 'receipt', f: () => { estado.fac = nuevaFactura(); estado.fac.cliente = c; ir('nueva'); toast('Factura nueva para ' + c.n); } }));
    return [...nav, ...acc, ...emps, ...clis];
  }
  function pintarPaleta() {
    const t = $('#paletaQ input').value.toLowerCase();
    paletaItems = comandos().filter((c) => (c.t + ' ' + (c.s || '') + ' ' + c.g).toLowerCase().includes(t)).slice(0, 14); paletaSel = 0;
    let g = '';
    $('#paletaRes').innerHTML = paletaItems.map((c, i) => `${c.g !== g ? `<div class="grupo">${(g = c.g)}</div>` : ''}<button class="op" role="option" data-n="${i}" aria-selected="${i === 0}">${ic(c.ic)}<span class="t">${esc(c.t)}${c.s ? ` <small>${esc(c.s)}</small>` : ''}</span></button>`).join('') || '<div class="vacio">Sin resultados.</div>';
  }
  function abrirPaleta() {
    const d = $('#paleta'); $('#paletaQ').innerHTML = `${ic('search')}<input placeholder="Escribí un comando, una empresa o un cliente…" aria-label="Comando">`;
    d.showModal(); pintarPaleta(); const inp = $('#paletaQ input'); inp.focus();
    inp.addEventListener('input', pintarPaleta);
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); paletaSel = (paletaSel + (ev.key === 'ArrowDown' ? 1 : -1) + paletaItems.length) % paletaItems.length; $$('#paletaRes .op').forEach((b, i) => b.setAttribute('aria-selected', i === paletaSel)); $$('#paletaRes .op')[paletaSel]?.scrollIntoView({ block: 'nearest' }); }
      if (ev.key === 'Enter' && paletaItems[paletaSel]) { d.close(); paletaItems[paletaSel].f(); }
    });
  }

  /* ---------- tema y avisos ---------- */
  function alternarTema() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; guardar('proto_tema', t); pintarTopbar();
  }
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 2800); }

  /* ---------- eventos globales ---------- */
  document.addEventListener('click', (ev) => {
    const ird = ev.target.closest('[data-ir]'); if (ird) { cerrarPop(); if ($('#detalle').open) $('#detalle').close(); ir(ird.dataset.ir); return; }
    const nv = ev.target.closest('[data-nuevo-evento]'); if (nv) { cerrarPop(); formEvento(); return; }
    const evb = ev.target.closest('[data-ev]'); if (evb) { cerrarPop(); verEvento(evb.dataset.ev); return; }
    const alc = ev.target.closest('[data-notif-alc]'); if (alc) { estado.notifSolo = alc.dataset.notifAlc === 'una'; abrirNotif(); return; }
    if (ev.target.closest('#campana')) { $('#popNotif').hidden ? abrirNotif() : cerrarPop(); return; }
    const emp = ev.target.closest('[data-emp]'); if (emp) { const id = Number(emp.dataset.emp); if (emp.dataset.entrar) { estado.empresaId = id; estado.fac = null; guardar('proto_empresa', id); registrar('acceso', 'Entró a la empresa ' + empresa().nombre, 'Desde la cartera del estudio'); pintarTopbar(); ir('inicio'); } else cambiarEmpresa(id); return; }
    const ts = ev.target.closest('[data-toast]'); if (ts) { toast(ts.dataset.toast); return; }
    const op = ev.target.closest('#paletaRes .op'); if (op) { $('#paleta').close(); paletaItems[Number(op.dataset.n)].f(); return; }
    if (ev.target.closest('#empresaBtn')) { $('#popEmpresa').hidden ? abrirPop() : cerrarPop(); return; }
    if (ev.target.closest('#abrirPaleta')) { abrirPaleta(); return; }
    if (ev.target.closest('#tema')) { alternarTema(); return; }
    if (!ev.target.closest('#popEmpresa, #popNotif')) cerrarPop();
    if (ev.target === $('#paleta') || ev.target === $('#emitir') || ev.target === $('#detalle')) ev.target.close();
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); const d = $('#paleta'); d.open ? d.close() : abrirPaleta(); }
    if (ev.key === 'Escape') cerrarPop();
  });
  window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 6), { passive: true });
  window.addEventListener('hashchange', render);

  /* ---------- módulos (ventas, compras, finanzas) ---------- */
  function abrirFactura(nombre, items, origen) {
    const c = empresa().clientes.find((x) => x.n === nombre) || null;
    estado.fac = nuevaFactura(); estado.fac.cliente = c; estado.fac.origen = origen || null;
    if (items.length) estado.fac.items = items.map((i) => ({ art: i.art, cant: i.cant, precio: Math.round(i.precio * (1 - (i.desc || 0) / 100) * 100) / 100, al: i.al }));
    ir('nueva'); toast(c ? 'Factura nueva para ' + c.n : 'Factura nueva');
  }
  const MOD = window.crearModulos({ $, $$, esc, ic, ARS, corto, toast, contar, sumarDias, empresa, registrar, abrirFactura, ir, D });

  /* ---------- arranque ---------- */
  const guardado = leer('proto_tema');
  document.documentElement.dataset.theme = guardado || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  try { if (!sessionStorage.getItem('proto_sesion')) { sessionStorage.setItem('proto_sesion', '1'); registrar('acceso', 'Inició sesión', 'Ingreso con usuario y segundo factor', { emp: null }); } } catch (e) { /* sin almacenamiento */ }
  pintarTopbar(); render();
})();
