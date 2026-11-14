try { require('dotenv').config(); } catch {}
const express = require('express'), http = require('http'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const { Server } = require('socket.io'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), multer = require('multer'), initSqlJs = require('sql.js');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const DEMO = !PROD || process.env.MODO_PRUEBA === '1'; // modo de prueba: muestra el código SMS y acepta apoyos simulados
const FILES = new Map(); // documentos en memoria (se pierden al reiniciar)
let SECRET = process.env.JWT_SECRET;
if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); console.warn('[aviso] Falta JWT_SECRET: las sesiones se cerrarán al reiniciar.'); }
const COMISION = Math.min(15, Math.max(10, +process.env.COMISION_SERVICIOS || 12));
const CATS = ['medicina', 'derecho', 'ingenieria', 'negocios'];

/* ---------- Base de datos ---------- */
initSqlJs().then((SQL) => {
const raw = new SQL.Database(), nz = (a) => a.map((x) => (x === undefined ? null : x));
const db = { exec: (q) => raw.exec(q), prepare: (q) => ({
  run: (...p) => { raw.run(q, nz(p)); return { changes: raw.getRowsModified(), lastInsertRowid: raw.exec('SELECT last_insert_rowid()')[0].values[0][0] }; },
  get: (...p) => { const st = raw.prepare(q); st.bind(nz(p)); const r = st.step() ? st.getAsObject() : undefined; st.free(); return r; },
  all: (...p) => { const st = raw.prepare(q); st.bind(nz(p)); const a = []; while (st.step()) a.push(st.getAsObject()); st.free(); return a; } }) };
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'user', tel TEXT, creado TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS profesionales(user_id INTEGER PRIMARY KEY, categoria TEXT, especialidad TEXT, doc_numero TEXT, doc_file TEXT, titulo_file TEXT, selfie_file TEXT, estado TEXT DEFAULT 'pendiente', motivo TEXT, tel_verificado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS streams(id INTEGER PRIMARY KEY, pro_id INTEGER, titulo TEXT, inicio TEXT DEFAULT CURRENT_TIMESTAMP, fin TEXT, activo INTEGER DEFAULT 1, pico INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ingresos(id INTEGER PRIMARY KEY, pro_id INTEGER, stream_id INTEGER, tipo TEXT, bruto REAL, comision REAL, neto REAL, creado TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS calificaciones(id INTEGER PRIMARY KEY, pro_id INTEGER, user_id INTEGER, estrellas INTEGER, creado TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS consultas(id INTEGER PRIMARY KEY, pro_id INTEGER, user_id INTEGER, estado TEXT DEFAULT 'pendiente', creado TEXT DEFAULT CURRENT_TIMESTAMP);
`);
db.prepare("UPDATE streams SET activo=0, fin=CURRENT_TIMESTAMP WHERE activo=1").run();
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && !db.prepare('SELECT 1 FROM users WHERE email=?').get(process.env.ADMIN_EMAIL.toLowerCase()))
  db.prepare("INSERT INTO users(nombre,email,pass,rol) VALUES('Administrador',?,?, 'admin')").run(process.env.ADMIN_EMAIL.toLowerCase(), bcrypt.hashSync(process.env.ADMIN_PASSWORD, 11));

/* ---------- App ---------- */
const app = express(), server = http.createServer(app);
const io = new Server(server);
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'", 'ws:', 'wss:'], upgradeInsecureRequests: PROD ? [] : null } },
  crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '100kb' }));
const lim = (n) => rateLimit({ windowMs: 15 * 60 * 1000, limit: n, standardHeaders: true, legacyHeaders: false });
const wrap = (f) => (req, res) => { try { f(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'Error interno del servidor' }); } };
const sign = (u) => jwt.sign({ id: u.id, rol: u.rol, nombre: u.nombre }, SECRET, { expiresIn: '7d' });
const user = (req) => { try { const t = (req.headers.authorization || '').slice(7); return t ? jwt.verify(t, SECRET) : null; } catch { return null; } };
const need = (...roles) => (req, res, next) => { const u = user(req); if (!u) return res.status(401).json({ error: 'Inicia sesión' }); if (roles.length && !roles.includes(u.rol)) return res.status(403).json({ error: 'No autorizado' }); req.u = u; next(); };
const proAprobado = (id) => db.prepare("SELECT 1 FROM profesionales WHERE user_id=? AND estado='aprobado'").get(id);
const money = (n) => Math.round(n * 100) / 100;

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 3 }, fileFilter: (r, f, cb) => cb(null, !!EXT[f.mimetype]) });
const keep = (f) => { const n = crypto.randomUUID() + EXT[f.mimetype]; FILES.set(n, { buf: f.buffer, mime: f.mimetype }); return n; };

/* ---------- Verificación de teléfono ---------- */
const otp = new Map();
app.post('/api/tel/enviar', lim(10), wrap(async (req, res) => {
  const tel = String(req.body.tel || '').replace(/[^\d+]/g, '');
  if (tel.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Número de teléfono inválido' });
  const code = String(crypto.randomInt(100000, 999999));
  otp.set(tel, { code, exp: Date.now() + 10 * 60000, tries: 0 });
  const { TWILIO_SID: s, TWILIO_TOKEN: t, TWILIO_FROM: f } = process.env;
  if (s && t && f) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s}/Messages.json`, { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(s + ':' + t).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: tel, From: f, Body: `VERITAS: tu código es ${code}` }) });
    if (!r.ok) return res.status(502).json({ error: 'No se pudo enviar el SMS' });
    return res.json({ ok: true });
  }
  console.log(`[SMS de prueba] ${tel}: ${code}`);
  res.json({ ok: true, dev_code: DEMO ? code : undefined });
}));
app.post('/api/tel/verificar', lim(30), wrap((req, res) => {
  const tel = String(req.body.tel || '').replace(/[^\d+]/g, ''), o = otp.get(tel);
  if (!o || o.exp < Date.now() || ++o.tries > 5) return res.status(400).json({ error: 'El código venció. Solicita uno nuevo' });
  if (o.code !== String(req.body.code)) return res.status(400).json({ error: 'Código incorrecto' });
  otp.delete(tel);
  res.json({ token: jwt.sign({ tel }, SECRET, { expiresIn: '30m' }) });
}));

