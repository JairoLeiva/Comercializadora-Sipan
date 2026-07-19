/* Servidor del sistema SIPAN */
/* Lo hice en Node puro con SQLite, mas pdfkit y nodemailer para el PDF y el correo */
/* Lo arranco con: node servidor.js */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const Validacion = require("./publico/js/validacion.js");

/* Cargo las variables del .env si existe, sin instalar nada nuevo */
(function cargarEnv() {
  const rutaEnv = path.join(__dirname, ".env");
  if (!fs.existsSync(rutaEnv)) return;
  for (const linea of fs.readFileSync(rutaEnv, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const igual = limpia.indexOf("=");
    if (igual === -1) continue;
    const clave = limpia.slice(0, igual).trim();
    let valor = limpia.slice(igual + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'")))
      valor = valor.slice(1, -1);
    if (!(clave in process.env)) process.env[clave] = valor;
  }
})();

const PUERTO = Number(process.env.PUERTO) || 3004;
const RUTA_BD = process.env.BD || path.join(__dirname, "datos", "sipan.db");
const CARPETA_PUBLICA = path.join(__dirname, "publico");
const CARPETA_RESPALDOS = process.env.CARPETA_RESPALDOS || path.join(__dirname, "respaldos");
const MAX_RESPALDOS = 14;
const HORAS_ENTRE_RESPALDOS = 24;
const MINUTOS_SESION = 30;
const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 5;
const MINUTOS_RECUPERACION = 30;
const CLAVE_GERENTE_INICIAL = "Sipan2026";
/* Esta es mi clave secreta de reCAPTCHA; el servidor valida el captcha con Google */
const SECRETO_RECAPTCHA = process.env.SECRETO_RECAPTCHA !== undefined
  ? process.env.SECRETO_RECAPTCHA
  : "6LeM_0MtAAAAABNN6qgSZVwVYl1dsEY6MaKCOiLL";
const ROLES = {
  gerente_general: "Gerente general",
  administrador: "Administrador",
  vendedor: "Vendedor",
  reponedor: "Reponedor"
};

/* Defino que puede hacer cada rol. Lo controlo en el servidor y ademas escondo botones en el cliente */
const PERMISOS = {
  gerente_general: {
    descripcion: "Dueno del sistema. Control total: define la estructura de la empresa, crea y da de baja cuentas, asigna cualquier rol y ve todo lo que ocurre.",
    inventario_ver: true, inventario_editar: true, producto_eliminar: true,
    categorias: true, movimientos: true, vender: true, tickets: true,
    reportes: true, exportar: true, papelera: true,
    usuarios_ver: true, usuarios_crear: true, usuarios_rol: true,
    asignar_gerente: true, auditoria: true
  },
  administrador: {
    descripcion: "Mano derecha de gerencia. Administra el inventario y las cuentas del dia a dia, pero no puede nombrar ni destituir a un gerente general.",
    inventario_ver: true, inventario_editar: true, producto_eliminar: true,
    categorias: true, movimientos: true, vender: true, tickets: true,
    reportes: true, exportar: true, papelera: true,
    usuarios_ver: true, usuarios_crear: true, usuarios_rol: true,
    asignar_gerente: false, auditoria: true
  },
  vendedor: {
    descripcion: "Atiende el mostrador. Su funcion es vender: registra ventas que descuentan stock, emite boletas, consulta el inventario y levanta tickets. No modifica el catalogo ni administra cuentas.",
    inventario_ver: true, inventario_editar: false, producto_eliminar: false,
    categorias: false, movimientos: false, vender: true, tickets: true,
    reportes: true, exportar: true, papelera: false,
    usuarios_ver: false, usuarios_crear: false, usuarios_rol: false,
    asignar_gerente: false, auditoria: false
  },
  reponedor: {
    descripcion: "Cuida las existencias. Registra entradas y salidas de almacen, edita datos de producto y mantiene el stock al dia, pero no vende al publico ni administra cuentas.",
    inventario_ver: true, inventario_editar: true, producto_eliminar: false,
    categorias: false, movimientos: true, vender: false, tickets: true,
    reportes: true, exportar: true, papelera: false,
    usuarios_ver: false, usuarios_crear: false, usuarios_rol: false,
    asignar_gerente: false, auditoria: false
  }
};

function puede(rol, accion) {
  const p = PERMISOS[rol];
  return !!(p && p[accion]);
}

/* Aca preparo la base de datos */

fs.mkdirSync(path.dirname(RUTA_BD), { recursive: true });
const bd = new DatabaseSync(RUTA_BD);

bd.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE,
    correo TEXT NOT NULL UNIQUE,
    sal TEXT NOT NULL,
    clave_hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'almacenero',
    dosfa_activo INTEGER NOT NULL DEFAULT 0,
    dosfa_secreto TEXT,
    dosfa_respaldo TEXT,
    creado TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY,
    csrf TEXT NOT NULL,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    vence INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recuperaciones (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    vence INTEGER NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS intentos (
    identidad TEXT PRIMARY KEY,
    total INTEGER NOT NULL DEFAULT 0,
    hasta INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    nombre_clave TEXT NOT NULL UNIQUE,
    categoria_id INTEGER NOT NULL REFERENCES categorias(id),
    precio REAL NOT NULL,
    stock INTEGER NOT NULL,
    minimo INTEGER NOT NULL DEFAULT 10,
    activo INTEGER NOT NULL DEFAULT 1,
    creado TEXT NOT NULL,
    actualizado TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida')),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    motivo TEXT NOT NULL,
    usuario TEXT NOT NULL,
    fecha TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    usuario TEXT NOT NULL,
    tipo TEXT NOT NULL,
    detalle TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER REFERENCES productos(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('nota','venta','reposicion','incidencia')),
    prioridad TEXT NOT NULL CHECK (prioridad IN ('baja','media','alta')),
    titulo TEXT NOT NULL,
    detalle TEXT NOT NULL,
    cantidad INTEGER,
    estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
    creado_por TEXT NOT NULL,
    creado TEXT NOT NULL,
    cerrado TEXT
  );

  CREATE TABLE IF NOT EXISTS boletas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    cliente TEXT NOT NULL,
    documento TEXT,
    direccion TEXT,
    subtotal REAL NOT NULL,
    descuento_pct REAL NOT NULL DEFAULT 0,
    descuento_monto REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    observacion TEXT,
    vendedor TEXT NOT NULL,
    creado TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS boleta_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boleta_id INTEGER NOT NULL REFERENCES boletas(id),
    producto_id INTEGER REFERENCES productos(id),
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    precio REAL NOT NULL,
    importe REAL NOT NULL
  );
`);

/* Si vengo de una version vieja, completo columnas y roles que faltan */
function migrar() {
  const columnas = bd.prepare("PRAGMA table_info(tickets)").all();
  if (!columnas.some(c => c.name === "cantidad")) {
    bd.exec("ALTER TABLE tickets ADD COLUMN cantidad INTEGER");
  }
  /* Junte el rol atendedor dentro de vendedor */
  bd.prepare("UPDATE usuarios SET rol = 'vendedor' WHERE rol = 'atendedor'").run();

  /* Agrego las columnas del 2FA si no existen */
  const colUsuarios = bd.prepare("PRAGMA table_info(usuarios)").all();
  if (!colUsuarios.some(c => c.name === "dosfa_activo"))
    bd.exec("ALTER TABLE usuarios ADD COLUMN dosfa_activo INTEGER NOT NULL DEFAULT 0");
  if (!colUsuarios.some(c => c.name === "dosfa_secreto"))
    bd.exec("ALTER TABLE usuarios ADD COLUMN dosfa_secreto TEXT");
  if (!colUsuarios.some(c => c.name === "dosfa_respaldo"))
    bd.exec("ALTER TABLE usuarios ADD COLUMN dosfa_respaldo TEXT");

  /* Codigo de barras opcional para escanear el producto */
  const colProductos = bd.prepare("PRAGMA table_info(productos)").all();
  if (!colProductos.some(c => c.name === "codigo_barras")) {
    bd.exec("ALTER TABLE productos ADD COLUMN codigo_barras TEXT");
    bd.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_codigo_barras " +
      "ON productos(codigo_barras) WHERE codigo_barras IS NOT NULL");
  }
}
migrar();

/* La primera vez cargo categorias y productos de ejemplo */
function sembrar() {
  const hay = bd.prepare("SELECT COUNT(*) AS n FROM categorias").get().n;
  if (hay > 0) return;

  const insertarCat = bd.prepare("INSERT INTO categorias (nombre) VALUES (?)");
  ["Abarrotes", "Bebidas", "Lacteos", "Limpieza"].forEach(c => insertarCat.run(c));

  const muestra = [
    ["Arroz Costeno 1 kg", 1, 2.80, 350], ["Aceite Primor 1 L", 1, 6.50, 80],
    ["Leche Gloria 400 g", 3, 3.20, 120], ["Azucar Rubia San Jacinto 1 kg", 1, 2.50, 5],
    ["Detergente Ariel 500 g", 4, 5.90, 45], ["Lejia Clorox 900 ml", 4, 3.90, 8],
    ["Fideos Don Vittorio 500 g", 1, 2.40, 200], ["Agua San Luis 2.5 L", 2, 2.90, 60],
    ["Gaseosa Inca Kola 1.5 L", 2, 6.00, 3], ["Papel Higienico Elite x4", 4, 4.80, 90]
  ];
  muestra.forEach(([nombre, cat, precio, stock], i) => {
    const ahora = new Date().toISOString();
    bd.prepare(`INSERT INTO productos
      (codigo, nombre, nombre_clave, categoria_id, precio, stock, minimo, activo, creado, actualizado)
      VALUES (?,?,?,?,?,?,10,1,?,?)`)
      .run("P-" + String(i + 1).padStart(4, "0"), nombre, nombre.toLowerCase(), cat, precio, stock, ahora, ahora);
  });
}
sembrar();

/* Mis funciones de seguridad */

function hashClave(clave, sal) {
  return crypto.scryptSync(clave, sal, 64).toString("hex");
}

function compararSeguro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function token() {
  return crypto.randomBytes(32).toString("hex");
}

function ahora() { return new Date().toISOString(); }

/* Envio correos por Gmail si hay credenciales en el env, si no los dejo escritos en consola */
let transportadorCorreo;
function transportador() {
  if (transportadorCorreo !== undefined) return transportadorCorreo;
  if (!process.env.GMAIL_USUARIO || !process.env.GMAIL_APP_PASSWORD) { transportadorCorreo = null; return null; }
  transportadorCorreo = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USUARIO, pass: process.env.GMAIL_APP_PASSWORD }
  });
  return transportadorCorreo;
}

async function enviarCorreo(destino, asunto, html) {
  const t = transportador();
  if (!t) {
    console.log("\n[correo simulado, falta GMAIL_USUARIO/GMAIL_APP_PASSWORD en .env]" +
      "\nPara: " + destino + "\nAsunto: " + asunto + "\n" + html + "\n");
    return;
  }
  await t.sendMail({ from: '"Comercializadora Sipan" <' + process.env.GMAIL_USUARIO + '>', to: destino, subject: asunto, html });
}

/* Aviso por correo apenas un producto baja de su minimo, no se repite en cada venta despues */
function avisarSiStockCritico(producto, nuevoStock) {
  if (producto.stock >= producto.minimo && nuevoStock < producto.minimo) {
    enviarAvisoStockCritico(producto, nuevoStock)
      .catch(error => console.error("No se pudo enviar el aviso de stock critico:", error.message));
  }
}

async function enviarAvisoStockCritico(producto, stockActual) {
  const destinatarios = bd.prepare(
    "SELECT correo FROM usuarios WHERE rol IN ('gerente_general','administrador','reponedor')").all();
  if (destinatarios.length === 0) return;

  const asunto = "Stock minimo: " + producto.nombre;
  const html =
    "<p>El producto <strong>" + escXml(producto.codigo) + " - " + escXml(producto.nombre) +
    "</strong> llego a un stock de <strong>" + stockActual + "</strong> unidades, por debajo de su minimo (" +
    producto.minimo + ").</p><p>Conviene reponerlo pronto.</p>";

  for (const d of destinatarios) await enviarCorreo(d.correo, asunto, html);
}

/* Leo el rango de fechas de la URL, ignoro lo que no venga como AAAA-MM-DD */
function rangoFechas(url) {
  const patron = /^\d{4}-\d{2}-\d{2}$/;
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  return {
    desde: desde && patron.test(desde) ? desde : null,
    hasta: hasta && patron.test(hasta) ? hasta : null
  };
}

/* Junto todos los numeros del reporte, lo uso tanto para la vista como para el PDF */
function datosReportes(url) {
  const { desde, hasta } = rangoFechas(url);

  const porCategoria = bd.prepare(`
    SELECT c.nombre, COUNT(p.id) AS productos, COALESCE(SUM(p.precio * p.stock), 0) AS valor
    FROM categorias c LEFT JOIN productos p ON p.categoria_id = c.id AND p.activo = 1
    GROUP BY c.id ORDER BY valor DESC`).all();

  /* Entradas y salidas del rango elegido, si no pusieron fechas uso los ultimos 7 dias */
  const diasRango = [];
  if (desde && hasta && desde <= hasta) {
    const inicio = new Date(desde + "T00:00:00");
    const fin = new Date(hasta + "T00:00:00");
    const totalDias = Math.min(92, Math.round((fin - inicio) / 86400000) + 1);
    for (let i = 0; i < totalDias; i++)
      diasRango.push(new Date(inicio.getTime() + i * 86400000).toISOString().slice(0, 10));
  } else {
    for (let i = 6; i >= 0; i--) diasRango.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  const dias = diasRango.map(dia => {
    const fila = bd.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN cantidad END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo = 'salida' THEN cantidad END), 0) AS salidas
      FROM movimientos WHERE substr(fecha, 1, 10) = ?`).get(dia);
    return { dia, entradas: fila.entradas, salidas: fila.salidas };
  });

  const condicionesMov = [];
  const parametrosMov = [];
  if (desde) { condicionesMov.push("substr(m.fecha,1,10) >= ?"); parametrosMov.push(desde); }
  if (hasta) { condicionesMov.push("substr(m.fecha,1,10) <= ?"); parametrosMov.push(hasta); }
  const dondeMov = condicionesMov.length ? " WHERE " + condicionesMov.join(" AND ") : "";

  const masMovidos = bd.prepare(`
    SELECT p.nombre, p.codigo, SUM(m.cantidad) AS unidades
    FROM movimientos m JOIN productos p ON p.id = m.producto_id` + dondeMov + `
    GROUP BY p.id ORDER BY unidades DESC LIMIT 5`).all(...parametrosMov);

  const criticos = bd.prepare(`
    SELECT codigo, nombre, stock, minimo FROM productos
    WHERE activo = 1 AND stock < minimo ORDER BY stock ASC LIMIT 8`).all();

  const tiposProducto = bd.prepare(`
    SELECT c.nombre, COUNT(p.id) AS productos,
      COALESCE(SUM(p.stock), 0) AS unidades,
      COALESCE(SUM(p.precio * p.stock), 0) AS valor
    FROM categorias c LEFT JOIN productos p ON p.categoria_id = c.id AND p.activo = 1
    GROUP BY c.id ORDER BY productos DESC, c.nombre`).all();

  const tickets = bd.prepare(`
    SELECT tipo, estado, COUNT(*) AS total
    FROM tickets GROUP BY tipo, estado ORDER BY tipo, estado`).all();

  return { porCategoria, dias, masMovidos, criticos, tiposProducto, tickets, rango: { desde, hasta } };
}

