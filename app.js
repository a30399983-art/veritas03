const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TK = 'veritas_token';
const ICO = { medicina: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.7A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/></svg>', derecho: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 3v18M5 21h14M4 7h16M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/></svg>', ingenieria: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 17 17 3l4 4L7 21H3zM13 7l4 4M6 14l4 4"/></svg>', negocios: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 20h18M6 16v-5M11 16V8M16 16v-8M4 9l5-4 4 3 7-5"/></svg>' };
const CATS = { medicina: ['Medicina', 'Atención y orientación médica con profesionales colegiados.'], derecho: ['Derecho', 'Asesoría legal clara para personas y empresas.'], ingenieria: ['Ingeniería', 'Criterio técnico para obras, diseño y proyectos.'], negocios: ['Negocios', 'Trámites, finanzas y estrategia para tu emprendimiento.'] };
const ST = { d: ['Disponible', ''], ec: ['En consulta', 'ec'], ev: ['En vivo', 'ev'] };
const SHIELD = '<svg class="vb" viewBox="0 0 24 24" fill="none" stroke="#f5b82e" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z"/><path d="m8.5 12 2.5 2.5 4.500-5"/></svg>';
let ME = null, sock = null, media = null, pcs = {}, timers = [], liveId = null, ICE = [{ urls: 'stun:stun.l.google.com:19302' }], SQ = '';
const W = { step: 0, d: {}, files: {} };

const api = async (p, o = {}) => {
  const h = { ...(o.headers || {}) }, t = localStorage.getItem(TK);
  if (t) h.Authorization = 'Bearer ' + t;
  if (o.json) { h['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.json); }
  let r; try { r = await fetch('/api' + p, { ...o, headers: h }); } catch { throw new Error('Sin conexión con el servidor'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ocurrió un error');
  return d;
};
const toast = (t) => { const e = $('#ts'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 3000); };
const fail = (e) => toast(e.message || 'Ocurrió un error');
const go = (h) => { location.hash === '#' + h ? render() : (location.hash = h); };
const ini = (n) => n.replace(/^(Dra?\.|Ing\.|Mg\.|CPC)\s/, '').split(' ').slice(0, 2).map((w) => w[0]).join('');
const money = (n) => 'S/ ' + Number(n || 0).toFixed(2);
const getSock = () => sock || (sock = io({ auth: { token: localStorage.getItem(TK) } }));

function stopAll() {
  timers.forEach(clearInterval); timers = [];
  if (liveId) { api(`/live/${liveId}/finalizar`, { method: 'POST' }).catch(() => {}); liveId = null; }
  Object.values(pcs).forEach((p) => p.close()); pcs = {};
  if (media) { media.getTracks().forEach((t) => t.stop()); media = null; }
  if (sock) { sock.disconnect(); sock = null; }
}
async function loadMe() {
  ME = null;
  if (localStorage.getItem(TK)) try { ME = await api('/me'); } catch { localStorage.removeItem(TK); }
  $('#pn').hidden = !(ME && ME.rol === 'pro'); $('#ad').hidden = !(ME && ME.rol === 'admin');
  $('#li').hidden = !!ME; $('#rg').textContent = ME ? 'Salir' : 'Registrarse';
}

/* ---------- Vistas ---------- */
async function render() {
  stopAll(); $('#nav').classList.remove('on'); window.scrollTo(0, 0);
  const h = (location.hash || '#inicio').slice(1), a = $('#app'), v = h.match(/^vivo-(\d+)$/);
  $$('nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === h));
  try {
    if (v) { a.innerHTML = vWatch(); await bindWatch(+v[1]); }
    else if (CATS[h]) { a.innerHTML = '<div class="wrap"><p class="empty">Cargando profesionales…</p></div>'; a.innerHTML = vCat(h, await api('/profesionales?categoria=' + h)); }
    else if (h === 'buscar') a.innerHTML = vSearch(SQ, await api('/profesionales?q=' + encodeURIComponent(SQ)));
    else if (h === 'registro-profesional') { a.innerHTML = '<div class="wrap wiz" id="wz"></div>'; wizard(); }
    else if (h === 'panel') await vPanel(a);
    else if (h === 'estudio') await vStudio(a);
    else if (h === 'admin') await vAdmin(a);
    else a.innerHTML = vHome();
  } catch (e) { a.innerHTML = `<div class="wrap panel"><p class="empty">${esc(e.message)}</p></div>`; }
}
const vHome = () => `<section class="hero"><div class="wrap"><div class="logo" role="img" aria-label="Logotipo VERITAS"></div>
<h1>Asesoría profesional en vivo, con identidad verificada</h1><p>Elige tu área, encuentra al profesional disponible y entra a su transmisión o solicita una consulta privada.</p></div></section>
<div class="wrap"><div class="cats">${Object.entries(CATS).map(([k, [n, d]]) => `<button class="cat" data-go="${k}" style="background-image:var(--i-${k})">${ICO[k]}<h2>${n}</h2><p>${d}</p><span class="btn">Ver profesionales</span></button>`).join('')}</div>
<div class="trust"><div><h3>Identidad comprobada</h3><p>Teléfono, documento, rostro y título profesional se validan antes de aparecer.</p></div><div><h3>Consulta directa</h3><p>Mira la transmisión o pide una consulta privada en un clic.</p></div><div><h3>Seguro y claro</h3><p>Precios en soles y un equipo administrador que revisa cada perfil.</p></div></div>
<p style="text-align:center;padding-bottom:56px"><button class="btn gh" data-go="registro-profesional">Soy profesional y quiero registrarme</button></p></div>`;
const card = (p) => { const [sl, sc] = ST[p.estado];
  return `<article class="pro ${p.estado === 'ev' ? 'live' : ''}"><div class="ph"><div class="av" aria-hidden="true">${esc(ini(p.nombre))}</div><div><h3>${esc(p.nombre)}</h3><small>${esc(p.especialidad)}${p.promedio ? ' · ★ ' + p.promedio : ''}</small></div></div>
  <div>${SHIELD}<span class="vb">Verificado</span></div><span class="st ${sc}"><i></i>${sl}${p.estado === 'ev' ? ` · ${p.espectadores} espectadores` : ''}</span>
  <div class="acts">${p.estado === 'ev' ? `<button class="btn" data-go="vivo-${p.stream_id}">Ver transmisión</button>` : '<button class="btn gh" disabled>Ver transmisión</button>'}
  ${p.estado === 'ec' ? '<button class="btn gh" disabled>Ocupado en este momento</button>' : `<button class="btn ${p.estado === 'ev' ? 'gh' : ''}" data-consult="${p.id}" data-name="${esc(p.nombre)}">Consultar ahora</button>`}</div></article>`; };
const vCat = (k, l) => `<section class="banner" style="background-image:var(--i-${k})"><div class="wrap"><button class="crumb" data-go="inicio">← Volver al inicio</button><h1>Profesionales en ${CATS[k][0]}</h1><p>Selecciona un profesional para ver su transmisión o solicitar una consulta</p></div></section>
<div class="wrap"><div class="grid">${l.map(card).join('') || '<p class="empty">Aún no hay profesionales verificados en esta categoría.</p>'}</div></div>`;
const vSearch = (q, l) => `<div class="wrap panel"><h1>Resultados para “${esc(q)}”</h1><div class="grid">${l.map(card).join('') || '<p class="empty">No encontramos profesionales con esa búsqueda. Prueba con otra especialidad.</p>'}</div></div>`;
const chatBox = (form) => `<aside class="chat tw-chat"><h3>Chat en vivo</h3><div class="msgs" id="ms"><div class="sys">Los mensajes de la sala aparecerán aquí.</div></div>${form ? '<form id="cf"><input id="ci" placeholder="Escribe un mensaje" maxlength="200" aria-label="Mensaje"><button class="btn">Enviar</button></form>' : ''}</aside>`;
function addMsg(m) { const box = $('#ms'); if (!box) return; const d = document.createElement('div');
  if (m.sys) { d.className = 'sys'; d.textContent = m.text; } else { d.innerHTML = `<b class="${m.pro ? 'pro' : ''}">${esc(m.user)}${m.pro ? ' ✔' : ''}:</b> `; d.append(document.createTextNode(m.text)); }
  box.append(d); box.scrollTop = box.scrollHeight; }

/* ---------- Espectador ---------- */
const vWatch = () => `<div class="tw"><div class="tw-main"><div class="tw-video"><video id="rv" autoplay playsinline controls></video><div class="tw-over"><span class="tag">EN VIVO</span><span class="cnt" id="vc">0 espectadores</span></div><div class="tw-wait" id="wt">Conectando con la transmisión…</div></div>
<div class="tw-info" id="inf"></div></div>${chatBox(true)}</div>`;
async function bindWatch(id) {
  const s = await api('/streams/' + id); if (!s.activo) { $('#wt').textContent = 'Esta transmisión ya terminó.'; return; }
  $('#inf').innerHTML = `<h1>${esc(s.titulo)}</h1><div class="ph"><div class="av" style="width:48px;height:48px;font-size:19px">${esc(ini(s.nombre))}</div><div><b>${esc(s.nombre)}</b> ${SHIELD}<small>${esc(s.especialidad)}</small></div></div>
  <div class="row" style="margin:0"><button class="btn" data-apoyo="${id}">Apoyar</button><button class="btn gh" data-consult="${s.pro_id}" data-name="${esc(s.nombre)}">Solicitar consulta privada</button><button class="btn gh" data-prof="${esc(s.nombre)}|${esc(s.especialidad)}">Ver perfil</button><button class="btn gh" data-rate="${s.pro_id}">Calificar atención</button></div>`;
  try { ICE = (await api('/config')).ice; } catch {}
  const so = getSock(), emit = () => so.emit('live:watch', { streamId: id });
  so.on('connect', emit); if (so.connected) emit();
  so.on('viewers', (n) => { $('#vc').textContent = n + ' espectadores'; });
  so.on('chat', addMsg);
  so.on('live:ended', () => { $('#wt').style.display = 'grid'; $('#wt').textContent = 'La transmisión ha finalizado.'; });
  so.on('rtc:offer', async ({ from, data }) => {
    const pc = new RTCPeerConnection({ iceServers: ICE }); pcs[from] = pc;
    pc.ontrack = (e) => { $('#rv').srcObject = e.streams[0]; $('#wt').style.display = 'none'; };
    pc.onicecandidate = (e) => e.candidate && so.emit('rtc:ice', { to: from, data: e.candidate });
    await pc.setRemoteDescription(data); const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); so.emit('rtc:answer', { to: from, data: pc.localDescription });
  });
  so.on('rtc:ice', ({ from, data }) => pcs[from] && pcs[from].addIceCandidate(data).catch(() => {}));
  $('#cf').onsubmit = (e) => { e.preventDefault(); if (!ME) return auth('in'); const t = $('#ci').value.trim(); if (t) { so.emit('chat', { streamId: id, text: t }); $('#ci').value = ''; } };
}

/* ---------- Estudio del profesional (estilo Twitch/Kick) ---------- */
async function vStudio(a) {
  if (!ME || ME.rol !== 'pro') { a.innerHTML = '<div class="wrap panel"><p class="empty">Inicia sesión como profesional.</p></div>'; return; }
  if (!ME.perfil || ME.perfil.estado !== 'aprobado') { go('panel'); return; }
  a.innerHTML = `<div class="tw"><div class="tw-main"><div class="tw-video"><video id="pv" muted autoplay playsinline></video><div class="tw-over"><span class="tag" id="tg" style="visibility:hidden">EN VIVO</span><span class="cnt"><span id="tm">00:00</span> · <span id="sv">0</span> espectadores</span></div></div>
  <div class="tw-info"><input id="ti" class="ti" maxlength="90" placeholder="Título de tu transmisión" aria-label="Título" style="background:var(--sf2);border:1px solid var(--ln);border-radius:10px;padding:11px 12px">
  <div class="sel" style="margin:0"><select id="sc1" aria-label="Cámara"><option value="">Cámara predeterminada</option></select><select id="sm" aria-label="Micrófono"><option value="">Micrófono predeterminado</option></select></div>
  <div class="row" style="margin:0"><button class="btn gn" id="go">🟢 INICIAR TRANSMISIÓN</button><button class="btn rd" id="en" disabled>🔴 FINALIZAR TRANSMISIÓN</button><button class="btn gh" data-go="panel">Volver al panel</button></div>
  <div class="stats"><span>Espectadores: <b id="sv2">0</b></span><span>Ganancias de esta transmisión: <b id="ge">S/ 0.00</b></span></div></div></div>${chatBox(true)}</div>`;
  const openMedia = async () => {
    try {
      if (media) media.getTracks().forEach((t) => t.stop());
      const c = $('#sc1').value, m = $('#sm').value;
      media = await navigator.mediaDevices.getUserMedia({ video: c ? { deviceId: { exact: c } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: m ? { deviceId: { exact: m } } : true });
      $('#pv').srcObject = media;
      Object.values(pcs).forEach((pc) => pc.getSenders().forEach((s) => { const t = media.getTracks().find((x) => s.track && x.kind === s.track.kind); if (t) s.replaceTrack(t); }));
      if ($('#sc1').options.length < 2) (await navigator.mediaDevices.enumerateDevices()).forEach((d) => { if (d.kind === 'videoinput') $('#sc1').add(new Option(d.label || 'Cámara', d.deviceId)); if (d.kind === 'audioinput') $('#sm').add(new Option(d.label || 'Micrófono', d.deviceId)); });
    } catch { toast('Permite el acceso a la cámara y al micrófono para transmitir'); }
  };
  await openMedia(); $('#sc1').onchange = $('#sm').onchange = openMedia;
  $('#cf').onsubmit = (e) => { e.preventDefault(); const t = $('#ci').value.trim(); if (t && liveId) { sock.emit('chat', { streamId: liveId, text: t }); $('#ci').value = ''; } };
  $('#go').onclick = async () => {
    if (!media) return openMedia();
    try { liveId = (await api('/live/iniciar', { method: 'POST', json: { titulo: $('#ti').value.trim() } })).id; } catch (e) { return fail(e); }
    try { ICE = (await api('/config')).ice; } catch {}
    const so = getSock(); const host = () => so.emit('live:host', { streamId: liveId }); so.on('connect', host); if (so.connected) host();
    so.on('chat', addMsg); so.on('viewers', (n) => { $('#sv').textContent = $('#sv2').textContent = n; });
    so.on('ganancia', (g) => { $('#ge').textContent = money(g.total); toast('Nueva ganancia: ' + money(g.neto)); });
    so.on('viewer:joined', async ({ id }) => {
      const pc = new RTCPeerConnection({ iceServers: ICE }); pcs[id] = pc;
      media.getTracks().forEach((t) => pc.addTrack(t, media));
      pc.onicecandidate = (e) => e.candidate && so.emit('rtc:ice', { to: id, data: e.candidate });
      pc.onconnectionstatechange = () => { if (['closed', 'failed'].includes(pc.connectionState)) delete pcs[id]; };
      const o = await pc.createOffer(); await pc.setLocalDescription(o); so.emit('rtc:offer', { to: id, data: pc.localDescription });
    });
    so.on('rtc:answer', ({ from, data }) => pcs[from] && pcs[from].setRemoteDescription(data));
    so.on('rtc:ice', ({ from, data }) => pcs[from] && pcs[from].addIceCandidate(data).catch(() => {}));
    $('#go').disabled = true; $('#en').disabled = false; $('#tg').style.visibility = 'visible'; $('#ti').disabled = true;
    const t0 = Date.now(); timers.push(setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('#tm').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000));
  };
  $('#en').onclick = () => { const id = liveId; liveId = null; api(`/live/${id}/finalizar`, { method: 'POST' }).catch(() => {}); toast('Transmisión finalizada'); go('panel'); };
}

/* ---------- Panel del profesional con ganancias ---------- */
async function vPanel(a) {
  if (!ME || ME.rol !== 'pro') { a.innerHTML = '<div class="wrap panel"><h1>Panel del profesional</h1><p class="sub">Regístrate como profesional para verificar tu identidad y transmitir.</p><button class="btn" data-go="registro-profesional">Registrarme como profesional</button></div>'; return; }
  const p = ME.perfil || {}, head = `<h1>Hola, ${esc(ME.nombre)}</h1>`;
  if (p.estado === 'pendiente') { a.innerHTML = `<div class="wrap panel">${head}<div class="lock">⏳ Tu solicitud está en revisión. Un administrador está comparando tu documento, tu título y tu verificación facial. Te avisaremos al aprobarla; mientras tanto no puedes transmitir.</div></div>`; return; }
  if (p.estado !== 'aprobado') { a.innerHTML = `<div class="wrap panel">${head}<div class="lock">Tu perfil no fue aprobado${p.estado === 'bloqueado' ? ' y está bloqueado' : ''}. Motivo: ${esc(p.motivo || 'no indicado')}. Escríbenos a soporte si crees que es un error.</div></div>`; return; }
  const [g, cons] = await Promise.all([api('/pro/ganancias'), api('/pro/consultas')]);
  a.innerHTML = `<div class="wrap panel">${head}<div class="badge on">✅ Verificado</div>
  <div class="row" style="margin:0 0 24px"><button class="btn" data-go="estudio">📹 Transmisión en vivo</button></div>
  <h2 style="font-size:32px;margin-bottom:14px">Panel de ganancias</h2>
  <div class="money"><div><small>Hoy</small><b>${money(g.hoy.neto)}</b></div><div><small>Este mes</small><b>${money(g.mes.neto)}</b></div><div><small>Total recibido</small><b>${money(g.total.neto)}</b><small>Bruto ${money(g.total.bruto)} · Comisión ${money(g.total.comision)}</small></div></div>
  <p class="hint" style="margin-bottom:12px">Publicidad: 70% para ti y 30% para la plataforma. Servicios y apoyos: comisión de ${g.comision_pct}%. Montos en soles.</p>
  <h3 style="font-size:24px;margin-bottom:10px">Consultas</h3><div class="tbl"><table><tbody>${cons.map((c) => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.estado === 'en_curso' ? 'En curso' : 'Pendiente')}</td><td>${c.estado === 'pendiente' ? `<button class="btn gh" data-ca="aceptar/${c.id}">Aceptar</button> <button class="btn gh" data-ca="rechazar/${c.id}">Rechazar</button>` : `<button class="btn gh" data-ca="finalizar/${c.id}">Finalizar</button>`}</td></tr>`).join('') || '<tr><td>No tienes consultas pendientes.</td></tr>'}</tbody></table></div>
  <h3 style="font-size:24px;margin-bottom:10px">Transmisiones</h3><div class="tbl"><table><thead><tr><th>Título</th><th>Fecha</th><th>Pico</th><th>Ganancia</th></tr></thead><tbody>${g.streams.map((s) => `<tr><td>${esc(s.titulo)}</td><td>${esc(s.inicio.slice(0, 16))}</td><td>${s.pico}</td><td>${money(s.neto)}</td></tr>`).join('') || '<tr><td colspan="4">Aún no has transmitido.</td></tr>'}</tbody></table></div>
  <h3 style="font-size:24px;margin-bottom:10px">Movimientos</h3><div class="tbl"><table><thead><tr><th>Tipo</th><th>Bruto</th><th>Comisión</th><th>Recibes</th></tr></thead><tbody>${g.historial.map((h) => `<tr><td>${esc(h.tipo)}</td><td>${money(h.bruto)}</td><td>${money(h.comision)}</td><td>${money(h.neto)}</td></tr>`).join('') || '<tr><td colspan="4">Sin movimientos todavía.</td></tr>'}</tbody></table></div></div>`;
}

/* ---------- Registro de profesional con verificación biométrica ---------- */
const STEPS = ['Datos', 'Teléfono', 'Documentos', 'Rostro', 'Enviar'];
function wizard() {
  const w = $('#wz'), s = W.step, d = W.d, f = (k, l, t = 'text', x = '') => `<label>${l}</label><input name="${k}" type="${t}" value="${esc(d[k] || '')}" ${x}>`;
  const body = [
    `<div class="fc">${f('nombre', 'Nombre completo', 'text', 'autocomplete="name"')}${f('email', 'Correo electrónico', 'email', 'autocomplete="email"')}</div><div class="fc">${f('password', 'Contraseña (mínimo 8 caracteres)', 'password', 'autocomplete="new-password"')}${f('doc_numero', 'Número de documento de identidad', 'text', 'inputmode="numeric"')}</div>
     <div class="fc"><div><label>Categoría</label><select name="categoria">${Object.entries(CATS).map(([k, [n]]) => `<option value="${k}" ${d.categoria === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>${f('especialidad', 'Especialidad')}</div>`,
    `${f('tel', 'Número de celular', 'tel', 'placeholder="+51 999 999 999"')}<div class="row"><button type="button" class="btn gh" id="ts1">Enviar código por SMS</button></div><div id="co" ${W.sent ? '' : 'hidden'}>${f('code', 'Código de 6 dígitos', 'text', 'inputmode="numeric" maxlength="6"')}<div class="row"><button type="button" class="btn" id="tv1">Confirmar código</button></div></div><p class="hint" id="th">${W.tel_token ? '✅ Teléfono verificado' : ''}</p>`,
    `<label>Foto de tu documento de identidad (imagen o PDF)</label><input type="file" name="documento" accept="image/*,.pdf"><p class="hint">${W.files.documento ? '✅ ' + esc(W.files.documento.name) : 'Debe verse el nombre, el número y tu foto.'}</p>
     <label>Título profesional o certificado (imagen o PDF)</label><input type="file" name="titulo" accept="image/*,.pdf"><p class="hint">${W.files.titulo ? '✅ ' + esc(W.files.titulo.name) : 'Un administrador revisará su autenticidad.'}</p>`,
    `<div class="face">${W.selfieUrl ? `<img src="${W.selfieUrl}" alt="Captura facial">` : '<video id="fv" autoplay playsinline muted></video>'}<p id="fp">${W.selfieUrl ? '✅ Rostro capturado' : 'Centra tu rostro en el óvalo'}</p></div><div class="row" style="justify-content:center">${W.selfieUrl ? '<button type="button" class="btn gh" id="fr">Repetir</button>' : '<button type="button" class="btn" id="fs">Iniciar verificación facial</button>'}</div><p class="hint" style="text-align:center">Seguirás tres indicaciones: mirar al frente, parpadear y girar la cabeza. Compararemos tu rostro con la foto de tu documento.</p>`,
    `<p>Revisa que todo esté correcto. Al enviar, un administrador verificará tu identidad y tu título. Recibirás acceso para transmitir cuando te aprueben.</p><div class="row"><button type="button" class="btn" id="fx">Enviar solicitud de verificación</button></div>`][s];
  w.innerHTML = `<h1 style="font-size:clamp(30px,5vw,46px)">Registro de profesional</h1><p class="sub">${STEPS[s]} — paso ${s + 1} de 5</p><div class="dots">${STEPS.map((_, i) => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>
  <form id="wf" novalidate>${body}</form><div class="row">${s ? '<button type="button" class="btn gh" id="wb">Atrás</button>' : ''}${s < 4 ? '<button type="button" class="btn" id="wn">Continuar</button>' : ''}</div>`;
  const save = () => $$('#wf input:not([type=file]),#wf select').forEach((i) => { d[i.name] = i.value; });
  $$('#wf input[type=file]').forEach((i) => i.onchange = () => { if (i.files[0]) { W.files[i.name] = i.files[0]; wizard(); } });
  if ($('#wb')) $('#wb').onclick = () => { save(); stopCam(); W.step--; wizard(); };
  if ($('#wn')) $('#wn').onclick = () => {
    save(); const e = s === 0 ? (!d.nombre || !/^\S+@\S+\.\S+$/.test(d.email || '') || (d.password || '').length < 8 || !/^\d{8,12}$/.test(d.doc_numero || '') || !d.especialidad ? 'Completa todos los datos. El documento debe tener entre 8 y 12 números.' : '') : s === 1 ? (W.tel_token ? '' : 'Verifica tu teléfono') : s === 2 ? (W.files.documento && W.files.titulo ? '' : 'Sube tu documento y tu título') : s === 3 ? (W.selfie ? '' : 'Completa la verificación facial') : '';
    if (e) return toast(e); stopCam(); W.step++; wizard();
  };
  if ($('#ts1')) $('#ts1').onclick = async () => { save(); try { const r = await api('/tel/enviar', { method: 'POST', json: { tel: d.tel } }); W.sent = 1; wizard(); toast(r.dev_code ? 'Código de prueba: ' + r.dev_code : 'Código enviado por SMS'); } catch (e) { fail(e); } };
  if ($('#tv1')) $('#tv1').onclick = async () => { save(); try { W.tel_token = (await api('/tel/verificar', { method: 'POST', json: { tel: d.tel, code: d.code } })).token; wizard(); } catch (e) { fail(e); } };
  if ($('#fs')) startFace(); if ($('#fr')) $('#fr').onclick = () => { W.selfie = W.selfieUrl = null; wizard(); };
  if ($('#fx')) $('#fx').onclick = async () => {
    const fd = new FormData(); fd.append('rol', 'pro'); ['nombre', 'email', 'password', 'doc_numero', 'categoria', 'especialidad'].forEach((k) => fd.append(k, d[k] || '')); fd.append('tel_token', W.tel_token);
    fd.append('documento', W.files.documento); fd.append('titulo', W.files.titulo); fd.append('selfie', W.selfie, 'selfie.jpg'); $('#fx').disabled = true;
    try { const r = await api('/auth/registro', { method: 'POST', body: fd }); localStorage.setItem(TK, r.token); Object.assign(W, { step: 0, d: {}, files: {}, selfie: null, selfieUrl: null, tel_token: null, sent: 0 }); await loadMe(); toast('Solicitud enviada. Te avisaremos al aprobarla.'); go('panel'); } catch (e) { $('#fx').disabled = false; fail(e); }
  };
  if (s === 3 && !W.selfieUrl) openCam();
}
const stopCam = () => { if (media) { media.getTracks().forEach((t) => t.stop()); media = null; } };
async function openCam() { try { media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); $('#fv').srcObject = media; } catch { toast('No pudimos acceder a la cámara. Revisa los permisos del navegador.'); } }
function startFace() {
  $('#fs').onclick = async () => {
    if (!media) await openCam(); if (!media) return; $('#fs').disabled = true;
    const v = $('#fv'), p = $('#fp'), sh = [['Mira al frente', 2200, true], ['Parpadea', 2200], ['Gira lentamente la cabeza a la izquierda', 2600], ['Mira al frente', 1500, true]];
    let blob = null;
    for (const [t, ms, cap] of sh) { p.textContent = t; await new Promise((r) => setTimeout(r, ms)); if (cap && !blob) { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', .88)); } }
    W.selfie = blob; W.selfieUrl = URL.createObjectURL(blob); stopCam(); wizard();
  };
}

/* ---------- Administración ---------- */
async function vAdmin(a) {
  if (!ME || ME.rol !== 'admin') { a.innerHTML = '<div class="wrap panel"><p class="empty">Acceso solo para administradores.</p></div>'; return; }
  const [list, st] = await Promise.all([api('/admin/pendientes'), api('/admin/stats')]);
  a.innerHTML = `<div class="wrap panel"><h1>Administración</h1><p class="sub">Usuarios: ${st.usuarios} · En vivo ahora: ${st.en_vivo} · Ingresos brutos: ${money(st.ingresos.bruto)} · Plataforma: ${money(st.ingresos.plataforma)}</p>
  ${list.map((p) => `<div class="adm"><div class="ph" style="justify-content:space-between;flex-wrap:wrap"><div><h3 style="font-size:24px">${esc(p.nombre)}</h3><small style="color:var(--mu)">${esc(p.email)} · ${esc(p.tel)} · ${esc(p.categoria)} / ${esc(p.especialidad)} · Documento ${esc(p.doc_numero)}</small></div><span class="pill ${p.estado}">${esc(p.estado)}</span></div>
  <div class="rv">${[['doc_file', 'Documento'], ['titulo_file', 'Título'], ['selfie_file', 'Verificación facial']].map(([k, n]) => `<div><small>${n}</small>${/\.pdf$/.test(p[k]) ? `<p><a href="#" data-pdf="${esc(p[k])}">Abrir PDF</a></p>` : `<img data-f="${esc(p[k])}" alt="${n}">`}</div>`).join('')}</div>
  <div class="row" style="margin:0">${p.estado !== 'aprobado' ? `<button class="btn gn" data-adm="aprobar/${p.id}">Aprobar</button>` : ''}${p.estado !== 'rechazado' ? `<button class="btn gh" data-adm="rechazar/${p.id}">Rechazar</button>` : ''}${p.estado !== 'bloqueado' ? `<button class="btn rd" data-adm="bloquear/${p.id}">Bloquear</button>` : ''}</div>${p.motivo ? `<p class="hint">Motivo: ${esc(p.motivo)}</p>` : ''}</div>`).join('') || '<p class="empty">No hay solicitudes.</p>'}</div>`;
  $$('img[data-f]').forEach(async (i) => { try { const r = await fetch('/api/admin/archivo/' + i.dataset.f, { headers: { Authorization: 'Bearer ' + localStorage.getItem(TK) } }); i.src = URL.createObjectURL(await r.blob()); } catch {} });
}

/* ---------- Ventanas y eventos ---------- */
const modal = (h) => { $('#bx').innerHTML = h; $('#md').classList.add('on'); const b = $('#bx input,#bx button'); if (b) b.focus(); };
const close = () => $('#md').classList.remove('on');
function auth(m) {
  modal(`<h2>${m === 'up' ? 'Crear cuenta' : 'Iniciar sesión'}</h2><form id="af">${m === 'up' ? '<label>Nombre completo</label><input name="nombre" required autocomplete="name">' : ''}<label>Correo electrónico</label><input name="email" type="email" required autocomplete="email"><label>Contraseña</label><input name="password" type="password" required minlength="8" autocomplete="${m === 'up' ? 'new-password' : 'current-password'}"><div class="row"><button class="btn">${m === 'up' ? 'Crear cuenta' : 'Entrar'}</button><button type="button" class="btn gh" data-x>Cancelar</button></div></form>
  <p class="hint" style="margin-top:14px">¿Eres profesional? <a href="#registro-profesional" data-x>Regístrate y verifica tu identidad</a></p>`);
  $('#af').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { const r = await api(m === 'up' ? '/auth/registro' : '/auth/login', { method: 'POST', json: { ...f, rol: 'user' } }); localStorage.setItem(TK, r.token); await loadMe(); close(); toast('Sesión iniciada'); r.rol === 'pro' ? go('panel') : r.rol === 'admin' ? go('admin') : render(); } catch (er) { fail(er); } };
}
let rating = 0;
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-go],[data-auth],[data-consult],[data-send],[data-x],[data-s],[data-apoyo],[data-pay],[data-prof],[data-rate],[data-star],[data-ca],[data-adm],[data-pdf]'); if (!t) return; const D = t.dataset;
  try {
    if (D.go) go(D.go);
    else if (D.auth) { if (ME && t.id === 'rg') return; auth(D.auth); }
    else if (D.consult) { if (!ME) return auth('in'); modal(`<h2>Consulta con ${esc(D.name)}</h2><p>Enviaremos tu solicitud y te avisaremos cuando el profesional la acepte.</p><div class="row"><button class="btn" data-send="${D.consult}">Solicitar consulta</button><button class="btn gh" data-x>Cancelar</button></div>`); }
    else if (D.send) { await api('/consultas', { method: 'POST', json: { pro_id: +D.send } }); close(); toast('Solicitud enviada'); }
    else if (D.apoyo) { if (!ME) return auth('in'); modal(`<h2>Apoyar al profesional</h2><p>Elige un monto en soles.</p><div class="row">${[5, 10, 20, 50].map((n) => `<button class="btn gh" data-pay="${D.apoyo}|${n}">S/ ${n}</button>`).join('')}</div>`); }
    else if (D.pay) { const [id, n] = D.pay.split('|'); await api(`/live/${id}/apoyo`, { method: 'POST', json: { monto: +n } }); close(); toast('¡Gracias por tu apoyo!'); }
    else if (D.prof) { const [n, e2] = D.prof.split('|'); modal(`<h2>${n}</h2><p>${e2}. Identidad, documento y título profesional verificados por VERITAS.</p><button class="btn" data-x>Cerrar</button>`); }
    else if (D.rate) { if (!ME) return auth('in'); rating = 0; modal(`<h2>Calificar atención</h2><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${n} estrellas">★</button>`).join('')}</div><button class="btn" data-s="${D.rate}">Enviar calificación</button>`); }
    else if (D.star) { rating = +D.star; $$('.stars button').forEach((b) => b.classList.toggle('on', +b.dataset.star <= rating)); }
    else if (D.s) { if (!rating) return toast('Elige de 1 a 5 estrellas'); await api('/calificar', { method: 'POST', json: { pro_id: +D.s, estrellas: rating } }); close(); toast('Gracias por tu calificación'); }
    else if (D.ca) { const [ac, id] = D.ca.split('/'); await api(`/pro/consultas/${id}/${ac}`, { method: 'POST' }); render(); }
    else if (D.adm) { const [ac, id] = D.adm.split('/');
      if (ac === 'aprobar') { await api(`/admin/profesionales/${id}/aprobar`, { method: 'POST', json: {} }); render(); }
      else { modal(`<h2>${ac === 'bloquear' ? 'Bloquear perfil' : 'Rechazar solicitud'}</h2><label>Motivo (lo verá el profesional)</label><input id="mo" maxlength="300"><div class="row"><button class="btn rd" id="mk">Confirmar</button><button class="btn gh" data-x>Cancelar</button></div>`);
        $('#mk').onclick = async () => { try { await api(`/admin/profesionales/${id}/${ac}`, { method: 'POST', json: { motivo: $('#mo').value } }); close(); render(); } catch (er) { fail(er); } }; } }
    else if (D.pdf) { e.preventDefault(); const r = await fetch('/api/admin/archivo/' + D.pdf, { headers: { Authorization: 'Bearer ' + localStorage.getItem(TK) } }); window.open(URL.createObjectURL(await r.blob()), '_blank'); }
    else if (D.x !== undefined) close();
  } catch (er) { fail(er); }
});
$('#rg').addEventListener('click', () => { if (ME) { localStorage.removeItem(TK); loadMe().then(() => { go('inicio'); toast('Sesión cerrada'); }); } });
$('#md').onclick = (e) => { if (e.target.id === 'md') close(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
$('#bg').onclick = () => $('#nav').classList.toggle('on');
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { SQ = e.target.value.trim(); go('buscar'); } });
addEventListener('hashchange', render);
addEventListener('pagehide', () => { if (liveId) navigator.sendBeacon && stopAll(); });
loadMe().then(render);