/* ---------- Cuentas ---------- */
const reg = (req, res) => {
  const b = req.body, email = String(b.email || '').toLowerCase().trim(), nombre = String(b.nombre || '').trim().slice(0, 80);
  const pro = b.rol === 'pro';
  if (!nombre || !/^\S+@\S+\.\S+$/.test(email) || String(b.password || '').length < 8) return res.status(400).json({ error: 'Completa nombre, correo válido y una contraseña de 8 caracteres o más' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Ese correo ya está registrado' });
  let tel = null;
  if (pro) {
    const f = req.files || {};
    try { tel = jwt.verify(b.tel_token, SECRET).tel; } catch { return res.status(400).json({ error: 'Verifica tu teléfono antes de registrarte' }); }
    if (!CATS.includes(b.categoria) || !b.especialidad || !/^\d{8,12}$/.test(b.doc_numero || '') || !f.documento || !f.titulo || !f.selfie)
      return res.status(400).json({ error: 'Faltan datos: categoría, especialidad, documento, título y verificación facial' });
  }
  const id = db.prepare('INSERT INTO users(nombre,email,pass,rol,tel) VALUES(?,?,?,?,?)').run(nombre, email, bcrypt.hashSync(b.password, 11), pro ? 'pro' : 'user', tel).lastInsertRowid;
  if (pro) db.prepare('INSERT INTO profesionales(user_id,categoria,especialidad,doc_numero,doc_file,titulo_file,selfie_file,tel_verificado) VALUES(?,?,?,?,?,?,?,1)')
    .run(id, b.categoria, String(b.especialidad).slice(0, 80), b.doc_numero, keep(req.files.documento[0]), keep(req.files.titulo[0]), keep(req.files.selfie[0]));
  res.json({ token: sign({ id, rol: pro ? 'pro' : 'user', nombre }), rol: pro ? 'pro' : 'user', nombre });
};
app.post('/api/auth/registro', lim(20), upload.fields([{ name: 'documento', maxCount: 1 }, { name: 'titulo', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]), wrap(reg));
app.post('/api/auth/login', lim(40), wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.pass)) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  res.json({ token: sign(u), rol: u.rol, nombre: u.nombre });
}));
app.get('/api/me', need(), wrap((req, res) => {
  const p = db.prepare('SELECT categoria,especialidad,estado,motivo FROM profesionales WHERE user_id=?').get(req.u.id);
  res.json({ ...req.u, perfil: p || null });
}));
app.get('/api/config', (q, res) => res.json({ ice: [{ urls: 'stun:stun.l.google.com:19302' }, ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS }] : [])] }));