/* Valido el captcha contra Google. Si no configure la clave secreta, dejo pasar (modo local). */
async function captchaValido(token, ip) {
  if (!SECRETO_RECAPTCHA) return true;
  if (!token) return false;
  try {
    const cuerpo = new URLSearchParams({ secret: SECRETO_RECAPTCHA, response: token, remoteip: ip });
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: cuerpo
    });
    const data = await r.json();
    return data.success === true;
  } catch {
    return false;
  }
}

/* Aca armo el 2FA (codigos TOTP) en Node puro; el secreto se comparte por QR */
const TOTP = (() => {
  const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; /* alfabeto base32 */

  function generarSecreto(bytes = 20) {
    const buf = crypto.randomBytes(bytes);
    let bits = "";
    for (const b of buf) bits += b.toString(2).padStart(8, "0");
    let salida = "";
    for (let i = 0; i + 5 <= bits.length; i += 5)
      salida += ALFABETO[parseInt(bits.slice(i, i + 5), 2)];
    return salida;
  }

  function base32ABuffer(secreto) {
    let bits = "";
    for (const c of secreto.replace(/=+$/, "").toUpperCase()) {
      const valor = ALFABETO.indexOf(c);
      if (valor === -1) continue;
      bits += valor.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8)
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  }

  function codigoEn(secreto, contador) {
    const clave = base32ABuffer(secreto);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(contador));
    const hmac = crypto.createHmac("sha1", clave).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binario = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return String(binario % 1000000).padStart(6, "0");
  }

  /* Acepto el codigo de ahora y uno antes o despues por si el reloj esta desfasado */
  function verificar(secreto, codigo, ventana = 1) {
    if (!secreto || !/^\d{6}$/.test(String(codigo || "").trim())) return false;
    const paso = Math.floor(Date.now() / 30000);
    const objetivo = String(codigo).trim();
    for (let i = -ventana; i <= ventana; i++) {
      if (compararSeguro(codigoEn(secreto, paso + i), objetivo)) return true;
    }
    return false;
  }

  function urlProvisionamiento(secreto, cuenta, emisor) {
    const etiqueta = encodeURIComponent(emisor + ":" + cuenta);
    const params = "secret=" + secreto + "&issuer=" + encodeURIComponent(emisor) +
      "&algorithm=SHA1&digits=6&period=30";
    return "otpauth://totp/" + etiqueta + "?" + params;
  }

  /* Codigos de respaldo por si pierdo el telefono */
  function generarRespaldos(cantidad = 8) {
    const codigos = [];
    for (let i = 0; i < cantidad; i++) {
      const bloque = crypto.randomBytes(4).toString("hex").toUpperCase();
      codigos.push(bloque.slice(0, 4) + "-" + bloque.slice(4, 8));
    }
    return codigos;
  }

  return { generarSecreto, verificar, urlProvisionamiento, generarRespaldos };
})();

function hashSimple(valor) {
  return crypto.createHash("sha256").update(String(valor)).digest("hex");
}

function auditar(usuario, tipo, detalle) {
  bd.prepare("INSERT INTO auditoria (fecha, usuario, tipo, detalle) VALUES (?,?,?,?)")
    .run(ahora(), usuario || "sistema", tipo, detalle);
}

function rolValido(rol) {
  return Object.prototype.hasOwnProperty.call(ROLES, rol);
}

function esGerencia(sesion) {
  return sesion && (sesion.rol === "gerente_general" || sesion.rol === "administrador");
}

function exigirGerencia(sesion, res) {
  if (!esGerencia(sesion)) {
    fallo(res, 403, "Esta accion requiere rol de gerente general o administrador.");
    return false;
  }
  return true;
}

/* Corto la accion si el rol no tiene permiso */
function exigirPermiso(sesion, res, accion, glosa) {
  if (!sesion) { fallo(res, 401, "Sesion no valida."); return false; }
  if (!puede(sesion.rol, accion)) {
    fallo(res, 403, "Su rol de " + (ROLES[sesion.rol] || sesion.rol) +
      " no tiene permiso para " + (glosa || "esta accion") + ".");
    return false;
  }
  return true;
}

function asegurarGerenteInicial() {
  const hayGerente = bd.prepare("SELECT id FROM usuarios WHERE usuario = 'gerente' OR rol = 'gerente_general' LIMIT 1").get();
  if (hayGerente) return;

  const sal = crypto.randomBytes(16).toString("hex");
  bd.prepare(`INSERT INTO usuarios (nombre, usuario, correo, sal, clave_hash, rol, creado)
    VALUES (?,?,?,?,?,?,?)`)
    .run("Gerente General", "gerente", "gerente@sipan.local", sal,
      hashClave(CLAVE_GERENTE_INICIAL, sal), "gerente_general", ahora());
  auditar("sistema", "usuario_inicial", "Cuenta gerente creada automaticamente.");
}
asegurarGerenteInicial();

/* Respaldo automatico de la base, se guarda en la carpeta respaldos */
function nombreRespaldo() {
  const f = new Date();
  const pad = n => String(n).padStart(2, "0");
  return "sipan_" + f.getFullYear() + "-" + pad(f.getMonth() + 1) + "-" + pad(f.getDate()) +
    "_" + pad(f.getHours()) + pad(f.getMinutes()) + pad(f.getSeconds()) + ".db";
}

async function hacerRespaldo() {
  fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
  const archivo = nombreRespaldo();
  await backup(bd, path.join(CARPETA_RESPALDOS, archivo));

  /* Guardo nomas los ultimos respaldos y borro los viejos */
  const archivos = fs.readdirSync(CARPETA_RESPALDOS)
    .filter(f => /^sipan_\d{4}-\d{2}-\d{2}_\d{6}\.db$/.test(f))
    .sort();
  while (archivos.length > MAX_RESPALDOS) fs.unlinkSync(path.join(CARPETA_RESPALDOS, archivos.shift()));

  return archivo;
}

hacerRespaldo()
  .then(archivo => console.log("Respaldo inicial creado: " + archivo))
  .catch(error => console.error("No se pudo crear el respaldo inicial:", error.message));

setInterval(() => {
  hacerRespaldo().catch(error => console.error("No se pudo crear el respaldo programado:", error.message));
}, HORAS_ENTRE_RESPALDOS * 60 * 60000).unref?.();

/* Guardo los logins que estan esperando el codigo 2FA */
const pendientes2FA = new Map();
/* Guardo los 2FA que se estan activando pero aun no confirman */
const pendientesAlta2FA = new Map();
setInterval(() => {
  const t = Date.now();
  for (const [vale, dato] of pendientes2FA) if (t > dato.vence) pendientes2FA.delete(vale);
  for (const [uid, dato] of pendientesAlta2FA) if (t > dato.vence) pendientesAlta2FA.delete(uid);
}, 60000).unref?.();

/* Freno la cantidad de peticiones por IP */
const trafico = new Map();
function excesoDeTrafico(ip, limite, ambito) {
  const minuto = Math.floor(Date.now() / 60000);
  const clave = ambito + ":" + ip + ":" + minuto;
  const total = (trafico.get(clave) || 0) + 1;
  trafico.set(clave, total);
  if (trafico.size > 5000) trafico.clear();
  return total > limite;
}

/* Bloqueo la cuenta si falla muchas veces */

function bloqueoActivo(identidad) {
  const fila = bd.prepare("SELECT hasta FROM intentos WHERE identidad = ?").get(identidad);
  if (!fila) return 0;
  const restante = fila.hasta - Date.now();
  return restante > 0 ? Math.ceil(restante / 60000) : 0;
}

