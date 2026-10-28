/* Módulos de trabajo del prototipo: Ventas, Compras (con Stock) y Finanzas (Tesorería, Contabilidad, Impuestos).
   Todo en memoria sobre los datos de ejemplo (datos.js). Las transiciones (convertir, remitir, recepcionar, pagar)
   mueven el stock y quedan registradas en la trazabilidad, como hará el sistema real. */
window.crearModulos = function (H) {
  'use strict';
  const { $, $$, esc, ic, ARS, corto, toast, contar, sumarDias, empresa, registrar, abrirFactura, ir, D } = H;
  const V = {}, C = {}, F = {}, A = {};   /* Ventas completo (ventas.js) y Compras completo (compras.js), se completan al final */
  const pe = (n) => ARS.format(n);
  const fe = (dias) => sumarDias(-dias).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '');
  const hace = (d) => (d === 0 ? 'hoy' : 'hace ' + d + ' d');
  const enDias = (d) => (d === 0 ? 'hoy' : d > 0 ? 'en ' + d + ' d' : 'hace ' + -d + ' d');
  const PILL = {
    Borrador: 'mute', Enviado: 'blue', Aceptado: '', Convertido: '', Vencido: 'warn', Pendiente: 'blue', Parcial: 'warn', Completo: '', Cancelado: 'mute',
    'Sin facturar': 'warn', Facturado: '', Anulado: 'mute', Autorizado: '', Rechazado: 'bad', Enviada: 'blue', 'Recibida parcial': 'warn', Recibida: '', Cancelada: 'mute',
    Impaga: 'blue', Vencida: 'bad', Pagada: '', Anulada: 'mute', Confirmado: '', 'En cartera': 'blue', Depositado: 'blue', Cobrado: '', Entregado: 'blue',
    Normal: '', 'Bajo mínimo': 'warn', 'Sin stock': 'bad', Automático: 'blue', Manual: 'mute', Recibido: 'blue', Propio: 'mute', Cobro: '', Pago: 'blue', 'Comisión bancaria': 'mute',
    'Remito de venta': 'blue', Modificado: 'blue', Reversado: 'warn', Presentado: '', Abierto: '', Cerrado: 'mute', 'Anulación de recepción': 'warn', 'Anulación de remito': 'warn', 'Remito de compra': '', 'Ajuste de inventario': 'warn', Transferencia: 'mute', 'Saldo inicial': 'mute', IIBB: 'blue', Ganancias: 'warn', IVA: '', Sufrida: 'blue', Practicada: 'mute',
  };
  const pill = (t) => `<span class="pill ${PILL[t] || ''}"><i></i>${esc(t)}</span>`;
  const ini = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const ent = (n, sub) => `<span class="ent"><span class="avatar t${n.length % 3}">${esc(ini(n))}</span><span class="t"><b>${esc(n)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></span>`;
  const c2 = (a, b) => `<span class="c2"><b>${a}</b>${b ? `<small>${b}</small>` : ''}</span>`;
  const art = (cod) => D.articulos.find((a) => a.cod === cod);
  const unidades = (items) => items.reduce((s, i) => s + i.cant, 0);
  const sinIvaDe = (e, clave) => e.cond === 'MT' && clave.startsWith('ventas');
  const copiar = (o) => JSON.parse(JSON.stringify(o));
  const siguiente = (lista, prefijo) => {
    const n = Math.max(0, ...lista.map((d) => Number(String(d.nro).match(/(\d+)$/)[1])));
    return prefijo + String(n + 1).padStart(8, '0');
  };

  /* ---------- stock derivado del libro de movimientos ---------- */
  const mover = (e, cod, dep, cant, tipo, ref, u = 1) => e.movs.unshift({ id: (e.movs[0] ? e.movs[0].id : 0) + 1, ts: Date.now(), cod, dep, cant, tipo, ref, u });
  const costoDe = (e, a) => ((e.costos || {})[a.cod] != null ? e.costos[a.cod] : a.costo);   /* costo según la última factura de compra */
  function saldos(e) { const s = {}; e.movs.forEach((m) => { const k = m.cod + '|' + m.dep; s[k] = (s[k] || 0) + m.cant; }); return s; }
  function existencias(e) {
    const s = saldos(e);
    return D.articulos.filter((a) => a.stock).map((a) => {
      const d1 = s[a.cod + '|1'] || 0, d2 = s[a.cod + '|2'] || 0, tot = d1 + d2;
      const costo = costoDe(e, a); return { a: { ...a, costo }, d1, d2, tot, valor: tot * costo, est: tot <= 0 ? 'Sin stock' : tot <= a.min ? 'Bajo mínimo' : 'Normal' };
    });
  }
  const bajoMinimo = (e) => existencias(e).filter((x) => x.est !== 'Normal');
  const depNombre = (e, id) => (e.deps.find((d) => d.id === id) || {}).n || '';

  /* ---------- asientos: se derivan de los comprobantes (como los generará el sistema) ---------- */
  function asientos(e) {
    const mt = e.cond === 'MT', out = [], cent = (x) => Math.round(x * 100);
    const add = (dias, concepto, origen, auto, lineas) => out.push({ dias, concepto, origen, auto, lineas: lineas.filter((l) => l[1] || l[2]) });
    e.comp.filter((c) => c.estado === 'Autorizado').forEach((c) => {
      const t = D.totales(c.items || [], mt), serv = (c.items || []).every((i) => (art(i.cod) || {}).tipo === 'servicio');
      add(c.dias, `Venta a ${c.cliente}`, `Factura ${c.letra} ${c.nro}`, true, [['1.1.3', cent(t.total), 0], [serv ? '4.1.2' : '4.1.1', 0, cent(t.total) - cent(t.iva)], ['2.1.2', 0, cent(t.iva)]]);
    });
    e.factC.filter((f) => f.estado !== 'Anulada').forEach((f) => {
      let g = 0, s = 0; f.items.forEach((i) => { const imp = cent(i.cant * i.precio); if ((art(i.cod) || {}).stock) g += imp; else s += imp; });
      const iva = cent(D.totales(f.items).iva); let credito = iva;
      if (mt) { if (g >= s) g += iva; else s += iva; credito = 0; }
      add(f.dias, `Compra a ${f.tercero}`, `Factura ${f.nro}`, true, [['1.1.4', g, 0], ['5.2.3', s, 0], ['1.1.5', credito, 0], ['2.1.1', 0, g + s + credito]]);
    });
    e.tes.cobrosPagos.filter((p) => p.estado === 'Confirmado').forEach((p) => {
      const cuenta = p.medio === 'Efectivo' ? '1.1.1' : '1.1.2', imp = cent(p.importe);
      add(p.dias, `${p.tipo === 'Cobro' ? 'Cobro de' : 'Pago a'} ${p.tercero}`, p.nro, true, p.tipo === 'Cobro' ? [[cuenta, imp, 0], ['1.1.3', 0, imp]] : [['2.1.1', imp, 0], [cuenta, 0, imp]]);
    });
    e.manuales.forEach((m) => { add(m.dias, m.concepto, m.origen || 'Asiento manual', !!m.auto, m.lineas || [[m.debe, cent(m.importe), 0], [m.haber, 0, cent(m.importe)]]); out[out.length - 1].manual = m; });
    out.sort((a, b) => b.dias - a.dias).forEach((a, i) => { a.nro = i + 1; a.debe = a.lineas.reduce((s, l) => s + l[1], 0); });
    return out.reverse();
  }
  const cuentaNombre = (cod) => (D.plan.find((p) => p.cod === cod) || { n: cod }).n;
  const centavos = (c) => pe(c / 100);

  /* ---------- tabla genérica ---------- */
  function tabla(el, cols, filas, alClick, vacio) {
    el.style.setProperty('--cols', cols.map((c) => c.w || '1fr').join(' '));
    el.style.setProperty('--colsm', cols.filter((c) => !c.sec).map((c, k) => (k === 0 ? 'minmax(0, 1fr)' : 'auto')).join(' '));
    const celda = (c, f) => `<span class="${c.sec ? 'sec ' : ''}${c.r ? 'r' : ''}">${c.f(f)}</span>`;
    el.innerHTML = filas.length
      ? `<div class="tb-f cab">${cols.map((c) => `<span class="${c.sec ? 'sec ' : ''}${c.r ? 'r' : ''}">${c.t}</span>`).join('')}</div>` +
        filas.map((f, i) => `<button class="tb-f${alClick ? '' : ' fija'}" data-i="${i}">${cols.map((c) => celda(c, f)).join('')}</button>`).join('')
      : `<div class="vacio">${vacio || 'Nada con ese filtro.'}</div>`;
    el.onclick = (ev) => { const b = ev.target.closest('.tb-f[data-i]'); if (b && alClick) alClick(filas[Number(b.dataset.i)]); };
  }

  /* ---------- definición de las listas ---------- */
  const tot = { t: 'Total', w: '130px', r: true, f: (d) => `<b class="num">${pe(d.total)}</b>` };
  const estadoCol = { t: 'Estado', w: '150px', f: (d) => pill(d.estado) };
  const fechaCol = { t: 'Fecha', w: '90px', sec: true, f: (d) => `<span class="num">${fe(d.dias)}</span>` };
  const nroCol = (t) => ({ t, w: '170px', f: (d) => `<b class="num">${esc(d.nro)}</b>` });
  const LISTAS = {
    'ventas/presupuestos': {
      singular: 'Presupuesto', nuevo: 'Nuevo presupuesto', ph: 'Buscar cliente o número…', datos: (e) => e.presup, estados: ['Borrador', 'Enviado', 'Aceptado', 'Convertido', 'Rechazado', 'Vencido'],
      buscar: (d) => d.tercero + d.nro, cols: () => [nroCol('Presupuesto'), { t: 'Cliente', w: 'minmax(0,1.4fr)', f: (d) => ent(d.tercero) }, fechaCol,
        { t: 'Vence', w: '100px', sec: true, f: (d) => { const v = 15 - d.dias; return `<span class="num">${enDias(v)}</span>`; } }, estadoCol, tot],
    },
    'ventas/pedidos': {
      singular: 'Pedido', nuevo: 'Nuevo pedido', ph: 'Buscar cliente o número…', datos: (e) => e.pedidos, estados: ['Pendiente', 'Parcial', 'Completo', 'Cancelado'],
      buscar: (d) => d.tercero + d.nro, cols: () => [nroCol('Pedido'), { t: 'Cliente', w: 'minmax(0,1.3fr)', f: (d) => ent(d.tercero) }, fechaCol,
        { t: 'Cumplimiento', w: '190px', sec: true, f: (d) => `<span class="avance"><small>Remitado ${d.rem}%</small><span class="barra-m"><i style="width:${d.rem}%"></i></span><small>Facturado ${d.fac}%</small><span class="barra-m b2"><i style="width:${d.fac}%"></i></span></span>` }, estadoCol, tot],
    },
    'ventas/remitos': {
      singular: 'Remito', nuevo: 'Nuevo remito', ph: 'Buscar cliente o número…', datos: (e) => e.remitos, estados: ['Sin facturar', 'Facturado', 'Anulado'],
      buscar: (d) => d.tercero + d.nro, cols: (e) => [nroCol('Remito'), { t: 'Cliente', w: 'minmax(0,1.3fr)', f: (d) => ent(d.tercero) }, fechaCol,
        { t: 'Sale de', w: '140px', sec: true, f: (d) => esc(depNombre(e, d.dep)) }, { t: 'Unidades', w: '80px', sec: true, r: true, f: (d) => `<span class="num">${unidades(d.items)}</span>` }, estadoCol, tot],
    },
    'ventas/facturas': {
      singular: 'Factura', nuevo: null, ph: 'Buscar cliente o número…', datos: (e) => e.comp, estados: ['Autorizado', 'Borrador', 'Rechazado', 'Anulado'],
      buscar: (d) => d.cliente + d.nro, cols: () => [{ t: 'Comprobante', w: '210px', f: (d) => `<span class="ent"><span class="letra">${d.letra}</span><span class="t"><b class="num">${esc(d.nro)}</b><small>Factura ${d.letra}</small></span></span>` },
        { t: 'Cliente', w: 'minmax(0,1.4fr)', f: (d) => ent(d.cliente) }, fechaCol, estadoCol, tot],
    },
    'ventas/clientes': {
      ficha: 'cliente', singular: 'Cliente', nuevo: 'Nuevo cliente', ph: 'Buscar cliente o documento…', datos: (e) => e.clientes, buscar: (d) => d.n + d.doc,
      filtros: [['Todos', () => true], ['Con saldo', (d) => d.saldo > 0], ['Deuda vencida', (d) => d.vencido > 0]],
      cols: () => [{ t: 'Cliente', w: 'minmax(0,1.5fr)', f: (d) => ent(d.n, d.doc) }, { t: 'Condición IVA', w: '170px', sec: true, f: (d) => `<span class="pill ${d.iva === 'RI' ? '' : 'blue'}">${D.condicion[d.iva]}</span>` },
        { t: 'Plazo', w: '90px', sec: true, f: (d) => (d.plazo ? d.plazo + ' días' : 'Contado') }, { t: 'Última compra', w: '120px', sec: true, f: (d) => (d.ultima == null ? 'Sin compras' : hace(d.ultima)) },
        { t: 'Ventas 12 m', w: '120px', sec: true, r: true, f: (d) => `<span class="num">${corto(d.anio)}</span>` },
        { t: 'Saldo', w: '140px', r: true, f: (d) => (d.saldo ? `<b class="num">${pe(d.saldo)}</b>${d.vencido ? `<small class="mal">${corto(d.vencido)} vencido</small>` : ''}` : '<span class="mudo">—</span>') }],
    },
    'compras/ordenes': {
      singular: 'Orden de compra', nuevo: 'Nueva orden de compra', ph: 'Buscar proveedor o número…', datos: (e) => e.oc, estados: ['Borrador', 'Enviada', 'Recibida parcial', 'Recibida', 'Cancelada'],
      buscar: (d) => d.tercero + d.nro, cols: () => [nroCol('Orden'), { t: 'Proveedor', w: 'minmax(0,1.4fr)', f: (d) => ent(d.tercero) }, fechaCol,
        { t: 'Entrega', w: '100px', sec: true, f: (d) => `<span class="num">${enDias(d.entrega)}</span>` }, estadoCol, tot],
    },
    'compras/remitos': {
      singular: 'Recepción', nuevo: 'Nueva recepción', ph: 'Buscar proveedor o número…', datos: (e) => e.remC, estados: ['Sin facturar', 'Facturado', 'Anulado'],
      buscar: (d) => d.tercero + d.nro, cols: (e) => [nroCol('Remito del proveedor'), { t: 'Proveedor', w: 'minmax(0,1.3fr)', f: (d) => ent(d.tercero) }, fechaCol,
        { t: 'Ingresa a', w: '140px', sec: true, f: (d) => esc(depNombre(e, d.dep)) }, { t: 'Unidades', w: '80px', sec: true, r: true, f: (d) => `<span class="num">${unidades(d.items)}</span>` }, estadoCol, tot],
    },
    'compras/facturas': {
      singular: 'Factura de compra', nuevo: 'Cargar factura de compra', ph: 'Buscar proveedor o número…', datos: (e) => e.factC, estados: ['Impaga', 'Vencida', 'Pagada', 'Anulada'],
      buscar: (d) => d.tercero + d.nro, cols: () => [nroCol('Factura'), { t: 'Proveedor', w: 'minmax(0,1.4fr)', f: (d) => ent(d.tercero) }, fechaCol,
        { t: 'Vence', w: '100px', sec: true, f: (d) => (d.estado === 'Pagada' || d.estado === 'Anulada' ? '<span class="mudo">—</span>' : `<span class="num ${d.venc < 0 ? 'mal' : ''}">${enDias(d.venc)}</span>`) }, estadoCol, tot],
    },
    'compras/proveedores': {
      ficha: 'proveedor', singular: 'Proveedor', nuevo: 'Nuevo proveedor', ph: 'Buscar proveedor o documento…', datos: (e) => e.proveedores, buscar: (d) => d.n + d.doc,
      filtros: [['Todos', () => true], ['Con saldo', (d) => d.saldo > 0], ['Deuda vencida', (d) => d.vencido > 0]],
      cols: () => [{ t: 'Proveedor', w: 'minmax(0,1.5fr)', f: (d) => ent(d.n, d.doc) }, { t: 'Condición IVA', w: '170px', sec: true, f: (d) => `<span class="pill ${d.iva === 'RI' ? '' : 'blue'}">${D.condicion[d.iva]}</span>` },
        { t: 'Plazo de pago', w: '110px', sec: true, f: (d) => (d.plazo ? d.plazo + ' días' : 'Contado') }, { t: 'Última compra', w: '120px', sec: true, f: (d) => (d.ultima == null ? 'Sin compras' : hace(d.ultima)) },
        { t: 'Compras 12 m', w: '120px', sec: true, r: true, f: (d) => `<span class="num">${corto(d.anio)}</span>` },
        { t: 'Saldo a pagar', w: '140px', r: true, f: (d) => (d.saldo ? `<b class="num">${pe(d.saldo)}</b>${d.vencido ? `<small class="mal">${corto(d.vencido)} vencido</small>` : ''}` : '<span class="mudo">—</span>') }],
    },
  };

  /* ---------- diálogo de detalle ---------- */
  function dialogo(html) {
    const dlg = $('#detalle'); $('#detalleBody').innerHTML = html;
    if (!dlg.open) dlg.showModal();
    $$('[data-cerrar]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    return dlg;
  }
  const cierra = `<button class="icon-btn" data-cerrar aria-label="Cerrar" style="width:34px;height:34px">${ic('x')}</button>`;
  const dato = (t, v) => `<div><small>${t}</small><b>${v}</b></div>`;

  const CADENAS = { ventas: ['Presupuesto', 'Pedido', 'Remito', 'Factura'], compras: ['Orden de compra', 'Recepción', 'Factura', 'Pago'] };
  const POS = { 'ventas/presupuestos': 0, 'ventas/pedidos': 1, 'ventas/remitos': 2, 'ventas/facturas': 3, 'compras/ordenes': 0, 'compras/remitos': 1, 'compras/facturas': 2 };
  function cadena(clave, d) {
    const mod = clave.split('/')[0], idx = POS[clave], anul = ['Anulado', 'Anulada', 'Cancelado', 'Cancelada', 'Rechazado'].includes(d.estado);
    return CADENAS[mod].map((t, j) => {
      let est = anul ? (j < idx ? 'hecho' : j === idx ? 'cancelado' : 'pendiente') : j < idx ? 'hecho' : j === idx ? 'actual' : 'pendiente';
      if (clave === 'ventas/presupuestos' && j === 1 && d.estado === 'Convertido') est = 'hecho';
      if (clave === 'ventas/pedidos' && j === 2) est = anul ? 'pendiente' : d.rem >= 100 ? 'hecho' : d.rem > 0 ? 'parcial' : 'pendiente';
      if (clave === 'ventas/pedidos' && j === 3) est = anul ? 'pendiente' : d.fac >= 100 ? 'hecho' : d.fac > 0 ? 'parcial' : 'pendiente';
      if (clave === 'ventas/remitos' && j === 3 && d.estado === 'Facturado') est = 'hecho';
      if (clave === 'compras/ordenes' && j === 1) est = anul ? 'pendiente' : d.estado === 'Recibida' ? 'hecho' : d.estado === 'Recibida parcial' ? 'parcial' : 'pendiente';
      if (clave === 'compras/remitos' && j === 2 && d.estado === 'Facturado') est = 'hecho';
      if (clave === 'compras/facturas' && j === 3 && d.estado === 'Pagada') est = 'hecho';
      return `<li class="${est}"><i>${est === 'hecho' ? ic('check') : j + 1}</i><span>${t}</span></li>`;
    }).join('');
  }
  function partes(clave, d, e) {
    const p = [dato(clave.startsWith('ventas') ? 'Cliente' : 'Proveedor', esc(d.tercero || d.cliente)), dato('Fecha', fe(d.dias))];
    if (clave === 'ventas/presupuestos') p.push(dato('Validez', '15 días'));
    if (clave === 'ventas/pedidos') p.push(dato('Cumplimiento', `Remitado ${d.rem}% · Facturado ${d.fac}%`));
    if (clave === 'ventas/remitos' || clave === 'compras/remitos') p.push(dato(clave === 'ventas/remitos' ? 'Sale de' : 'Ingresa a', esc(depNombre(e, d.dep))));
    if (clave === 'ventas/facturas') p.push(dato('Punto de venta', '0003'));
    if (clave === 'compras/ordenes') p.push(dato('Entrega', enDias(d.entrega)));
    if (clave === 'compras/facturas') p.push(dato('Vencimiento', d.estado === 'Pagada' ? 'Pagada' : enDias(d.venc)));
    return p.join('');
  }
  function abrirDoc(clave, d) {
    const L = LISTAS[clave], e = empresa(), t = D.totales(d.items || [], sinIvaDe(e, clave));
    const titulo = clave === 'ventas/facturas' ? `Factura ${d.letra} ${d.nro}` : d.nro, items = d.items || [];
    const lineas = items.length ? items.map((i) => `<tr><td>${esc(i.art)}<small>${esc(i.cod || '')}</small></td><td class="num">${i.cant}</td><td class="num">${pe(i.precio)}${i.desc ? `<small>Dto. ${String(i.desc).replace('.', ',')} %</small>` : ''}</td><td>${i.al === 'ex' ? 'Exento' : i.al === 'ng' ? 'No gravado' : sinIvaDe(e, clave) ? '—' : String(D.TASA[i.al] * 100).replace('.', ',') + ' %'}</td><td class="num r">${pe(i.cant * i.precio * (1 - (i.desc || 0) / 100))}</td></tr>`).join('')
      : `<tr><td colspan="5" style="color:var(--muted)">Detalle según el comprobante emitido.</td></tr>`;
    const tots = items.length ? (sinIvaDe(e, clave) ? '' : `<div><span>Neto gravado</span><span>${pe(t.neto)}</span></div>${t.ivas.map((x) => `<div><span>IVA ${String(D.TASA[x.al] * 100).replace('.', ',')} %</span><span>${pe(x.iva)}</span></div>`).join('')}${t.exento ? `<div><span>Exento</span><span>${pe(t.exento)}</span></div>` : ''}${t.noGrav ? `<div><span>No gravado</span><span>${pe(t.noGrav)}</span></div>` : ''}`) : '';
    const acc = acciones(clave, d, e);
    dialogo(`<header class="det-h"><div><small>${L.singular}</small><h4>${esc(titulo)}</h4></div>${pill(d.estado)}${cierra}</header>
      <ol class="flujo" aria-label="Recorrido del documento">${cadena(clave, d)}</ol>
      <div class="partes">${partes(clave, d, e)}</div>
      <div class="tb-scroll"><table class="lineas"><thead><tr><th>Artículo</th><th>Cant.</th><th>Precio</th><th>Alícuota</th><th class="r">Importe</th></tr></thead><tbody>${lineas}</tbody></table></div>
      <div class="tots num">${tots}<div class="total"><span>Total</span><span>${pe(d.total)}</span></div></div>
      <footer class="det-f">${acc.map((a, i) => `<button class="btn ${a.p ? 'primary' : ''}" data-acc="${i}">${a.t}</button>`).join('')}<button class="btn" data-cerrar>Cerrar</button></footer>`);
    $$('[data-acc]', $('#detalle')).forEach((b) => b.addEventListener('click', () => acc[Number(b.dataset.acc)].f()));
  }

  /* ---------- acciones: cada una mueve documentos y stock y deja rastro ---------- */
  const terminar = () => { $('#detalle').close(); repintar(); };
  function acciones(clave, d, e) {
    const out = [], mt = e.cond === 'MT';
    const imprimir = { t: 'Imprimir / PDF', f: () => toast('PDF simulado: el prototipo no genera archivos') };
    if (clave.startsWith('ventas')) out.push(...V.acciones(clave, d, e));
    if (clave.startsWith('compras')) out.push(...C.acciones(clave, d, e));
    out.push(imprimir);
    return out;
  }

  /* ---------- fichas de cliente, proveedor y artículo ---------- */
  function abrirTercero(tipo, d) {
    const e = empresa(), venta = tipo === 'cliente';
    const docs = venta ? e.comp.filter((c) => c.cliente === d.n).slice(0, 5) : e.factC.filter((c) => c.tercero === d.n).slice(0, 5);
    dialogo(`<header class="det-h"><div><small>${venta ? 'Cliente' : 'Proveedor'}</small><h4>${esc(d.n)}</h4></div><span class="pill ${d.iva === 'RI' ? '' : 'blue'}">${D.condicion[d.iva]}</span>${cierra}</header>
      <div class="partes">${dato('Documento', esc(d.doc))}${dato('Plazo', d.plazo ? d.plazo + ' días' : 'Contado')}${venta ? dato('Lista de precios', d.lista) : dato('Última compra', hace(d.ultima))}${dato(venta ? 'Saldo' : 'Saldo a pagar', d.saldo ? pe(d.saldo) : '—')}${dato('Vencido', d.vencido ? `<span class="mal">${pe(d.vencido)}</span>` : '—')}${dato(venta ? 'Ventas 12 meses' : 'Compras 12 meses', pe(d.anio))}</div>
      <h5 class="sub-h">${venta ? 'Últimas facturas' : 'Últimas facturas de compra'}</h5>
      ${docs.length ? `<div class="mini">${docs.map((c) => `<div><span class="num">${esc(venta ? `Factura ${c.letra} ${c.nro}` : c.nro)}</span><span class="mudo">${fe(c.dias)}</span>${pill(c.estado)}<b class="num">${pe(c.total)}</b></div>`).join('')}</div>` : '<p class="mudo" style="margin:0">Sin comprobantes recientes en este período.</p>'}
      <footer class="det-f">${venta ? '<button class="btn primary" data-fact>Facturarle</button><button class="btn" data-pre>Nuevo presupuesto</button><button class="btn" data-ped>Nuevo pedido</button>' + (d.saldo ? '<button class="btn" data-cobro>Registrar cobro</button>' : '') + '<button class="btn" data-edit>Editar datos</button>' : '<button class="btn primary" data-oc>Nueva orden de compra</button>' + (d.saldo ? '<button class="btn" data-pend>Pagar facturas</button>' : '') + '<button class="btn" data-edit>Editar datos</button>'}${venta && d.vencido ? '<button class="btn" data-recl>Reclamar saldo vencido</button>' : ''}<button class="btn" data-cerrar>Cerrar</button></footer>`);
    const dlg = $('#detalle');
    const f = $('[data-fact]', dlg); if (f) f.addEventListener('click', () => { dlg.close(); abrirFactura(d.n, []); });
    const ir2 = (sel, fn) => { const b = $(sel, dlg); if (b) b.addEventListener('click', () => { dlg.close(); fn(); }); };
    ir2('[data-pre]', () => V.nuevo('presupuesto', { cliente: d.n })); ir2('[data-ped]', () => V.nuevo('pedido', { cliente: d.n }));
    ir2('[data-cobro]', () => V.abrirCobro(d)); ir2('[data-edit]', () => (venta ? V.abrirCliente(d) : C.abrirProveedor(d))); ir2('[data-oc]', () => C.nuevo('orden', { proveedor: d.n })); ir2('[data-pend]', () => C.abrirPendientes(d));
    const r = $('[data-recl]', dlg); if (r) r.addEventListener('click', () => { registrar('maestros', venta ? `Envió el reclamo de saldo vencido a ${d.n}` : `Programó el pago a ${d.n}`, pe(d.vencido)); toast(venta ? 'Reclamo enviado (simulado)' : 'Pago programado (simulado)'); });
  }
  function abrirArticulo(x) {
    const e = empresa(), a = x.a, ult = e.movs.filter((m) => m.cod === a.cod).slice(0, 6);
    dialogo(`<header class="det-h"><div><small>Artículo · ${esc(a.cod)}</small><h4>${esc(a.n)}</h4></div>${pill(x.est)}${cierra}</header>
      <div class="partes">${dato('Stock total', `<span class="num">${x.tot}</span>`)}${dato('Mínimo', a.min)}${dato('Costo', pe(a.costo))}${dato('Precio neto', pe(a.p))}${dato('Margen', Math.round(((a.p - a.costo) / a.p) * 100) + ' %')}${dato('Rubro · IVA', `${a.rubro} · ${a.al === 'ex' ? 'Exento' : a.al === 'ng' ? 'No gravado' : String(D.TASA[a.al] * 100).replace('.', ',') + ' %'}`)}</div>
      <div class="partes">${e.deps.map((dp, k) => dato(esc(dp.n), `<span class="num">${k ? x.d2 : x.d1}</span>`)).join('')}</div>
      <h5 class="sub-h">Últimos movimientos</h5>
      <div class="mini">${ult.map((m) => `<div><span class="num mudo">${new Date(m.ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '')}</span><span>${esc(m.tipo)}</span><span class="mudo">${esc(m.ref)}</span><b class="num ${m.cant < 0 ? 'neg' : 'pos'}">${m.cant > 0 ? '+' : ''}${m.cant}</b></div>`).join('')}</div>
      <footer class="det-f"><button class="btn primary" data-ajustar>Ajustar stock</button><button class="btn" data-ir="compras/stock/movimientos">Ver todos los movimientos</button><button class="btn" data-cerrar>Cerrar</button></footer>`);
    $('[data-ajustar]', $('#detalle')).addEventListener('click', () => abrirAjuste(a.cod));
  }
  function abrirAjuste(cod) {
    const e = empresa(), s = saldos(e), bienes = D.articulos.filter((a) => a.stock);
    dialogo(`<header class="det-h"><div><small>Stock</small><h4>Ajuste de inventario</h4></div>${cierra}</header>
      <p class="mudo" style="margin:0">El ajuste no edita el stock: agrega un movimiento al libro, con motivo y usuario. Los saldos se derivan de ahí.</p>
      <div class="form-aj">
        <label>Artículo<select class="in" id="ajArt">${bienes.map((a) => `<option value="${a.cod}" ${a.cod === cod ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</select></label>
        <label>Depósito<select class="in" id="ajDep">${e.deps.map((dp) => `<option value="${dp.id}">${esc(dp.n)}</option>`).join('')}</select></label>
        <label>Movimiento<select class="in" id="ajSig"><option value="1">Entrada (suma)</option><option value="-1">Salida (resta)</option></select></label>
        <label>Cantidad<input class="in" id="ajCant" type="number" min="1" step="1" value="1"></label>
        <label class="ancho">Motivo<select class="in" id="ajMot"><option>Conteo físico</option><option>Rotura</option><option>Vencimiento</option><option>Consumo interno</option><option>Otro</option></select></label>
      </div>
      <p class="mudo" id="ajInfo" style="margin:0"></p>
      <footer class="det-f"><button class="btn primary" id="ajOk">Registrar ajuste</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), info = () => { const k = $('#ajArt', dlg).value + '|' + $('#ajDep', dlg).value; $('#ajInfo', dlg).textContent = `Hay ${s[k] || 0} unidades en ese depósito.`; };
    ['ajArt', 'ajDep'].forEach((id) => $('#' + id, dlg).addEventListener('change', info)); info();
    $('#ajOk', dlg).addEventListener('click', () => {
      const c = $('#ajArt', dlg).value, dep = Number($('#ajDep', dlg).value), sig = Number($('#ajSig', dlg).value), n = Math.floor(Number($('#ajCant', dlg).value)), mot = $('#ajMot', dlg).value, a = art(c);
      if (!(n > 0)) { toast('La cantidad tiene que ser mayor que cero'); return; }
      if (sig < 0 && n > (saldos(e)[c + '|' + dep] || 0)) { registrar('stock', `Se rechazó el ajuste de ${a.n}`, `Salida de ${n} u. con stock insuficiente en ${depNombre(e, dep)}`, { res: 'rechazo' }); toast('Stock insuficiente: el sistema no deja stock negativo'); return; }
      mover(e, c, dep, sig * n, 'Ajuste de inventario', mot);
      registrar('stock', `Ajustó el stock de ${a.n}`, `${sig > 0 ? '+' : '−'}${n} u. en ${depNombre(e, dep)} · ${mot}`, { cambios: [['Stock en ' + depNombre(e, dep), String(saldos(e)[c + '|' + dep] - sig * n), String(saldos(e)[c + '|' + dep])]] });
      toast('Ajuste registrado'); dlg.close(); repintar();
    });
  }

  /* ---------- listas genéricas ---------- */
  function lista(cuerpo, clave, e) {
    const L = LISTAS[clave]; let filtro = 0, texto = '';
    const filtros = L.filtros || [['Todos', () => true], ...L.estados.map((s) => [s, (d) => d.estado === s])];
    cuerpo.innerHTML = `<div class="filtros rise">${filtros.map(([n], i) => `<button class="f" data-f="${i}" aria-pressed="${i === 0}">${n}</button>`).join('')}<input id="mq" placeholder="${L.ph}" aria-label="Buscar"></div><div class="card tb rise" style="--d:1" id="tb"></div>`;
    const pintar = () => {
      const datos = L.datos(e).filter((d) => filtros[filtro][1](d) && L.buscar(d).toLowerCase().includes(texto));
      tabla($('#tb'), L.cols(e), datos, (d) => (L.ficha ? abrirTercero(L.ficha, d) : abrirDoc(clave, d)));
    };
    pintar();
    $$('[data-f]', cuerpo).forEach((b) => b.addEventListener('click', () => { filtro = Number(b.dataset.f); $$('[data-f]', cuerpo).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }));
    $('#mq', cuerpo).addEventListener('input', (ev) => { texto = ev.target.value.toLowerCase(); pintar(); });
  }
  const subnav = (clave, sub, items) => `<div class="seg subnav rise" role="group" aria-label="Secciones">${items.map(([k, t]) => `<button data-ir="${clave}/${k}" aria-pressed="${k === sub}">${t}</button>`).join('')}</div>`;
  const SUBS = {
    'compras/stock': [['existencias', 'Existencias'], ['movimientos', 'Movimientos'], ['depositos', 'Depósitos']],
    'finanzas/tesoreria': [['cuentas', 'Cajas y bancos'], ['cheques', 'Cheques'], ['cobros', 'Cobros y pagos'], ['conciliacion', 'Conciliación']],
    'finanzas/contabilidad': [['diario', 'Libro diario'], ['plan', 'Plan de cuentas'], ['balance', 'Sumas y saldos'], ['periodos', 'Períodos']],
    'finanzas/impuestos': [['iva', 'Posición de IVA'], ['ventas', 'Libro IVA ventas'], ['compras', 'Libro IVA compras'], ['retenciones', 'Retenciones'], ['vencimientos', 'Vencimientos']],
  };

  /* ---------- stock ---------- */
  function vStock(cuerpo, e, sub) {
    const clave = 'compras/stock', nav = subnav(clave, sub, SUBS[clave]);
    if (sub === 'existencias') {
      let filtro = 'Todos', texto = '';
      cuerpo.innerHTML = `${nav}<div class="filtros rise">${['Todos', 'Bajo mínimo', 'Sin stock', 'Normal'].map((f) => `<button class="f" data-f="${f}" aria-pressed="${f === 'Todos'}">${f}</button>`).join('')}<input id="mq" placeholder="Buscar artículo o código…" aria-label="Buscar"></div><div class="card tb rise" style="--d:1" id="tb"></div>`;
      const orden = { 'Sin stock': 0, 'Bajo mínimo': 1, Normal: 2 };
      const pintar = () => {
        const filas = existencias(e).filter((x) => (filtro === 'Todos' || x.est === filtro) && (x.a.n + x.a.cod).toLowerCase().includes(texto)).sort((a, b) => orden[a.est] - orden[b.est] || a.a.n.localeCompare(b.a.n));
        tabla($('#tb'), [
          { t: 'Artículo', w: 'minmax(0,1.5fr)', f: (x) => c2(esc(x.a.n), esc(x.a.cod) + ' · ' + esc(x.a.rubro)) },
          { t: e.deps[0].n, w: '110px', sec: true, r: true, f: (x) => `<span class="num">${x.d1}</span>` }, { t: e.deps[1].n, w: '100px', sec: true, r: true, f: (x) => `<span class="num">${x.d2}</span>` },
          { t: 'Stock', w: '150px', f: (x) => `<span class="nivel"><b class="num">${x.tot}</b><span class="barra-m ${x.est === 'Normal' ? '' : x.est === 'Sin stock' ? 'bad' : 'warn'}"><i style="width:${Math.min(100, (x.tot / (x.a.min * 3 || 1)) * 100)}%"></i></span></span>` },
          { t: 'Mínimo', w: '70px', sec: true, r: true, f: (x) => `<span class="num">${x.a.min}</span>` }, { t: 'Costo', w: '110px', sec: true, r: true, f: (x) => `<span class="num">${pe(x.a.costo)}</span>` },
          { t: 'Valor', w: '130px', sec: true, r: true, f: (x) => `<b class="num">${pe(x.valor)}</b>` }, { t: 'Estado', w: '120px', f: (x) => pill(x.est) },
        ], filas, abrirArticulo);
      };
      pintar();
      $$('[data-f]', cuerpo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.f; $$('[data-f]', cuerpo).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }));
      $('#mq', cuerpo).addEventListener('input', (ev) => { texto = ev.target.value.toLowerCase(); pintar(); });
    } else if (sub === 'movimientos') {
      const TIPOS = [['Todos', null], ['Ventas', 'Remito de venta'], ['Compras', 'Remito de compra'], ['Ajustes', 'Ajuste de inventario'], ['Transferencias', 'Transferencia']];
      let filtro = null, max = 40;
      cuerpo.innerHTML = `${nav}<div class="filtros rise">${TIPOS.map(([n, v], i) => `<button class="f" data-t="${i}" aria-pressed="${i === 0}">${n}</button>`).join('')}<span class="mudo" style="margin-left:auto;font-size:12.5px">${ic('lock')} Libro de solo agregar: los saldos se derivan de estos movimientos</span></div><div class="card tb rise" style="--d:1" id="tb"></div><button class="btn mas" id="mas" hidden>Ver más</button>`;
      const pintar = () => {
        const todos = e.movs.filter((m) => !filtro || m.tipo === filtro), filas = todos.slice(0, max);
        tabla($('#tb'), [
          { t: 'ID', w: '92px', sec: true, f: (m) => `<span class="idm num">MV-${String(m.id).padStart(6, '0')}</span>` },
          { t: 'Fecha y hora', w: '110px', f: (m) => { const d = new Date(m.ts); return c2(d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', ''), `<span class="num">${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>`); } },
          { t: 'Artículo', w: 'minmax(0,1.3fr)', f: (m) => c2(esc(art(m.cod).n), esc(m.cod)) }, { t: 'Tipo', w: '170px', sec: true, f: (m) => pill(m.tipo) },
          { t: 'Depósito', w: '130px', sec: true, f: (m) => esc(depNombre(e, m.dep)) }, { t: 'Cantidad', w: '90px', r: true, f: (m) => `<b class="num ${m.cant < 0 ? 'neg' : 'pos'}">${m.cant > 0 ? '+' : ''}${m.cant}</b>` },
          { t: 'Origen', w: '140px', sec: true, f: (m) => `<span class="num">${esc(m.ref)}</span>` }, { t: 'Usuario', w: '130px', sec: true, f: (m) => esc((D.usuarios.find((u) => u.id === m.u) || {}).n || '') },
        ], filas);
        const mas = $('#mas', cuerpo); mas.hidden = todos.length <= max; mas.textContent = `Ver más · quedan ${todos.length - max}`;
      };
      pintar();
      $$('[data-t]', cuerpo).forEach((b) => b.addEventListener('click', () => { filtro = TIPOS[Number(b.dataset.t)][1]; max = 40; $$('[data-t]', cuerpo).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }));
      $('#mas', cuerpo).addEventListener('click', () => { max += 40; pintar(); });
    } else {
      const ex = existencias(e);
      cuerpo.innerHTML = `${nav}<div class="grid">${e.deps.map((dp, k) => {
        const unid = ex.reduce((s, x) => s + (k ? x.d2 : x.d1), 0), valor = ex.reduce((s, x) => s + (k ? x.d2 : x.d1) * x.a.costo, 0), conStock = ex.filter((x) => (k ? x.d2 : x.d1) > 0).length;
        return `<article class="card s6 rise" style="--d:${k + 1}"><h3>${ic('box')} ${esc(dp.n)}</h3><div class="dep-v num">${pe(valor)}</div><div class="partes" style="margin-top:12px">${dato('Unidades', unid)}${dato('Artículos con stock', conStock + ' de ' + ex.length)}</div><button class="btn sm" data-toast="Transferencias entre depósitos: próximamente en el prototipo" style="margin-top:14px">Transferir stock</button></article>`;
      }).join('')}</div>`;
    }
  }

  /* ---------- tesorería ---------- */
  function vTesoreria(cuerpo, e, sub) {
    const clave = 'finanzas/tesoreria', nav = subnav(clave, sub, SUBS[clave]);
    if (sub === 'cuentas') {
      cuerpo.innerHTML = `${nav}<div class="filtros rise"><button class="btn sm" data-tr>Transferir entre cuentas</button></div><div class="grid">${e.tes.cuentas.map((c, i) => `<article class="card s4 rise" style="--d:${i}"><h3>${ic(c.tipo === 'Caja' ? 'coin' : 'bank')} ${esc(c.n)}</h3><div class="dep-v num">${pe(c.saldo)}</div><div class="mudo">${c.tipo === 'Caja' ? 'Efectivo disponible' : 'Saldo según libros'}</div></article>`).join('')}</div>
        <h5 class="sub-h rise">Últimos movimientos</h5><div class="card tb rise" style="--d:3" id="tb"></div>`;
      tabla($('#tb'), [
        { t: 'Fecha', w: '90px', f: (m) => `<span class="num">${fe(m.dias)}</span>` }, { t: 'Concepto', w: 'minmax(0,1.4fr)', f: (m) => ent(m.concepto) }, { t: 'Cuenta', w: '230px', sec: true, f: (m) => esc(m.cuenta) },
        { t: 'Tipo', w: '170px', sec: true, f: (m) => pill(m.tipo) }, { t: 'Importe', w: '140px', r: true, f: (m) => `<b class="num ${m.importe < 0 ? 'neg' : 'pos'}">${m.importe < 0 ? '−' : '+'} ${pe(Math.abs(m.importe))}</b>` },
      ], e.tes.movs);
      $('[data-tr]', cuerpo).addEventListener('click', () => F.transferir());
    } else if (sub === 'cheques') {
      cuerpo.innerHTML = `${nav}<div class="card tb rise" style="--d:1" id="tb"></div>`;
      tabla($('#tb'), [
        { t: 'Cheque', w: '130px', f: (c) => `<b class="num">${c.nro}</b>` }, { t: 'Banco', w: '150px', sec: true, f: (c) => esc(c.banco) }, { t: 'Librador / beneficiario', w: 'minmax(0,1.3fr)', f: (c) => ent(c.tercero) },
        { t: 'Tipo', w: '110px', sec: true, f: (c) => pill(c.sentido) }, { t: 'Vence', w: '100px', sec: true, f: (c) => `<span class="num">${enDias(c.vence)}</span>` }, { t: 'Estado', w: '120px', f: (c) => pill(c.estado) },
        { t: 'Importe', w: '130px', r: true, f: (c) => `<b class="num">${pe(c.importe)}</b>` },
      ], e.tes.cheques, (c) => F.abrirCheque(c));
    } else if (sub === 'conciliacion') {
      F.vConciliacion(cuerpo, e, nav);
    } else {
      let filtro = 'Todos';
      cuerpo.innerHTML = `${nav}<div class="filtros rise">${['Todos', 'Cobro', 'Pago'].map((f) => `<button class="f" data-f="${f}" aria-pressed="${f === 'Todos'}">${f === 'Cobro' ? 'Cobros' : f === 'Pago' ? 'Pagos' : f}</button>`).join('')}</div><div class="card tb rise" style="--d:1" id="tb"></div>`;
      const pintar = () => tabla($('#tb'), [
        { t: 'Comprobante', w: '190px', f: (p) => `<b class="num">${esc(p.nro)}</b>` }, { t: 'Tercero', w: 'minmax(0,1.3fr)', f: (p) => ent(p.tercero) }, fechaCol,
        { t: 'Medio', w: '130px', sec: true, f: (p) => esc(p.medio) }, { t: 'Estado', w: '130px', f: (p) => pill(p.estado) }, { t: 'Importe', w: '140px', r: true, f: (p) => `<b class="num ${p.tipo === 'Pago' ? 'neg' : 'pos'}">${p.tipo === 'Pago' ? '−' : '+'} ${pe(p.importe)}</b>` },
      ], e.tes.cobrosPagos.filter((p) => filtro === 'Todos' || p.tipo === filtro), (p) => F.abrirMovimiento(p));
      pintar();
      $$('[data-f]', cuerpo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.f; $$('[data-f]', cuerpo).forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }));
    }
  }

  /* ---------- contabilidad ---------- */
  function abrirAsiento(a) {
    const deb = a.lineas.reduce((s, l) => s + l[1], 0), hab = a.lineas.reduce((s, l) => s + l[2], 0);
    dialogo(`<header class="det-h"><div><small>Asiento N° ${a.nro}</small><h4>${esc(a.concepto)}</h4></div>${pill(a.manual && a.manual.reversado ? 'Reversado' : a.auto ? 'Automático' : 'Manual')}${cierra}</header>
      <div class="partes">${dato('Fecha', fe(a.dias))}${dato('Origen', esc(a.origen))}${dato('Balance', deb === hab ? '<span class="pos">Debe = Haber ✓</span>' : '<span class="mal">No balancea</span>')}</div>
      <div class="tb-scroll"><table class="lineas"><thead><tr><th>Cuenta</th><th class="r">Debe</th><th class="r">Haber</th></tr></thead><tbody>${a.lineas.map((l) => `<tr><td>${esc(l[0])} · ${esc(cuentaNombre(l[0]))}</td><td class="num r">${l[1] ? centavos(l[1]) : ''}</td><td class="num r">${l[2] ? centavos(l[2]) : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="tots num"><div class="total"><span>Totales</span><span>${centavos(deb)} · ${centavos(hab)}</span></div></div>
      <p class="mudo" style="margin:0">Un asiento contabilizado no se edita: se corrige con un contraasiento.</p>
      <footer class="det-f"><button class="btn" data-contra>Generar contraasiento</button><button class="btn" data-cerrar>Cerrar</button></footer>`);
    $('[data-contra]', $('#detalle')).addEventListener('click', () => F.contraasiento(a, empresa()));
  }
  function mayor(e) {
    const m = {}; D.plan.forEach((p) => { m[p.cod] = { ...p, debe: 0, haber: 0 }; });
    asientos(e).forEach((a) => a.lineas.forEach((l) => { m[l[0]].debe += l[1]; m[l[0]].haber += l[2]; }));
    return Object.values(m).map((c) => ({ ...c, saldo: c.debe - c.haber }));
  }
  function vContabilidad(cuerpo, e, sub) {
    const clave = 'finanzas/contabilidad', nav = subnav(clave, sub, SUBS[clave]);
    if (sub === 'periodos') { F.vPeriodos(cuerpo, e, nav); return; }
    cuerpo.innerHTML = `${nav}<div class="card tb rise" style="--d:1" id="tb"></div>`;
    if (sub === 'diario') {
      tabla($('#tb'), [
        { t: 'N°', w: '70px', f: (a) => `<b class="num">${a.nro}</b>` }, { t: 'Fecha', w: '90px', sec: true, f: (a) => `<span class="num">${fe(a.dias)}</span>` },
        { t: 'Concepto', w: 'minmax(0,1.5fr)', f: (a) => c2(esc(a.concepto), esc(a.origen)) }, { t: 'Origen', w: '120px', sec: true, f: (a) => pill(a.manual && a.manual.reversado ? 'Reversado' : a.auto ? 'Automático' : 'Manual') },
        { t: 'Importe', w: '150px', r: true, f: (a) => `<b class="num">${centavos(a.debe)}</b>` },
      ], asientos(e), abrirAsiento);
    } else if (sub === 'plan') {
      tabla($('#tb'), [
        { t: 'Código', w: '90px', f: (c) => `<b class="num">${c.cod}</b>` }, { t: 'Cuenta', w: 'minmax(0,1.5fr)', f: (c) => esc(c.n) }, { t: 'Tipo', w: '130px', sec: true, f: (c) => `<span class="pill mute">${CAP(c.tipo)}</span>` },
        { t: 'Saldo', w: '170px', r: true, f: (c) => { const v = c.tipo === 'activo' || c.tipo === 'gasto' ? c.saldo : -c.saldo; return c.debe || c.haber ? `<b class="num ${v < 0 ? 'neg' : ''}">${centavos(v)}</b>` : '<span class="mudo">—</span>'; } },
      ], mayor(e));
    } else {
      const filas = mayor(e).filter((c) => c.debe || c.haber), sd = filas.reduce((s, c) => s + (c.saldo > 0 ? c.saldo : 0), 0), sa = filas.reduce((s, c) => s + (c.saldo < 0 ? -c.saldo : 0), 0);
      tabla($('#tb'), [
        { t: 'Cuenta', w: 'minmax(0,1.5fr)', f: (c) => c2(esc(c.n), c.cod) }, { t: 'Debe', w: '140px', sec: true, r: true, f: (c) => `<span class="num">${centavos(c.debe)}</span>` }, { t: 'Haber', w: '140px', sec: true, r: true, f: (c) => `<span class="num">${centavos(c.haber)}</span>` },
        { t: 'Saldo deudor', w: '150px', r: true, f: (c) => (c.saldo > 0 ? `<b class="num">${centavos(c.saldo)}</b>` : '') }, { t: 'Saldo acreedor', w: '150px', r: true, f: (c) => (c.saldo < 0 ? `<b class="num">${centavos(-c.saldo)}</b>` : '') },
      ], filas);
      $('#tb').insertAdjacentHTML('beforeend', `<div class="tb-f cab pie-tb"><span>Totales</span><span class="sec r num">${centavos(filas.reduce((s, c) => s + c.debe, 0))}</span><span class="sec r num">${centavos(filas.reduce((s, c) => s + c.haber, 0))}</span><span class="r num">${centavos(sd)}</span><span class="r num">${centavos(sa)}</span></div>`);
      $('#tb').insertAdjacentHTML('beforebegin', `<div class="chequeo ${sd === sa ? 'ok' : 'no'} rise">${ic(sd === sa ? 'check' : 'alert')}<span>${sd === sa ? 'Las sumas y saldos balancean: el Debe es igual al Haber.' : 'El balance no cierra: revisar los asientos.'}</span></div>`);
    }
  }
  const CAP = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- impuestos ---------- */
  function ivaPeriodo(e) {
    const dentro = (d) => d.dias <= 30, acum = (docs, mt) => { const g = {}, tot = { base: 0, iva: 0 }; docs.forEach((c) => D.totales(c.items || [], mt).ivas.forEach((x) => { g[x.al] = g[x.al] || { base: 0, iva: 0 }; g[x.al].base += x.base; g[x.al].iva += x.iva; tot.base += x.base; tot.iva += x.iva; })); return { g, tot }; };
    return { v: acum(e.comp.filter((c) => c.estado === 'Autorizado' && dentro(c)), false), c: acum(e.factC.filter((c) => c.estado !== 'Anulada' && dentro(c)), false) };
  }
  function vImpuestos(cuerpo, e, sub) {
    const clave = 'finanzas/impuestos', nav = subnav(clave, sub, SUBS[clave]), ri = e.cond === 'RI';
    const alic = (al) => 'IVA ' + String(D.TASA[al] * 100).replace('.', ',') + ' %';
    if (sub === 'iva') {
      if (!ri) { cuerpo.innerHTML = `${nav}<div class="card rise" style="--d:1"><h3>${ic('cal')} Monotributo</h3><p style="margin:8px 0 0;color:var(--ink-2)">${esc(e.nombre)} es monotributista: no lleva posición ni libros de IVA, y sus facturas son tipo C. Lo que vence es la cuota mensual.</p><button class="btn sm" data-ir="finanzas/impuestos/vencimientos" style="margin-top:14px">Ver vencimientos</button></div>`; return; }
      const { v, c } = ivaPeriodo(e), saldo = v.tot.iva - c.tot.iva;
      const tabAl = (g) => Object.keys(g).sort((a, b) => D.TASA[b] - D.TASA[a]).map((al) => `<div><span>${alic(al)}</span><span class="mudo num">${pe(g[al].base)}</span><b class="num">${pe(g[al].iva)}</b></div>`).join('') || '<p class="mudo" style="margin:0">Sin operaciones en el período.</p>';
      cuerpo.innerHTML = `${nav}<div class="grid">
        <article class="card s4 rise" style="--d:1"><h3>IVA débito fiscal</h3><div class="dep-v num">${pe(v.tot.iva)}</div><div class="mudo">de ventas · últimos 30 días</div></article>
        <article class="card s4 rise" style="--d:2"><h3>IVA crédito fiscal</h3><div class="dep-v num">${pe(c.tot.iva)}</div><div class="mudo">de compras · últimos 30 días</div></article>
        <article class="card s4 rise ${saldo > 0 ? 'resalta' : ''}" style="--d:3"><h3>${saldo >= 0 ? 'Saldo a pagar' : 'Saldo a favor'}</h3><div class="dep-v num">${pe(Math.abs(saldo))}</div><div class="mudo">${saldo >= 0 ? 'Débito menos crédito' : 'Se arrastra al período siguiente'}</div></article>
        <article class="card s6 rise" style="--d:4"><h3>Ventas por alícuota</h3><div class="mini mini3"><div class="cab"><span>Alícuota</span><span>Neto</span><span>IVA</span></div>${tabAl(v.g)}</div></article>
        <article class="card s6 rise" style="--d:5"><h3>Compras por alícuota</h3><div class="mini mini3"><div class="cab"><span>Alícuota</span><span>Neto</span><span>IVA</span></div>${tabAl(c.g)}</div></article></div>
        <div id="ivaLiq"></div><p class="pie-proto">Cálculo de ejemplo sobre los comprobantes de la empresa. La posición definitiva sale de los libros de IVA del período.</p>`;
      F.bloqueIva($('#ivaLiq', cuerpo), e, v, c);
    } else if (sub === 'ventas' || sub === 'compras') {
      if (!ri) { cuerpo.innerHTML = `${nav}<div class="vacio card">Una empresa monotributista no lleva libros de IVA.</div>`; return; }
      const venta = sub === 'ventas', docs = venta ? e.comp.filter((c) => c.estado === 'Autorizado') : e.factC.filter((c) => c.estado !== 'Anulada');
      cuerpo.innerHTML = `${nav}<div class="card tb rise" style="--d:1" id="tb"></div>`;
      tabla($('#tb'), [
        { t: 'Fecha', w: '90px', f: (d) => `<span class="num">${fe(d.dias)}</span>` }, { t: 'Comprobante', w: '200px', f: (d) => `<b class="num">${esc(venta ? `${d.letra} ${d.nro}` : d.nro)}</b>` }, { t: venta ? 'Cliente' : 'Proveedor', w: 'minmax(0,1.3fr)', sec: true, f: (d) => esc(d.tercero || d.cliente) },
        { t: 'Neto gravado', w: '130px', sec: true, r: true, f: (d) => `<span class="num">${pe(D.totales(d.items || []).neto)}</span>` }, { t: 'IVA', w: '120px', r: true, f: (d) => `<span class="num">${pe(D.totales(d.items || []).iva)}</span>` },
        { t: 'Exento / No gravado', w: '140px', sec: true, r: true, f: (d) => { const t = D.totales(d.items || []); return `<span class="num">${pe(t.exento + t.noGrav)}</span>`; } }, { t: 'Total', w: '130px', r: true, f: (d) => `<b class="num">${pe(d.total)}</b>` },
      ], docs);
    } else if (sub === 'retenciones') {
      const s = e.retenciones.filter((r) => r.sentido === 'Sufrida').reduce((t, r) => t + r.importe, 0), p = e.retenciones.filter((r) => r.sentido === 'Practicada').reduce((t, r) => t + r.importe, 0);
      cuerpo.innerHTML = `${nav}<div class="grid"><article class="card s6 rise" style="--d:1"><h3>Retenciones sufridas</h3><div class="dep-v num">${pe(s)}</div><div class="mudo">Crédito a favor, con su certificado</div></article><article class="card s6 rise" style="--d:2"><h3>Retenciones practicadas</h3><div class="dep-v num">${pe(p)}</div><div class="mudo">A depositar (SIRE)</div></article></div><div class="card tb rise" style="--d:3;margin-top:16px" id="tb"></div>`;
      tabla($('#tb'), [
        { t: 'Fecha', w: '90px', f: (r) => `<span class="num">${fe(r.dias)}</span>` }, { t: 'Impuesto', w: '120px', f: (r) => pill(r.impuesto) }, { t: 'Sentido', w: '120px', sec: true, f: (r) => pill(r.sentido) },
        { t: 'Tercero', w: 'minmax(0,1.3fr)', f: (r) => esc(r.tercero) }, { t: 'Base', w: '130px', sec: true, r: true, f: (r) => `<span class="num">${pe(r.base)}</span>` }, { t: 'Alícuota', w: '90px', sec: true, r: true, f: (r) => `<span class="num">${String(r.alic).replace('.', ',')} %</span>` },
        { t: 'Importe', w: '130px', r: true, f: (r) => `<b class="num">${pe(r.importe)}</b>` },
      ], e.retenciones);
    } else {
      cuerpo.innerHTML = `${nav}<div class="card tb rise" style="--d:1" id="tb"></div>`;
      const TIPO = { imp: 'Impuesto', lab: 'Laboral', est: 'Estudio' };
      tabla($('#tb'), [
        { t: 'Vencimiento', w: 'minmax(0,1.4fr)', f: (v) => `<b>${esc(v.nombre)}</b>` }, { t: 'Fecha', w: '110px', f: (v) => `<span class="num">${sumarDias(v.dias).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '')}</span>` },
        { t: 'Cuándo', w: '110px', sec: true, f: (v) => `<span class="num ${v.dias < 0 ? 'mal' : ''}">${enDias(v.dias)}</span>` }, { t: 'Tipo', w: '110px', sec: true, f: (v) => `<span class="pill mute">${TIPO[v.tipo]}</span>` },
        { t: 'Estado', w: '130px', f: (v) => (v.presentado ? pill('Presentado') : v.dias < 0 ? pill('Vencida') : v.dias <= 5 ? '<span class="pill warn"><i></i>Vence pronto</span>' : pill('Normal').replace('Normal', 'Al día')) },
      ], e.venc);
    }
  }

  /* ---------- armado de cada módulo ---------- */
  const MODULOS = {
    ventas: { titulo: 'Ventas', em: (e) => e.nombre, sub: 'Del presupuesto a la factura, con cada paso registrado.', defecto: 'facturas',
      tabs: [['presupuestos', 'Presupuestos'], ['pedidos', 'Pedidos'], ['remitos', 'Remitos'], ['facturas', 'Facturas'], ['clientes', 'Clientes'], ['precios', 'Precios']] },
    compras: { titulo: 'Compras', em: (e) => e.nombre, sub: 'Órdenes, recepciones, facturas, proveedores y el stock que se mueve con ellas.', defecto: 'ordenes',
      tabs: [['ordenes', 'Órdenes de compra'], ['remitos', 'Recepciones'], ['facturas', 'Facturas'], ['proveedores', 'Proveedores'], ['stock', 'Stock']] },
    finanzas: { titulo: 'Finanzas', em: (e) => e.nombre, sub: 'Tesorería, contabilidad e impuestos, derivados de los comprobantes.', defecto: 'tesoreria',
      tabs: [['tesoreria', 'Tesorería'], ['contabilidad', 'Contabilidad'], ['impuestos', 'Impuestos']] },
  };
  const TAB_VISTAS = { 'ventas/precios': (c, e) => V.vPrecios(c, e), 'compras/stock': vStock, 'finanzas/tesoreria': vTesoreria, 'finanzas/contabilidad': vContabilidad, 'finanzas/impuestos': vImpuestos };
    function accionesHero(clave) {
    if (clave.startsWith('ventas')) {
      const NUEVO = { 'ventas/presupuestos': ['Nuevo presupuesto', 'ir:ventas/nuevo/presupuesto'], 'ventas/pedidos': ['Nuevo pedido', 'ir:ventas/nuevo/pedido'], 'ventas/remitos': ['Nuevo remito', 'ir:ventas/nuevo/remito'], 'ventas/clientes': ['Nuevo cliente', 'cli'] };
      return NUEVO[clave] ? [['btn primary', ...NUEVO[clave]], ['btn', 'Nueva factura', 'ir:nueva']] : [['btn primary', 'Nueva factura', 'ir:nueva']];
    }
    if (clave === 'compras/stock') return [['btn primary', 'Ajuste de inventario', 'ajuste']];
    if (clave.startsWith('compras')) {
      const NUEVO = { 'compras/ordenes': ['Nueva orden de compra', 'ir:compras/nuevo/orden'], 'compras/remitos': ['Nueva recepción', 'ir:compras/nuevo/recepcion'], 'compras/facturas': ['Cargar factura de compra', 'ir:compras/nuevo/factura'], 'compras/proveedores': ['Nuevo proveedor', 'prov'] };
      return [['btn primary', ...NUEVO[clave]]];
    }
    if (clave === 'finanzas/tesoreria') return [['btn primary', 'Registrar cobro', 'fin:elegirCobro'], ['btn', 'Registrar pago', 'fin:elegirPago']];
    if (clave === 'finanzas/contabilidad') return [['btn primary', 'Nuevo asiento manual', 'fin:nuevoAsiento']];
    return [['btn primary', 'Exportar libros de IVA', 'fin:exportarLibros']];
  }
  function stats(nombre, e) {
    const sum = (a, f = (x) => x.total) => a.reduce((s, x) => s + f(x), 0), ri = e.cond === 'RI';
    if (nombre === 'ventas') {
      const ped = e.pedidos.filter((p) => p.estado === 'Pendiente' || p.estado === 'Parcial'), pre = e.presup.filter((p) => p.estado === 'Enviado' || p.estado === 'Aceptado'), v = ((e.ventasMes - e.ventasPrev) / e.ventasPrev) * 100;
      return [{ t: 'Facturado del mes', v: e.ventasMes, sub: `<b class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1).replace('.', ',')}%</b> vs. mes anterior`, go: 'ventas/facturas' },
        { t: 'Por cobrar', v: e.porCobrar, sub: `<b class="${e.vencido > 3 ? 'down' : ''}">${e.vencido} vencida${e.vencido === 1 ? '' : 's'}</b>`, go: 'ventas/clientes' },
        { t: 'Pedidos por entregar', v: ped.length, f: 'n', sub: `${corto(sum(ped))} en pedidos abiertos`, go: 'ventas/pedidos' },
        { t: 'Presupuestos abiertos', v: pre.length, f: 'n', sub: `${corto(sum(pre))} esperando respuesta`, go: 'ventas/presupuestos' }];
    }
    if (nombre === 'compras') {
      const mes = e.factC.filter((f) => f.estado !== 'Anulada' && f.dias <= 30), pag = e.factC.filter((f) => f.estado === 'Impaga' || f.estado === 'Vencida'), abiertas = e.oc.filter((o) => o.estado === 'Enviada' || o.estado === 'Recibida parcial'), bajo = bajoMinimo(e);
      return [{ t: 'Compras del mes', v: sum(mes), sub: `${mes.length} facturas de proveedores`, go: 'compras/facturas' },
        { t: 'Por pagar', v: sum(pag), sub: `<b class="${pag.some((f) => f.estado === 'Vencida') ? 'down' : ''}">${pag.filter((f) => f.estado === 'Vencida').length === 1 ? '1 vencida' : pag.filter((f) => f.estado === 'Vencida').length + ' vencidas'}</b>`, go: 'compras/facturas' },
        { t: 'Órdenes abiertas', v: abiertas.length, f: 'n', sub: `${corto(sum(abiertas))} por recibir`, go: 'compras/ordenes' },
        { t: 'Stock bajo mínimo', v: bajo.length, f: 'n', sub: `<b class="${bajo.some((x) => x.est === 'Sin stock') ? 'down' : ''}">${bajo.filter((x) => x.est === 'Sin stock').length} sin stock</b>`, go: 'compras/stock' }];
    }
    const cartera = e.tes.cheques.filter((c) => c.estado === 'En cartera'), { v, c } = ivaPeriodo(e);
    return [{ t: 'Caja y bancos', v: e.caja, sub: `${e.conciliar} movimientos por conciliar`, go: 'finanzas/tesoreria' },
      { t: 'Cheques en cartera', v: sum(cartera, (x) => x.importe), sub: `${cartera.length} cheques por depositar`, go: 'finanzas/tesoreria/cheques' },
      ri ? { t: 'Saldo de IVA', v: Math.abs(v.tot.iva - c.tot.iva), sub: v.tot.iva - c.tot.iva >= 0 ? 'a pagar este período' : 'a favor', go: 'finanzas/impuestos' }
        : { t: 'Cuota monotributo', v: 38000, sub: 'valor de ejemplo', go: 'finanzas/impuestos/vencimientos' },
      { t: 'Asientos del período', v: asientos(e).length, f: 'n', sub: `${asientos(e).filter((a) => a.auto).length} generados solos`, go: 'finanzas/contabilidad' }];
  }

  let ctx = null;
  function pintarStats() {
    const e = empresa(), el = $('#modStats'); if (!el) return;
    el.innerHTML = stats(ctx.nombre, e).map((s, i) => `<button class="card stat rise" style="--d:${i}" data-ir="${s.go}"><small>${s.t}</small><b class="v" data-cuenta="${s.v}" data-f="${s.f || 'corto'}">0</b><span class="d">${s.sub}</span></button>`).join('');
    $$('[data-cuenta]', el).forEach((n) => contar(n, Number(n.dataset.cuenta), n.dataset.f === 'n' ? (v) => String(Math.round(v)) : (v) => corto(v)));
  }
  function pintarTabs() {
    const M = MODULOS[ctx.nombre], e = empresa();
    const cuenta = { 'compras/stock': bajoMinimo(e).length };
    $('#modTabs').innerHTML = M.tabs.map(([k, t]) => { const L = LISTAS[ctx.nombre + '/' + k], n = L ? L.datos(e).length : cuenta[ctx.nombre + '/' + k]; return `<button class="tab" role="tab" data-ir="${ctx.nombre}/${k}" aria-selected="${k === ctx.tab}">${t}${n ? `<i class="${ctx.nombre + '/' + k === 'compras/stock' ? 'alerta' : ''}">${n}</i>` : ''}</button>`; }).join('');
    const clave = ctx.nombre + '/' + ctx.tab;
    $('#modAcc').innerHTML = accionesHero(clave).map(([c, t, a], i) => `<button class="${c}" data-ha="${i}">${t}</button>`).join('');
    $$('[data-ha]', $('#modAcc')).forEach((b) => b.addEventListener('click', () => {
      const [, t, a] = accionesHero(clave)[Number(b.dataset.ha)];
      if (a === 'toast') toast(t + ': próximamente en el prototipo'); else if (a === 'cli') V.abrirCliente(null); else if (a === 'prov') C.abrirProveedor(null); else if (a.startsWith('fin:')) F[a.slice(4)](); else if (a === 'ajuste') abrirAjuste(); else if (a.startsWith('ir:')) { ir(a.slice(3)); }
    }));
  }
  function pintarCuerpo() {
    const e = empresa(), clave = ctx.nombre + '/' + ctx.tab, cuerpo = $('#modCuerpo');
    if (LISTAS[clave]) lista(cuerpo, clave, e); else TAB_VISTAS[clave](cuerpo, e, ctx.sub);
  }
  function repintar() { if (!ctx || !$('#modCuerpo')) return; pintarStats(); pintarTabs(); pintarCuerpo(); }

  function montar(root, nombre, partes) {
    const M = MODULOS[nombre], e = empresa();
    const EDITORES = { ventas: ['presupuesto', 'pedido', 'remito'], compras: ['orden', 'recepcion', 'factura'] };
    if (partes[1] === 'nuevo' && (EDITORES[nombre] || []).includes(partes[2])) {
      ctx = { nombre, editor: true }; root.innerHTML = ''; (nombre === 'ventas' ? V : C).editor(root, partes[2]); window.scrollTo(0, 0);
      root._mod = { empresaId: e.id, nombre, cambiar(p) { montar(root, nombre, p); } }; return;
    }
    const poner = (p) => {
      const tab = M.tabs.some(([k]) => k === p[1]) ? p[1] : M.defecto, clave = nombre + '/' + tab;
      ctx = { nombre, tab, sub: p[2] || (SUBS[clave] ? SUBS[clave][0][0] : null) };
      if (SUBS[clave] && !SUBS[clave].some(([k]) => k === ctx.sub)) ctx.sub = SUBS[clave][0][0];
    };
    poner(partes);
    root.innerHTML = `<section class="hero rise"><div><h1>${M.titulo} <em>${esc(M.em(e))}</em></h1><p>${M.sub}</p></div><div class="acciones" id="modAcc"></div></section>
      <div class="stats" id="modStats"></div><div class="tabs rise" id="modTabs" role="tablist" style="--d:2"></div><div id="modCuerpo"></div>`;
    pintarStats(); pintarTabs(); pintarCuerpo();
    root._mod = { empresaId: e.id, nombre, cambiar(p) { if (p[1] === 'nuevo') { montar(root, nombre, p); return; } poner(p); pintarTabs(); pintarCuerpo(); window.scrollTo({ top: 0 }); } };
  }

  /* rutas para la paleta de comandos */
  const rutas = [];
  Object.entries(MODULOS).forEach(([n, M]) => M.tabs.forEach(([k, t]) => {
    const clave = n + '/' + k;
    if (SUBS[clave]) SUBS[clave].forEach(([s, ts]) => rutas.push({ ruta: `${clave}/${s}`, t: `${M.titulo} · ${t} · ${ts}` })); else rutas.push({ ruta: clave, t: `${M.titulo} · ${t}` });
  }));
  ['presupuesto', 'pedido', 'remito'].forEach((t) => rutas.push({ ruta: 'ventas/nuevo/' + t, t: 'Ventas · Nuevo ' + t }));
  ['orden', 'recepcion', 'factura'].forEach((t) => rutas.push({ ruta: 'compras/nuevo/' + t, t: 'Compras · Nueva ' + ({ orden: 'orden de compra', recepcion: 'recepción', factura: 'factura de compra' })[t] }));
  const comun = { pe, pill, ent, c2, dato, cierra, dialogo, tabla, art, saldos, mover, siguiente, depNombre, copiar, unidades, hace, enDias, fe, abrirFactura, repintar, terminar, costoDe };
  Object.assign(V, window.crearVentas(H, comun));
  Object.assign(C, window.crearCompras(H, { ...comun, cuitValido: V.cuitValido, fmtDoc: V.fmtDoc, parseDoc: V.parseDoc }));
  Object.assign(A, window.crearArchivos(H, comun));
  Object.assign(F, window.crearFinanzas(H, { ...comun, abrirCobro: V.abrirCobro, abrirPendientes: C.abrirPendientes, asientos, cuentaNombre, centavos, archivos: A }));
  return { montar, precio: V.precio, alFacturar: V.alFacturar, rutas, nombres: Object.keys(MODULOS), titulo: (n) => MODULOS[n].titulo };
};
