/* Conciliación entre dos archivos (A y B): se cargan CSV o Excel, se ven sus columnas, se eligen qué columnas comparar y cómo
   (importe, fecha, texto) y el sistema concilia. Muestra la planilla con el % de cada lado y las listas de lo conciliado y lo pendiente.
   Los archivos se leen en el navegador: no se suben a ningún servidor ni se guardan. Se apoya en modulos.js (I). */
window.crearArchivos = function (H, I) {
  'use strict';
  const { $, $$, esc, ic, toast, registrar, D, empresa } = H;
  const { pe, pill, tabla, dialogo, cierra, dato } = I;

  const MAX_FILAS = 50000, MAX_BYTES = 15 * 1024 * 1024;
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', XLSX_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
  let promesaXlsx = null;
  const cargarXLSX = () => {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!promesaXlsx) promesaXlsx = new Promise((ok, mal) => {
      const s = document.createElement('script'); s.src = XLSX_URL; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous';
      s.onload = () => ok(window.XLSX); s.onerror = () => { promesaXlsx = null; mal(new Error('No se pudo cargar el lector de Excel (¿sin conexión?). Guardá el archivo como CSV y volvé a subirlo.')); };
      document.head.append(s);
    });
    return promesaXlsx;
  };

  /* ---------- lectura de valores ---------- */
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (v instanceof Date || v == null) return NaN;
    let s = String(v).trim().replace(/^(ars|usd|u\$s)\s*/i, ''); if (!/^[\s$()+\-]*\d[\d.,\s]*[\s\-+)]*$/.test(s)) return NaN;
    let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[^\d.,+\-]/g, ''); if (!/\d/.test(s)) return NaN;
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    const tienePunto = s.includes('.'), tieneComa = s.includes(',');
    if (tienePunto && tieneComa) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (tieneComa) s = /^[+-]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (tienePunto && /^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s); return Number.isFinite(n) ? (neg ? -n : n) : NaN;
  }
  function fecha(v) {
    if (v instanceof Date) return isNaN(v) ? NaN : Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / 864e5);
    if (typeof v === 'number') return v > 20000 && v < 80000 ? Math.floor(v) - 25569 : NaN;
    const s = String(v == null ? '' : v).trim(); let y, m, d, r;
    if ((r = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) { d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000; }
    else return NaN;
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? Math.floor(Date.UTC(y, m - 1, d) / 864e5) : NaN;
  }
  const fmtFecha = (dias) => { const d = new Date(dias * 864e5); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };

  function parseCSV(texto) {
    texto = texto.replace(/^﻿/, '');
    const muestra = texto.split(/\r?\n/).slice(0, 10).join('\n'), cuenta = (c) => muestra.split(c).length - 1;
    const delim = [';', '\t', ',', '|'].map((c) => [c, cuenta(c)]).sort((a, b) => b[1] - a[1])[0][0];
    const filas = []; let fila = [], campo = '', comillas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (comillas) { if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c; }
      else if (c === '"' && campo === '') comillas = true;
      else if (c === delim) { fila.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); campo = ''; filas.push(fila); fila = []; if (filas.length > MAX_FILAS + 1) break; }
      else campo += c;
    }
    if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
  }

  /* ---------- estado (se conserva mientras la pestaña esté abierta) ---------- */
  const S = { A: null, B: null, pares: [], ignorarSigno: false, res: null, rancio: false, vista: 'conciliado', max: 100, selA: new Set(), selB: new Set(), error: '', cargando: '' };
  const datosDe = (f) => {
    if (f._memo && f._memo.m === f.matriz && f._memo.c === f.conEnc) return f._memo.v;
    const v = calcularDatos(f); f._memo = { m: f.matriz, c: f.conEnc, v }; return v;
  };
  const calcularDatos = (f) => {
    const m = f.matriz.filter((r) => r.some((c) => String(c == null ? '' : c).trim() !== '')), ancho = Math.max(1, ...m.slice(0, 200).map((r) => r.length));
    const enc = f.conEnc && m.length ? Array.from({ length: ancho }, (_, i) => String(m[0][i] == null ? '' : m[0][i]).trim() || `Columna ${i + 1}`) : Array.from({ length: ancho }, (_, i) => `Columna ${i + 1}`);
    const unicos = enc.map((n, i) => (enc.indexOf(n) === i ? n : `${n} (${i + 1})`));
    return { enc: unicos, filas: f.conEnc ? m.slice(1) : m };
  };
  const tipoDe = (filas, i) => {
    const v = filas.slice(0, 40).map((r) => r[i]).filter((x) => String(x == null ? '' : x).trim() !== ''); if (!v.length) return 'texto';
    const nf = v.filter((x) => typeof x !== 'number' && !isNaN(fecha(x))).length, nn = v.filter((x) => !isNaN(num(x))).length;
    return nf / v.length >= 0.8 ? 'fecha' : nn / v.length >= 0.8 ? 'importe' : 'texto';
  };
  const ROTULO = { importe: 'Importe', fecha: 'Fecha', texto: 'Texto', contiene: 'Texto (contiene)' };
  const TIPOS_PAR = [['importe', 'Importe'], ['fecha', 'Fecha'], ['texto', 'Texto igual'], ['contiene', 'Texto contiene']];

  function sugerirPares() {
    const a = datosDe(S.A), b = datosDe(S.B), pares = [];
    const hallar = (enc, filas, re, tipo) => { const i = enc.findIndex((n, k) => re.test(norm(n)) && tipoDe(filas, k) === tipo); return i; };
    const reImp = /importe|monto|amount|valor|total/, reImp2 = /debit|credit|haber|debe/, reFec = /fecha|date|fec\b/;
    let ia = hallar(a.enc, a.filas, reImp, 'importe'), ib = hallar(b.enc, b.filas, reImp, 'importe');
    if (ia < 0) ia = hallar(a.enc, a.filas, reImp2, 'importe'); if (ib < 0) ib = hallar(b.enc, b.filas, reImp2, 'importe');
    if (ia < 0) ia = a.enc.findIndex((n, k) => tipoDe(a.filas, k) === 'importe'); if (ib < 0) ib = b.enc.findIndex((n, k) => tipoDe(b.filas, k) === 'importe');
    if (ia >= 0 && ib >= 0) pares.push({ a: ia, b: ib, tipo: 'importe', tol: 0.01 });
    let fa = hallar(a.enc, a.filas, reFec, 'fecha'), fb = hallar(b.enc, b.filas, reFec, 'fecha');
    if (fa < 0) fa = a.enc.findIndex((n, k) => tipoDe(a.filas, k) === 'fecha'); if (fb < 0) fb = b.enc.findIndex((n, k) => tipoDe(b.filas, k) === 'fecha');
    if (fa >= 0 && fb >= 0) pares.push({ a: fa, b: fb, tipo: 'fecha', tol: 2 });
    S.pares = pares;
  }

  /* ---------- conciliación ---------- */
  function conciliar() {
    const a = datosDe(S.A), b = datosDe(S.B);
    if (a.filas.length * b.filas.length > 4e8) { S.error = 'Los archivos son demasiado grandes para conciliar de una vez. Dividilos por mes.'; return false; }
    const conv = (p, v) => (p.tipo === 'importe' ? (S.ignorarSigno ? Math.abs(num(v)) : num(v)) : p.tipo === 'fecha' ? fecha(v) : norm(v));
    const P = S.pares.map((p) => ({ ...p, va: a.filas.map((r) => conv(p, r[p.a])), vb: b.filas.map((r) => conv(p, r[p.b])) }));
    const idx = P.find((p) => p.tipo === 'importe' && p.tol <= 5); let mapa = null;
    if (idx) { mapa = new Map(); idx.vb.forEach((v, j) => { if (Number.isFinite(v)) { const k = Math.round(v * 100); (mapa.get(k) || mapa.set(k, []).get(k)).push(j); } }); }
    const comparar = (i, j) => {
      let score = 0;
      for (const p of P) {
        const x = p.va[i], y = p.vb[j];
        if (p.tipo === 'importe') { if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > p.tol + 1e-9) return -1; score += Math.abs(x - y) / (Math.abs(x) + 1); }
        else if (p.tipo === 'fecha') { if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > p.tol) return -1; score += Math.abs(x - y) * 0.01; }
        else if (p.tipo === 'texto') { if (!x || x !== y) return -1; }
        else { if (!x || !y || Math.min(x.length, y.length) < 3 || !(x.includes(y) || y.includes(x))) return -1; score += 0.005; }
      }
      return score;
    };
    const usadaB = new Set(), usadaA = new Set(), pares = [];
    for (const tope of [1e-9, Infinity]) {
      for (let i = 0; i < a.filas.length; i++) {
        if (usadaA.has(i)) continue; let mejor = -1, ms = Infinity;
        let candidatos;
        if (mapa) { const v = idx.va[i]; candidatos = []; if (Number.isFinite(v)) { const lo = Math.round((v - idx.tol) * 100), hi = Math.round((v + idx.tol) * 100); for (let k = lo; k <= hi && k - lo < 600; k++) { const l = mapa.get(k); if (l) candidatos.push(...l); } } }
        const n = candidatos ? candidatos.length : b.filas.length;
        for (let c = 0; c < n; c++) { const j = candidatos ? candidatos[c] : c; if (usadaB.has(j)) continue; const s = comparar(i, j); if (s >= 0 && s <= tope && s < ms) { ms = s; mejor = j; if (s === 0) break; } }
        if (mejor >= 0) { usadaA.add(i); usadaB.add(mejor); pares.push({ A: [i], B: [mejor], manual: false, score: ms }); }
      }
    }
    S.res = { pares }; S.rancio = false; S.error = ''; S.selA.clear(); S.selB.clear(); return true;
  }
  const pendientes = () => {
    const a = datosDe(S.A), b = datosDe(S.B), ua = new Set(S.res.pares.flatMap((p) => p.A)), ub = new Set(S.res.pares.flatMap((p) => p.B));
    return { pa: a.filas.map((_, i) => i).filter((i) => !ua.has(i)), pb: b.filas.map((_, i) => i).filter((i) => !ub.has(i)), a, b };
  };
  const colImp = () => S.pares.find((p) => p.tipo === 'importe');
  const valImp = (v) => { const x = num(v); return Number.isFinite(x) ? (S.ignorarSigno ? Math.abs(x) : x) : 0; };

  /* ---------- carga de archivos ---------- */
  async function leer(lado, file) {
    S.error = ''; if (!file) return;
    if (file.size > MAX_BYTES) { S.error = `El archivo pesa ${(file.size / 1048576).toFixed(1)} MB: el máximo es 15 MB.`; return; }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    try {
      const buf = await file.arrayBuffer(); let f;
      if (['csv', 'tsv', 'txt'].includes(ext)) {
        let texto; try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { texto = new TextDecoder('windows-1252').decode(buf); }
        f = { nombre: file.name, tam: file.size, matriz: parseCSV(texto), conEnc: true };
      } else if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
        const X = await cargarXLSX(), wb = X.read(buf, { type: 'array', cellDates: true }), hojas = {};
        wb.SheetNames.forEach((n) => { hojas[n] = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
        f = { nombre: file.name, tam: file.size, hojas, hoja: wb.SheetNames[0], matriz: hojas[wb.SheetNames[0]], conEnc: true };
      } else { S.error = 'Formato no admitido. Subí un CSV o un Excel (.xlsx, .xls).'; return; }
      if (f.matriz.length > MAX_FILAS + 1) { S.error = `El archivo tiene más de ${MAX_FILAS.toLocaleString('es-AR')} filas: dividilo por período.`; return; }
      if (!datosDe(f).filas.length) { S.error = 'El archivo no tiene filas de datos.'; return; }
      S[lado] = f; S.res = null; S.rancio = false;
    } catch (err) { S.error = err.message || 'No se pudo leer el archivo.'; }
  }

  function ejemplo() {
    const e = empresa(), f2 = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
    const libros = [...e.tes.cobrosPagos.filter((p) => p.estado === 'Confirmado').slice(0, 9).map((p) => [p.dias, `${p.tipo === 'Cobro' ? 'Cobro' : 'Pago'} ${p.tercero}`, p.tipo === 'Cobro' ? p.importe : -p.importe, p.nro]),
      ...e.tes.movs.slice(0, 8).map((m, i) => [m.dias, m.concepto, m.importe, `MOV-${100 + i}`])];
    const banco = [];
    libros.forEach((l, i) => { if (i % 6 === 5) return; const dif = i % 7 === 3 ? 0.5 : 0; banco.push([Math.max(0, l[0] - (i % 5 === 2 ? 1 : 0)), `TRANSF ${String(l[1]).toUpperCase()}`, l[2] - Math.sign(l[2]) * dif]); });
    banco.push([2, 'COMISION MANTENIMIENTO DE CUENTA', -3200], [2, 'IMPUESTO LEY 25413 DEBITO', -1450], [1, 'INTERESES DESCUBIERTO', -870]);
    const fmtNum = (n) => n.toFixed(2).replace('.', ',');
    const csvA = ['Fecha;Descripción;Importe', ...banco.map((r) => `${f2(r[0])};${r[1]};${fmtNum(r[2])}`)].join('\n'), csvB = ['Fecha;Concepto;Importe;Comprobante', ...libros.map((r) => `${f2(r[0])};${r[1]};${fmtNum(r[2])};${r[3]}`)].join('\n');
    S.A = { nombre: 'extracto_banco_ejemplo.csv', tam: csvA.length, matriz: parseCSV(csvA), conEnc: true }; S.B = { nombre: 'libro_banco_ejemplo.csv', tam: csvB.length, matriz: parseCSV(csvB), conEnc: true };
    S.res = null; S.error = '';
  }

  /* ---------- vista ---------- */
  function vista(cuerpo, e, cabecera, cambiarModo) {
    const pintar = () => {
      const a = S.A && datosDe(S.A), b = S.B && datosDe(S.B), listo = a && b;
      const zona = (lado, f, d) => `<div class="drop ${f ? 'lleno' : ''}" data-drop="${lado}">${f ? `
          <div class="drop-h"><span class="avatar t${lado === 'A' ? 0 : 1}">${lado}</span><span class="t"><b>${esc(f.nombre)}</b><small>${d.filas.length.toLocaleString('es-AR')} filas · ${d.enc.length} columnas · ${(f.tam / 1024).toFixed(0)} KB</small></span><button class="icon-btn" data-quitar="${lado}" aria-label="Quitar el archivo ${lado}" style="width:32px;height:32px">${ic('x')}</button></div>
          <div class="drop-o">${f.hojas ? `<label>Hoja <select class="in" data-hoja="${lado}">${Object.keys(f.hojas).map((h) => `<option ${h === f.hoja ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>` : ''}<label class="chk"><input type="checkbox" data-enc="${lado}" ${f.conEnc ? 'checked' : ''}> La primera fila son los encabezados</label></div>`
        : `<label class="drop-v" for="arch${lado}">${ic('download')}<b>Archivo ${lado}</b><span>Arrastrá un CSV o Excel acá, o hacé clic para elegirlo</span></label>`}<input type="file" id="arch${lado}" data-file="${lado}" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods" hidden></div>`;
      const colsCard = (lado, f, d) => `<article class="card s6 rise" style="--d:${lado === 'A' ? 2 : 3}"><h3><span class="avatar t${lado === 'A' ? 0 : 1}" style="width:22px;height:22px;font-size:11px">${lado}</span> Columnas del archivo ${lado}</h3>
        ${f ? `<div class="mini cols-l">${d.enc.map((n, i) => `<div><b>${esc(n)}</b><span class="pill mute">${ROTULO[tipoDe(d.filas, i)]}</span><span class="mudo ej">${esc(String(d.filas[0] && d.filas[0][i] != null ? (d.filas[0][i] instanceof Date ? d.filas[0][i].toLocaleDateString('es-AR') : d.filas[0][i]) : '')).slice(0, 28)}</span></div>`).join('')}</div>` : '<p class="mudo" style="margin:8px 0 0">Subí el archivo para ver sus columnas.</p>'}</article>`;
      const sel = (lado, d, val) => `<select class="in" data-par-col="${lado}" aria-label="Columna del archivo ${lado}">${d.enc.map((n, i) => `<option value="${i}" ${i === val ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      const paresHtml = listo ? `<div class="pares">${S.pares.map((p, i) => `<div class="par" data-i="${i}">${sel('a', a, p.a).replace('data-par-col="a"', `data-par-col="a" data-i="${i}"`)}<span class="eq">${ic('arrow')}</span>${sel('b', b, p.b).replace('data-par-col="b"', `data-par-col="b" data-i="${i}"`)}
          <select class="in" data-par-tipo="${i}" aria-label="Cómo se compara">${TIPOS_PAR.map(([k, t]) => `<option value="${k}" ${k === p.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
          ${p.tipo === 'importe' || p.tipo === 'fecha' ? `<label class="tol">±<input class="in" type="number" min="0" step="${p.tipo === 'importe' ? '0.01' : '1'}" value="${p.tol}" data-par-tol="${i}" aria-label="Tolerancia"> ${p.tipo === 'importe' ? '$' : 'días'}</label>` : '<span></span>'}
          <button class="x" data-par-x="${i}" aria-label="Quitar este criterio">${ic('trash')}</button></div>`).join('') || '<p class="mudo" style="margin:0">Agregá al menos un criterio de comparación.</p>'}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px"><button class="btn sm" data-par-add>${ic('plus')} Agregar criterio</button><label class="chk"><input type="checkbox" data-signo ${S.ignorarSigno ? 'checked' : ''}> Ignorar el signo del importe (débito/crédito)</label></div>` : '<p class="mudo" style="margin:8px 0 0">Primero subí los dos archivos.</p>';
      cuerpo.innerHTML = `${cabecera}
        ${S.error ? `<div class="chequeo no rise">${ic('alert')}<span>${esc(S.error)}</span></div>` : ''}${S.cargando ? `<div class="chequeo ok rise">${ic('bolt')}<span>${esc(S.cargando)}</span></div>` : ''}
        <div class="grid">
          <article class="card s12 rise" style="--d:1"><h3>${ic('receipt')} 1 · Archivos</h3><div class="dosc">${zona('A', S.A, a)}${zona('B', S.B, b)}</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button class="btn sm" data-ejemplo>Probar con archivos de ejemplo</button><span class="mudo" style="font-size:12.5px">${ic('lock')} Los archivos se leen en tu navegador: no se suben ni se guardan.</span></div></article>
          ${colsCard('A', S.A, a)}${colsCard('B', S.B, b)}
          <article class="card s12 rise" style="--d:4"><h3>${ic('bolt')} 2 · Qué comparar</h3>${paresHtml}
            ${listo ? `<div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap"><button class="btn primary" data-conciliar ${S.pares.length ? '' : 'disabled'}>${S.res ? 'Conciliar de nuevo' : 'Conciliar'}</button>${S.rancio ? '<span class="pill warn"><i></i>Cambiaste los criterios: conciliá de nuevo</span>' : ''}${S.res && S.res.pares.some((p) => p.manual) ? '<span class="mudo" style="font-size:12.5px">Conciliar de nuevo descarta las conciliaciones manuales.</span>' : ''}</div>` : ''}</article>
          ${S.res ? '<div class="s12" id="resultado" style="grid-column:span 12"></div>' : ''}
        </div>`;
      if (S.res) pintarResultado($('#resultado', cuerpo));
      engancharArrastre();
    };

    function pintarResultado(el) {
      const { pa, pb, a, b } = pendientes(), r = S.res, ci = colImp();
      const nA = a.filas.length, nB = b.filas.length, cA = new Set(r.pares.flatMap((p) => p.A)).size, cB = new Set(r.pares.flatMap((p) => p.B)).size;
      const sumA = (idx) => idx.reduce((s, i) => s + (ci ? valImp(a.filas[i][ci.a]) : 0), 0), sumB = (idx) => idx.reduce((s, i) => s + (ci ? valImp(b.filas[i][ci.b]) : 0), 0);
      const todosA = a.filas.map((_, i) => i), todosB = b.filas.map((_, i) => i), tA = sumA(todosA), tB = sumB(todosB), pA = sumA(pa), pB = sumB(pb), mA = tA - pA, mB = tB - pB;
      const pct = (x, y) => (y ? Math.round((x / y) * 1000) / 10 : 0), fp = (n) => String(n).replace('.', ',') + ' %';
      const fila = (lado, n, c, pend, tot, mat, pendImp) => `<tr><th scope="row"><span class="avatar t${lado === 'A' ? 0 : 1}" style="width:22px;height:22px;font-size:11px;display:inline-grid;vertical-align:middle;margin-right:8px">${lado}</span>${esc((lado === 'A' ? S.A : S.B).nombre)}</th><td class="num r">${n.toLocaleString('es-AR')}</td><td class="num r">${c.toLocaleString('es-AR')}</td><td class="num r ${pend ? 'mal' : ''}">${pend.toLocaleString('es-AR')}</td>
        <td><span class="nivel"><b class="num">${fp(pct(c, n))}</b><span class="barra-m ${pct(c, n) < 70 ? 'warn' : ''}"><i style="width:${pct(c, n)}%"></i></span></span></td>${ci ? `<td class="num r">${pe(tot)}</td><td class="num r">${pe(mat)}</td><td class="num r ${pendImp ? 'mal' : ''}">${pe(pendImp)}</td><td class="num r"><b>${fp(pct(Math.abs(mat), Math.abs(tot)))}</b></td>` : ''}</tr>`;
      const dif = Math.round((tA - tB) * 100) / 100, porPend = Math.round((pA - pB) * 100) / 100, porTol = Math.round((mA - mB) * 100) / 100;
      const filasConc = r.pares.slice().sort((x, y) => x.A[0] - y.A[0]);
      el.innerHTML = `
        <article class="card rise" style="--d:5"><h3>${ic('check')} 3 · Planilla de conciliación</h3>
          <div class="tb-scroll"><table class="lineas planilla"><thead><tr><th>Archivo</th><th class="r">Filas</th><th class="r">Conciliadas</th><th class="r">Pendientes</th><th>% conciliación</th>${ci ? '<th class="r">Importe total</th><th class="r">Conciliado</th><th class="r">Pendiente</th><th class="r">% del importe</th>' : ''}</tr></thead>
            <tbody>${fila('A', nA, cA, pa.length, tA, mA, pA)}${fila('B', nB, cB, pb.length, tB, mB, pB)}</tbody></table></div>
          ${ci ? `<div class="chequeo ${Math.abs(dif - porPend - porTol) < 0.005 ? 'ok' : 'no'}" style="margin:14px 0 0">${ic('check')}<span>Diferencia entre archivos ${pe(dif)} = pendientes ${pe(porPend)} + diferencias dentro de la tolerancia ${pe(porTol)}. No explicada: ${pe(Math.round((dif - porPend - porTol) * 100) / 100)}.</span></div>` : ''}
          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap"><button class="btn sm" data-export>${ic('download')} Descargar el resultado (CSV)</button></div></article>
        <div class="seg rise" role="group" aria-label="Lista" style="margin:16px 0 12px"><button data-vista="conciliado" aria-pressed="${S.vista === 'conciliado'}">Conciliado (${r.pares.length})</button><button data-vista="pendiente" aria-pressed="${S.vista === 'pendiente'}">Pendiente de conciliar (${pa.length + pb.length})</button></div>
        <div id="lista"></div>`;
      const lista = $('#lista', el);
      const fv = (tipo, v) => (tipo === 'importe' ? (Number.isFinite(num(v)) ? pe(num(v)) : esc(v)) : tipo === 'fecha' ? (Number.isFinite(fecha(v)) ? fmtFecha(fecha(v)) : esc(v)) : esc(String(v == null ? '' : v)));
      if (S.vista === 'conciliado') {
        lista.innerHTML = `<div class="card tb rise" id="tbC"></div>`;
        const cols = [{ t: '#', w: '50px', f: (p) => `<span class="num mudo">${filasConc.indexOf(p) + 1}</span>` }];
        S.pares.forEach((p) => { cols.push({ t: `${esc(a.enc[p.a])} (A)`, w: 'minmax(0,1fr)', f: (g) => (g.A.length > 1 ? `<span class="mudo">${g.A.length} filas</span>` : fv(p.tipo, a.filas[g.A[0]][p.a])) }); cols.push({ t: `${esc(b.enc[p.b])} (B)`, w: 'minmax(0,1fr)', sec: true, f: (g) => (g.B.length > 1 ? `<span class="mudo">${g.B.length} filas</span>` : fv(p.tipo, b.filas[g.B[0]][p.b])) }); });
        cols.push({ t: 'Diferencia', w: '110px', r: true, f: (g) => { if (!ci) return ''; const d = Math.round((g.A.reduce((s, i) => s + valImp(a.filas[i][ci.a]), 0) - g.B.reduce((s, i) => s + valImp(b.filas[i][ci.b]), 0)) * 100) / 100; return `<span class="num ${d ? 'mal' : 'mudo'}">${d ? pe(d) : '—'}</span>`; } }, { t: 'Cómo', w: '100px', sec: true, f: (g) => (g.manual ? pill('Manual') : pill('Automático')) });
        tabla($('#tbC', lista), cols, filasConc.slice(0, S.max), (g) => detallePar(g, a, b), 'Todavía no se conciliaron filas.');
        if (filasConc.length > S.max) lista.insertAdjacentHTML('beforeend', `<button class="btn mas" data-mas>Ver más · quedan ${filasConc.length - S.max}</button>`);
      } else {
        const ver = (lado, d, idxs, sel) => {
          const orden = [...new Set([...S.pares.map((p) => (lado === 'A' ? p.a : p.b)), ...d.enc.map((_, i) => i)])].slice(0, 5);
          return { orden, html: `<article class="card s6 rise"><h3><span class="avatar t${lado === 'A' ? 0 : 1}" style="width:22px;height:22px;font-size:11px">${lado}</span> Pendiente en ${lado} <span class="pill ${idxs.length ? 'warn' : ''}"><i></i>${idxs.length}</span></h3><div class="tb" id="tb${lado}" style="margin-top:8px"></div></article>` };
        };
        const vA = ver('A', a, pa), vB = ver('B', b, pb);
        lista.innerHTML = `<div class="grid">${vA.html}${vB.html}</div>
          <div class="barra rise" style="--d:2"><div class="tot"><small id="selInfo">Elegí filas de los dos lados para conciliarlas a mano</small><b class="num" id="selDif"></b></div><button class="btn primary" data-manual disabled>Conciliar selección</button></div>`;
        const colsDe = (lado, d, orden) => orden.map((c, k) => ({ t: esc(d.enc[c]), w: k === 0 ? 'minmax(0,1.2fr)' : 'minmax(0,1fr)', sec: k > 1, f: (i) => { const par = S.pares.find((p) => (lado === 'A' ? p.a : p.b) === c); const v = (lado === 'A' ? a : b).filas[i][c]; return par ? fv(par.tipo, v) : esc(String(v == null ? '' : v instanceof Date ? v.toLocaleDateString('es-AR') : v).slice(0, 40)); } }));
        const dibujar = (lado, d, idxs, orden, set) => { const el2 = $('#tb' + lado, lista); tabla(el2, colsDe(lado, d, orden), idxs.slice(0, S.max), (i) => { set.has(i) ? set.delete(i) : set.add(i); marcar(); }, '¡Nada pendiente de este lado!'); el2._idx = idxs.slice(0, S.max); };
        const marcar = () => {
          [['A', S.selA], ['B', S.selB]].forEach(([lado, set]) => { const el2 = $('#tb' + lado, lista); $$('.tb-f[data-i]', el2).forEach((bt) => bt.setAttribute('aria-pressed', set.has(el2._idx[Number(bt.dataset.i)]))); });
          const sa = [...S.selA].reduce((s, i) => s + (ci ? valImp(a.filas[i][ci.a]) : 0), 0), sb = [...S.selB].reduce((s, i) => s + (ci ? valImp(b.filas[i][ci.b]) : 0), 0), dif2 = Math.round((sa - sb) * 100) / 100;
          const ambos = S.selA.size && S.selB.size, okMonto = !ci || Math.abs(dif2) <= ci.tol + 1e-9;
          $('#selInfo', lista).textContent = !ambos ? `Seleccionadas: ${S.selA.size} de A · ${S.selB.size} de B` : okMonto ? `${S.selA.size} de A y ${S.selB.size} de B: los importes coinciden` : `Los importes no coinciden: diferencia ${pe(Math.abs(dif2))}`;
          $('#selDif', lista).textContent = ci ? pe(Math.abs(dif2)) : ''; $('[data-manual]', lista).disabled = !(ambos && okMonto);
        };
        dibujar('A', a, pa, vA.orden, S.selA); dibujar('B', b, pb, vB.orden, S.selB); marcar();
        if (pa.length > S.max || pb.length > S.max) lista.insertAdjacentHTML('beforeend', `<button class="btn mas" data-mas>Ver más filas</button>`);
      }
    }

    function detallePar(g, a, b) {
      const tabla2 = (lado, d, idxs) => `<div class="tb-scroll"><table class="lineas"><thead><tr>${d.enc.map((n) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${idxs.map((i) => `<tr>${d.enc.map((_, c) => `<td>${esc(String((lado === 'A' ? a : b).filas[i][c] instanceof Date ? (lado === 'A' ? a : b).filas[i][c].toLocaleDateString('es-AR') : (lado === 'A' ? a : b).filas[i][c] == null ? '' : (lado === 'A' ? a : b).filas[i][c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      dialogo(`<header class="det-h"><div><small>Conciliación ${g.manual ? 'manual' : 'automática'}</small><h4>${g.A.length} fila${g.A.length === 1 ? '' : 's'} de A ↔ ${g.B.length} de B</h4></div>${g.manual ? pill('Manual') : pill('Automático')}${cierra}</header>
        <h5 class="sub-h" style="margin:0">Archivo A · ${esc(S.A.nombre)}</h5>${tabla2('A', a, g.A)}<h5 class="sub-h" style="margin:0">Archivo B · ${esc(S.B.nombre)}</h5>${tabla2('B', b, g.B)}
        <footer class="det-f"><button class="btn" id="ptDes">Deshacer conciliación</button><button class="btn" data-cerrar>Cerrar</button></footer>`);
      $('#ptDes', $('#detalle')).addEventListener('click', () => { S.res.pares = S.res.pares.filter((p) => p !== g); registrar('tesoreria', 'Deshizo una conciliación entre archivos', `${S.A.nombre} ↔ ${S.B.nombre} · ${g.A.length} y ${g.B.length} filas vuelven a pendientes`); $('#detalle').close(); toast('Conciliación deshecha: las filas vuelven a pendientes'); pintar(); });
    }

    const csv = () => {
      const { pa, pb, a, b } = pendientes(), q = (v) => { let s = String(v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : v); if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s.replace(',', '.')))) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const ca = a.enc.length, cb = b.enc.length, vacioA = Array(ca).fill(''), vacioB = Array(cb).fill('');
      const filas = [['Estado', 'Grupo', ...a.enc.map((n) => 'A · ' + n), ...b.enc.map((n) => 'B · ' + n)]];
      S.res.pares.slice().sort((x, y) => x.A[0] - y.A[0]).forEach((g, k) => { for (let t = 0; t < Math.max(g.A.length, g.B.length); t++) filas.push([g.manual ? 'Conciliado (manual)' : 'Conciliado', k + 1, ...(g.A[t] != null ? a.filas[g.A[t]].concat(vacioA).slice(0, ca) : vacioA), ...(g.B[t] != null ? b.filas[g.B[t]].concat(vacioB).slice(0, cb) : vacioB)]); });
      pa.forEach((i) => filas.push(['Pendiente en A', '', ...a.filas[i].concat(vacioA).slice(0, ca), ...vacioB])); pb.forEach((j) => filas.push(['Pendiente en B', '', ...vacioA, ...b.filas[j].concat(vacioB).slice(0, cb)]));
      const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob(['﻿' + filas.map((l) => l.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); el.download = 'conciliacion-' + new Date().toISOString().slice(0, 10) + '.csv'; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 1000);
      registrar('seguridad', 'Descargó el resultado de una conciliación entre archivos', `${filas.length - 1} filas · ${S.A.nombre} ↔ ${S.B.nombre}`); toast(`${filas.length - 1} filas descargadas`);
    };

    const correr = (aviso) => {
      if (!conciliar()) { pintar(); return; }
      const { pa, pb, a, b } = pendientes(), cA = a.filas.length - pa.length, cB = b.filas.length - pb.length, pc = (x, y) => (y ? Math.round((x / y) * 1000) / 10 : 0);
      registrar('tesoreria', 'Concilió dos archivos', `${S.A.nombre} (${pc(cA, a.filas.length)} %) ↔ ${S.B.nombre} (${pc(cB, b.filas.length)} %) · ${S.res.pares.length} coincidencias`);
      if (aviso !== false) toast(`Conciliado: ${pc(cA, a.filas.length)} % de A y ${pc(cB, b.filas.length)} % de B`); pintar();
    };
    const tras = () => { if (S.A && S.B && !S.pares.length) sugerirPares(); if (S.A && S.B && S.pares.length && !S.res) { correr(false); return; } pintar(); };
    const aplicar = async (lado, file) => { S.cargando = 'Leyendo ' + file.name + '…'; pintar(); await leer(lado, file); S.cargando = ''; if (S[lado]) S.pares = lado === 'A' || lado === 'B' ? [] : S.pares; tras(); };

    function engancharArrastre() {
      $$('[data-drop]', cuerpo).forEach((z) => {
        z.addEventListener('dragover', (ev) => { ev.preventDefault(); z.classList.add('sobre'); }); z.addEventListener('dragleave', () => z.classList.remove('sobre'));
        z.addEventListener('drop', (ev) => { ev.preventDefault(); z.classList.remove('sobre'); const f = ev.dataTransfer.files[0]; if (f) aplicar(z.dataset.drop, f); });
      });
    }
    cuerpo.onchange = (ev) => {
      const t = ev.target;
      if (t.dataset.file) { aplicar(t.dataset.file, t.files[0]); return; }
      if (t.dataset.hoja) { const f = S[t.dataset.hoja]; f.hoja = t.value; f.matriz = f.hojas[t.value]; S.pares = []; S.res = null; tras(); return; }
      if (t.dataset.enc) { S[t.dataset.enc].conEnc = t.checked; S.pares = []; S.res = null; tras(); return; }
      if (t.dataset.parCol) { S.pares[Number(t.dataset.i)][t.dataset.parCol] = Number(t.value); S.rancio = !!S.res; pintar(); return; }
      if (t.dataset.parTipo) { const p = S.pares[Number(t.dataset.parTipo)]; p.tipo = t.value; p.tol = t.value === 'importe' ? 0.01 : t.value === 'fecha' ? 2 : 0; S.rancio = !!S.res; pintar(); return; }
      if (t.dataset.parTol != null && t.dataset.parTol !== '') { S.pares[Number(t.dataset.parTol)].tol = Math.max(0, Number(t.value) || 0); S.rancio = !!S.res; pintar(); return; }
      if (t.hasAttribute('data-signo')) { S.ignorarSigno = t.checked; S.rancio = !!S.res; pintar(); }
    };
    cuerpo.onclick = (ev) => {
      const t = ev.target, mo = t.closest('[data-modo]'); if (mo) { cambiarModo(mo.dataset.modo); return; }
      const q = t.closest('[data-quitar]'); if (q) { S[q.dataset.quitar] = null; S.res = null; S.pares = []; pintar(); return; }
      if (t.closest('[data-ejemplo]')) { ejemplo(); S.pares = []; tras(); toast('Archivos de ejemplo cargados'); return; }
      if (t.closest('[data-par-add]')) { const a = datosDe(S.A), b = datosDe(S.B); S.pares.push({ a: 0, b: 0, tipo: 'texto', tol: 0 }); S.rancio = !!S.res; pintar(); return; }
      const x = t.closest('[data-par-x]'); if (x) { S.pares.splice(Number(x.dataset.parX), 1); S.rancio = !!S.res; pintar(); return; }
      if (t.closest('[data-conciliar]')) { correr(); return; }
      if (t.closest('[data-export]')) { csv(); return; }
      const v = t.closest('[data-vista]'); if (v) { S.vista = v.dataset.vista; S.selA.clear(); S.selB.clear(); pintar(); return; }
      if (t.closest('[data-mas]')) { S.max += 100; pintar(); return; }
      if (t.closest('[data-manual]')) {
        const g = { A: [...S.selA], B: [...S.selB], manual: true, score: 0 }; S.res.pares.push(g); S.selA.clear(); S.selB.clear();
        registrar('tesoreria', 'Concilió a mano filas de dos archivos', `${S.A.nombre} ↔ ${S.B.nombre} · ${g.A.length} de A y ${g.B.length} de B`); toast('Filas conciliadas a mano'); pintar();
      }
    };
    pintar();
  }

  return { vista };
};