/* ---------- Profesionales y transmisiones ---------- */
app.get('/api/profesionales', wrap((req, res) => {
  const { categoria, q } = req.query, like = `%${String(q || '').toLowerCase()}%`;
  const rows = db.prepare(`SELECT u.id, u.nombre, p.categoria, p.especialidad,
    (SELECT id FROM streams s WHERE s.pro_id=u.id AND s.activo=1) AS stream_id,
    (SELECT titulo FROM streams s WHERE s.pro_id=u.id AND s.activo=1) AS titulo,
    EXISTS(SELECT 1 FROM consultas c WHERE c.pro_id=u.id AND c.estado='en_curso') AS ocupado,
    (SELECT ROUND(AVG(estrellas),1) FROM calificaciones c WHERE c.pro_id=u.id) AS promedio
    FROM users u JOIN profesionales p ON p.user_id=u.id WHERE p.estado='aprobado' AND (? IS NULL OR p.categoria=?) AND (lower(u.nombre||p.especialidad) LIKE ?)
    ORDER BY (stream_id IS NOT NULL) DESC, u.nombre`).all(categoria || null, categoria || null, like);
  res.json(rows.map((r) => ({ ...r, espectadores: r.stream_id ? (live.get(r.stream_id)?.viewers.size || 0) : 0, estado: r.stream_id ? 'ev' : r.ocupado ? 'ec' : 'd' })));
}));
app.get('/api/streams/:id', wrap((req, res) => {
  const s = db.prepare('SELECT s.id,s.titulo,s.activo,u.id pro_id,u.nombre,p.especialidad,p.categoria FROM streams s JOIN users u ON u.id=s.pro_id JOIN profesionales p ON p.user_id=u.id WHERE s.id=?').get(req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Transmisión no encontrada' });
}));
const live = new Map(); // streamId -> { host, proId, viewers:Set, total }
const room = (id) => 's' + id;
function endStream(id, why) {
  const l = live.get(+id); if (!l) return;
  db.prepare('UPDATE streams SET activo=0, fin=CURRENT_TIMESTAMP WHERE id=?').run(id);
  io.to(room(id)).emit('live:ended', { why }); io.in(room(id)).socketsLeave(room(id)); live.delete(+id);
}
app.post('/api/live/iniciar', need('pro'), wrap((req, res) => {
  if (!proAprobado(req.u.id)) return res.status(403).json({ error: 'Tu perfil aún no está verificado por el administrador' });
  const old = db.prepare('SELECT id FROM streams WHERE pro_id=? AND activo=1').get(req.u.id); if (old) endStream(old.id, 'reinicio');
  const titulo = String(req.body.titulo || 'Asesoría en vivo').slice(0, 90);
  const id = db.prepare('INSERT INTO streams(pro_id,titulo) VALUES(?,?)').run(req.u.id, titulo).lastInsertRowid;
  live.set(+id, { host: null, proId: req.u.id, viewers: new Set(), total: 0 });
  res.json({ id });
}));
app.post('/api/live/:id/finalizar', need('pro'), wrap((req, res) => {
  const s = db.prepare('SELECT * FROM streams WHERE id=? AND pro_id=?').get(req.params.id, req.u.id);
  if (!s) return res.status(404).json({ error: 'No encontrada' });
  endStream(s.id, 'finalizada'); res.json({ ok: true });
}));

/* ---------- Ganancias ---------- */
function ingreso(proId, streamId, tipo, bruto) {
  const pct = tipo === 'publicidad' ? 30 : COMISION, comision = money(bruto * pct / 100), neto = money(bruto - comision);
  db.prepare('INSERT INTO ingresos(pro_id,stream_id,tipo,bruto,comision,neto) VALUES(?,?,?,?,?,?)').run(proId, streamId || null, tipo, bruto, comision, neto);
  const l = live.get(+streamId);
  if (l?.host) { l.total = money(l.total + neto); io.to(l.host).emit('ganancia', { neto, total: l.total }); }
  return neto;
}
// Apoyo/pago del espectador. En producción conecta aquí tu pasarela (Culqi, Niubiz, Mercado Pago) y llama a ingreso() solo cuando el pago se confirme.
app.post('/api/live/:id/apoyo', need(), wrap((req, res) => {
  const s = db.prepare('SELECT * FROM streams WHERE id=? AND activo=1').get(req.params.id), monto = money(+req.body.monto);
  if (!s) return res.status(404).json({ error: 'La transmisión terminó' });
  if (!(monto >= 1 && monto <= 1000)) return res.status(400).json({ error: 'Monto inválido (S/ 1 a S/ 1000)' });
  if (!DEMO) return res.status(501).json({ error: 'Pasarela de pagos pendiente de configurar' });
  const neto = ingreso(s.pro_id, s.id, 'propina', monto);
  io.to(room(s.id)).emit('chat', { sys: true, text: `${req.u.nombre} apoyó con S/ ${monto.toFixed(2)}` });
  res.json({ ok: true, neto });
}));
app.get('/api/pro/ganancias', need('pro'), wrap((req, res) => {
  const id = req.u.id, g = (w) => db.prepare(`SELECT COALESCE(SUM(bruto),0) bruto, COALESCE(SUM(comision),0) comision, COALESCE(SUM(neto),0) neto FROM ingresos WHERE pro_id=? ${w}`).get(id);
  res.json({ total: g(''), hoy: g("AND date(creado)=date('now')"), mes: g("AND strftime('%Y-%m',creado)=strftime('%Y-%m','now')"), comision_pct: COMISION,
    streams: db.prepare(`SELECT s.id,s.titulo,s.inicio,s.fin,s.pico, COALESCE(SUM(i.neto),0) neto FROM streams s LEFT JOIN ingresos i ON i.stream_id=s.id WHERE s.pro_id=? GROUP BY s.id ORDER BY s.id DESC LIMIT 15`).all(id),
    historial: db.prepare('SELECT tipo,bruto,comision,neto,creado FROM ingresos WHERE pro_id=? ORDER BY id DESC LIMIT 25').all(id) });
}));

/* ---------- Calificaciones y consultas ---------- */
app.post('/api/calificar', need(), wrap((req, res) => {
  const e = +req.body.estrellas; if (!(e >= 1 && e <= 5) || !proAprobado(+req.body.pro_id)) return res.status(400).json({ error: 'Datos inválidos' });
  db.prepare('INSERT INTO calificaciones(pro_id,user_id,estrellas) VALUES(?,?,?)').run(+req.body.pro_id, req.u.id, e); res.json({ ok: true });
}));
app.post('/api/consultas', need(), wrap((req, res) => {
  if (!proAprobado(+req.body.pro_id)) return res.status(404).json({ error: 'Profesional no disponible' });
  res.json({ id: db.prepare('INSERT INTO consultas(pro_id,user_id) VALUES(?,?)').run(+req.body.pro_id, req.u.id).lastInsertRowid });
}));
app.get('/api/pro/consultas', need('pro'), wrap((req, res) => res.json(db.prepare("SELECT c.id,c.estado,c.creado,u.nombre FROM consultas c JOIN users u ON u.id=c.user_id WHERE c.pro_id=? AND c.estado IN('pendiente','en_curso') ORDER BY c.id DESC").all(req.u.id))));
app.post('/api/pro/consultas/:id/:accion', need('pro'), wrap((req, res) => {
  const est = { aceptar: 'en_curso', rechazar: 'rechazada', finalizar: 'finalizada' }[req.params.accion];
  if (!est) return res.status(400).json({ error: 'Acción inválida' });
  const r = db.prepare('UPDATE consultas SET estado=? WHERE id=? AND pro_id=?').run(est, req.params.id, req.u.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'No encontrada' });
}));

