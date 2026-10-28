/* Ventas completo: crear presupuestos, pedidos y remitos desde cero (con precios por lista, descuentos y control de stock),
   altas y cambios de clientes, lista de precios, cobros y las acciones entre documentos. Se apoya en modulos.js (I). */
window.crearVentas = function (H, I) {
  'use strict';
  const { $, $$, esc, ic, toast, registrar, ir, D, empresa } = H;
  const { pe, pill, ent, c2, dato, cierra, dialogo, tabla, art, saldos, mover, siguiente, depNombre, copiar, unidades, hace, abrirFactura, repintar, terminar } = I;

  const LISTAS_PRECIO = [{ n: 'General', f: 0 }, { n: 'Mayorista', f: -10 }, { n: 'Minorista', f: 8 }];
  const DESC_MAX = 20;   /* permiso "ventas.descuento_max" del rol; lo decide la API en el producto */
  const base = (e, a) => ((e.precios || {})[a.cod] != null ? e.precios[a.cod] : a.p);
  const precioLista = (e, a, lista) => Math.round(base(e, a) * (1 + (LISTAS_PRECIO.find((l) => l.n === lista) || LISTAS_PRECIO[0]).f / 100));
  const precio = (e, a, cli) => precioLista(e, a, cli && cli.lista);
  const importe = (it) => Math.round(it.cant * it.precio * (1 - (it.desc || 0) / 100) * 100) / 100;
  const vacio = () => ({ art: '', cod: '', cant: 1, precio: 0, desc: 0, al: '21', manual: false });
  const ETIQ = { '21': 'IVA 21 %', '10.5': 'IVA 10,5 %', '27': 'IVA 27 %', '5': 'IVA 5 %', '2.5': 'IVA 2,5 %', '0': 'IVA 0 %', ex: 'Exento', ng: 'No gravado' };
  const hoyISO = () => new Date().toISOString().slice(0, 10);

  /* ---------- documentos nuevos ---------- */
  const TIPOS = {
    presupuesto: { t: 'Presupuesto', tab: 'ventas/presupuestos', letra: 'X', sub: 'Una oferta con precios y validez. No mueve stock ni genera deuda.' },
    pedido: { t: 'Pedido', tab: 'ventas/pedidos', letra: 'X', sub: 'El cliente confirma qué quiere. Se entrega después, en uno o más remitos.' },
    remito: { t: 'Remito', tab: 'ventas/remitos', letra: 'R', sub: 'La entrega: descuenta el stock del depósito y queda pendiente de facturar.' },
  };
  let prefill = null;
  function nuevo(tipo, opciones) { prefill = { tipo, ...(opciones || {}) }; ir('ventas/nuevo/' + tipo); }

  function editor(root, tipo) {
    const e = empresa(), mt = e.cond === 'MT', T = TIPOS[tipo], pre = prefill && prefill.tipo === tipo ? prefill : {}, doc = pre.doc || null; prefill = null;
    const pool = D.articulos.filter((a) => a.v && (tipo !== 'remito' || a.stock));
    const cliPorNombre = (n) => e.clientes.find((c) => c.n === n) || null;
    const f = { cliente: cliPorNombre(pre.cliente || (doc && doc.tercero)), dep: 1, obs: '', items: doc ? copiar(doc.items).map((i) => ({ ...i, desc: i.desc || 0, manual: true })) : [vacio()] };
    root.innerHTML = `
      <section class="hero rise"><div><h1>${doc ? 'Editar' : 'Nuevo'} <em>${T.t.toLowerCase()}</em></h1><p>${T.sub}</p></div><div class="acciones"><button class="btn" data-ir="${T.tab}">Volver a ${T.tab.split('/')[1]}</button></div></section>
      <div class="fac">
        <div class="col">
          <section class="card paso rise" style="--d:1"><h3><span class="n">1</span> Cliente</h3>
            <div class="campo combo"><label for="vcli">¿Para quién es?</label><input class="in" id="vcli" autocomplete="off" placeholder="Escribí un nombre o documento…" role="combobox" aria-expanded="false"><ul id="vlistaCli" hidden role="listbox"></ul></div>
            <div id="vselCli"></div></section>
          <section class="card paso rise" style="--d:2"><h3><span class="n">2</span> Datos</h3>
            <div class="tres"><div class="campo"><label for="vfecha">Fecha</label><input class="in" type="date" id="vfecha" value="${hoyISO()}" readonly></div>
              ${tipo === 'presupuesto' ? '<div class="campo"><label for="vval">Validez</label><select class="in" id="vval"><option>15 días</option><option>30 días</option><option>7 días</option></select></div>' : ''}
              ${tipo === 'pedido' ? '<div class="campo"><label for="vent">Entrega estimada</label><input class="in" type="date" id="vent"></div>' : ''}
              ${tipo === 'remito' ? `<div class="campo"><label for="vdep">Sale del depósito</label><select class="in" id="vdep">${e.deps.map((d) => `<option value="${d.id}">${esc(d.n)}</option>`).join('')}</select></div>` : ''}
              <div class="campo"><label for="vobs">Observaciones</label><input class="in" id="vobs" placeholder="Opcional"></div></div></section>
          <section class="card paso rise" style="--d:3"><h3><span class="n">3</span> Renglones</h3>
            <div id="vreng" style="display:grid;gap:8px"></div>
            <button class="btn sm agregar" id="vagregar">${ic('plus')} Agregar renglón</button></section>
        </div>
        <aside class="card papel rise" style="--d:2" id="vpapel"></aside>
      </div>
      <div class="barra rise" style="--d:4"><div class="tot"><small id="vbTipo"></small><b class="num" id="vbTotal"></b></div>
        ${tipo === 'presupuesto' ? '<button class="btn" id="vborrador">Guardar borrador</button>' : ''}<button class="btn primary" id="vcrear">${ic('bolt')} ${tipo === 'presupuesto' ? 'Crear y enviar' : tipo === 'pedido' ? 'Crear pedido' : 'Generar remito y descontar stock'}</button></div>
      <datalist id="artsV">${pool.map((a) => `<option value="${esc(a.n)}">`).join('')}</datalist>`;

    const inCli = $('#vcli', root), ul = $('#vlistaCli', root), rEl = $('#vreng', root);
    const pintarCli = () => {
      const c = f.cliente;
      $('#vselCli', root).innerHTML = c ? `<div class="sel"><span class="avatar t2">${esc(c.n.split(' ').slice(0, 2).map((p) => p[0]).join(''))}</span><span class="t"><b>${esc(c.n)}</b><span>${esc(c.doc)} · ${D.condicion[c.iva]} · lista ${esc(c.lista)} · ${c.plazo ? c.plazo + ' días' : 'contado'}</span></span><button class="icon-btn" id="vquitar" aria-label="Quitar cliente" style="width:32px;height:32px">${ic('x')}</button></div>` : '';
      inCli.style.display = c ? 'none' : ''; $('label[for=vcli]', root).style.display = c ? 'none' : '';
      const q = $('#vquitar', root); if (q) q.onclick = () => { f.cliente = null; pintarCli(); repreciar(); recalcular(); inCli.focus(); };
    };
    const abrirLista = () => {
      const t = inCli.value.toLowerCase(), r = e.clientes.filter((c) => (c.n + c.doc).toLowerCase().includes(t));
      ul.innerHTML = r.map((c, i) => `<li role="option" data-n="${esc(c.n)}" ${i === 0 ? 'aria-selected="true"' : ''}><span><b>${esc(c.n)}</b><br><small>${esc(c.doc)}</small></span><span class="pill ${c.iva === 'RI' ? '' : 'blue'}">${D.condicion[c.iva]}</span></li>`).join('') || '<li>Sin resultados</li>';
      ul.hidden = false; inCli.setAttribute('aria-expanded', 'true');
    };
    const elegir = (n) => { f.cliente = cliPorNombre(n); ul.hidden = true; inCli.value = ''; pintarCli(); repreciar(); recalcular(); };
    inCli.addEventListener('focus', abrirLista); inCli.addEventListener('input', abrirLista);
    inCli.addEventListener('keydown', (ev) => {
      const items = $$('li[data-n]', ul), cur = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = (cur + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, k) => x.setAttribute('aria-selected', k === n)); }
      if (ev.key === 'Enter' && items[cur]) { ev.preventDefault(); elegir(items[cur].dataset.n); }
      if (ev.key === 'Escape') ul.hidden = true;
    });
    ul.addEventListener('mousedown', (ev) => { const li = ev.target.closest('li[data-n]'); if (li) { ev.preventDefault(); elegir(li.dataset.n); } });
    inCli.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; }, 120));

    /* los precios siguen la lista del cliente, salvo los que el usuario tocó a mano */
    const repreciar = () => {
      f.items.forEach((it, i) => { const a = art(it.cod); if (a && !it.manual) { it.precio = precio(e, a, f.cliente); const inp = $('.precio', rEl.children[i + 1] || document.createElement('div')); if (inp) inp.value = it.precio; } });
    };
    const cab = '<div class="reng ed cab"><span>Artículo o servicio</span><span>Cant.</span><span>Precio</span><span>Dto. %</span><span>Alícuota</span><span style="text-align:right">Importe</span><span></span></div>';
    const renglon = (it, i) => `<div class="reng ed" data-i="${i}"><span class="a"><input class="in art" list="artsV" placeholder="Artículo…" value="${esc(it.art)}" aria-label="Artículo"><small class="disp"></small></span><input class="in cant" type="number" min="0" step="any" value="${it.cant}" aria-label="Cantidad"><input class="in precio" type="number" min="0" step="any" value="${it.precio || ''}" placeholder="0,00" aria-label="Precio"><input class="in dto" type="number" min="0" max="100" step="any" value="${it.desc || ''}" placeholder="0" aria-label="Descuento %"><span class="alic">${mt ? '—' : ETIQ[it.al]}</span><span class="sub num">$ 0,00</span><button class="x" aria-label="Quitar renglón">${ic('trash')}</button></div>`;
    const pintarReng = () => { rEl.innerHTML = cab + f.items.map(renglon).join(''); recalcular(); };
    rEl.addEventListener('input', (ev) => {
      const fila = ev.target.closest('.reng[data-i]'); if (!fila) return; const it = f.items[Number(fila.dataset.i)];
      if (ev.target.classList.contains('art')) {
        const a = pool.find((x) => x.n === ev.target.value); it.art = ev.target.value;
        if (a) { it.cod = a.cod; it.al = a.al; it.manual = false; it.precio = precio(e, a, f.cliente); $('.precio', fila).value = it.precio; $('.alic', fila).textContent = mt ? '—' : ETIQ[a.al]; } else it.cod = '';
      }
      if (ev.target.classList.contains('cant')) it.cant = Number(ev.target.value) || 0;
      if (ev.target.classList.contains('precio')) { it.precio = Number(ev.target.value) || 0; it.manual = true; }
      if (ev.target.classList.contains('dto')) it.desc = Number(ev.target.value) || 0;
      recalcular();
    });
    rEl.addEventListener('click', (ev) => { const b = ev.target.closest('.x'); if (!b) return; f.items.splice(Number(b.closest('.reng').dataset.i), 1); if (!f.items.length) f.items.push(vacio()); pintarReng(); });
    const agregar = () => { f.items.push(vacio()); pintarReng(); $$('.art', rEl).pop().focus(); };
    $('#vagregar', root).addEventListener('click', agregar);
    rEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.classList.contains('dto')) { ev.preventDefault(); agregar(); } });
    if (tipo === 'remito') $('#vdep', root).addEventListener('change', (ev) => { f.dep = Number(ev.target.value); recalcular(); });
    $('#vobs', root).addEventListener('input', (ev) => { f.obs = ev.target.value; });

    const lineasValidas = () => f.items.filter((it) => it.art && it.cod);
    let errores = true;
    function recalcular() {
      const sd = saldos(e), disp = (cod) => (tipo === 'remito' ? sd[cod + '|' + f.dep] || 0 : (sd[cod + '|1'] || 0) + (sd[cod + '|2'] || 0));
      const validas = lineasValidas(), t = D.totales(validas.map((it) => ({ ...it })), mt), cli = f.cliente;
      $$('.reng[data-i]', rEl).forEach((fila, i) => {
        const it = f.items[i], a = art(it.cod); $('.sub', fila).textContent = pe(importe(it));
        const h = $('.disp', fila); if (a && a.stock) { const d = disp(a.cod); h.textContent = `${tipo === 'remito' ? 'En ' + depNombre(e, f.dep) : 'Stock total'}: ${d}`; h.className = 'disp' + (it.cant > d ? ' mal' : ''); } else { h.textContent = a ? 'Servicio · sin stock' : ''; h.className = 'disp'; }
      });
      const faltantes = validas.filter((it) => { const a = art(it.cod); return a && a.stock && it.cant > disp(a.cod); });
      const dtoAlto = validas.filter((it) => (it.desc || 0) > DESC_MAX), cantMal = f.items.filter((it) => it.art && !(it.cant > 0)), sinPrecio = validas.filter((it) => !(it.precio > 0));
      const chk = [
        [cli ? 'ok' : 'no', cli ? `Cliente: ${cli.n} · ${D.condicion[cli.iva]}` : 'Elegí el cliente'],
        [validas.length && !cantMal.length && !sinPrecio.length ? 'ok' : 'no', !validas.length ? 'Cargá al menos un renglón con artículo' : cantMal.length ? 'Hay renglones con cantidad cero' : sinPrecio.length ? 'Hay renglones sin precio' : `${validas.length} renglón${validas.length === 1 ? '' : 'es'} con importe`],
        [dtoAlto.length ? 'no' : 'ok', dtoAlto.length ? `Descuento máximo permitido para tu rol: ${DESC_MAX} %` : 'Descuentos dentro de lo permitido'],
        [tipo === 'remito' ? (faltantes.length ? 'no' : 'ok') : (faltantes.length ? 'av' : 'ok'),
          faltantes.length ? (tipo === 'remito' ? `Stock insuficiente de ${faltantes[0].art}: hay ${disp(faltantes[0].cod)} en ${depNombre(e, f.dep)}. El sistema no deja stock negativo.` : `Falta stock de ${faltantes[0].art} (hay ${disp(faltantes[0].cod)}): se podrá cumplir con una compra`) : validas.some((it) => art(it.cod).stock) ? 'Hay stock para todo lo pedido' : 'Sin artículos con stock'],
      ];
      if (tipo === 'remito' && f.items.some((it) => it.art && !art(it.cod))) chk.push(['no', 'Hay artículos que no existen en el catálogo']);
      if (cli && cli.vencido > 0) chk.push(['av', `${cli.n} tiene ${pe(cli.vencido)} vencidos. Conviene cobrar antes de entregar.`]);
      if (cli) chk.push(['ok', `Precios de la lista ${cli.lista}${f.items.some((it) => it.manual && it.cod) ? ' (algunos modificados a mano)' : ''}`]);
      errores = chk.some((x) => x[0] === 'no');
      $('#vpapel', root).innerHTML = `
        <div class="cab"><div class="emi"><b>${esc(e.nombre)}</b><span>CUIT ${esc(e.cuit)} · ${D.condicion[e.cond]}</span><span>${T.t} · ${new Date().toLocaleDateString('es-AR')}</span></div><div class="letra-grande"><b>${T.letra}</b><small>${T.letra === 'R' ? 'REMITO' : 'NO VÁLIDO COMO FACTURA'}</small></div></div>
        <div class="cuerpo"><div><small style="color:var(--muted)">Cliente</small><br><b>${cli ? esc(cli.n) : '— sin elegir —'}</b>${cli ? `<br><span style="color:var(--ink-2)">${esc(cli.doc)} · ${D.condicion[cli.iva]}</span>` : ''}</div>
          <table><thead><tr><th>Detalle</th><th>Cant.</th><th>Importe</th></tr></thead><tbody>${validas.length ? validas.map((it) => `<tr><td>${esc(it.art)}${it.desc ? `<br><small style="color:var(--muted)">Dto. ${String(it.desc).replace('.', ',')} %</small>` : ''}</td><td class="num">${it.cant}</td><td class="num">${pe(importe(it))}</td></tr>`).join('') : '<tr><td colspan="3" style="color:var(--muted)">Los renglones aparecen acá a medida que los cargás.</td></tr>'}</tbody></table>
          <div class="totales num">${tipo === 'remito' ? `<div><span>Unidades</span><span>${unidades(validas)}</span></div>` : mt ? '' : `<div><span>Neto gravado</span><span>${pe(t.neto)}</span></div>${t.ivas.map((x) => `<div><span>IVA ${String(D.TASA[x.al] * 100).replace('.', ',')} %</span><span>${pe(x.iva)}</span></div>`).join('')}${t.exento ? `<div><span>Exento</span><span>${pe(t.exento)}</span></div>` : ''}${t.noGrav ? `<div><span>No gravado</span><span>${pe(t.noGrav)}</span></div>` : ''}`}<div class="total"><span>${tipo === 'remito' ? 'Valor de la entrega' : 'Total'}</span><span>${pe(t.total)}</span></div></div></div>
        <div class="chequeos">${chk.map(([k, x]) => `<div class="${k}">${ic(k === 'ok' ? 'check' : 'alert')}<span style="color:var(--ink-2)">${esc(x)}</span></div>`).join('')}</div>`;
      $('#vbTipo', root).textContent = `${T.t}${cli ? ' · ' + cli.n : ''}`; $('#vbTotal', root).textContent = pe(t.total);
      $('#vcrear', root).disabled = errores; const b = $('#vborrador', root); if (b) b.disabled = !cli || !validas.length;
    }

    const guardar = (estadoFinal) => {
      const items = lineasValidas().map((it) => ({ art: it.art, cod: it.cod, cant: it.cant, precio: it.precio, desc: it.desc || 0, al: it.al }));
      const total = D.totales(items, mt).total, cli = f.cliente;
      if (tipo === 'presupuesto') {
        if (doc) {
          const antes = doc.total, antesEst = doc.estado; Object.assign(doc, { tercero: cli.n, items, total, estado: estadoFinal });
          registrar('comprobantes', `Modificó el presupuesto ${doc.nro}`, `${cli.n} · ${items.length} renglones`, { cambios: [['Total', pe(antes), pe(total)], ['Estado', antesEst, estadoFinal]] });
          toast(`Presupuesto ${doc.nro} actualizado`);
        } else {
          const d = { nro: siguiente(e.presup, '0001-'), tercero: cli.n, dias: 0, items, estado: estadoFinal, total }; e.presup.unshift(d);
          registrar('comprobantes', `Creó el presupuesto ${d.nro}`, `${cli.n} · ${pe(total)} · ${estadoFinal === 'Enviado' ? 'enviado al cliente' : 'borrador'}`);
          toast(`Presupuesto ${d.nro} ${estadoFinal === 'Enviado' ? 'enviado (simulado)' : 'guardado como borrador'}`);
        }
      } else if (tipo === 'pedido') {
        const d = { nro: siguiente(e.pedidos, '0001-'), tercero: cli.n, dias: 0, items, estado: 'Pendiente', rem: 0, fac: 0, total }; e.pedidos.unshift(d);
        registrar('comprobantes', `Creó el pedido ${d.nro}`, `${cli.n} · ${pe(total)} · ${items.length} renglones`); toast(`Pedido ${d.nro} creado`);
      } else {
        const d = { nro: siguiente(e.remitos, '0002-'), tercero: cli.n, dias: 0, items, dep: f.dep, estado: 'Sin facturar', total }; e.remitos.unshift(d);
        items.forEach((i) => mover(e, i.cod, f.dep, -i.cant, 'Remito de venta', d.nro));
        registrar('comprobantes', `Generó el remito ${d.nro}`, `${cli.n} · ${unidades(items)} unidades salen de ${depNombre(e, f.dep)}`); toast(`Remito ${d.nro} generado y stock descontado`);
      }
      ir(T.tab);
    };
    $('#vcrear', root).addEventListener('click', () => { if (!errores) guardar(tipo === 'presupuesto' ? 'Enviado' : null); });
    const bor = $('#vborrador', root); if (bor) bor.addEventListener('click', () => guardar('Borrador'));
    pintarCli(); pintarReng();
  }

  /* ---------- clientes ---------- */
  const cuitValido = (c) => {
    if (!/^\d{11}$/.test(c) || !['20', '23', '24', '25', '26', '27', '30', '33', '34', '50', '51', '55'].includes(c.slice(0, 2))) return false;
    const p = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < 10; i++) s += Number(c[i]) * p[i];
    let dv = 11 - (s % 11); if (dv === 11) dv = 0; else if (dv === 10) dv = 9; return dv === Number(c[10]);
  };
  const fmtDoc = (tipo, n) => (tipo === 'Sin identificar' ? 'Sin identificar' : tipo === 'DNI' ? 'DNI ' + n.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : `${tipo} ${n.slice(0, 2)}-${n.slice(2, 10)}-${n.slice(10)}`);
  const parseDoc = (doc) => { const m = /^(CUIT|CUIL|DNI) (.+)$/.exec(doc || ''); return m ? [m[1], m[2].replace(/\D/g, '')] : ['Sin identificar', '']; };

  function abrirCliente(c) {
    const e = empresa(), [tipo0, num0] = c ? parseDoc(c.doc) : ['CUIT', ''];
    const opt = (lista, sel) => lista.map(([v, t]) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${t}</option>`).join('');
    dialogo(`<header class="det-h"><div><small>Cliente</small><h4>${c ? 'Editar cliente' : 'Nuevo cliente'}</h4></div>${cierra}</header>
      <div class="form-aj">
        <label class="ancho">Razón social o nombre<input class="in" id="cNom" value="${esc(c ? c.n : '')}" autocomplete="off"></label>
        <label>Tipo de documento<select class="in" id="cTipo">${opt(['CUIT', 'CUIL', 'DNI', 'Sin identificar'].map((x) => [x, x]), tipo0)}</select></label>
        <label>Número<input class="in" id="cNro" inputmode="numeric" value="${num0}" placeholder="Solo números" autocomplete="off"></label>
        <label>Condición frente al IVA<select class="in" id="cIva">${opt(Object.entries(D.condicion), c ? c.iva : 'RI')}</select></label>
        <label>Plazo de pago<select class="in" id="cPlazo">${opt([[0, 'Contado'], [15, '15 días'], [30, '30 días'], [45, '45 días'], [60, '60 días']], c ? c.plazo : 30)}</select></label>
        <label class="ancho">Lista de precios<select class="in" id="cLista">${opt(LISTAS_PRECIO.map((l) => [l.n, l.n + (l.f ? ` (${l.f > 0 ? '+' : ''}${l.f} %)` : '')]), c ? c.lista : 'General')}</select></label>
      </div>
      <div id="cErr" style="display:grid;gap:6px"></div>
      <footer class="det-f"><button class="btn primary" id="cOk">${c ? 'Guardar cambios' : 'Crear cliente'}</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), v = (id) => $('#' + id, dlg).value;
    const validar = () => {
      const tipo = v('cTipo'), num = v('cNro').replace(/\D/g, ''), iva = v('cIva'), err = [];
      if (v('cNom').trim().length < 3) err.push('Escribí la razón social o el nombre');
      if (tipo === 'CUIT' || tipo === 'CUIL') { if (!cuitValido(num)) err.push(num.length === 11 ? 'El CUIT no es válido (dígito verificador o prefijo incorrecto)' : 'El CUIT tiene 11 dígitos'); }
      else if (tipo === 'DNI') { if (!/^\d{7,8}$/.test(num)) err.push('El DNI tiene 7 u 8 dígitos'); }
      else if (iva !== 'CF') err.push('Sin identificar solo se admite para Consumidor Final');
      if (iva !== 'CF' && tipo !== 'CUIT') err.push(`La condición ${D.condicion[iva]} requiere CUIT (RG 5616)`);
      const doc = fmtDoc(tipo, num);
      if (tipo !== 'Sin identificar' && !err.length) { const dup = e.clientes.find((x) => x !== c && x.doc.replace(/\D/g, '') === num && x.doc.split(' ')[0] === tipo); if (dup) err.push(`Ya existe un cliente con ese documento: ${dup.n}`); }
      $('#cErr', dlg).innerHTML = err.length ? err.map((m) => `<div class="chequeo no" style="margin:0">${ic('alert')}<span>${esc(m)}</span></div>`).join('') : `<div class="chequeo ok" style="margin:0">${ic('check')}<span>${esc(doc)} · ${D.condicion[iva]}</span></div>`;
      $('#cOk', dlg).disabled = !!err.length; return { err, doc };
    };
    ['cNom', 'cTipo', 'cNro', 'cIva'].forEach((id) => $('#' + id, dlg).addEventListener('input', validar)); validar();
    $('#cOk', dlg).addEventListener('click', () => {
      const { err, doc } = validar(); if (err.length) return;
      const nuevoDatos = { n: v('cNom').trim(), doc, iva: v('cIva'), plazo: Number(v('cPlazo')), lista: v('cLista') };
      if (c) {
        const cambios = []; [['Nombre', 'n'], ['Documento', 'doc'], ['Condición IVA', 'iva'], ['Plazo de pago', 'plazo'], ['Lista de precios', 'lista']].forEach(([t, k]) => {
          if (c[k] !== nuevoDatos[k]) cambios.push([t, k === 'iva' ? D.condicion[c[k]] : String(c[k]), k === 'iva' ? D.condicion[nuevoDatos[k]] : String(nuevoDatos[k])]);
        });
        if (!cambios.length) { toast('No hay cambios para guardar'); return; }
        const nombreAnterior = c.n; Object.assign(c, nuevoDatos);
        [e.presup, e.pedidos, e.remitos].forEach((l) => l.forEach((d) => { if (d.tercero === nombreAnterior) d.tercero = c.n; }));
        registrar('maestros', `Modificó el cliente ${c.n}`, cambios.map((x) => x[0]).join(', '), { cambios }); toast('Cliente actualizado');
      } else {
        const nuevoC = { ...nuevoDatos, saldo: 0, vencido: 0, ultima: null, anio: 0 }; e.clientes.unshift(nuevoC);
        registrar('maestros', `Dio de alta el cliente ${nuevoC.n}`, `${doc} · ${D.condicion[nuevoC.iva]} · CUIT validado`); toast(`Cliente ${nuevoC.n} creado`);
      }
      dlg.close(); repintar();
    });
  }

  function abrirCobro(c) {
    const e = empresa();
    dialogo(`<header class="det-h"><div><small>Cobranza</small><h4>Registrar cobro de ${esc(c.n)}</h4></div>${cierra}</header>
      <div class="partes">${dato('Saldo', pe(c.saldo))}${dato('Vencido', c.vencido ? `<span class="mal">${pe(c.vencido)}</span>` : '—')}</div>
      <div class="form-aj"><label>Importe cobrado<input class="in" id="kImp" type="number" min="0" step="0.01" value="${c.saldo}"></label>
        <label>Medio<select class="in" id="kMedio"><option>Transferencia</option><option>Efectivo</option><option>Cheque</option></select></label></div>
      <p class="mudo" style="margin:0">Cancela primero lo vencido. Genera el recibo, mueve la caja o el banco y el asiento contable.</p>
      <div id="kErr"></div>
      <footer class="det-f"><button class="btn primary" id="kOk">Registrar cobro</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), imp = () => Math.round(Number($('#kImp', dlg).value) * 100) / 100;
    const val = () => { const m = !(imp() > 0) ? 'El importe tiene que ser mayor que cero' : imp() > c.saldo ? 'No puede superar el saldo del cliente' : ''; $('#kErr', dlg).innerHTML = m ? `<div class="chequeo no" style="margin:0">${ic('alert')}<span>${m}</span></div>` : ''; $('#kOk', dlg).disabled = !!m; return !m; };
    $('#kImp', dlg).addEventListener('input', val); val();
    $('#kOk', dlg).addEventListener('click', () => {
      if (!val()) return; const medio = $('#kMedio', dlg).value, x = imp();
      const rec = { nro: siguiente(e.tes.cobrosPagos.filter((p) => p.tipo === 'Cobro'), 'REC 0001-'), tipo: 'Cobro', tercero: c.n, dias: 0, medio, importe: x, estado: 'Confirmado' };
      e.tes.cobrosPagos.unshift(rec); c.saldo = Math.round((c.saldo - x) * 100) / 100; c.vencido = Math.max(0, Math.round((c.vencido - x) * 100) / 100);
      e.porCobrar = Math.max(0, e.porCobrar - x);
      const cuenta = e.tes.cuentas[medio === 'Efectivo' ? 0 : 1]; if (medio !== 'Cheque') { cuenta.saldo += x; e.caja += x; e.tes.movs.unshift({ dias: 0, cuenta: cuenta.n, tipo: 'Cobro', concepto: c.n, importe: x }); }
      else e.tes.cheques.unshift({ nro: String(20500000 + Math.floor(Math.random() * 99999)), banco: 'Banco Nación', tercero: c.n, sentido: 'Recibido', importe: x, vence: 30, estado: 'En cartera' });
      registrar('tesoreria', `Registró el cobro ${rec.nro}`, `${c.n} · ${pe(x)} · ${medio.toLowerCase()}`);
      toast(`Cobro ${rec.nro} registrado`); dlg.close(); repintar();
    });
  }

  /* ---------- precios ---------- */
  function vPrecios(cuerpo, e) {
    let texto = '';
    cuerpo.innerHTML = `<div class="filtros rise"><span class="mudo" style="font-size:13px">Precios netos de IVA por lista. Un cambio rige para los documentos nuevos: los ya emitidos no se tocan.</span><input id="mq" placeholder="Buscar artículo o código…" aria-label="Buscar"></div><div class="card tb rise" style="--d:1" id="tb"></div>`;
    const pintar = () => tabla($('#tb'), [
      { t: 'Artículo', w: 'minmax(0,1.5fr)', f: (a) => c2(esc(a.n), esc(a.cod) + ' · ' + esc(a.rubro)) },
      { t: 'Costo', w: '120px', sec: true, r: true, f: (a) => `<span class="num">${pe(a.costo)}</span>` },
      ...LISTAS_PRECIO.map((l, k) => ({ t: l.n, w: '130px', sec: k > 0, r: true, f: (a) => `<${k ? 'span' : 'b'} class="num">${pe(precioLista(e, a, l.n))}</${k ? 'span' : 'b'}>` })),
      { t: 'Margen', w: '80px', sec: true, r: true, f: (a) => { const m = Math.round(((base(e, a) - a.costo) / base(e, a)) * 100); return `<span class="num ${m < 10 ? 'mal' : ''}">${m} %</span>`; } },
      { t: '', w: '110px', sec: true, f: (a) => ((e.precios || {})[a.cod] != null ? pill('Modificado').replace('class="pill "', 'class="pill blue"') : '') },
    ], D.articulos.filter((a) => a.v && (a.n + a.cod).toLowerCase().includes(texto)), abrirPrecio);
    pintar(); $('#mq', cuerpo).addEventListener('input', (ev) => { texto = ev.target.value.toLowerCase(); pintar(); });
  }
  function abrirPrecio(a) {
    const e = empresa(), actual = base(e, a);
    dialogo(`<header class="det-h"><div><small>Precio · ${esc(a.cod)}</small><h4>${esc(a.n)}</h4></div>${cierra}</header>
      <div class="partes">${dato('Costo', pe(a.costo))}${dato('Precio neto actual', pe(actual))}${dato('Margen actual', Math.round(((actual - a.costo) / actual) * 100) + ' %')}</div>
      <div class="form-aj"><label>Nuevo precio neto (lista General)<input class="in" id="pNuevo" type="number" min="0" step="0.01" value="${actual}"></label>
        <label>Rige desde<input class="in" id="pDesde" type="date" value="${hoyISO()}"></label></div>
      <div class="mini mini3" id="pVista"></div>
      <label style="display:none;gap:8px;align-items:center;font-size:13px" id="pConf"><input type="checkbox" id="pOk2"> Confirmo vender por debajo del costo</label>
      <div id="pErr"></div>
      <footer class="det-f"><button class="btn primary" id="pOk">Guardar precio</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), nuevoP = () => Math.round(Number($('#pNuevo', dlg).value) * 100) / 100;
    const val = () => {
      const n = nuevoP(), bajo = n > 0 && n < a.costo;
      $('#pConf', dlg).style.display = bajo ? 'flex' : 'none';
      $('#pVista', dlg).innerHTML = `<div class="cab"><span>Lista</span><span>Precio</span><span>Margen</span></div>` + LISTAS_PRECIO.map((l) => { const p = Math.round(n * (1 + l.f / 100)); return `<div><span>${l.n}</span><b class="num">${pe(p)}</b><span class="num ${p < a.costo ? 'mal' : ''}">${p ? Math.round(((p - a.costo) / p) * 100) : 0} %</span></div>`; }).join('');
      const m = !(n > 0) ? 'El precio tiene que ser mayor que cero' : bajo && !$('#pOk2', dlg).checked ? 'El precio queda por debajo del costo: confirmalo para guardarlo' : n === actual ? 'El precio es el mismo que el actual' : '';
      $('#pErr', dlg).innerHTML = m ? `<div class="chequeo ${bajo && n > 0 ? 'no' : 'no'}" style="margin:0">${ic('alert')}<span>${m}</span></div>` : ''; $('#pOk', dlg).disabled = !!m;
    };
    ['pNuevo', 'pOk2'].forEach((id) => $('#' + id, dlg).addEventListener('input', val)); val();
    $('#pOk', dlg).addEventListener('click', () => {
      const n = nuevoP(); e.precios = e.precios || {}; e.precios[a.cod] = n;
      registrar('maestros', `Cambió el precio de ${a.n}`, `Lista General · rige desde ${$('#pDesde', dlg).value}`, { cambios: [['Precio neto (General)', pe(actual), pe(n)]] });
      toast('Precio actualizado: rige para los documentos nuevos'); dlg.close(); repintar();
    });
  }

  /* ---------- acciones entre documentos ---------- */
  function acciones(clave, d, e) {
    const out = [], mt = e.cond === 'MT', cambiarEstado = (nuevoEst, verbo, msg) => () => {
      const antes = d.estado; d.estado = nuevoEst; if (nuevoEst === 'Enviado' && antes === 'Vencido') d.dias = 0;
      registrar('comprobantes', `${verbo} ${clave === 'ventas/pedidos' ? 'el pedido' : 'el presupuesto'} ${d.nro}`, `${d.tercero} · ${pe(d.total)}`, { cambios: [['Estado', antes, nuevoEst]] }); toast(msg); terminar();
    };
    if (clave === 'ventas/presupuestos') {
      if (d.estado === 'Borrador') {
        out.push({ t: 'Editar', p: 1, f: () => { $('#detalle').close(); nuevo('presupuesto', { doc: d }); } });
        out.push({ t: 'Enviar al cliente', f: cambiarEstado('Enviado', 'Envió', 'Presupuesto enviado (simulado)') });
      }
      if (d.estado === 'Enviado') { out.push({ t: 'Marcar aceptado', p: 1, f: cambiarEstado('Aceptado', 'Marcó como aceptado', 'Presupuesto aceptado') }); out.push({ t: 'Marcar rechazado', f: cambiarEstado('Rechazado', 'Marcó como rechazado', 'Presupuesto rechazado') }); }
      if (d.estado === 'Vencido') out.push({ t: 'Renovar validez', p: 1, f: cambiarEstado('Enviado', 'Renovó la validez de', 'Validez renovada: vuelve a estar enviado') });
      if (d.estado === 'Enviado' || d.estado === 'Aceptado') {
        out.push({ t: 'Convertir en pedido', p: d.estado === 'Aceptado', f: () => {
          const ped = { nro: siguiente(e.pedidos, '0001-'), tercero: d.tercero, dias: 0, items: copiar(d.items), estado: 'Pendiente', rem: 0, fac: 0, total: d.total };
          e.pedidos.unshift(ped); d.estado = 'Convertido';
          registrar('comprobantes', `Convirtió el presupuesto ${d.nro} en el pedido ${ped.nro}`, `${d.tercero} · ${pe(d.total)}`); toast(`Pedido ${ped.nro} creado`); terminar();
        } });
      }
    }
    if (clave === 'ventas/pedidos') {
      if (d.estado === 'Pendiente' || d.estado === 'Parcial') {
        out.push({ t: 'Generar remito', p: 1, f: () => {
          const pend = d.items.filter((i) => (art(i.cod) || {}).stock).map((i) => ({ ...i, cant: i.cant - Math.round((i.cant * d.rem) / 100) })).filter((i) => i.cant > 0);
          if (!pend.length) { toast('El pedido no tiene artículos con stock: se factura directamente'); return; }
          const s = saldos(e), dep = [1, 2].find((x) => pend.every((i) => (s[i.cod + '|' + x] || 0) >= i.cant));
          if (!dep) {
            const falta = pend.find((i) => (s[i.cod + '|1'] || 0) + (s[i.cod + '|2'] || 0) < i.cant) || pend[0];
            registrar('comprobantes', `Se rechazó el remito del pedido ${d.nro}`, `Stock insuficiente de ${falta.art}: hacen falta ${falta.cant}`, { res: 'rechazo' });
            toast(`Stock insuficiente de ${falta.art} (hacen falta ${falta.cant}). El sistema no deja stock negativo.`); return;
          }
          const rem = { nro: siguiente(e.remitos, '0002-'), tercero: d.tercero, dias: 0, items: pend, dep, estado: 'Sin facturar', total: D.totales(pend, mt).total, pedido: d.nro, remAnterior: d.rem };
          e.remitos.unshift(rem); pend.forEach((i) => mover(e, i.cod, dep, -i.cant, 'Remito de venta', rem.nro));
          d.rem = 100; d.estado = 'Completo';
          registrar('comprobantes', `Generó el remito ${rem.nro} del pedido ${d.nro}`, `${d.tercero} · ${unidades(pend)} unidades salen de ${depNombre(e, dep)}`);
          toast(`Remito ${rem.nro} generado y stock descontado`); terminar();
        } });
      }
      if (d.estado !== 'Cancelado' && d.rem > d.fac) {
        out.push({ t: 'Facturar lo remitido', f: () => {
          const items = d.items.map((i) => ({ ...i, cant: Math.round((i.cant * (d.rem - d.fac)) / 100) })).filter((i) => i.cant > 0);
          $('#detalle').close(); abrirFactura(d.tercero, items, { tipo: 'pedido', doc: d, hasta: d.rem });
        } });
      }
      if (d.estado === 'Pendiente') out.push({ t: 'Cancelar pedido', f: cambiarEstado('Cancelado', 'Canceló', 'Pedido cancelado') });
    }
    if (clave === 'ventas/remitos' && d.estado === 'Sin facturar') {
      out.push({ t: 'Facturar', p: 1, f: () => { $('#detalle').close(); abrirFactura(d.tercero, d.items, { tipo: 'remito', doc: d }); } });
      out.push({ t: 'Anular remito', f: () => {
        d.items.filter((i) => (art(i.cod) || {}).stock).forEach((i) => mover(e, i.cod, d.dep, i.cant, 'Anulación de remito', d.nro)); d.estado = 'Anulado';
        const ped = d.pedido && e.pedidos.find((p) => p.nro === d.pedido); if (ped) { ped.rem = d.remAnterior || 0; ped.estado = ped.rem > 0 ? 'Parcial' : 'Pendiente'; }
        registrar('comprobantes', `Anuló el remito ${d.nro}`, `${d.tercero} · el stock vuelve a ${depNombre(e, d.dep)}`, { cambios: [['Estado', 'Sin facturar', 'Anulado']] });
        toast('Remito anulado y stock devuelto'); terminar();
      } });
    }
    if (clave === 'ventas/facturas') out.push({ t: 'Duplicar como nueva factura', f: () => { $('#detalle').close(); abrirFactura(d.tercero || d.cliente, d.items || []); } });
    return out;
  }

  /* ---------- efectos de emitir una factura ---------- */
  function alFacturar(origen, nro, total, clienteNombre) {
    const e = empresa(), c = e.clientes.find((x) => x.n === clienteNombre);
    if (c && c.n !== 'Consumidor Final') { c.saldo = Math.round((c.saldo + total) * 100) / 100; c.ultima = 0; c.anio += total; }
    e.porCobrar += total; e.ventasMes += total;
    if (origen && origen.tipo === 'remito') origen.doc.estado = 'Facturado';
    if (origen && origen.tipo === 'pedido') origen.doc.fac = origen.hasta;
    if (origen) registrar('comprobantes', `Facturó ${origen.tipo === 'remito' ? 'el remito' : 'el pedido'} ${origen.doc.nro}`, `Factura ${nro} · ${pe(total)}`);
  }

  return { nuevo, editor, abrirCliente, abrirCobro, vPrecios, precio, acciones, alFacturar };
};