function registrarFallo(identidad) {
  const fila = bd.prepare("SELECT total FROM intentos WHERE identidad = ?").get(identidad);
  const total = (fila ? fila.total : 0) + 1;
  if (total >= MAX_INTENTOS) {
    bd.prepare(`INSERT INTO intentos (identidad, total, hasta) VALUES (?,0,?)
      ON CONFLICT(identidad) DO UPDATE SET total = 0, hasta = excluded.hasta`)
      .run(identidad, Date.now() + MINUTOS_BLOQUEO * 60000);
    return 0;
  }
  bd.prepare(`INSERT INTO intentos (identidad, total, hasta) VALUES (?,?,0)
    ON CONFLICT(identidad) DO UPDATE SET total = excluded.total`).run(identidad, total);
  return MAX_INTENTOS - total;
}

function limpiarFallos(identidad) {
  bd.prepare("DELETE FROM intentos WHERE identidad = ?").run(identidad);
}

/* Manejo las sesiones; vencen por inactividad */

function crearSesion(usuarioId) {
  const sesion = { token: token(), csrf: token() };
  bd.prepare("INSERT INTO sesiones (token, csrf, usuario_id, vence) VALUES (?,?,?,?)")
    .run(sesion.token, sesion.csrf, usuarioId, Date.now() + MINUTOS_SESION * 60000);
  return sesion;
}

function sesionDe(req) {
  const cookies = req.headers.cookie || "";
  const par = cookies.split(";").map(c => c.trim()).find(c => c.startsWith("sipan_sesion="));
  if (!par) return null;

  const fila = bd.prepare(`
    SELECT s.token, s.csrf, s.vence, u.id, u.nombre, u.usuario, u.rol
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ?`).get(par.slice(13));

  if (!fila) return null;
  if (Date.now() > fila.vence) {
    bd.prepare("DELETE FROM sesiones WHERE token = ?").run(fila.token);
    return null;
  }

  /* Si hay actividad, renuevo el tiempo de la sesion */
  bd.prepare("UPDATE sesiones SET vence = ? WHERE token = ?")
    .run(Date.now() + MINUTOS_SESION * 60000, fila.token);
  return fila;
}

/* Funciones de ayuda para las respuestas HTTP */

function responder(res, codigo, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(cuerpo);
}

function fallo(res, codigo, errores) {
  responder(res, codigo, { errores: Array.isArray(errores) ? errores : [errores] });
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let datos = "";
    req.on("data", trozo => {
      datos += trozo;
      if (datos.length > 100000) { rechazar(new Error("Cuerpo demasiado grande")); req.destroy(); }
    });
    req.on("end", () => {
      if (!datos) return resolver({});
      try { resolver(JSON.parse(datos)); }
      catch { rechazar(new Error("JSON invalido")); }
    });
    req.on("error", rechazar);
  });
}

function cabecerasSeguras(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  /* Dejo usar la camara solo en el sitio, la necesita el lector de codigo de barras */
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' https://www.google.com https://www.gstatic.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "frame-src https://www.google.com; " +
    "connect-src 'self'");
}

/* Exijo sesion valida y, si escribe, el token CSRF */
function exigirSesion(req, res, mutacion) {
  const sesion = sesionDe(req);
  if (!sesion) { fallo(res, 401, "Sesion no valida o vencida. Inicie sesion de nuevo."); return null; }
  if (mutacion && !compararSeguro(req.headers["x-token"] || "", sesion.csrf)) {
    fallo(res, 403, "Token de seguridad invalido. Recargue la pagina.");
    return null;
  }
  return sesion;
}

function exigirAdmin(sesion, res) {
  if (!esGerencia(sesion)) {
    fallo(res, 403, "Esta accion requiere rol de gerente general o administrador.");
    return false;
  }
  return true;
}

/* Aca estan todas las rutas de la API */