/* ---------- Administrador ---------- */
const A = need('admin');
app.get('/api/admin/pendientes', A, wrap((req, res) => res.json(db.prepare("SELECT u.id,u.nombre,u.email,u.tel,p.* FROM profesionales p JOIN users u ON u.id=p.user_id WHERE p.estado IN('pendiente','rechazado','aprobado','bloqueado') ORDER BY (p.estado='pendiente') DESC, u.id DESC LIMIT 100").all())));
app.get('/api/admin/archivo/:f', A, (req, res) => { const f = FILES.get(path.basename(req.params.f)); f ? res.type(f.mime).send(f.buf) : res.sendStatus(404); });
app.post('/api/admin/profesionales/:id/:accion', A, wrap((req, res) => {
  const est = { aprobar: 'aprobado', rechazar: 'rechazado', bloquear: 'bloqueado' }[req.params.accion], motivo = String(req.body.motivo || '').slice(0, 300);
  if (!est || (est !== 'aprobado' && !motivo)) return res.status(400).json({ error: 'Indica el motivo' });
  db.prepare('UPDATE profesionales SET estado=?, motivo=? WHERE user_id=?').run(est, est === 'aprobado' ? null : motivo, req.params.id);
  if (est !== 'aprobado') { const s = db.prepare('SELECT id FROM streams WHERE pro_id=? AND activo=1').get(req.params.id); if (s) endStream(s.id, 'bloqueado'); }
  res.json({ ok: true });
}));
app.post('/api/admin/publicidad', A, wrap((req, res) => { // ingreso publicitario de una transmisión: 70% profesional / 30% plataforma
  const s = db.prepare('SELECT * FROM streams WHERE id=?').get(+req.body.stream_id), m = money(+req.body.monto);
  if (!s || !(m > 0)) return res.status(400).json({ error: 'Datos inválidos' }); res.json({ neto: ingreso(s.pro_id, s.id, 'publicidad', m) });
}));
app.get('/api/admin/stats', A, wrap((req, res) => res.json({
  usuarios: db.prepare("SELECT COUNT(*) n FROM users WHERE rol='user'").get().n, profesionales: db.prepare("SELECT estado, COUNT(*) n FROM profesionales GROUP BY estado").all(),
  en_vivo: live.size, ingresos: db.prepare('SELECT COALESCE(SUM(bruto),0) bruto, COALESCE(SUM(comision),0) plataforma FROM ingresos').get() })));

