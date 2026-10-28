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
    x: 'M6 6l12 12M18 6L6 18',
    coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7',
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
  const VISTAS = {
    inicio: { titulo: 'Inicio', icono: 'home', montar: vInicio },
    estudio: { titulo: 'Estudio', icono: 'grid', montar: vEstudio },
    comprobantes: { titulo: 'Comprobantes', icono: 'receipt', montar: vComprobantes },
    nueva: { titulo: 'Nueva factura', icono: 'plus', montar: vNueva },
  };
  function pintarNav(actual) {
    $('#nav').innerHTML = Object.entries(VISTAS).map(([k, v]) =>
      `<button data-ir="${k}" data-tip="${v.titulo}" aria-label="${v.titulo}" ${k === actual ? 'aria-current="page"' : ''}>${ic(v.icono)}</button>`).join('');
  }
  function render() {
    const nombre = location.hash.replace('#/', '') || 'inicio';
    const vista = VISTAS[nombre] || VISTAS.inicio;
    const actual = VISTAS[nombre] ? nombre : 'inicio';
    const montar = () => { pintarNav(actual); $('#vista').innerHTML = ''; vista.montar($('#vista')); window.scrollTo(0, 0); };
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
  }
  function cambiarEmpresa(id) {
    estado.empresaId = id; estado.fac = null; guardar('proto_empresa', id);
    pintarTopbar(); cerrarPop(); render();
    toast('Ahora trabajás en ' + empresa().nombre);
  }
  function abrirPop() {
    const pop = $('#popEmpresa'); const b = $('#empresaBtn').getBoundingClientRect();
    pop.style.left = Math.max(12, b.left + scrollX) + 'px'; pop.style.top = b.bottom + scrollY + 8 + 'px';
    pop.innerHTML = `<h6>Empresas del estudio</h6>` + D.empresas.map((e) =>
      `<button class="op" data-emp="${e.id}" role="option" ${e.id === estado.empresaId ? 'aria-selected="true"' : ''}><span class="avatar t${e.tono}">${esc(e.ini)}</span><span class="t"><b>${esc(e.nombre)}</b><span>${esc(e.cuit)} · ${e.cond === 'RI' ? 'Resp. Inscripto' : 'Monotributo'}</span></span>${semaforo(e).punto}</button>`).join('') +
      `<h6>Vista global</h6><button class="op" data-ir="estudio">${ic('grid')}<span class="t"><b>Cartera del estudio</b><span>Semáforo de todas las empresas</span></span></button>`;
    pop.hidden = false; $('#empresaBtn').setAttribute('aria-expanded', 'true');
  }
  function cerrarPop() { $('#popEmpresa').hidden = true; $('#empresaBtn').setAttribute('aria-expanded', 'false'); }

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

  /* ---------- vista: inicio ---------- */
  function vInicio(root) {
    const e = empresa(), ri = e.cond === 'RI';
    const varVentas = ((e.ventasMes - e.ventasPrev) / e.ventasPrev) * 100;
    const diaIva = e.venc[0];
    const tareas = [
      { t: ri ? 'Presentar IVA' : 'Pagar monotributo', s: diaIva.dias < 0 ? `Venció hace ${-diaIva.dias} días` : `Vence en ${diaIva.dias} días`, p: Math.max(.08, Math.min(.95, 1 - diaIva.dias / 20)), c: diaIva.dias <= 3 ? 'var(--warn)' : 'var(--brand)', go: 'comprobantes' },
      { t: 'Conciliar el banco', s: `${e.conciliar} movimientos sin conciliar`, p: Math.max(.1, 1 - e.conciliar / 40), c: 'var(--accent)', go: 'comprobantes' },
      { t: 'Reclamar cobranzas', s: `${e.vencido} facturas vencidas`, p: Math.max(.1, 1 - e.vencido / 8), c: e.vencido > 3 ? 'var(--bad)' : 'var(--cyan)', go: 'comprobantes' },
    ];
    const saludo = hoy.getHours() < 12 ? 'Buen día' : hoy.getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';
    root.innerHTML = `
      <section class="hero rise">
        <div><h1>${saludo}, Andrés.<br><em>${esc(e.nombre)}</em> en una mirada.</h1>
        <p>${tareas.filter((t) => t.p < .75).length ? `Tenés <b>${tareas.filter((t) => t.p < .75).length === 1 ? '1 cosa' : tareas.filter((t) => t.p < .75).length + ' cosas'}</b> para mirar hoy. Lo demás está en orden.` : 'Todo está en orden por hoy.'}</p></div>
        <div class="acciones"><button class="btn primary" data-ir="nueva">${ic('plus')} Nueva factura</button><button class="btn" data-toast="Registrar cobro: próximamente en el prototipo">${ic('coin')} Registrar cobro</button><button class="btn" data-toast="Conciliación: próximamente en el prototipo">${ic('bank')} Conciliar</button></div>
      </section>
      <section class="grid">
        <article class="card kpi s3 rise" style="--d:1"><h3>Ventas del mes</h3>${spark(e.ventas)}<div class="v" data-cuenta="${e.ventasMes}" data-f="corto">$ 0</div><div class="d"><b class="${varVentas >= 0 ? 'up' : 'down'}">${varVentas >= 0 ? '▲' : '▼'} ${Math.abs(varVentas).toFixed(1).replace('.', ',')}%</b> vs. mes anterior</div></article>
        <article class="card kpi s3 rise" style="--d:2"><h3>${ri ? 'IVA a pagar' : 'Cuota del mes'}</h3>${spark(e.ventas.map((v) => v * .1).reverse(), 'var(--accent)')}<div class="v" data-cuenta="${ri ? e.ivaPagar : 38000}" data-f="corto">$ 0</div><button class="accion" data-ir="comprobantes">${ri ? 'Ver posición de IVA' : 'Ver detalle'} ${ic('arrow')}</button></article>
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

        <article class="card s7 rise" style="--d:7"><h3>${ic('cal')} Próximos vencimientos</h3>
          <div class="venc">${e.venc.map((v) => { const f = sumarDias(v.dias); return `<div class="v ${v.dias < 0 ? 'ya' : v.dias <= 5 ? 'urg' : ''}"><small>${f.toLocaleDateString('es-AR', { month: 'short' })}</small><span class="dia">${f.getDate()}</span><b>${esc(v.nombre)}</b><small style="text-transform:none">${v.dias < 0 ? 'vencido' : v.dias === 0 ? 'hoy' : 'en ' + v.dias + ' días'}</small></div>`; }).join('')}</div>
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

  /* ---------- vista: comprobantes ---------- */
  function vComprobantes(root) {
    const e = empresa(); let filtro = 'Todos', texto = '';
    const pillEstado = { Autorizado: '', Borrador: 'mute', Rechazado: 'bad', Anulado: 'warn' };
    root.innerHTML = `
      <section class="hero rise"><div><h1>Comprobantes <em>emitidos</em></h1><p>${esc(e.nombre)} · punto de venta 0003</p></div><div class="acciones"><button class="btn primary" data-ir="nueva">${ic('plus')} Nueva factura</button></div></section>
      <div class="filtros rise" style="--d:1">${['Todos', 'Autorizado', 'Borrador', 'Rechazado', 'Anulado'].map((f) => `<button class="f" data-filtro="${f}" aria-pressed="${f === 'Todos'}">${f}</button>`).join('')}<input id="q" placeholder="Buscar cliente o número…" aria-label="Buscar"></div>
      <div class="card lista rise" style="--d:2" id="lista"></div>`;
    const pintar = () => {
      const filas = e.comp.filter((c) => (filtro === 'Todos' || c.estado === filtro) && (c.cliente + c.nro).toLowerCase().includes(texto));
      $('#lista').innerHTML = filas.length ? filas.map((c) => `<div class="fila"><span class="letra">${c.letra}</span><span class="t col-cli"><b>${esc(c.cliente)}</b><span>Factura ${c.letra} ${c.nro}</span></span><span class="col-fecha num" style="color:var(--ink-2)">${sumarDias(-c.dias).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</span><span><span class="pill ${pillEstado[c.estado]}"><i></i>${c.estado}</span></span><span class="imp num">${ARS.format(c.total)}</span></div>`).join('') : `<div class="vacio">Nada con ese filtro.</div>`;
    };
    pintar();
    $$('[data-filtro]', root).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.filtro; $$('[data-filtro]', root).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }));
    $('#q', root).addEventListener('input', (ev) => { texto = ev.target.value.toLowerCase(); pintar(); });
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
      const r = D.clientes.filter((c) => (c.n + c.doc).toLowerCase().includes(t));
      ul.innerHTML = r.map((c, i) => `<li role="option" data-i="${D.clientes.indexOf(c)}" ${i === 0 ? 'aria-selected="true"' : ''}><span><b>${esc(c.n)}</b><br><small>${esc(c.doc)}</small></span><span class="pill ${c.iva === 'RI' ? '' : 'blue'}">${D.condicion[c.iva]}</span></li>`).join('') || '<li>Sin resultados</li>';
      ul.hidden = false; inCli.setAttribute('aria-expanded', 'true');
    };
    const elegir = (i) => { f.cliente = D.clientes[i]; ul.hidden = true; inCli.value = ''; pintarCli(); recalcular(); };
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
      if (ev.target.classList.contains('art')) { const a = D.articulos.find((x) => x.n === it.art); if (a) { it.precio = a.p; it.al = a.al; $('.precio', fila).value = a.p; $('.al', fila).value = a.al; } }
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
    $('#borrador').addEventListener('click', () => toast('Borrador guardado (simulado)'));
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
      e.comp.unshift({ letra, cliente: f.cliente ? f.cliente.n : 'Consumidor Final', dias: 0, nro: '0003-' + String(Math.max(...e.comp.map((x) => Number(x.nro.slice(5)))) + 1).padStart(8, '0'), total: c.total / 100, estado: 'Autorizado' });
      body.innerHTML = `<h4>Factura ${letra} autorizada</h4><div class="sub" style="color:var(--muted);margin-bottom:14px">Simulado · el CAE de abajo es inventado.</div><div class="cae"><small style="color:var(--ink-2)">CAE</small><b>${cae}</b><small style="color:var(--ink-2)">Vence ${sumarDias(10).toLocaleDateString('es-AR')}</small></div><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="otra">Hacer otra</button><button class="btn primary" id="verLista">Ver comprobantes</button></div>`;
      $('#otra').onclick = () => { estado.fac = null; dlg.close(); render(); };
      $('#verLista').onclick = () => { estado.fac = null; dlg.close(); ir('comprobantes'); };
    };
    siguiente();
  }

  /* ---------- paleta de comandos ---------- */
  let paletaSel = 0, paletaItems = [];
  function comandos() {
    const nav = Object.entries(VISTAS).map(([k, v]) => ({ g: 'Ir a', t: v.titulo, ic: v.icono, f: () => ir(k) }));
    const acc = [
      { g: 'Acciones', t: 'Emitir factura nueva', ic: 'plus', f: () => { estado.fac = null; ir('nueva'); } },
      { g: 'Acciones', t: document.documentElement.dataset.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro', ic: 'sun', f: alternarTema },
    ];
    const emps = D.empresas.map((e) => ({ g: 'Cambiar de empresa', t: e.nombre, s: e.cuit, ic: 'grid', f: () => cambiarEmpresa(e.id) }));
    const clis = D.clientes.map((c) => ({ g: 'Clientes', t: c.n, s: c.doc, ic: 'receipt', f: () => { estado.fac = nuevaFactura(); estado.fac.cliente = c; ir('nueva'); toast('Factura nueva para ' + c.n); } }));
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
    const ird = ev.target.closest('[data-ir]'); if (ird) { cerrarPop(); ir(ird.dataset.ir); return; }
    const emp = ev.target.closest('[data-emp]'); if (emp) { const id = Number(emp.dataset.emp); if (emp.dataset.entrar) { estado.empresaId = id; estado.fac = null; guardar('proto_empresa', id); pintarTopbar(); ir('inicio'); } else cambiarEmpresa(id); return; }
    const ts = ev.target.closest('[data-toast]'); if (ts) { toast(ts.dataset.toast); return; }
    const op = ev.target.closest('#paletaRes .op'); if (op) { $('#paleta').close(); paletaItems[Number(op.dataset.n)].f(); return; }
    if (ev.target.closest('#empresaBtn')) { $('#popEmpresa').hidden ? abrirPop() : cerrarPop(); return; }
    if (ev.target.closest('#abrirPaleta')) { abrirPaleta(); return; }
    if (ev.target.closest('#tema')) { alternarTema(); return; }
    if (!ev.target.closest('#popEmpresa')) cerrarPop();
    if (ev.target === $('#paleta') || ev.target === $('#emitir')) ev.target.close();
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); const d = $('#paleta'); d.open ? d.close() : abrirPaleta(); }
    if (ev.key === 'Escape') cerrarPop();
  });
  window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 6), { passive: true });
  window.addEventListener('hashchange', render);

  /* ---------- arranque ---------- */
  const guardado = leer('proto_tema');
  document.documentElement.dataset.theme = guardado || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  pintarTopbar(); render();
})();