const api = {

  "POST /api/registro": async (req, res) => {
    fallo(res, 403, "El registro publico esta desactivado. Un gerente debe crear la cuenta desde el panel.");
  },

  "GET /api/roles": async (req, res) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirGerencia(sesion, res)) return;
    responder(res, 200, Object.entries(ROLES).map(([valor, nombre]) => ({ valor, nombre })));
  },

  "GET /api/usuarios": async (req, res) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirGerencia(sesion, res)) return;
    const filas = bd.prepare(`
      SELECT id, nombre, usuario, correo, rol, creado
      FROM usuarios ORDER BY rol, nombre`).all();
    responder(res, 200, { filas, roles: ROLES });
  },

  "POST /api/usuarios": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion || !exigirGerencia(sesion, res)) return;

    const datos = await leerCuerpo(req);

    /* Campo trampa: si lo llenan, es un robot */
    if (datos.empresa_web) { fallo(res, 400, "Solicitud rechazada."); return; }

    const errores = Validacion.registroUsuario(datos);
    if (!rolValido(datos.rol)) errores.push("Debe elegir un rol valido.");
    if (sesion.rol !== "gerente_general" && datos.rol === "gerente_general")
      errores.push("Solo el gerente general puede crear otro gerente general.");
    if (errores.length) { fallo(res, 422, errores); return; }

    const usuario = String(datos.usuario).trim().toLowerCase();
    const correo = String(datos.correo).trim().toLowerCase();

    if (bd.prepare("SELECT id FROM usuarios WHERE correo = ?").get(correo)) {
      fallo(res, 409, "El correo ya esta registrado."); return;
    }
    if (bd.prepare("SELECT id FROM usuarios WHERE usuario = ?").get(usuario)) {
      fallo(res, 409, "El nombre de usuario ya esta en uso."); return;
    }

    const sal = crypto.randomBytes(16).toString("hex");

    bd.prepare(`INSERT INTO usuarios (nombre, usuario, correo, sal, clave_hash, rol, creado)
      VALUES (?,?,?,?,?,?,?)`)
      .run(String(datos.nombre).trim(), usuario, correo, sal,
        hashClave(datos.clave, sal), datos.rol, ahora());

    auditar(sesion.usuario, "usuario_creado", "Cuenta " + usuario + " con rol " + datos.rol);
    responder(res, 201, { mensaje: "Usuario creado correctamente.", rol: datos.rol });
  },

  "PUT /api/usuarios/:id/rol": async (req, res, ip, url, id) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion || !exigirGerencia(sesion, res)) return;

    const datos = await leerCuerpo(req);
    if (Validacion.vacio(datos.clave)) { fallo(res, 422, "Ingrese su clave para confirmar el cambio."); return; }
    if (!rolValido(datos.rol)) { fallo(res, 422, "Debe elegir un rol valido."); return; }

    /* Pido la clave de quien hace el cambio */
    const quienCambia = bd.prepare("SELECT * FROM usuarios WHERE id = ?").get(sesion.id);
    if (!compararSeguro(hashClave(datos.clave, quienCambia.sal), quienCambia.clave_hash)) {
      fallo(res, 401, "La clave no es correcta."); return;
    }

    const objetivo = bd.prepare("SELECT * FROM usuarios WHERE id = ?").get(Number(id));
    if (!objetivo) { fallo(res, 404, "El usuario no existe."); return; }

    if (datos.rol === "gerente_general" && sesion.rol !== "gerente_general") {
      fallo(res, 403, "Solo el gerente general puede asignar ese rol."); return;
    }

    if (objetivo.rol === "gerente_general" && datos.rol !== "gerente_general") {
      const otrosGerentes = bd.prepare(
        "SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'gerente_general' AND id != ?").get(objetivo.id).n;
      if (otrosGerentes === 0) { fallo(res, 422, "Debe existir al menos un gerente general."); return; }
    }

    bd.prepare("UPDATE usuarios SET rol = ? WHERE id = ?").run(datos.rol, objetivo.id);
    /* Al cambiar el rol, cierro las sesiones de ese usuario */
    bd.prepare("DELETE FROM sesiones WHERE usuario_id = ?").run(objetivo.id);

    auditar(sesion.usuario, "cambio_rol",
      "Cuenta " + objetivo.usuario + " paso de " + objetivo.rol + " a " + datos.rol);
    responder(res, 200, { mensaje: "Rol actualizado correctamente.", rol: datos.rol });
  },

  "POST /api/login": async (req, res, ip) => {
    if (excesoDeTrafico(ip, 30, "login")) { fallo(res, 429, "Demasiadas solicitudes. Espere un minuto."); return; }

    const datos = await leerCuerpo(req);
    if (datos.empresa_web) { fallo(res, 400, "Solicitud rechazada."); return; }
    if (!(await captchaValido(datos.captcha, ip))) { fallo(res, 400, "No se pudo verificar el captcha. Intente de nuevo."); return; }

    const errores = Validacion.inicioSesion(datos);
    if (errores.length) { fallo(res, 422, errores); return; }

    const identidad = String(datos.usuario).trim().toLowerCase();

    const minutos = bloqueoActivo(identidad);
    if (minutos > 0) {
      fallo(res, 423, "Cuenta bloqueada por intentos fallidos. Espere " + minutos + " minutos.");
      return;
    }

    const cuenta = bd.prepare("SELECT * FROM usuarios WHERE usuario = ? OR correo = ?")
      .get(identidad, identidad);

    const valido = cuenta && compararSeguro(hashClave(datos.clave, cuenta.sal), cuenta.clave_hash);

    if (!valido) {
      const restantes = registrarFallo(identidad);
      auditar(identidad, "acceso_fallido", "Credenciales incorrectas");
      fallo(res, 401, restantes > 0
        ? "Usuario o clave incorrectos. Le quedan " + restantes + " intentos."
        : "Usuario o clave incorrectos. Cuenta bloqueada por " + MINUTOS_BLOQUEO + " minutos.");
      return;
    }

    limpiarFallos(identidad);

    /* Si la cuenta usa 2FA, la clave sola no basta: entrego un vale y pido el codigo */
    if (cuenta.dosfa_activo) {
      const vale = token();
      pendientes2FA.set(vale, { usuarioId: cuenta.id, vence: Date.now() + 5 * 60000 });
      auditar(cuenta.usuario, "acceso_2fa_pendiente", "Clave correcta, esperando codigo de verificacion");
      responder(res, 200, { requiere2FA: true, vale, usuario: cuenta.usuario });
      return;
    }

    const sesion = crearSesion(cuenta.id);
    auditar(cuenta.usuario, "acceso", "Inicio de sesion");

    res.setHeader("Set-Cookie",
      "sipan_sesion=" + sesion.token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + (MINUTOS_SESION * 60));
    responder(res, 200, {
      csrf: sesion.csrf,
      perfil: { nombre: cuenta.nombre, usuario: cuenta.usuario, rol: cuenta.rol }
    });
  },

  "POST /api/login/2fa": async (req, res, ip) => {
    if (excesoDeTrafico(ip, 30, "login2fa")) { fallo(res, 429, "Demasiadas solicitudes. Espere un minuto."); return; }

    const datos = await leerCuerpo(req);
    const pendiente = pendientes2FA.get(String(datos.vale || ""));
    if (!pendiente || Date.now() > pendiente.vence) {
      pendientes2FA.delete(String(datos.vale || ""));
      fallo(res, 401, "La verificacion expiro. Vuelva a iniciar sesion."); return;
    }

    const cuenta = bd.prepare("SELECT * FROM usuarios WHERE id = ?").get(pendiente.usuarioId);
    if (!cuenta || !cuenta.dosfa_activo) { fallo(res, 401, "Cuenta no valida."); return; }

    const codigo = String(datos.codigo || "").trim();
    let valido = TOTP.verificar(cuenta.dosfa_secreto, codigo);
    let usoRespaldo = false;

    /* Si no es el codigo de la app, pruebo con uno de respaldo */
    if (!valido && codigo) {
      const respaldos = cuenta.dosfa_respaldo ? JSON.parse(cuenta.dosfa_respaldo) : [];
      const hash = hashSimple(codigo.toUpperCase());
      const indice = respaldos.indexOf(hash);
      if (indice !== -1) {
        respaldos.splice(indice, 1);
        bd.prepare("UPDATE usuarios SET dosfa_respaldo = ? WHERE id = ?")
          .run(JSON.stringify(respaldos), cuenta.id);
        valido = true; usoRespaldo = true;
      }
    }

    if (!valido) {
      const restantes = registrarFallo(String(cuenta.usuario).toLowerCase());
      auditar(cuenta.usuario, "acceso_2fa_fallido", "Codigo de verificacion incorrecto");
      fallo(res, 401, restantes > 0
        ? "Codigo incorrecto. Le quedan " + restantes + " intentos."
        : "Codigo incorrecto. Cuenta bloqueada por " + MINUTOS_BLOQUEO + " minutos.");
      return;
    }

    pendientes2FA.delete(String(datos.vale));
    limpiarFallos(String(cuenta.usuario).toLowerCase());
    const sesion = crearSesion(cuenta.id);
    auditar(cuenta.usuario, "acceso", "Inicio de sesion con verificacion en dos pasos" +
      (usoRespaldo ? " (codigo de respaldo)" : ""));

    res.setHeader("Set-Cookie",
      "sipan_sesion=" + sesion.token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + (MINUTOS_SESION * 60));
    responder(res, 200, {
      csrf: sesion.csrf,
      avisoRespaldo: usoRespaldo,
      perfil: { nombre: cuenta.nombre, usuario: cuenta.usuario, rol: cuenta.rol }
    });
  },

  /* Respondo siempre lo mismo aca para no revelar si la cuenta existe */
  "POST /api/recuperar": async (req, res, ip) => {
    if (excesoDeTrafico(ip, 10, "recuperar")) { fallo(res, 429, "Demasiadas solicitudes. Espere un minuto."); return; }

    const datos = await leerCuerpo(req);
    if (datos.empresa_web) { fallo(res, 400, "Solicitud rechazada."); return; }
    if (!(await captchaValido(datos.captcha, ip))) { fallo(res, 400, "No se pudo verificar el captcha. Intente de nuevo."); return; }
    if (Validacion.vacio(datos.identidad)) { fallo(res, 422, "Ingrese su usuario o correo."); return; }

    const identidad = String(datos.identidad).trim().toLowerCase();
    const mensaje = "Si el usuario existe, se envio un correo con instrucciones para recuperar el acceso.";

    const cuenta = bd.prepare("SELECT * FROM usuarios WHERE usuario = ? OR correo = ?").get(identidad, identidad);
    if (!cuenta) { responder(res, 200, { mensaje }); return; }

    const tok = token();
    bd.prepare("INSERT INTO recuperaciones (token, usuario_id, vence, usado) VALUES (?,?,?,0)")
      .run(tok, cuenta.id, Date.now() + MINUTOS_RECUPERACION * 60000);

    const protocolo = req.headers["x-forwarded-proto"] || "http";
    const enlace = protocolo + "://" + (req.headers.host || "localhost") + "/restablecer.html?token=" + tok;

    await enviarCorreo(cuenta.correo, "Recuperar acceso - Sistema Sipan",
      "<p>Hola " + escXml(cuenta.nombre) + ",</p>" +
      "<p>Pidieron restablecer la clave de tu cuenta en el sistema de inventario de Comercializadora Sipan.</p>" +
      '<p><a href="' + enlace + '">Restablecer mi clave</a></p>' +
      "<p>El enlace vence en " + MINUTOS_RECUPERACION + " minutos. Si no fuiste tu, ignora este correo.</p>");

    auditar(cuenta.usuario, "recuperacion_solicitada", "Se pidio un enlace para restablecer la clave");
    responder(res, 200, { mensaje });
  },

  /* Reviso si el enlace todavia sirve antes de mostrar el formulario */
  "GET /api/recuperar/:token": async (req, res, ip, url, tok) => {
    const fila = bd.prepare("SELECT * FROM recuperaciones WHERE token = ?").get(tok);
    if (!fila || fila.usado || Date.now() > fila.vence) { fallo(res, 400, "El enlace no es valido o ya vencio."); return; }
    responder(res, 200, { valido: true });
  },

  "POST /api/restablecer": async (req, res, ip) => {
    if (excesoDeTrafico(ip, 20, "restablecer")) { fallo(res, 429, "Demasiadas solicitudes. Espere un minuto."); return; }

    const datos = await leerCuerpo(req);
    if (Validacion.vacio(datos.token)) { fallo(res, 422, "El enlace no es valido."); return; }

    const errores = Validacion.clave(datos.clave);
    if (Validacion.vacio(datos.confirmacion)) errores.push("Debe repetir la clave.");
    else if (datos.clave !== datos.confirmacion) errores.push("Las claves no coinciden.");
    if (errores.length) { fallo(res, 422, errores); return; }

    const fila = bd.prepare("SELECT * FROM recuperaciones WHERE token = ?").get(String(datos.token));
    if (!fila || fila.usado || Date.now() > fila.vence) { fallo(res, 400, "El enlace no es valido o ya vencio."); return; }

    const cuenta = bd.prepare("SELECT * FROM usuarios WHERE id = ?").get(fila.usuario_id);
    if (!cuenta) { fallo(res, 400, "La cuenta ya no existe."); return; }

    const sal = crypto.randomBytes(16).toString("hex");
    bd.prepare("UPDATE usuarios SET sal = ?, clave_hash = ? WHERE id = ?")
      .run(sal, hashClave(datos.clave, sal), cuenta.id);
    bd.prepare("UPDATE recuperaciones SET usado = 1 WHERE token = ?").run(fila.token);
    bd.prepare("DELETE FROM sesiones WHERE usuario_id = ?").run(cuenta.id);
    limpiarFallos(String(cuenta.usuario).toLowerCase());

    auditar(cuenta.usuario, "clave_restablecida", "Clave restablecida mediante enlace de recuperacion");
    responder(res, 200, { mensaje: "Su clave fue actualizada. Ya puede iniciar sesion." });
  },

  "POST /api/salir": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;
    bd.prepare("DELETE FROM sesiones WHERE token = ?").run(sesion.token);
    auditar(sesion.usuario, "salida", "Cierre de sesion");
    res.setHeader("Set-Cookie", "sipan_sesion=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    responder(res, 200, { mensaje: "Sesion cerrada." });
  },

  "GET /api/sesion": async (req, res) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion) return;
    const cuenta = bd.prepare("SELECT dosfa_activo FROM usuarios WHERE id = ?").get(sesion.id);
    responder(res, 200, {
      csrf: sesion.csrf,
      perfil: {
        nombre: sesion.nombre, usuario: sesion.usuario, rol: sesion.rol,
        rolNombre: ROLES[sesion.rol] || sesion.rol,
        dosfaActivo: !!(cuenta && cuenta.dosfa_activo)
      },
      permisos: PERMISOS[sesion.rol] || {}
    });
  },

  "PUT /api/clave": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;

    const datos = await leerCuerpo(req);
    if (Validacion.vacio(datos.actual)) { fallo(res, 422, "Ingrese su clave actual."); return; }

    const errores = Validacion.clave(datos.nueva);
    if (datos.nueva !== datos.confirmacion) errores.push("Las claves nuevas no coinciden.");
    if (errores.length) { fallo(res, 422, errores); return; }

    const cuenta = bd.prepare("SELECT * FROM usuarios WHERE id = ?").get(sesion.id);
    if (!compararSeguro(hashClave(datos.actual, cuenta.sal), cuenta.clave_hash)) {
      fallo(res, 401, "La clave actual no es correcta."); return;
    }

    const sal = crypto.randomBytes(16).toString("hex");
    bd.prepare("UPDATE usuarios SET sal = ?, clave_hash = ? WHERE id = ?")
      .run(sal, hashClave(datos.nueva, sal), sesion.id);

    /* Cierro las otras sesiones del usuario */
    bd.prepare("DELETE FROM sesiones WHERE usuario_id = ? AND token != ?").run(sesion.id, sesion.token);
    auditar(sesion.usuario, "clave", "Cambio de clave");
    responder(res, 200, { mensaje: "Clave actualizada." });
  },

  /* Devuelvo el estado del 2FA del usuario */
  "GET /api/2fa/estado": async (req, res) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion) return;
    const cuenta = bd.prepare("SELECT dosfa_activo, dosfa_respaldo FROM usuarios WHERE id = ?").get(sesion.id);
    const respaldos = cuenta.dosfa_respaldo ? JSON.parse(cuenta.dosfa_respaldo).length : 0;
    responder(res, 200, {
      activo: !!cuenta.dosfa_activo,
      respaldosRestantes: respaldos,
      /* El gerente general tiene que usar 2FA si o si */
      obligatorio: sesion.rol === "gerente_general"
    });
  },

  /* Paso 1 del 2FA: genero el secreto y el QR, todavia sin activar */
  "POST /api/2fa/iniciar": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;

    const secreto = TOTP.generarSecreto();
    /* Lo guardo en memoria hasta que confirme */
    pendientesAlta2FA.set(sesion.id, { secreto, vence: Date.now() + 10 * 60000 });

    const cuenta = bd.prepare("SELECT usuario FROM usuarios WHERE id = ?").get(sesion.id);
    const uri = TOTP.urlProvisionamiento(secreto, cuenta.usuario, "SIPAN Inventario");
    responder(res, 200, { secreto, uri });
  },

  /* Paso 2 del 2FA: confirmo con un codigo y entrego los de respaldo */
  "POST /api/2fa/activar": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;

    const datos = await leerCuerpo(req);
    const alta = pendientesAlta2FA.get(sesion.id);
    if (!alta || Date.now() > alta.vence) {
      pendientesAlta2FA.delete(sesion.id);
      fallo(res, 400, "La configuracion expiro. Vuelva a comenzar."); return;
    }
    if (!TOTP.verificar(alta.secreto, String(datos.codigo || "").trim())) {
      fallo(res, 422, "El codigo no es valido. Revise la hora de su telefono e intente de nuevo."); return;
    }

    const respaldos = TOTP.generarRespaldos();
    const respaldoHash = JSON.stringify(respaldos.map(c => hashSimple(c.toUpperCase())));

    bd.prepare("UPDATE usuarios SET dosfa_activo = 1, dosfa_secreto = ?, dosfa_respaldo = ? WHERE id = ?")
      .run(alta.secreto, respaldoHash, sesion.id);
    pendientesAlta2FA.delete(sesion.id);

    auditar(sesion.usuario, "2fa_activado", "Activo la verificacion en dos pasos");
    responder(res, 200, {
      mensaje: "Verificacion en dos pasos activada.",
      respaldos
    });
  },

  /* Para apagar el 2FA pido clave y codigo; el gerente general no puede */
  "POST /api/2fa/desactivar": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;

    if (sesion.rol === "gerente_general") {
      fallo(res, 403, "El gerente general debe mantener la verificacion en dos pasos activa."); return;
    }

    const datos = await leerCuerpo(req);
    const cuenta = bd.prepare("SELECT * FROM usuarios WHERE id = ?").get(sesion.id);
    if (!cuenta.dosfa_activo) { fallo(res, 400, "La verificacion no esta activa."); return; }

    if (Validacion.vacio(datos.clave) ||
        !compararSeguro(hashClave(datos.clave, cuenta.sal), cuenta.clave_hash)) {
      fallo(res, 401, "Debe ingresar su clave correcta para desactivar."); return;
    }
    if (!TOTP.verificar(cuenta.dosfa_secreto, String(datos.codigo || "").trim())) {
      fallo(res, 422, "Debe ingresar un codigo valido de su app para desactivar."); return;
    }

    bd.prepare("UPDATE usuarios SET dosfa_activo = 0, dosfa_secreto = NULL, dosfa_respaldo = NULL WHERE id = ?")
      .run(sesion.id);
    auditar(sesion.usuario, "2fa_desactivado", "Desactivo la verificacion en dos pasos");
    responder(res, 200, { mensaje: "Verificacion en dos pasos desactivada." });
  },

  "GET /api/categorias": async (req, res) => {
    if (!exigirSesion(req, res, false)) return;
    responder(res, 200, bd.prepare("SELECT * FROM categorias ORDER BY nombre").all());
  },

  "POST /api/categorias": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion || !exigirPermiso(sesion, res, "categorias", "crear categorias")) return;

    const datos = await leerCuerpo(req);
    const errores = Validacion.categoria(datos.nombre);
    if (errores.length) { fallo(res, 422, errores); return; }

    const nombre = String(datos.nombre).trim();
    if (bd.prepare("SELECT id FROM categorias WHERE lower(nombre) = lower(?)").get(nombre)) {
      fallo(res, 409, "La categoria ya existe."); return;
    }

    bd.prepare("INSERT INTO categorias (nombre) VALUES (?)").run(nombre);
    auditar(sesion.usuario, "categoria", "Categoria creada: " + nombre);
    responder(res, 201, { mensaje: "Categoria creada." });
  },

  "GET /api/productos": async (req, res, ip, url) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion) return;

    const q = url.searchParams;
    const condiciones = [];
    const valores = [];

    const estado = q.get("estado") || "";
    if (estado === "papelera") {
      if (!exigirAdmin(sesion, res)) return;
      condiciones.push("p.activo = 0");
    } else {
      condiciones.push("p.activo = 1");
      if (estado === "bajo") condiciones.push("p.stock < p.minimo");
      if (estado === "normal") condiciones.push("p.stock >= p.minimo");
    }

    if (q.get("buscar")) {
      condiciones.push("(p.nombre LIKE ? OR p.codigo LIKE ?)");
      const termino = "%" + q.get("buscar").trim() + "%";
      valores.push(termino, termino);
    }

    if (q.get("categoria")) {
      condiciones.push("p.categoria_id = ?");
      valores.push(Number(q.get("categoria")));
    }

    /* Solo dejo ordenar por columnas de una lista permitida */
    const ordenes = { nombre: "p.nombre", precio: "p.precio", stock: "p.stock", codigo: "p.codigo" };
    const orden = ordenes[q.get("orden")] || "p.codigo";
    const direccion = q.get("dir") === "desc" ? "DESC" : "ASC";

    const pagina = Math.max(1, Number(q.get("pagina")) || 1);
    const limite = 8;
    const donde = "WHERE " + condiciones.join(" AND ");

    const total = bd.prepare("SELECT COUNT(*) AS n FROM productos p " + donde).get(...valores).n;

    const filas = bd.prepare(`
      SELECT p.*, c.nombre AS categoria FROM productos p
      JOIN categorias c ON c.id = p.categoria_id
      ${donde} ORDER BY ${orden} ${direccion} LIMIT ? OFFSET ?`)
      .all(...valores, limite, (pagina - 1) * limite);

    const resumen = bd.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(precio * stock), 0) AS valor,
        SUM(CASE WHEN stock < minimo THEN 1 ELSE 0 END) AS bajos
      FROM productos WHERE activo = 1`).get();

    responder(res, 200, {
      filas, total, pagina, paginas: Math.max(1, Math.ceil(total / limite)),
      resumen: {
        total: resumen.total,
        valor: resumen.valor,
        bajos: resumen.bajos || 0,
        categorias: bd.prepare("SELECT COUNT(DISTINCT categoria_id) AS n FROM productos WHERE activo = 1").get().n
      }
    });
  },

  /* La usa el lector de codigo de barras, sea USB o camara */
  "GET /api/productos/codigo/:codigo": async (req, res, ip, url, codigoBarras) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion) return;

    const producto = bd.prepare(`
      SELECT p.*, c.nombre AS categoria FROM productos p
      JOIN categorias c ON c.id = p.categoria_id
      WHERE p.codigo_barras = ? AND p.activo = 1`).get(codigoBarras);

    if (!producto) { fallo(res, 404, "Ningun producto tiene ese codigo de barras."); return; }
    responder(res, 200, producto);
  },

  "POST /api/productos": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;
    if (!exigirPermiso(sesion, res, "inventario_editar", "registrar productos")) return;

    const datos = await leerCuerpo(req);
    const errores = Validacion.producto(datos);
    if (errores.length) { fallo(res, 422, errores); return; }

    const nombre = String(datos.nombre).trim();
    if (bd.prepare("SELECT id FROM productos WHERE nombre_clave = ?").get(nombre.toLowerCase())) {
      fallo(res, 409, "Ya existe un producto con ese nombre."); return;
    }
    if (!bd.prepare("SELECT id FROM categorias WHERE id = ?").get(Number(datos.categoria_id))) {
      fallo(res, 422, "La categoria elegida no existe."); return;
    }

    const codigoBarras = Validacion.vacio(datos.codigo_barras) ? null : String(datos.codigo_barras).trim();
    if (codigoBarras && bd.prepare("SELECT id FROM productos WHERE codigo_barras = ?").get(codigoBarras)) {
      fallo(res, 409, "Ya existe un producto con ese codigo de barras."); return;
    }

    const mayor = bd.prepare("SELECT MAX(CAST(substr(codigo, 3) AS INTEGER)) AS n FROM productos").get().n || 0;
    const codigo = "P-" + String(mayor + 1).padStart(4, "0");

    bd.prepare(`INSERT INTO productos
      (codigo, nombre, nombre_clave, categoria_id, precio, stock, minimo, codigo_barras, activo, creado, actualizado)
      VALUES (?,?,?,?,?,?,?,?,1,?,?)`)
      .run(codigo, nombre, nombre.toLowerCase(), Number(datos.categoria_id),
        Number(Number(datos.precio).toFixed(2)), Number(datos.stock), Number(datos.minimo), codigoBarras, ahora(), ahora());

    auditar(sesion.usuario, "producto_nuevo", codigo + " " + nombre);
    responder(res, 201, { mensaje: "Producto registrado.", codigo });
  },

  "PUT /api/productos/:id": async (req, res, ip, url, id) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;
    if (!exigirPermiso(sesion, res, "inventario_editar", "editar productos")) return;

    const datos = await leerCuerpo(req);
    const errores = Validacion.producto(datos);
    if (errores.length) { fallo(res, 422, errores); return; }

    const producto = bd.prepare("SELECT * FROM productos WHERE id = ? AND activo = 1").get(Number(id));
    if (!producto) { fallo(res, 404, "El producto no existe."); return; }

    const nombre = String(datos.nombre).trim();
    if (bd.prepare("SELECT id FROM productos WHERE nombre_clave = ? AND id != ?")
      .get(nombre.toLowerCase(), producto.id)) {
      fallo(res, 409, "Ya existe otro producto con ese nombre."); return;
    }

    const codigoBarras = Validacion.vacio(datos.codigo_barras) ? null : String(datos.codigo_barras).trim();
    if (codigoBarras && bd.prepare("SELECT id FROM productos WHERE codigo_barras = ? AND id != ?")
      .get(codigoBarras, producto.id)) {
      fallo(res, 409, "Ya existe otro producto con ese codigo de barras."); return;
    }

    bd.prepare(`UPDATE productos SET nombre = ?, nombre_clave = ?, categoria_id = ?,
      precio = ?, stock = ?, minimo = ?, codigo_barras = ?, actualizado = ? WHERE id = ?`)
      .run(nombre, nombre.toLowerCase(), Number(datos.categoria_id),
        Number(Number(datos.precio).toFixed(2)), Number(datos.stock), Number(datos.minimo),
        codigoBarras, ahora(), producto.id);

    auditar(sesion.usuario, "producto_editado", producto.codigo + " " + nombre);
    responder(res, 200, { mensaje: "Producto actualizado." });
  },

  "DELETE /api/productos/:id": async (req, res, ip, url, id) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion || !exigirAdmin(sesion, res)) return;

    const producto = bd.prepare("SELECT * FROM productos WHERE id = ? AND activo = 1").get(Number(id));
    if (!producto) { fallo(res, 404, "El producto no existe."); return; }

    /* No borro de verdad: mando a la papelera y se puede restaurar */
    bd.prepare("UPDATE productos SET activo = 0, actualizado = ? WHERE id = ?").run(ahora(), producto.id);
    auditar(sesion.usuario, "producto_eliminado", producto.codigo + " " + producto.nombre);
    responder(res, 200, { mensaje: "Producto enviado a la papelera." });
  },

  "POST /api/productos/:id/restaurar": async (req, res, ip, url, id) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion || !exigirAdmin(sesion, res)) return;

    const producto = bd.prepare("SELECT * FROM productos WHERE id = ? AND activo = 0").get(Number(id));
    if (!producto) { fallo(res, 404, "El producto no esta en la papelera."); return; }

    bd.prepare("UPDATE productos SET activo = 1, actualizado = ? WHERE id = ?").run(ahora(), producto.id);
    auditar(sesion.usuario, "producto_restaurado", producto.codigo + " " + producto.nombre);
    responder(res, 200, { mensaje: "Producto restaurado." });
  },

  "GET /api/movimientos": async (req, res, ip, url) => {
    if (!exigirSesion(req, res, false)) return;

    const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
    const limite = 10;
    const { desde, hasta } = rangoFechas(url);

    const condiciones = [];
    const parametros = [];
    if (desde) { condiciones.push("substr(m.fecha,1,10) >= ?"); parametros.push(desde); }
    if (hasta) { condiciones.push("substr(m.fecha,1,10) <= ?"); parametros.push(hasta); }
    const dondeSql = condiciones.length ? " WHERE " + condiciones.join(" AND ") : "";

    const total = bd.prepare("SELECT COUNT(*) AS n FROM movimientos m" + dondeSql).get(...parametros).n;

    const filas = bd.prepare(`
      SELECT m.*, p.nombre AS producto, p.codigo FROM movimientos m
      JOIN productos p ON p.id = m.producto_id` + dondeSql + `
      ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...parametros, limite, (pagina - 1) * limite);

    responder(res, 200, { filas, total, pagina, paginas: Math.max(1, Math.ceil(total / limite)) });
  },

  "POST /api/movimientos": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;
    if (!exigirPermiso(sesion, res, "movimientos", "registrar movimientos de almacen")) return;

    const datos = await leerCuerpo(req);
    const errores = Validacion.movimiento(datos);
    if (errores.length) { fallo(res, 422, errores); return; }

    /* El movimiento y el stock cambian juntos, o no cambia nada */
    bd.exec("BEGIN");
    try {
      const producto = bd.prepare("SELECT * FROM productos WHERE id = ? AND activo = 1")
        .get(Number(datos.producto_id));
      if (!producto) throw { codigo: 404, mensaje: "El producto no existe." };

      const cantidad = Number(datos.cantidad);
      if (datos.tipo === "salida" && cantidad > producto.stock)
        throw { codigo: 422, mensaje: "La salida (" + cantidad + ") supera el stock disponible (" + producto.stock + ")." };

      const nuevoStock = datos.tipo === "entrada" ? producto.stock + cantidad : producto.stock - cantidad;

      bd.prepare("UPDATE productos SET stock = ?, actualizado = ? WHERE id = ?")
        .run(nuevoStock, ahora(), producto.id);
      bd.prepare(`INSERT INTO movimientos (producto_id, tipo, cantidad, motivo, usuario, fecha)
        VALUES (?,?,?,?,?,?)`)
        .run(producto.id, datos.tipo, cantidad, String(datos.motivo).trim(), sesion.usuario, ahora());

      bd.exec("COMMIT");
      avisarSiStockCritico(producto, nuevoStock);
      auditar(sesion.usuario, "movimiento",
        datos.tipo + " de " + cantidad + " x " + producto.nombre);
      responder(res, 201, { mensaje: "Movimiento registrado. Nuevo stock: " + nuevoStock + "." });
    } catch (error) {
      bd.exec("ROLLBACK");
      fallo(res, error.codigo || 500, error.mensaje || "No se pudo registrar el movimiento.");
    }
  },

  "GET /api/tickets": async (req, res, ip, url) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion) return;

    const estado = url.searchParams.get("estado") === "cerrado" ? "cerrado" : "abierto";
    const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
    const limite = 10;
    const total = bd.prepare("SELECT COUNT(*) AS n FROM tickets WHERE estado = ?").get(estado).n;
    const filas = bd.prepare(`
      SELECT t.*, p.codigo, p.nombre AS producto
      FROM tickets t LEFT JOIN productos p ON p.id = t.producto_id
      WHERE t.estado = ? ORDER BY t.id DESC LIMIT ? OFFSET ?`)
      .all(estado, limite, (pagina - 1) * limite);

    responder(res, 200, { filas, total, pagina, paginas: Math.max(1, Math.ceil(total / limite)) });
  },

  "POST /api/tickets": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;

    const datos = await leerCuerpo(req);

    /* Vender es solo del vendedor y la gerencia */
    if (datos.tipo === "venta") {
      if (!exigirPermiso(sesion, res, "vender", "registrar ventas")) return;
    } else {
      if (!exigirPermiso(sesion, res, "tickets", "registrar tickets")) return;
    }

    const errores = Validacion.ticket(datos);
    if (errores.length) { fallo(res, 422, errores); return; }

    const productoId = datos.producto_id ? Number(datos.producto_id) : null;
    if (productoId && !bd.prepare("SELECT id FROM productos WHERE id = ? AND activo = 1").get(productoId)) {
      fallo(res, 422, "El producto elegido no existe."); return;
    }

    /* La venta registra el ticket y descuenta el stock a la vez */
    if (datos.tipo === "venta") {
      const cantidad = Number(datos.cantidad);
      bd.exec("BEGIN");
      try {
        const producto = bd.prepare("SELECT * FROM productos WHERE id = ? AND activo = 1").get(productoId);
        if (!producto) throw { codigo: 422, mensaje: "El producto elegido no existe." };
        if (cantidad > producto.stock)
          throw { codigo: 422, mensaje: "La venta (" + cantidad + ") supera el stock disponible (" + producto.stock + ")." };

        const nuevoStock = producto.stock - cantidad;
        bd.prepare("UPDATE productos SET stock = ?, actualizado = ? WHERE id = ?")
          .run(nuevoStock, ahora(), producto.id);
        bd.prepare(`INSERT INTO movimientos (producto_id, tipo, cantidad, motivo, usuario, fecha)
          VALUES (?, 'salida', ?, ?, ?, ?)`)
          .run(producto.id, cantidad, "Venta: " + String(datos.titulo).trim(), sesion.usuario, ahora());

        const momento = ahora();
        bd.prepare(`INSERT INTO tickets
          (producto_id, tipo, prioridad, titulo, detalle, cantidad, estado, creado_por, creado, cerrado)
          VALUES (?,?,?,?,?,?,'cerrado',?,?,?)`)
          .run(producto.id, "venta", datos.prioridad, String(datos.titulo).trim(),
            String(datos.detalle).trim(), cantidad, sesion.usuario, momento, momento);

        bd.exec("COMMIT");
        avisarSiStockCritico(producto, nuevoStock);
        auditar(sesion.usuario, "venta",
          "Venta de " + cantidad + " x " + producto.nombre + ". Nuevo stock: " + nuevoStock + ".");
        responder(res, 201, { mensaje: "Venta registrada. Nuevo stock: " + nuevoStock + "." });
      } catch (error) {
        bd.exec("ROLLBACK");
        fallo(res, error.codigo || 500, error.mensaje || "No se pudo registrar la venta.");
      }
      return;
    }

    bd.prepare(`INSERT INTO tickets
      (producto_id, tipo, prioridad, titulo, detalle, estado, creado_por, creado)
      VALUES (?,?,?,?,?,'abierto',?,?)`)
      .run(productoId, datos.tipo, datos.prioridad, String(datos.titulo).trim(),
        String(datos.detalle).trim(), sesion.usuario, ahora());

    auditar(sesion.usuario, "ticket", "Ticket creado: " + String(datos.titulo).trim());
    responder(res, 201, { mensaje: "Ticket registrado." });
  },

  "POST /api/tickets/:id/cerrar": async (req, res, ip, url, id) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;

    const ticket = bd.prepare("SELECT * FROM tickets WHERE id = ? AND estado = 'abierto'").get(Number(id));
    if (!ticket) { fallo(res, 404, "El ticket no existe o ya esta cerrado."); return; }

    bd.prepare("UPDATE tickets SET estado = 'cerrado', cerrado = ? WHERE id = ?").run(ahora(), ticket.id);
    auditar(sesion.usuario, "ticket_cerrado", "Ticket cerrado: " + ticket.titulo);
    responder(res, 200, { mensaje: "Ticket cerrado." });
  },

  /* Venta mayorista: armo la boleta con varios productos y descuento el stock */
  "POST /api/ventas/mayorista": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion) return;
    if (!exigirPermiso(sesion, res, "vender", "emitir boletas de venta")) return;

    const datos = await leerCuerpo(req);
    const errores = Validacion.boletaMayorista(datos);
    if (errores.length) { fallo(res, 422, errores); return; }

    const descuentoPct = datos.descuento_pct ? Number(datos.descuento_pct) : 0;

    bd.exec("BEGIN");
    try {
      const items = [];
      const paraAvisar = [];
      let subtotal = 0;

      for (const linea of datos.items) {
        const producto = bd.prepare("SELECT * FROM productos WHERE id = ? AND activo = 1")
          .get(Number(linea.producto_id));
        if (!producto) throw { codigo: 422, mensaje: "Un producto de la boleta ya no existe." };

        const cantidad = Number(linea.cantidad);
        if (cantidad > producto.stock)
          throw { codigo: 422, mensaje: producto.nombre + ": la venta (" + cantidad +
            ") supera el stock disponible (" + producto.stock + ")." };

        const importe = Number((producto.precio * cantidad).toFixed(2));
        subtotal += importe;

        const nuevoStock = producto.stock - cantidad;
        bd.prepare("UPDATE productos SET stock = ?, actualizado = ? WHERE id = ?")
          .run(nuevoStock, ahora(), producto.id);
        bd.prepare(`INSERT INTO movimientos (producto_id, tipo, cantidad, motivo, usuario, fecha)
          VALUES (?, 'salida', ?, ?, ?, ?)`)
          .run(producto.id, cantidad, "Venta mayorista a " + String(datos.cliente).trim(),
            sesion.usuario, ahora());

        items.push({
          producto_id: producto.id, codigo: producto.codigo, nombre: producto.nombre,
          cantidad, precio: producto.precio, importe
        });
        paraAvisar.push({ producto, nuevoStock });
      }

      subtotal = Number(subtotal.toFixed(2));
      const descuentoMonto = Number((subtotal * descuentoPct / 100).toFixed(2));
      const total = Number((subtotal - descuentoMonto).toFixed(2));

      /* Numero de boleta correlativo */
      const ultimo = bd.prepare("SELECT MAX(id) AS n FROM boletas").get().n || 0;
      const numero = "B001-" + String(ultimo + 1).padStart(6, "0");
      const momento = ahora();

      const resultado = bd.prepare(`INSERT INTO boletas
        (numero, cliente, documento, direccion, subtotal, descuento_pct, descuento_monto, total, observacion, vendedor, creado)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(numero, String(datos.cliente).trim(),
          datos.documento ? String(datos.documento).trim() : null,
          datos.direccion ? String(datos.direccion).trim() : null,
          subtotal, descuentoPct, descuentoMonto, total,
          datos.observacion ? String(datos.observacion).trim() : null,
          sesion.usuario, momento);

      const boletaId = resultado.lastInsertRowid;
      const insItem = bd.prepare(`INSERT INTO boleta_items
        (boleta_id, producto_id, codigo, nombre, cantidad, precio, importe)
        VALUES (?,?,?,?,?,?,?)`);
      for (const it of items)
        insItem.run(boletaId, it.producto_id, it.codigo, it.nombre, it.cantidad, it.precio, it.importe);

      bd.exec("COMMIT");
      paraAvisar.forEach(a => avisarSiStockCritico(a.producto, a.nuevoStock));
      auditar(sesion.usuario, "venta_mayorista",
        "Boleta " + numero + " a " + String(datos.cliente).trim() + " por " + total +
        (descuentoPct ? " (dscto " + descuentoPct + "%)" : ""));

      responder(res, 201, {
        mensaje: "Boleta " + numero + " emitida.",
        boleta: {
          id: boletaId, numero, cliente: String(datos.cliente).trim(),
          documento: datos.documento || "", direccion: datos.direccion || "",
          observacion: datos.observacion || "",
          subtotal, descuento_pct: descuentoPct, descuento_monto: descuentoMonto, total,
          vendedor: sesion.usuario, creado: momento, items
        }
      });
    } catch (error) {
      bd.exec("ROLLBACK");
      fallo(res, error.codigo || 500, error.mensaje || "No se pudo emitir la boleta.");
    }
  },

  "GET /api/ventas/boletas": async (req, res, ip, url) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirPermiso(sesion, res, "vender", "ver boletas")) return;

    const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
    const limite = 8;
    const total = bd.prepare("SELECT COUNT(*) AS n FROM boletas").get().n;
    const filas = bd.prepare("SELECT * FROM boletas ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(limite, (pagina - 1) * limite);
    responder(res, 200, { filas, total, pagina, paginas: Math.max(1, Math.ceil(total / limite)) });
  },

  "GET /api/ventas/boleta/:id": async (req, res, ip, url, id) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirPermiso(sesion, res, "vender", "ver boletas")) return;

    const boleta = bd.prepare("SELECT * FROM boletas WHERE id = ?").get(Number(id));
    if (!boleta) { fallo(res, 404, "La boleta no existe."); return; }
    const items = bd.prepare("SELECT * FROM boleta_items WHERE boleta_id = ? ORDER BY id").all(boleta.id);
    responder(res, 200, { boleta, items });
  },

  "GET /api/ventas/boleta/:id/pdf": async (req, res, ip, url, id) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirPermiso(sesion, res, "vender", "ver boletas")) return;

    const boleta = bd.prepare("SELECT * FROM boletas WHERE id = ?").get(Number(id));
    if (!boleta) { fallo(res, 404, "La boleta no existe."); return; }
    const items = bd.prepare("SELECT * FROM boleta_items WHERE boleta_id = ? ORDER BY id").all(boleta.id);

    const pdf = await construirPdfBoleta(boleta, items);
    auditar(sesion.usuario, "exportacion", "Descarga de boleta " + boleta.numero + " en PDF");
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="boleta_' + boleta.numero + '.pdf"'
    });
    res.end(pdf);
  },

  "GET /api/reportes": async (req, res, ip, url) => {
    if (!exigirSesion(req, res, false)) return;
    responder(res, 200, datosReportes(url));
  },

  "GET /api/reportes/pdf": async (req, res, ip, url) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion) return;

    const pdf = await construirPdfReporte(datosReportes(url), sesion.usuario);
    auditar(sesion.usuario, "exportacion", "Descarga del reporte en PDF");
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="reporte_sipan.pdf"'
    });
    res.end(pdf);
  },

  "GET /api/auditoria": async (req, res, ip, url) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirAdmin(sesion, res)) return;

    const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
    const limite = 15;
    const total = bd.prepare("SELECT COUNT(*) AS n FROM auditoria").get().n;
    const filas = bd.prepare("SELECT * FROM auditoria ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(limite, (pagina - 1) * limite);

    responder(res, 200, { filas, total, pagina, paginas: Math.max(1, Math.ceil(total / limite)) });
  },

  "GET /api/respaldos": async (req, res) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirAdmin(sesion, res)) return;

    fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
    const archivos = fs.readdirSync(CARPETA_RESPALDOS)
      .filter(f => /^sipan_\d{4}-\d{2}-\d{2}_\d{6}\.db$/.test(f))
      .map(nombre => {
        const info = fs.statSync(path.join(CARPETA_RESPALDOS, nombre));
        return { nombre, tamano: info.size, creado: info.mtime.toISOString() };
      })
      .sort((a, b) => b.nombre.localeCompare(a.nombre));

    responder(res, 200, { archivos, maximo: MAX_RESPALDOS, horas: HORAS_ENTRE_RESPALDOS });
  },

  "POST /api/respaldos": async (req, res) => {
    const sesion = exigirSesion(req, res, true);
    if (!sesion || !exigirAdmin(sesion, res)) return;

    try {
      const archivo = await hacerRespaldo();
      auditar(sesion.usuario, "respaldo_manual", "Respaldo creado a pedido: " + archivo);
      responder(res, 201, { mensaje: "Respaldo creado: " + archivo, archivo });
    } catch (error) {
      fallo(res, 500, "No se pudo crear el respaldo: " + error.message);
    }
  },

  "GET /api/respaldos/:archivo": async (req, res, ip, url, archivo) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirAdmin(sesion, res)) return;

    const ruta = path.join(CARPETA_RESPALDOS, archivo);
    if (!fs.existsSync(ruta)) { fallo(res, 404, "El respaldo no existe."); return; }

    auditar(sesion.usuario, "respaldo_descargado", "Descarga del respaldo " + archivo);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="' + archivo + '"'
    });
    fs.createReadStream(ruta).pipe(res);
  },

  "GET /api/exportar": async (req, res) => {
    const sesion = exigirSesion(req, res, false);
    if (!sesion || !exigirPermiso(sesion, res, "exportar", "exportar el inventario")) return;

    const filas = bd.prepare(`
      SELECT p.codigo, p.nombre, c.nombre AS categoria, p.precio, p.stock, p.minimo
      FROM productos p JOIN categorias c ON c.id = p.categoria_id
      WHERE p.activo = 1 ORDER BY p.codigo`).all();

    const resumen = bd.prepare(`
      SELECT COUNT(*) AS total, COALESCE(SUM(precio*stock),0) AS valor,
        SUM(CASE WHEN stock < minimo THEN 1 ELSE 0 END) AS bajos
      FROM productos WHERE activo = 1`).get();

    const libro = construirExcelInventario(filas, resumen, sesion.usuario);

    auditar(sesion.usuario, "exportacion", "Descarga del inventario en Excel");
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="inventario_sipan.xlsx"'
    });
    res.end(libro);
  }
};

/* Aca genero el Excel (.xlsx) a mano en Node, sin librerias */

const zlib = require("node:zlib");

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Armo el ZIP del Excel */
function armarZip(archivos) {
  const locales = [];
  const central = [];
  let offset = 0;

  for (const { nombre, contenido } of archivos) {
    const nombreBuf = Buffer.from(nombre, "utf8");
    const datos = Buffer.from(contenido, "utf8");
    const comprimido = zlib.deflateRawSync(datos);
    const crc = crc32(datos);

    const cabLocal = Buffer.alloc(30);
    cabLocal.writeUInt32LE(0x04034b50, 0);
    cabLocal.writeUInt16LE(20, 4);
    cabLocal.writeUInt16LE(0, 6);
    cabLocal.writeUInt16LE(8, 8); /* uso deflate */
    cabLocal.writeUInt16LE(0, 10);
    cabLocal.writeUInt16LE(0, 12);
    cabLocal.writeUInt32LE(crc, 14);
    cabLocal.writeUInt32LE(comprimido.length, 18);
    cabLocal.writeUInt32LE(datos.length, 22);
    cabLocal.writeUInt16LE(nombreBuf.length, 26);
    cabLocal.writeUInt16LE(0, 28);

    locales.push(cabLocal, nombreBuf, comprimido);

    const cabCentral = Buffer.alloc(46);
    cabCentral.writeUInt32LE(0x02014b50, 0);
    cabCentral.writeUInt16LE(20, 4);
    cabCentral.writeUInt16LE(20, 6);
    cabCentral.writeUInt16LE(0, 8);
    cabCentral.writeUInt16LE(8, 10);
    cabCentral.writeUInt16LE(0, 12);
    cabCentral.writeUInt16LE(0, 14);
    cabCentral.writeUInt32LE(crc, 16);
    cabCentral.writeUInt32LE(comprimido.length, 20);
    cabCentral.writeUInt32LE(datos.length, 24);
    cabCentral.writeUInt16LE(nombreBuf.length, 28);
    cabCentral.writeUInt16LE(0, 30);
    cabCentral.writeUInt16LE(0, 32);
    cabCentral.writeUInt16LE(0, 34);
    cabCentral.writeUInt16LE(0, 36);
    cabCentral.writeUInt32LE(0, 38);
    cabCentral.writeUInt32LE(offset, 42);

    central.push(cabCentral, nombreBuf);
    offset += cabLocal.length + nombreBuf.length + comprimido.length;
  }

  const cuerpoLocal = Buffer.concat(locales);
  const cuerpoCentral = Buffer.concat(central);

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(cuerpoCentral.length, 12);
  fin.writeUInt32LE(cuerpoLocal.length, 16);
  fin.writeUInt16LE(0, 20);

  return Buffer.concat([cuerpoLocal, cuerpoCentral, fin]);
}

function escXml(v) {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/* Armo la hoja del inventario con cabecera de color, filas cebra y totales */
function construirExcelInventario(filas, resumen, usuario) {
  const col = n => { let s = ""; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

  const fecha = new Date().toLocaleString("es-PE");
  const renglones = [];
  let fila = 1;

  /* Estilos que uso en las celdas del Excel */

  const celdaTexto = (ref, valor, estilo) =>
    '<c r="' + ref + '" s="' + estilo + '" t="inlineStr"><is><t xml:space="preserve">' + escXml(valor) + "</t></is></c>";
  const celdaNum = (ref, valor, estilo) =>
    '<c r="' + ref + '" s="' + estilo + '"><v>' + valor + "</v></c>";

  /* Titulo */
  renglones.push('<row r="' + fila + '" ht="30" customHeight="1"><c r="A' + fila + '" s="1" t="inlineStr"><is><t>COMERCIALIZADORA SIPAN S.A.C.</t></is></c></row>'); fila++;
  renglones.push('<row r="' + fila + '" ht="20" customHeight="1"><c r="A' + fila + '" s="2" t="inlineStr"><is><t>Reporte de inventario - Chiclayo, Lambayeque</t></is></c></row>'); fila++;
  renglones.push('<row r="' + fila + '"><c r="A' + fila + '" s="2" t="inlineStr"><is><t xml:space="preserve">Emitido: ' + escXml(fecha) + " por " + escXml(usuario) + "</t></is></c></row>"); fila += 2;

  /* Cabecera de tabla */
  const cabecera = ["Codigo", "Producto", "Categoria", "Precio unit. (S/)", "Stock", "Stock minimo", "Estado"];
  renglones.push('<row r="' + fila + '" ht="22" customHeight="1">' +
    cabecera.map((h, i) => celdaTexto(col(i) + fila, h, 3)).join("") + "</row>");
  const filaCabecera = fila;
  fila++;

  filas.forEach((f, idx) => {
    const cebra = idx % 2 === 0;
    const bajo = f.stock < f.minimo;
    const eTexto = cebra ? 4 : 5;
    const eMoneda = cebra ? 6 : 7;
    const eEntero = cebra ? 8 : 9;
    const estado = bajo ? "Reponer" : "Normal";
    renglones.push('<row r="' + fila + '">' +
      celdaTexto(col(0) + fila, f.codigo, eTexto) +
      celdaTexto(col(1) + fila, f.nombre, eTexto) +
      celdaTexto(col(2) + fila, f.categoria, eTexto) +
      celdaNum(col(3) + fila, f.precio, eMoneda) +
      celdaNum(col(4) + fila, f.stock, bajo ? 10 : eEntero) +
      celdaNum(col(5) + fila, f.minimo, eEntero) +
      celdaTexto(col(6) + fila, estado, bajo ? 10 : eTexto) + "</row>");
    fila++;
  });

  fila++;
  /* Totales */
  renglones.push('<row r="' + fila + '" ht="20" customHeight="1">' +
    celdaTexto(col(0) + fila, "Resumen", 11) +
    celdaTexto(col(1) + fila, resumen.total + " productos activos", 11) +
    celdaTexto(col(2) + fila, (resumen.bajos || 0) + " bajo el minimo", 11) +
    celdaTexto(col(3) + fila, "Valor total:", 11) +
    celdaNum(col(4) + fila, resumen.valor, 12) + "</row>");

  const anchos =
    '<cols>' +
    '<col min="1" max="1" width="14" customWidth="1"/>' +
    '<col min="2" max="2" width="38" customWidth="1"/>' +
    '<col min="3" max="3" width="18" customWidth="1"/>' +
    '<col min="4" max="4" width="16" customWidth="1"/>' +
    '<col min="5" max="6" width="14" customWidth="1"/>' +
    '<col min="7" max="7" width="12" customWidth="1"/>' +
    "</cols>";

  const merges =
    '<mergeCells count="3">' +
    '<mergeCell ref="A1:G1"/><mergeCell ref="A2:G2"/><mergeCell ref="A3:G3"/>' +
    "</mergeCells>";

  const hoja =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView showGridLines="0" workbookViewId="0">' +
    '<pane ySplit="' + filaCabecera + '" topLeftCell="A' + (filaCabecera + 1) + '" activePane="bottomLeft" state="frozen"/>' +
    "</sheetView></sheetViews>" +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    anchos +
    "<sheetData>" + renglones.join("") + "</sheetData>" +
    merges +
    "</worksheet>";

  const estilos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;S/&quot;\\ #,##0.00"/></numFmts>' +
    '<fonts count="6">' +
    '<font><sz val="11"/><color rgb="FF121A16"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="16"/><color rgb="FF0F3A40"/><name val="Calibri"/></font>' +
    '<font><sz val="10"/><color rgb="FF4A5650"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF121A16"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFBE4B33"/><name val="Calibri"/></font>' +
    "</fonts>" +
    '<fills count="6">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0F3A40"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F4EF"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8E9E4"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFDF6E3"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="2">' +
    "<border><left/><right/><top/><bottom/><diagonal/></border>" +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD8DDD3"/></bottom><diagonal/></border>' +
    "</borders>" +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="13">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>' +
    '<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0"/>' +
    '<xf numFmtId="1" fontId="0" fillId="3" borderId="1" xfId="0"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="1" fontId="5" fillId="4" borderId="1" xfId="0"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="4" fillId="5" borderId="0" xfId="0"/>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  const archivos = [
    { nombre: "[Content_Types].xml",
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>" },
    { nombre: "_rels/.rels",
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>" },
    { nombre: "xl/workbook.xml",
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Inventario" sheetId="1" r:id="rId1"/></sheets>' +
        "</workbook>" },
    { nombre: "xl/_rels/workbook.xml.rels",
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>" },
    { nombre: "xl/styles.xml", contenido: estilos },
    { nombre: "xl/worksheets/sheet1.xml", contenido: hoja }
  ];

  return armarZip(archivos);
}

/* Armo un pdfkit y junto sus bytes en un Buffer */
function pdfABuffer(construir) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const partes = [];
    doc.on("data", chunk => partes.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    construir(doc);
    doc.end();
  });
}

const moneda = valor => "S/ " + Number(valor).toFixed(2);

/* Arma el PDF de la boleta, parecido a como se ve al imprimir */
function construirPdfBoleta(boleta, items) {
  return pdfABuffer(doc => {
    doc.fontSize(15).fillColor("#0F3A40").text("COMERCIALIZADORA SIPAN S.A.C.");
    doc.fontSize(9).fillColor("#4A5650")
      .text("Distribucion mayorista de abarrotes - Chiclayo, Lambayeque, Peru")
      .text("RUC 20xxxxxxxxx");
    doc.moveDown(0.6);
    doc.fontSize(12).fillColor("#121A16").text("BOLETA DE VENTA " + boleta.numero, { align: "right" });
    doc.moveDown(0.8);

    doc.fontSize(10).fillColor("#121A16");
    doc.text("Cliente: " + boleta.cliente);
    if (boleta.documento) doc.text("RUC/DNI: " + boleta.documento);
    if (boleta.direccion) doc.text("Direccion: " + boleta.direccion);
    doc.text("Fecha: " + new Date(boleta.creado).toLocaleString("es-PE"));
    doc.text("Atendio: " + boleta.vendedor);
    doc.moveDown();

    /* Tabla de productos */
    const x0 = 40, anchoTabla = 515, alto = 20;
    const columnas = [
      { titulo: "Codigo", x: 0, ancho: 65 },
      { titulo: "Descripcion", x: 65, ancho: 220 },
      { titulo: "Cant.", x: 285, ancho: 50, align: "right" },
      { titulo: "P. Unit.", x: 335, ancho: 90, align: "right" },
      { titulo: "Importe", x: 425, ancho: 90, align: "right" }
    ];

    let y = doc.y;
    const filaCabecera = () => {
      doc.rect(x0, y, anchoTabla, alto).fill("#0F3A40");
      doc.fontSize(9).fillColor("#FFFFFF");
      columnas.forEach(c => doc.text(c.titulo, x0 + c.x + 4, y + 5, { width: c.ancho - 8, align: c.align || "left" }));
      y += alto;
    };
    filaCabecera();

    items.forEach((it, idx) => {
      if (y > 760) { doc.addPage(); y = 40; filaCabecera(); }
      if (idx % 2 === 0) doc.rect(x0, y, anchoTabla, alto).fill("#F2F4EF");
      doc.fontSize(9).fillColor("#121A16");
      doc.text(it.codigo, x0 + columnas[0].x + 4, y + 5, { width: columnas[0].ancho - 8 });
      doc.text(it.nombre, x0 + columnas[1].x + 4, y + 5, { width: columnas[1].ancho - 8 });
      doc.text(String(it.cantidad), x0 + columnas[2].x + 4, y + 5, { width: columnas[2].ancho - 8, align: "right" });
      doc.text(moneda(it.precio), x0 + columnas[3].x + 4, y + 5, { width: columnas[3].ancho - 8, align: "right" });
      doc.text(moneda(it.importe), x0 + columnas[4].x + 4, y + 5, { width: columnas[4].ancho - 8, align: "right" });
      y += alto;
    });

    y += 14;
    doc.fontSize(10).fillColor("#121A16").text("Subtotal", 355, y, { width: 100 });
    doc.text(moneda(boleta.subtotal), 455, y, { width: 100, align: "right" });
    y += 16;
    if (boleta.descuento_pct > 0) {
      doc.text("Descuento (" + boleta.descuento_pct + "%)", 355, y, { width: 100 });
      doc.text("-" + moneda(boleta.descuento_monto), 455, y, { width: 100, align: "right" });
      y += 16;
    }
    doc.fontSize(12).text("TOTAL", 355, y, { width: 100 });
    doc.text(moneda(boleta.total), 455, y, { width: 100, align: "right" });

    if (boleta.observacion) {
      doc.moveDown(3);
      doc.fontSize(9).fillColor("#4A5650").text("Observacion: " + boleta.observacion);
    }

    doc.moveDown(2);
    doc.fontSize(9).fillColor("#4A5650").text("Gracias por su compra.", { align: "center" });
  });
}

/* Arma el PDF con los mismos datos que se ven en la pantalla de reportes */
function construirPdfReporte(datos, usuario) {
  return pdfABuffer(doc => {
    doc.fontSize(15).fillColor("#0F3A40").text("COMERCIALIZADORA SIPAN S.A.C.");
    doc.fontSize(9).fillColor("#4A5650").text("Reporte de inventario y movimientos");
    const etiquetaRango = datos.rango.desde && datos.rango.hasta
      ? "Rango: " + datos.rango.desde + " al " + datos.rango.hasta
      : "Rango: ultimos 7 dias";
    doc.text(etiquetaRango + "  -  Emitido " + new Date().toLocaleString("es-PE") + " por " + usuario);
    doc.moveDown();

    const seccion = titulo => { doc.moveDown(0.6); doc.fontSize(12).fillColor("#0F3A40").text(titulo); doc.moveDown(0.2); };
    const linea = texto => doc.fontSize(9).fillColor("#121A16").text(texto);

    seccion("Valor de inventario por categoria");
    datos.porCategoria.forEach(c => linea(c.nombre + ":  " + c.productos + " productos  -  " + moneda(c.valor)));

    seccion("Movimientos del periodo");
    datos.dias.forEach(d => linea(d.dia + ":  entradas " + d.entradas + "  /  salidas " + d.salidas));

    seccion("Productos con mas movimiento");
    if (datos.masMovidos.length === 0) linea("Sin movimientos en el periodo.");
    datos.masMovidos.forEach(m => linea(m.codigo + " " + m.nombre + ":  " + m.unidades + " unidades"));

    seccion("Stock critico");
    if (datos.criticos.length === 0) linea("Ningun producto esta bajo su minimo.");
    datos.criticos.forEach(p => linea(p.codigo + " " + p.nombre + ":  stock " + p.stock + " / minimo " + p.minimo));

    seccion("Tickets y notas");
    if (datos.tickets.length === 0) linea("Aun no hay tickets registrados.");
    datos.tickets.forEach(t => linea(t.tipo + " (" + t.estado + "):  " + t.total));
  });
}

/* Sirvo los archivos estaticos (html, css, js, imagenes) */

const MIMES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"
};

function servirArchivo(res, ruta) {
  /* Normalizo la ruta para que no salgan de la carpeta publica */
  const destino = path.normalize(path.join(CARPETA_PUBLICA, ruta === "/" ? "index.html" : ruta));
  if (!destino.startsWith(CARPETA_PUBLICA)) { res.writeHead(403); res.end(); return; }

  fs.readFile(destino, (error, contenido) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Recurso no encontrado");
      return;
    }
    res.writeHead(200, { "Content-Type": MIMES[path.extname(destino)] || "application/octet-stream" });
    res.end(contenido);
  });
}

/* Enrutador: recibo cada peticion y la mando a su controlador */

const servidor = http.createServer(async (req, res) => {
  cabecerasSeguras(res);
  const ip = req.socket.remoteAddress || "desconocida";
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  try {
    if (url.pathname.startsWith("/api/")) {
      if (excesoDeTrafico(ip, 300, "api")) { fallo(res, 429, "Demasiadas solicitudes."); return; }

      /* Busco la ruta exacta y despues las que llevan :id */
      const exacta = api[req.method + " " + url.pathname];
      if (exacta) { await exacta(req, res, ip, url); return; }

      const conId = url.pathname.match(/^\/api\/(productos|tickets|usuarios)\/(\d+)(\/restaurar|\/cerrar|\/rol)?$/);
      if (conId) {
        const patron = req.method + " /api/" + conId[1] + "/:id" + (conId[3] || "");
        if (api[patron]) { await api[patron](req, res, ip, url, conId[2]); return; }
      }

      /* La boleta por su id, con o sin PDF */
      const boletaId = url.pathname.match(/^\/api\/ventas\/boleta\/(\d+)(\/pdf)?$/);
      if (boletaId) {
        const patron = req.method + " /api/ventas/boleta/:id" + (boletaId[2] || "");
        if (api[patron]) { await api[patron](req, res, ip, url, boletaId[1]); return; }
      }

      /* El token de recuperacion de clave */
      const tokenRecuperacion = url.pathname.match(/^\/api\/recuperar\/([a-f0-9]{16,80})$/);
      if (tokenRecuperacion) {
        const patron = req.method + " /api/recuperar/:token";
        if (api[patron]) { await api[patron](req, res, ip, url, tokenRecuperacion[1]); return; }
      }

      /* El producto por su codigo de barras */
      const codigoBarras = url.pathname.match(/^\/api\/productos\/codigo\/([a-zA-Z0-9-]{4,64})$/);
      if (codigoBarras) {
        const patron = req.method + " /api/productos/codigo/:codigo";
        if (api[patron]) { await api[patron](req, res, ip, url, codigoBarras[1]); return; }
      }

      /* El archivo de respaldo para descargar */
      const archivoRespaldo = url.pathname.match(/^\/api\/respaldos\/(sipan_\d{4}-\d{2}-\d{2}_\d{6}\.db)$/);
      if (archivoRespaldo) {
        const patron = req.method + " /api/respaldos/:archivo";
        if (api[patron]) { await api[patron](req, res, ip, url, archivoRespaldo[1]); return; }
      }

      fallo(res, 404, "Ruta de API no encontrada.");
      return;
    }

    if (req.method !== "GET") { fallo(res, 405, "Metodo no permitido."); return; }
    servirArchivo(res, url.pathname);
  } catch (error) {
    fallo(res, error.message === "JSON invalido" || error.message === "Cuerpo demasiado grande" ? 400 : 500,
      error.message || "Error interno del servidor.");
  }
});

if (require.main === module) {
  servidor.listen(PUERTO, () => {
    console.log("SIPAN Inventario corriendo en http://localhost:" + PUERTO);
    console.log("Base de datos: " + RUTA_BD);
  });
}

module.exports = { servidor, bd };