/* ---------- Transmisión en vivo: chat + señalización WebRTC ---------- */
io.use((s, next) => { try { s.user = jwt.verify(s.handshake.auth.token, SECRET); } catch { s.user = null; } next(); });
io.on('connection', (sock) => {
  const count = (id) => { const l = live.get(id); if (!l) return; io.to(room(id)).emit('viewers', l.viewers.size); db.prepare('UPDATE streams SET pico=MAX(pico,?) WHERE id=?').run(l.viewers.size, id); };
  sock.on('live:host', ({ streamId }) => {
    const l = live.get(+streamId); if (!l || !sock.user || l.proId !== sock.user.id) return;
    l.host = sock.id; sock.join(room(streamId)); sock.data.host = +streamId; sock.emit('viewers', l.viewers.size);
  });
  sock.on('live:watch', ({ streamId }) => {
    const l = live.get(+streamId); if (!l || !l.host) return sock.emit('live:ended', { why: 'sin transmisión' });
    sock.join(room(streamId)); sock.data.watch = +streamId; l.viewers.add(sock.id);
    io.to(l.host).emit('viewer:joined', { id: sock.id }); count(+streamId);
    io.to(room(streamId)).emit('chat', { sys: true, text: `${sock.user?.nombre || 'Un espectador'} entró a la sala` });
  });
  for (const ev of ['rtc:offer', 'rtc:answer', 'rtc:ice']) sock.on(ev, ({ to, data }) => io.to(to).emit(ev, { from: sock.id, data }));
  sock.on('chat', ({ streamId, text }) => {
    if (!sock.user || !sock.rooms.has(room(streamId))) return;
    const t = String(text || '').trim().slice(0, 200); if (t) io.to(room(streamId)).emit('chat', { user: sock.user.nombre, text: t, pro: sock.data.host === +streamId });
  });
  sock.on('disconnecting', () => {
    if (sock.data.host) { const l = live.get(sock.data.host); if (l && l.host === sock.id) endStream(sock.data.host, 'desconexión'); }
    if (sock.data.watch) { const l = live.get(sock.data.watch); if (l) { l.viewers.delete(sock.id); count(sock.data.watch); } }
  });
});

/* ---------- Web ---------- */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1d' : 0 }));
app.use('/api', (q, res) => res.status(404).json({ error: 'No encontrado' }));
app.get('*', (q, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`VERITAS listo en http://localhost:${PORT}`));
});
