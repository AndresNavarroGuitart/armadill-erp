/* Compras completo: órdenes de compra, recepciones (que ingresan stock) y facturas de proveedor desde cero, con control
   de lo pedido contra lo recibido y lo facturado; proveedores; pagos con control de fondos; costo según la última factura.
   Se apoya en modulos.js (I). */
window.crearCompras = function (H, I) {
  'use strict';
  const { $, $$, esc, ic, toast, registrar, ir, D, empresa } = H;
  const { pe, pill, ent, dato, cierra, dialogo, art, saldos, mover, siguiente, depNombre, copiar, unidades, enDias, fe, repintar, terminar, costoDe, cuitValido, fmtDoc, parseDoc } = I;

  const importe = (it) => Math.round(it.cant * it.precio * 100) / 100;
  const vacio = () => ({ art: '', cod: '', cant: 1, precio: 0, al: '21' });
  const ETIQ = { '21': 'IVA 21 %', '10.5': 'IVA 10,5 %', '27': 'IVA 27 %', '5': 'IVA 5 %', '2.5': 'IVA 2,5 %', '0': 'IVA 0 %', ex: 'Exento', ng: 'No gravado' };
  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const diasHasta = (iso) => Math.round((new Date(iso + 'T12:00') - new Date(hoyISO() + 'T12:00')) / 864e5);
  const sumaDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const conStock = (items) => items.filter((i) => (art(i.cod) || {}).stock);

  /* lo recibido de cada orden se lleva por artículo; las órdenes de ejemplo se reconstruyen desde su estado */
  function recibido(oc) {
    if (!oc.recibido) {
      oc.recibido = {}; conStock(oc.items).forEach((i) => { oc.recibido[i.cod] = oc.estado === 'Recibida' ? i.cant : oc.estado === 'Recibida parcial' ? Math.ceil(i.cant / 2) : 0; });
    }
    return oc.recibido;
  }
  const pendiente = (oc) => conStock(oc.items).map((i) => ({ ...i, cant: i.cant - (recibido(oc)[i.cod] || 0) })).filter((i) => i.cant > 0);
  const actualizarEstadoOrden = (oc) => { const hay = Object.values(recibido(oc)).some((v) => v > 0); oc.estado = !pendiente(oc).length ? 'Recibida' : hay ? 'Recibida parcial' : 'Enviada'; };

  /* ---------- documentos nuevos ---------- */
  const TIPOS = {
    orden: { t: 'Orden de compra', tab: 'compras/ordenes', letra: 'OC', chico: 'ORDEN DE COMPRA', sub: 'Lo que le pedís al proveedor. No mueve stock ni genera deuda hasta que llega la factura.' },
    recepcion: { t: 'Recepción', tab: 'compras/remitos', letra: 'R', chico: 'RECEPCIÓN', sub: 'La mercadería que llega: ingresa al stock del depósito y queda pendiente de factura.' },
    factura: { t: 'Factura de compra', tab: 'compras/facturas', letra: 'A', chico: 'FACTURA DEL PROVEEDOR', sub: 'Lo que el proveedor te factura: genera la deuda, el crédito fiscal y actualiza el costo.' },
  };
  let prefill = null;
  function nuevo(tipo, opciones) { prefill = { tipo, ...(opciones || {}) }; ir('compras/nuevo/' + tipo); }

  function editor(root, tipo) {
    const e = empresa(), T = TIPOS[tipo], pre = prefill && prefill.tipo === tipo ? prefill : {}, doc = pre.doc || null; prefill = null;
    const provPorNombre = (n) => e.proveedores.find((p) => p.n === n) || null;
    const f = { prov: provPorNombre(pre.proveedor || (doc && doc.tercero)), dep: doc && doc.dep ? doc.dep : 1, fuente: pre.fuente || null, items: [vacio()] };
    const cargarDesde = (fuente) => {
      f.fuente = fuente;
      if (!fuente) return;
      if (tipo === 'recepcion') f.items = pendiente(fuente).map((i) => ({ ...i, max: i.cant }));
      if (tipo === 'factura') { f.items = copiar(fuente.items); f.dep = fuente.dep || 1; }
    };
    if (doc) f.items = copiar(doc.items); else if (f.fuente) cargarDesde(f.fuente);
    if (!f.items.length) f.items = [vacio()];
    const poolDe = () => (tipo === 'recepcion' ? (f.fuente ? D.articulos.filter((a) => pendiente(f.fuente).some((i) => i.cod === a.cod)) : D.articulos.filter((a) => a.c && a.stock)) : D.articulos.filter((a) => a.c));
    const letra = () => (tipo === 'factura' ? (f.prov && f.prov.iva === 'MT' ? 'C' : 'A') : T.letra);
    const fuentes = () => {
      if (!f.prov) return [];
      if (tipo === 'recepcion') return e.oc.filter((o) => o.tercero === f.prov.n && (o.estado === 'Enviada' || o.estado === 'Recibida parcial') && pendiente(o).length);
      if (tipo === 'factura') return e.remC.filter((r) => r.tercero === f.prov.n && r.estado === 'Sin facturar');
      return [];
    };

    root.innerHTML = `
      <section class="hero rise"><div><h1>${doc ? 'Editar' : 'Nueva'} <em>${T.t.toLowerCase()}</em></h1><p>${T.sub}</p></div><div class="acciones"><button class="btn" data-ir="${T.tab}">Volver</button></div></section>
      <div class="fac">
        <div class="col">
          <section class="card paso rise" style="--d:1"><h3><span class="n">1</span> Proveedor</h3>
            <div class="campo combo"><label for="ccli">¿A quién?</label><input class="in" id="ccli" autocomplete="off" placeholder="Escribí un nombre o documento…" role="combobox" aria-expanded="false"><ul id="clistaCli" hidden role="listbox"></ul></div>
            <div id="cselCli"></div></section>
          <section class="card paso rise" style="--d:2"><h3><span class="n">2</span> Datos</h3>
            <div class="tres"><div class="campo"><label for="cfecha">Fecha</label><input class="in" type="date" id="cfecha" value="${hoyISO()}" readonly></div>
              ${tipo === 'orden' ? '<div class="campo"><label for="cent">Entrega estimada</label><input class="in" type="date" id="cent"></div>' : ''}
              ${tipo === 'recepcion' ? `<div class="campo"><label for="cdep">Ingresa al depósito</label><select class="in" id="cdep">${e.deps.map((d) => `<option value="${d.id}">${esc(d.n)}</option>`).join('')}</select></div>` : ''}
              ${tipo === 'factura' ? '<div class="campo"><label for="cnro">N° de factura del proveedor</label><input class="in" id="cnro" placeholder="0005-00001234" autocomplete="off"></div><div class="campo"><label for="cvenc">Vence</label><input class="in" type="date" id="cvenc"></div>' : ''}
              ${tipo !== 'orden' ? `<div class="campo"><label for="cfuente">${tipo === 'recepcion' ? 'Orden de compra' : 'Recepción'}</label><select class="in" id="cfuente"></select></div>` : ''}</div></section>
          <section class="card paso rise" style="--d:3"><h3><span class="n">3</span> Renglones</h3>
            <div id="creng" style="display:grid;gap:8px"></div>
            <button class="btn sm agregar" id="cagregar">${ic('plus')} Agregar renglón</button></section>
        </div>
        <aside class="card papel rise" style="--d:2" id="cpapel"></aside>
      </div>
      <div class="barra rise" style="--d:4"><div class="tot"><small id="cbTipo"></small><b class="num" id="cbTotal"></b></div>
        ${tipo === 'orden' ? '<button class="btn" id="cborrador">Guardar borrador</button>' : ''}<button class="btn primary" id="ccrear">${ic('bolt')} ${tipo === 'orden' ? 'Crear y enviar' : tipo === 'recepcion' ? 'Registrar recepción e ingresar stock' : 'Cargar factura'}</button></div>
      <datalist id="artsC"></datalist>`;

    const inCli = $('#ccli', root), ul = $('#clistaCli', root), rEl = $('#creng', root);
    const pintarFuentes = () => {
      const sel = $('#cfuente', root); if (!sel) return;
      const lista = fuentes();
      sel.innerHTML = `<option value="">${tipo === 'recepcion' ? 'Sin orden (compra directa)' : 'Sin recepción (servicios o compra directa)'}</option>` + lista.map((x) => `<option value="${esc(x.nro)}" ${f.fuente && f.fuente.nro === x.nro ? 'selected' : ''}>${esc(x.nro)} · ${pe(x.total)}</option>`).join('');
      sel.disabled = !f.prov;
    };
    const pintarCli = () => {
      const p = f.prov;
      $('#cselCli', root).innerHTML = p ? `<div class="sel"><span class="avatar t1">${esc(p.n.split(' ').slice(0, 2).map((x) => x[0]).join(''))}</span><span class="t"><b>${esc(p.n)}</b><span>${esc(p.doc)} · ${D.condicion[p.iva]} · ${p.plazo ? 'paga a ' + p.plazo + ' días' : 'contado'}</span></span><button class="icon-btn" id="cquitar" aria-label="Quitar proveedor" style="width:32px;height:32px">${ic('x')}</button></div>` : '';
      inCli.style.display = p ? 'none' : ''; $('label[for=ccli]', root).style.display = p ? 'none' : '';
      const q = $('#cquitar', root); if (q) q.onclick = () => { f.prov = null; f.fuente = null; pintarCli(); pintarFuentes(); recalcular(); inCli.focus(); };
      if (tipo === 'factura' && p && !$('#cvenc', root).value) $('#cvenc', root).value = sumaDias(p.plazo);
    };
    const abrirLista = () => {
      const t = inCli.value.toLowerCase(), r = e.proveedores.filter((p) => (p.n + p.doc).toLowerCase().includes(t));
      ul.innerHTML = r.map((p, i) => `<li role="option" data-n="${esc(p.n)}" ${i === 0 ? 'aria-selected="true"' : ''}><span><b>${esc(p.n)}</b><br><small>${esc(p.doc)}</small></span><span class="pill ${p.iva === 'RI' ? '' : 'blue'}">${D.condicion[p.iva]}</span></li>`).join('') || '<li>Sin resultados</li>';
      ul.hidden = false; inCli.setAttribute('aria-expanded', 'true');
    };
    const elegir = (n) => { f.prov = provPorNombre(n); f.fuente = null; ul.hidden = true; inCli.value = ''; pintarCli(); pintarFuentes(); recalcular(); };
    inCli.addEventListener('focus', abrirLista); inCli.addEventListener('input', abrirLista);
    inCli.addEventListener('keydown', (ev) => {
      const items = $$('li[data-n]', ul), cur = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = (cur + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, k) => x.setAttribute('aria-selected', k === n)); }
      if (ev.key === 'Enter' && items[cur]) { ev.preventDefault(); elegir(items[cur].dataset.n); }
      if (ev.key === 'Escape') ul.hidden = true;
    });
    ul.addEventListener('mousedown', (ev) => { const li = ev.target.closest('li[data-n]'); if (li) { ev.preventDefault(); elegir(li.dataset.n); } });
    inCli.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; }, 120));

    const cab = '<div class="reng ed cab"><span>Artículo o servicio</span><span>Cant.</span><span>Precio de compra</span><span>Últ. costo</span><span>Alícuota</span><span style="text-align:right">Importe</span><span></span></div>';
    const aliCelda = (it) => (tipo === 'factura' ? `<select class="in al" aria-label="Alícuota">${Object.entries(ETIQ).map(([k, v]) => `<option value="${k}" ${k === it.al ? 'selected' : ''}>${v}</option>`).join('')}</select>` : `<span class="alic">${ETIQ[it.al]}</span>`);
    const renglon = (it, i) => { const a = art(it.cod); return `<div class="reng ed" data-i="${i}"><span class="a"><input class="in art" list="artsC" placeholder="Artículo…" value="${esc(it.art)}" aria-label="Artículo"><small class="disp"></small></span><input class="in cant" type="number" min="0" step="any" value="${it.cant}" aria-label="Cantidad"><input class="in precio" type="number" min="0" step="any" value="${it.precio || ''}" placeholder="0,00" aria-label="Precio de compra"><span class="alic ult">${a ? pe(costoDe(e, a)) : '—'}</span>${aliCelda(it)}<span class="sub num">$ 0,00</span><button class="x" aria-label="Quitar renglón">${ic('trash')}</button></div>`; };
    const pintarReng = () => { $('#artsC', root).innerHTML = poolDe().map((a) => `<option value="${esc(a.n)}">`).join(''); rEl.innerHTML = cab + f.items.map(renglon).join(''); recalcular(); };
    rEl.addEventListener('input', (ev) => {
      const fila = ev.target.closest('.reng[data-i]'); if (!fila) return; const it = f.items[Number(fila.dataset.i)];
      if (ev.target.classList.contains('art')) {
        const a = poolDe().find((x) => x.n === ev.target.value); it.art = ev.target.value;
        if (a) { it.cod = a.cod; it.al = a.al; it.precio = costoDe(e, a); $('.precio', fila).value = it.precio; $('.ult', fila).textContent = pe(costoDe(e, a)); const s = $('select.al', fila); if (s) s.value = a.al; const l = $('span.alic:not(.ult)', fila); if (l) l.textContent = ETIQ[a.al]; } else it.cod = '';
      }
      if (ev.target.classList.contains('cant')) it.cant = Number(ev.target.value) || 0;
      if (ev.target.classList.contains('precio')) it.precio = Number(ev.target.value) || 0;
      recalcular();
    });
    rEl.addEventListener('change', (ev) => { if (ev.target.classList.contains('al')) { f.items[Number(ev.target.closest('.reng').dataset.i)].al = ev.target.value; recalcular(); } });
    rEl.addEventListener('click', (ev) => { const b = ev.target.closest('.x'); if (!b) return; f.items.splice(Number(b.closest('.reng').dataset.i), 1); if (!f.items.length) f.items.push(vacio()); pintarReng(); });
    const agregar = () => { f.items.push(vacio()); pintarReng(); $$('.art', rEl).pop().focus(); };
    $('#cagregar', root).addEventListener('click', agregar);
    rEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.classList.contains('precio')) { ev.preventDefault(); agregar(); } });
    const dep = $('#cdep', root); if (dep) dep.addEventListener('change', (ev) => { f.dep = Number(ev.target.value); });
    const fu = $('#cfuente', root); if (fu) fu.addEventListener('change', (ev) => { const x = fuentes().find((y) => y.nro === ev.target.value) || null; f.fuente = x; f.items = x ? [] : [vacio()]; cargarDesde(x); if (!f.items.length) f.items = [vacio()]; if (x && x.dep) { f.dep = x.dep; if (dep) dep.value = x.dep; } pintarReng(); });
    ['cnro', 'cvenc', 'cent'].forEach((id) => { const el = $('#' + id, root); if (el) el.addEventListener('input', recalcular); });

    const validas = () => f.items.filter((it) => it.art && it.cod);
    const nroFull = () => { const v = ($('#cnro', root) || { value: '' }).value.replace(/\D/g, ''); return v.length === 12 ? `${letra()} ${v.slice(0, 4)}-${v.slice(4)}` : null; };
    let errores = true;
    function recalcular() {
      const sd = saldos(e), lineas = validas(), p = f.prov, sinIva = tipo === 'factura' && letra() === 'C', t = D.totales(lineas.map((it) => ({ ...it })), sinIva);
      $$('.reng[data-i]', rEl).forEach((fila, i) => {
        const it = f.items[i], a = art(it.cod); $('.sub', fila).textContent = pe(importe(it)); const h = $('.disp', fila);
        let txt = '', mal = false;
        if (a && a.stock) {
          const tot = (sd[a.cod + '|1'] || 0) + (sd[a.cod + '|2'] || 0); txt = `Stock ${tot} · mínimo ${a.min}`;
          if (tipo === 'recepcion' && f.fuente && it.max != null) { txt = `Pendiente de la orden: ${it.max}`; mal = it.cant > it.max; }
          if (tipo === 'factura' && f.fuente) { const r = f.fuente.items.find((x) => x.cod === a.cod); txt = r ? `Recibido: ${r.cant}` : 'No figura en la recepción'; mal = !r || it.cant > r.cant; }
        } else if (a) txt = 'Servicio · sin stock';
        h.textContent = txt; h.className = 'disp' + (mal ? ' mal' : '');
      });
      const sobre = tipo === 'recepcion' && f.fuente ? lineas.filter((it) => it.max != null && it.cant > it.max) : [], cantMal = f.items.filter((it) => it.art && !(it.cant > 0)), sinPrecio = lineas.filter((it) => !(it.precio > 0));
      const chk = [[p ? 'ok' : 'no', p ? `Proveedor: ${p.n} · ${D.condicion[p.iva]}` : 'Elegí el proveedor'],
        [lineas.length && !cantMal.length && !sinPrecio.length ? 'ok' : 'no', !lineas.length ? 'Cargá al menos un renglón con artículo' : cantMal.length ? 'Hay renglones con cantidad cero' : sinPrecio.length ? 'Hay renglones sin precio' : `${lineas.length} renglón${lineas.length === 1 ? '' : 'es'} con importe`]];
      if (tipo === 'recepcion') {
        if (f.items.some((it) => it.art && !art(it.cod))) chk.push(['no', 'Hay artículos que no existen en el catálogo']);
        if (lineas.some((it) => !art(it.cod).stock)) chk.push(['no', 'La recepción solo lleva artículos con stock']);
        chk.push(sobre.length ? ['no', `Se recibe más de lo pedido: ${sobre[0].art} (pendiente ${sobre[0].max})`] : [f.fuente ? 'ok' : 'av', f.fuente ? `Contra la orden ${f.fuente.nro}` : 'Sin orden de compra: no se puede controlar lo pedido']);
      }
      if (tipo === 'orden') {
        const saltos = lineas.filter((it) => { const a = art(it.cod), u = costoDe(e, a); return a.stock && u && Math.abs(it.precio / u - 1) > 0.15; });
        chk.push(saltos.length ? ['av', `${saltos[0].art}: el precio se aparta más de 15 % del último costo (${pe(costoDe(e, art(saltos[0].cod)))})`] : ['ok', 'Precios en línea con el último costo']);
        if (p && p.vencido > 0) chk.push(['av', `Le debés ${pe(p.vencido)} vencidos a ${p.n}: puede condicionar la entrega`]);
        const en = ($('#cent', root) || { value: '' }).value; if (en && diasHasta(en) < 0) chk.push(['no', 'La entrega estimada ya pasó']);
      }
      if (tipo === 'factura') {
        const nro = nroFull(), raw = $('#cnro', root).value.trim(), venc = $('#cvenc', root).value;
        chk.push([nro ? 'ok' : 'no', nro ? `Factura ${nro} (letra ${letra()}${letra() === 'C' ? ': el proveedor es monotributista, sin crédito fiscal' : ''})` : raw ? 'El número tiene 4 dígitos de punto de venta y 8 de número' : 'Cargá el número de la factura del proveedor']);
        const dup = nro && p && e.factC.find((x) => x.tercero === p.n && x.nro === nro && x.estado !== 'Anulada' && !(doc && x === doc));
        if (dup) chk.push(['no', `Esa factura ya está cargada (${dup.estado.toLowerCase()})`]);
        chk.push([venc && diasHasta(venc) >= 0 ? 'ok' : venc ? 'av' : 'no', !venc ? 'Indicá el vencimiento' : diasHasta(venc) >= 0 ? `Vence ${enDias(diasHasta(venc))}` : 'El vencimiento ya pasó: queda como vencida']);
        if (f.fuente) {
          const dif = lineas.filter((it) => { const r = f.fuente.items.find((x) => x.cod === it.cod); return !r || it.cant !== r.cant || it.precio !== r.precio; }).length + f.fuente.items.filter((r) => !lineas.some((it) => it.cod === r.cod)).length;
          chk.push([dif ? 'av' : 'ok', dif ? `La factura difiere de lo recibido en ${dif} renglón${dif === 1 ? '' : 'es'}: revisá antes de cargarla` : `Coincide con la recepción ${f.fuente.nro}`]);
        }
      }
      errores = chk.some((x) => x[0] === 'no');
      $('#cpapel', root).innerHTML = `
        <div class="cab"><div class="emi"><b>${esc(e.nombre)}</b><span>CUIT ${esc(e.cuit)} · ${D.condicion[e.cond]}</span><span>${T.t} · ${new Date().toLocaleDateString('es-AR')}</span></div><div class="letra-grande"><b style="${letra().length > 1 ? 'font-size:24px' : ''}">${letra()}</b><small>${T.chico}</small></div></div>
        <div class="cuerpo"><div><small style="color:var(--muted)">Proveedor</small><br><b>${p ? esc(p.n) : '— sin elegir —'}</b>${p ? `<br><span style="color:var(--ink-2)">${esc(p.doc)} · ${D.condicion[p.iva]}</span>` : ''}</div>
          <table><thead><tr><th>Detalle</th><th>Cant.</th><th>Importe</th></tr></thead><tbody>${lineas.length ? lineas.map((it) => `<tr><td>${esc(it.art)}</td><td class="num">${it.cant}</td><td class="num">${pe(importe(it))}</td></tr>`).join('') : '<tr><td colspan="3" style="color:var(--muted)">Los renglones aparecen acá a medida que los cargás.</td></tr>'}</tbody></table>
          <div class="totales num">${tipo === 'recepcion' ? `<div><span>Unidades</span><span>${unidades(lineas)}</span></div>` : sinIva ? '' : `<div><span>Neto gravado</span><span>${pe(t.neto)}</span></div>${t.ivas.map((x) => `<div><span>IVA ${String(D.TASA[x.al] * 100).replace('.', ',')} %</span><span>${pe(x.iva)}</span></div>`).join('')}${t.exento ? `<div><span>Exento</span><span>${pe(t.exento)}</span></div>` : ''}${t.noGrav ? `<div><span>No gravado</span><span>${pe(t.noGrav)}</span></div>` : ''}`}<div class="total"><span>${tipo === 'recepcion' ? 'Valor recibido' : 'Total'}</span><span>${pe(t.total)}</span></div></div></div>
        <div class="chequeos">${chk.map(([k, x]) => `<div class="${k}">${ic(k === 'ok' ? 'check' : 'alert')}<span style="color:var(--ink-2)">${esc(x)}</span></div>`).join('')}</div>`;
      $('#cbTipo', root).textContent = `${T.t}${p ? ' · ' + p.n : ''}`; $('#cbTotal', root).textContent = pe(t.total);
      $('#ccrear', root).disabled = errores; const b = $('#cborrador', root); if (b) b.disabled = !p || !lineas.length;
    }

    const guardar = (estadoFinal) => {
      const items = validas().map((it) => ({ art: it.art, cod: it.cod, cant: it.cant, precio: it.precio, al: it.al })), p = f.prov;
      if (tipo === 'orden') {
        const en = $('#cent', root).value, entrega = en ? diasHasta(en) : 7, total = D.totales(items).total;
        if (doc) { const antes = doc.total, ant = doc.estado; Object.assign(doc, { tercero: p.n, items, total, entrega, estado: estadoFinal }); registrar('comprobantes', `Modificó la orden de compra ${doc.nro}`, `${p.n} · ${items.length} renglones`, { cambios: [['Total', pe(antes), pe(total)], ['Estado', ant, estadoFinal]] }); toast(`Orden ${doc.nro} actualizada`); }
        else { const d = { nro: siguiente(e.oc, '0001-'), tercero: p.n, dias: 0, items, entrega, estado: estadoFinal, total }; e.oc.unshift(d); registrar('comprobantes', `Creó la orden de compra ${d.nro}`, `${p.n} · ${pe(total)} · ${estadoFinal === 'Enviada' ? 'enviada al proveedor' : 'borrador'}`); toast(`Orden ${d.nro} ${estadoFinal === 'Enviada' ? 'enviada (simulado)' : 'guardada como borrador'}`); }
      } else if (tipo === 'recepcion') {
        const d = { nro: siguiente(e.remC, '0007-'), tercero: p.n, dias: 0, items, dep: f.dep, estado: 'Sin facturar', total: D.totales(items).total, orden: f.fuente ? f.fuente.nro : null }; e.remC.unshift(d);
        items.forEach((i) => mover(e, i.cod, f.dep, i.cant, 'Remito de compra', d.nro));
        if (f.fuente) { const r = recibido(f.fuente); items.forEach((i) => { r[i.cod] = (r[i.cod] || 0) + i.cant; }); actualizarEstadoOrden(f.fuente); }
        registrar('comprobantes', `Registró la recepción ${d.nro}`, `${p.n} · ${unidades(items)} unidades ingresan a ${depNombre(e, f.dep)}${f.fuente ? ' · orden ' + f.fuente.nro : ''}`);
        toast(`Recepción ${d.nro} registrada y stock actualizado`);
      } else {
        const nro = nroFull(), sinIva = letra() === 'C', total = D.totales(items, sinIva).total, venc = diasHasta($('#cvenc', root).value);
        const d = { nro, tercero: p.n, dias: 0, items, venc, estado: venc < 0 ? 'Vencida' : 'Impaga', total, recepcion: f.fuente ? f.fuente.nro : null }; e.factC.unshift(d);
        if (f.fuente) f.fuente.estado = 'Facturado';
        p.saldo = Math.round((p.saldo + total) * 100) / 100; if (venc < 0) p.vencido += total; p.ultima = 0; p.anio += total;
        const cambios = []; e.costos = e.costos || {};
        conStock(items).forEach((i) => { const a = art(i.cod), antes = costoDe(e, a); if (i.precio !== antes) { e.costos[i.cod] = i.precio; cambios.push([`Costo de ${a.n}`, pe(antes), pe(i.precio)]); } });
        registrar('comprobantes', `Cargó la factura de compra ${nro}`, `${p.n} · ${pe(total)} · vence ${enDias(venc)}${f.fuente ? ' · recepción ' + f.fuente.nro : ''}`, cambios.length ? { cambios: cambios.slice(0, 4) } : {});
        toast(`Factura ${nro} cargada${cambios.length ? ' y costos actualizados' : ''}`);
      }
      ir(T.tab);
    };
    $('#ccrear', root).addEventListener('click', () => { if (!errores) guardar(tipo === 'orden' ? 'Enviada' : null); });
    const bor = $('#cborrador', root); if (bor) bor.addEventListener('click', () => guardar('Borrador'));
    pintarCli(); pintarFuentes(); pintarReng();
  }

  /* ---------- proveedores ---------- */
  function abrirProveedor(p) {
    const e = empresa(), [tipo0, num0] = p ? parseDoc(p.doc) : ['CUIT', ''];
    const opt = (lista, sel) => lista.map(([v, t]) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${t}</option>`).join('');
    dialogo(`<header class="det-h"><div><small>Proveedor</small><h4>${p ? 'Editar proveedor' : 'Nuevo proveedor'}</h4></div>${cierra}</header>
      <div class="form-aj">
        <label class="ancho">Razón social<input class="in" id="pvNom" value="${esc(p ? p.n : '')}" autocomplete="off"></label>
        <label>Tipo de documento<select class="in" id="pvTipo">${opt([['CUIT', 'CUIT'], ['CUIL', 'CUIL']], tipo0 === 'CUIL' ? 'CUIL' : 'CUIT')}</select></label>
        <label>Número<input class="in" id="pvNro" inputmode="numeric" value="${num0}" placeholder="Solo números" autocomplete="off"></label>
        <label>Condición frente al IVA<select class="in" id="pvIva">${opt([['RI', D.condicion.RI], ['MT', D.condicion.MT], ['EX', D.condicion.EX]], p ? p.iva : 'RI')}</select></label>
        <label>Plazo de pago<select class="in" id="pvPlazo">${opt([[0, 'Contado'], [15, '15 días'], [30, '30 días'], [45, '45 días'], [60, '60 días']], p ? p.plazo : 30)}</select></label>
      </div>
      <div id="pvErr" style="display:grid;gap:6px"></div>
      <footer class="det-f"><button class="btn primary" id="pvOk">${p ? 'Guardar cambios' : 'Crear proveedor'}</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), v = (id) => $('#' + id, dlg).value;
    const validar = () => {
      const tipo = v('pvTipo'), num = v('pvNro').replace(/\D/g, ''), err = [];
      if (v('pvNom').trim().length < 3) err.push('Escribí la razón social');
      if (!cuitValido(num)) err.push(num.length === 11 ? 'El CUIT no es válido (dígito verificador o prefijo incorrecto)' : 'El CUIT tiene 11 dígitos');
      else { const dup = e.proveedores.find((x) => x !== p && x.doc.replace(/\D/g, '') === num); if (dup) err.push(`Ya existe un proveedor con ese CUIT: ${dup.n}`); }
      const doc = fmtDoc(tipo, num);
      $('#pvErr', dlg).innerHTML = err.length ? err.map((m) => `<div class="chequeo no" style="margin:0">${ic('alert')}<span>${esc(m)}</span></div>`).join('') : `<div class="chequeo ok" style="margin:0">${ic('check')}<span>${esc(doc)} · ${D.condicion[v('pvIva')]}</span></div>`;
      $('#pvOk', dlg).disabled = !!err.length; return { err, doc };
    };
    ['pvNom', 'pvTipo', 'pvNro', 'pvIva'].forEach((id) => $('#' + id, dlg).addEventListener('input', validar)); validar();
    $('#pvOk', dlg).addEventListener('click', () => {
      const { err, doc } = validar(); if (err.length) return;
      const nuevoDatos = { n: v('pvNom').trim(), doc, iva: v('pvIva'), plazo: Number(v('pvPlazo')) };
      if (p) {
        const cambios = []; [['Razón social', 'n'], ['Documento', 'doc'], ['Condición IVA', 'iva'], ['Plazo de pago', 'plazo']].forEach(([t, k]) => { if (p[k] !== nuevoDatos[k]) cambios.push([t, k === 'iva' ? D.condicion[p[k]] : String(p[k]), k === 'iva' ? D.condicion[nuevoDatos[k]] : String(nuevoDatos[k])]); });
        if (!cambios.length) { toast('No hay cambios para guardar'); return; }
        const ant = p.n; Object.assign(p, nuevoDatos); [e.oc, e.remC, e.factC].forEach((l) => l.forEach((d) => { if (d.tercero === ant) d.tercero = p.n; }));
        registrar('maestros', `Modificó el proveedor ${p.n}`, cambios.map((x) => x[0]).join(', '), { cambios }); toast('Proveedor actualizado');
      } else {
        const n = { ...nuevoDatos, saldo: 0, vencido: 0, ultima: null, anio: 0 }; e.proveedores.unshift(n);
        registrar('maestros', `Dio de alta el proveedor ${n.n}`, `${doc} · ${D.condicion[n.iva]} · CUIT validado`); toast(`Proveedor ${n.n} creado`);
      }
      dlg.close(); repintar();
    });
  }

  /* ---------- pagos ---------- */
  function abrirPago(f) {
    const e = empresa(), prov = e.proveedores.find((p) => p.n === f.tercero);
    dialogo(`<header class="det-h"><div><small>Tesorería</small><h4>Pagar ${esc(f.nro)}</h4></div>${cierra}</header>
      <div class="partes">${dato('Proveedor', esc(f.tercero))}${dato('Importe', pe(f.total))}${dato('Vence', f.estado === 'Vencida' ? '<span class="mal">vencida</span>' : enDias(f.venc))}</div>
      <div class="form-aj"><label>Medio<select class="in" id="gMedio"><option>Transferencia</option><option>Efectivo</option><option>Cheque propio</option></select></label>
        <label>Sale de<select class="in" id="gCuenta"></select></label></div>
      <p class="mudo" id="gInfo" style="margin:0"></p><div id="gErr"></div>
      <footer class="det-f"><button class="btn primary" id="gOk">Registrar el pago</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), cuentas = () => e.tes.cuentas.filter((c) => ($('#gMedio', dlg).value === 'Efectivo' ? c.tipo === 'Caja' : c.tipo === 'Banco'));
    const cargar = () => { $('#gCuenta', dlg).innerHTML = cuentas().map((c) => `<option value="${c.id}">${esc(c.n)}</option>`).join(''); val(); };
    const val = () => {
      const c = e.tes.cuentas.find((x) => x.id === $('#gCuenta', dlg).value), cheque = $('#gMedio', dlg).value === 'Cheque propio';
      $('#gInfo', dlg).textContent = c ? `Saldo disponible: ${pe(c.saldo)}${cheque ? ' · el cheque descuenta del banco al cobrarse' : ''}` : '';
      const m = !c ? 'Elegí de dónde sale el pago' : !cheque && c.saldo < f.total ? `Fondos insuficientes en ${c.n}: faltan ${pe(f.total - c.saldo)}. No se permite el sobregiro.` : '';
      $('#gErr', dlg).innerHTML = m ? `<div class="chequeo no" style="margin:0">${ic('alert')}<span>${esc(m)}</span></div>` : ''; $('#gOk', dlg).disabled = !!m; return !m;
    };
    $('#gMedio', dlg).addEventListener('change', cargar); $('#gCuenta', dlg).addEventListener('change', val); cargar();
    $('#gOk', dlg).addEventListener('click', () => {
      if (!val()) return; const medio = $('#gMedio', dlg).value, c = e.tes.cuentas.find((x) => x.id === $('#gCuenta', dlg).value);
      const op = { nro: siguiente(e.tes.cobrosPagos.filter((x) => x.tipo === 'Pago'), 'OP 0001-'), tipo: 'Pago', tercero: f.tercero, dias: 0, medio: medio === 'Cheque propio' ? 'Cheque' : medio, importe: f.total, estado: 'Confirmado' };
      e.tes.cobrosPagos.unshift(op); f.estado = 'Pagada';
      if (medio === 'Cheque propio') e.tes.cheques.unshift({ nro: String(30100000 + Math.floor(Math.random() * 99999)), banco: c.n.split(' · ')[0], tercero: f.tercero, sentido: 'Propio', importe: f.total, vence: 15, estado: 'Entregado' });
      else { c.saldo -= f.total; e.caja -= f.total; e.tes.movs.unshift({ dias: 0, cuenta: c.n, tipo: 'Pago', concepto: f.tercero, importe: -f.total }); }
      if (prov) { prov.saldo = Math.max(0, Math.round((prov.saldo - f.total) * 100) / 100); prov.vencido = Math.max(0, Math.round((prov.vencido - f.total) * 100) / 100); }
      registrar('tesoreria', `Registró el pago ${op.nro} de la factura ${f.nro}`, `${f.tercero} · ${pe(f.total)} · ${medio.toLowerCase()}`);
      toast(`Pago ${op.nro} registrado`); dlg.close(); repintar();
    });
  }
  function abrirPendientes(p) {
    const e = empresa(), pend = e.factC.filter((x) => x.tercero === p.n && (x.estado === 'Impaga' || x.estado === 'Vencida'));
    dialogo(`<header class="det-h"><div><small>Pagos</small><h4>Facturas pendientes de ${esc(p.n)}</h4></div>${cierra}</header>
      ${pend.length ? `<div class="mini">${pend.map((x, i) => `<div><span class="num">${esc(x.nro)}</span>${pill(x.estado)}<b class="num">${pe(x.total)}</b><button class="btn sm" data-pg="${i}">Pagar</button></div>`).join('')}</div>` : '<p class="mudo" style="margin:0">No hay facturas pendientes.</p>'}
      <footer class="det-f"><button class="btn" data-cerrar>Cerrar</button></footer>`);
    $$('[data-pg]', $('#detalle')).forEach((b) => b.addEventListener('click', () => abrirPago(pend[Number(b.dataset.pg)])));
  }

  /* ---------- acciones entre documentos ---------- */
  function acciones(clave, d, e) {
    const out = [];
    if (clave === 'compras/ordenes') {
      if (d.estado === 'Borrador') {
        out.push({ t: 'Editar', p: 1, f: () => { $('#detalle').close(); nuevo('orden', { doc: d }); } });
        out.push({ t: 'Enviar al proveedor', f: () => { d.estado = 'Enviada'; registrar('comprobantes', `Envió la orden de compra ${d.nro}`, `${d.tercero} · ${pe(d.total)}`, { cambios: [['Estado', 'Borrador', 'Enviada']] }); toast('Orden enviada (simulado)'); terminar(); } });
      }
      if (d.estado === 'Enviada' || d.estado === 'Recibida parcial') {
        const pend = pendiente(d), hayStock = conStock(d.items).length > 0;
        if (pend.length) out.push({ t: 'Registrar recepción', p: 1, f: () => { $('#detalle').close(); nuevo('recepcion', { proveedor: d.tercero, fuente: d }); } });
        else out.push({ t: hayStock ? 'Cerrar la orden' : 'Marcar como recibida', p: 1, f: () => { d.estado = 'Recibida'; registrar('comprobantes', `Cerró la orden de compra ${d.nro}`, `${d.tercero} · ${hayStock ? 'todo recibido' : 'servicio recibido'}`, { cambios: [['Estado', 'Enviada', 'Recibida']] }); toast('Orden cerrada'); terminar(); } });
        if (!Object.values(recibido(d)).some((v) => v > 0)) out.push({ t: 'Cancelar orden', f: () => { d.estado = 'Cancelada'; registrar('comprobantes', `Canceló la orden de compra ${d.nro}`, `${d.tercero} · ${pe(d.total)}`, { cambios: [['Estado', 'Enviada', 'Cancelada']] }); toast('Orden cancelada'); terminar(); } });
      }
    }
    if (clave === 'compras/remitos' && d.estado === 'Sin facturar') {
      out.push({ t: 'Cargar la factura', p: 1, f: () => { $('#detalle').close(); nuevo('factura', { proveedor: d.tercero, fuente: d }); } });
      out.push({ t: 'Anular recepción', f: () => {
        const s = saldos(e), falta = conStock(d.items).find((i) => (s[i.cod + '|' + d.dep] || 0) < i.cant);
        if (falta) { registrar('comprobantes', `Se rechazó la anulación de la recepción ${d.nro}`, `Ya salió parte de ${falta.art}: no se puede devolver todo el ingreso`, { res: 'rechazo' }); toast(`No se puede anular: ya salió stock de ${falta.art} y quedaría negativo.`); return; }
        conStock(d.items).forEach((i) => mover(e, i.cod, d.dep, -i.cant, 'Anulación de recepción', d.nro)); d.estado = 'Anulado';
        const oc = d.orden && e.oc.find((o) => o.nro === d.orden); if (oc) { const r = recibido(oc); conStock(d.items).forEach((i) => { r[i.cod] = Math.max(0, (r[i.cod] || 0) - i.cant); }); actualizarEstadoOrden(oc); }
        registrar('comprobantes', `Anuló la recepción ${d.nro}`, `${d.tercero} · el stock sale de ${depNombre(e, d.dep)}`, { cambios: [['Estado', 'Sin facturar', 'Anulado']] }); toast('Recepción anulada y stock devuelto'); terminar();
      } });
    }
    if (clave === 'compras/facturas' && (d.estado === 'Impaga' || d.estado === 'Vencida')) {
      out.push({ t: 'Registrar el pago', p: 1, f: () => abrirPago(d) });
      out.push({ t: 'Anular factura', f: () => {
        const ant = d.estado; d.estado = 'Anulada'; const prov = e.proveedores.find((p) => p.n === d.tercero);
        if (prov) { prov.saldo = Math.max(0, Math.round((prov.saldo - d.total) * 100) / 100); if (ant === 'Vencida') prov.vencido = Math.max(0, prov.vencido - d.total); }
        const rec = d.recepcion && e.remC.find((r) => r.nro === d.recepcion); if (rec && rec.estado === 'Facturado') rec.estado = 'Sin facturar';
        registrar('comprobantes', `Anuló la factura de compra ${d.nro}`, `${d.tercero} · ${pe(d.total)}`, { cambios: [['Estado', ant, 'Anulada']] }); toast('Factura anulada'); terminar();
      } });
    }
    return out;
  }

  return { nuevo, editor, abrirProveedor, abrirPago, abrirPendientes, acciones };
};
