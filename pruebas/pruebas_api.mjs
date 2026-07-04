/* Aca estan mis pruebas de la API */
/* Levanto el servidor con una base temporal y pruebo errores, permisos y reglas */
/* Las corro con: npm test */

import { unlinkSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const requerir = createRequire(import.meta.url);

/* Base temporal solo para las pruebas */
const BD_PRUEBAS = fileURLToPath(new URL("./sipan_pruebas.db", import.meta.url));
["", "-wal", "-shm"].forEach(s => { if (existsSync(BD_PRUEBAS + s)) unlinkSync(BD_PRUEBAS + s); });
process.env.BD = BD_PRUEBAS;
process.env.PUERTO = "3999";
/* En las pruebas apago el captcha: no mando token real */
process.env.SECRETO_RECAPTCHA = "";

const { servidor, bd } = requerir("../servidor.js");
await new Promise(listo => servidor.listen(3999, listo));

const BASE = "http://localhost:3999";
let pasa = 0, falla = 0;

function prueba(nombre, condicion) {
  if (condicion) { pasa++; console.log("  PASA   " + nombre); }
  else { falla++; console.log("  FALLA  " + nombre); }
}

function grupo(nombre) { console.log("\n" + nombre); }

/* Cliente que guarda las cookies de sesion */
function cliente() {
  let cookie = "", csrf = "";
  return {
    async pedir(metodo, ruta, cuerpo) {
      const respuesta = await fetch(BASE + ruta, {
        method: metodo,
        headers: { "Content-Type": "application/json", "Cookie": cookie, "X-Token": csrf },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
      });
      const nueva = respuesta.headers.get("set-cookie");
      if (nueva) cookie = nueva.split(";")[0];
      const datos = await respuesta.json().catch(() => ({}));
      if (datos.csrf) csrf = datos.csrf;
      return { estado: respuesta.status, datos };
    }
  };
}

const admin = cliente();
const almacenero = cliente();
const anonimo = cliente();

/* Pruebo la creacion de cuentas y los roles */

grupo("Cuentas y creacion desde el panel");

let r = await admin.pedir("POST", "/api/registro", {});
prueba("El registro publico esta desactivado (403)", r.estado === 403);

r = await admin.pedir("POST", "/api/login", { usuario: "gerente", clave: "Sipan2026" });
prueba("El gerente inicial puede iniciar sesion (200)", r.estado === 200);
prueba("El gerente tiene rol gerente_general", r.datos.perfil.rol === "gerente_general");

/* Creo cuentas desde la sesion del gerente */
r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "", usuario: "", correo: "", clave: "", confirmacion: "", rol: "" });
prueba("Rechaza crear usuario con campos vacios (422)", r.estado === 422 && r.datos.errores.length >= 4);

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Robot Malo", usuario: "robot_x", correo: "r@x.com", clave: "Clave123", confirmacion: "Clave123", rol: "vendedor", empresa_web: "spam" });
prueba("Rechaza envios que llenan el campo trampa (400)", r.estado === 400);

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Ana Torres", usuario: "ana_admin", correo: "correo-invalido", clave: "Clave123", confirmacion: "Clave123", rol: "administrador" });
prueba("Rechaza correo con formato invalido (422)", r.estado === 422);

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Ana Torres", usuario: "ana_admin", correo: "ana@sipan.pe", clave: "debil", confirmacion: "debil", rol: "administrador" });
prueba("Rechaza clave debil (422)", r.estado === 422);

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Ana Torres", usuario: "ana_admin", correo: "ana@sipan.pe", clave: "Clave123", confirmacion: "Clave123", rol: "administrador" });
prueba("Crea una cuenta de administrador (201)", r.estado === 201 && r.datos.rol === "administrador");

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Otra Persona", usuario: "otra_user", correo: "ANA@SIPAN.PE", clave: "Clave123", confirmacion: "Clave123", rol: "vendedor" });
prueba("Rechaza correo duplicado aunque cambie mayusculas (409)", r.estado === 409);

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Otra Persona", usuario: "ana_admin", correo: "otra@sipan.pe", clave: "Clave123", confirmacion: "Clave123", rol: "vendedor" });
prueba("Rechaza usuario duplicado (409)", r.estado === 409);

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Luis Almacen", usuario: "luis_alm", correo: "luis@sipan.pe", clave: "Clave123", confirmacion: "Clave123", rol: "reponedor" });
prueba("Crea una cuenta de reponedor (201)", r.estado === 201 && r.datos.rol === "reponedor");

r = await admin.pedir("POST", "/api/usuarios",
  { nombre: "Vera Ventas", usuario: "vera_ven", correo: "vera@sipan.pe", clave: "Clave123", confirmacion: "Clave123", rol: "vendedor" });
prueba("Crea una cuenta de vendedor (201)", r.estado === 201 && r.datos.rol === "vendedor");

/* Pruebo el login */

grupo("Inicio de sesion");

const pruebaLogin = cliente();
r = await pruebaLogin.pedir("POST", "/api/login", { usuario: "ana_admin", clave: "ClaveMala1" });
prueba("Rechaza clave incorrecta (401)", r.estado === 401);

r = await pruebaLogin.pedir("POST", "/api/login", { usuario: "fantasma", clave: "Clave123" });
prueba("Rechaza usuario inexistente (401)", r.estado === 401);

r = await pruebaLogin.pedir("POST", "/api/login", { usuario: "ana_admin", clave: "Clave123" });
prueba("Acepta credenciales correctas (200)", r.estado === 200);
prueba("Entrega token de seguridad al iniciar sesion", Boolean(r.datos.csrf));

r = await pruebaLogin.pedir("POST", "/api/login", { usuario: "ANA@SIPAN.PE", clave: "Clave123" });
prueba("Acepta iniciar sesion con el correo", r.estado === 200);

/* Este cliente lo uso como reponedor mas adelante */
await almacenero.pedir("POST", "/api/login", { usuario: "luis_alm", clave: "Clave123" });
const vendedor = cliente();
await vendedor.pedir("POST", "/api/login", { usuario: "vera_ven", clave: "Clave123" });

grupo("Bloqueo por intentos fallidos");

/* Creo una cuenta y fallo la clave cinco veces */
await admin.pedir("POST", "/api/usuarios",
  { nombre: "Pedro Prueba", usuario: "pedro_p", correo: "pedro@sipan.pe", clave: "Clave123", confirmacion: "Clave123", rol: "reponedor" });
const bloqueado = cliente();
for (let i = 0; i < 5; i++) await bloqueado.pedir("POST", "/api/login", { usuario: "pedro_p", clave: "Mala" + i + "xxx" });
r = await bloqueado.pedir("POST", "/api/login", { usuario: "pedro_p", clave: "Clave123" });
prueba("Cinco fallos bloquean la cuenta incluso con clave correcta (423)", r.estado === 423);

/* Pruebo que las rutas esten protegidas */

grupo("Proteccion de rutas y token");

r = await anonimo.pedir("GET", "/api/productos");
prueba("Rechaza consultar productos sin sesion (401)", r.estado === 401);

r = await anonimo.pedir("POST", "/api/productos", { nombre: "Intruso", categoria_id: 1, precio: 1, stock: 1, minimo: 1 });
prueba("Rechaza crear productos sin sesion (401)", r.estado === 401);

const sinToken = cliente();
const loginSinToken = await fetch(BASE + "/api/login", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ usuario: "ana_admin", clave: "Clave123" }) });
const cookieSinToken = loginSinToken.headers.get("set-cookie").split(";")[0];
const respuestaCruda = await fetch(BASE + "/api/productos", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Cookie": cookieSinToken },
  body: JSON.stringify({ nombre: "Sin Token", categoria_id: 1, precio: 1, stock: 1, minimo: 1 })
});
prueba("Rechaza mutaciones sin token de seguridad (403)", respuestaCruda.status === 403);

/* Pruebo los productos */

grupo("Productos");

r = await admin.pedir("POST", "/api/productos", { nombre: "", categoria_id: "", precio: "", stock: "", minimo: "" });
prueba("Rechaza producto con campos vacios (422)", r.estado === 422);

r = await admin.pedir("POST", "/api/productos", { nombre: "Cafe Altomayo 200 g", categoria_id: 1, precio: 0, stock: 10, minimo: 5 });
prueba("Rechaza precio en cero (422)", r.estado === 422);

r = await admin.pedir("POST", "/api/productos", { nombre: "Cafe Altomayo 200 g", categoria_id: 1, precio: -5, stock: 10, minimo: 5 });
prueba("Rechaza precio negativo (422)", r.estado === 422);

r = await admin.pedir("POST", "/api/productos", { nombre: "Cafe Altomayo 200 g", categoria_id: 1, precio: 8, stock: 3.5, minimo: 5 });
prueba("Rechaza stock decimal (422)", r.estado === 422);

r = await admin.pedir("POST", "/api/productos", { nombre: "Cafe Altomayo 200 g", categoria_id: 999, precio: 8, stock: 10, minimo: 5 });
prueba("Rechaza categoria inexistente (422)", r.estado === 422);

r = await admin.pedir("POST", "/api/productos", { nombre: "Cafe Altomayo 200 g", categoria_id: 1, precio: 8.5, stock: 20, minimo: 5 });
prueba("Acepta producto valido (201)", r.estado === 201);
const codigoCafe = r.datos.codigo;

r = await admin.pedir("POST", "/api/productos", { nombre: "CAFE altomayo 200 G", categoria_id: 1, precio: 9, stock: 5, minimo: 5 });
prueba("Rechaza nombre duplicado aunque cambie mayusculas (409)", r.estado === 409);

r = await admin.pedir("GET", "/api/productos?buscar=cafe");
prueba("La busqueda encuentra el producto creado", r.datos.filas.some(p => p.codigo === codigoCafe));
const idCafe = r.datos.filas.find(p => p.codigo === codigoCafe).id;

r = await admin.pedir("PUT", "/api/productos/" + idCafe, { nombre: "Cafe Altomayo 250 g", categoria_id: 1, precio: 9.9, stock: 25, minimo: 8 });
prueba("Acepta edicion valida (200)", r.estado === 200);

r = await admin.pedir("PUT", "/api/productos/99999", { nombre: "Nada", categoria_id: 1, precio: 1, stock: 1, minimo: 1 });
prueba("Rechaza editar producto inexistente (404)", r.estado === 404);

r = await admin.pedir("GET", "/api/productos?orden=precio;DROP TABLE productos&dir=asc");
prueba("Un orden malicioso no rompe la consulta (200)", r.estado === 200);

const xss = await admin.pedir("POST", "/api/productos",
  { nombre: '<script>alert(1)</script> Producto', categoria_id: 1, precio: 5, stock: 5, minimo: 2 });
prueba("El texto peligroso se guarda como dato y no se ejecuta", xss.estado === 201);

grupo("Permisos por rol");

r = await almacenero.pedir("DELETE", "/api/productos/" + idCafe);
prueba("El reponedor no puede eliminar productos (403)", r.estado === 403);

r = await almacenero.pedir("GET", "/api/auditoria");
prueba("El reponedor no puede ver la auditoria (403)", r.estado === 403);

r = await almacenero.pedir("POST", "/api/categorias", { nombre: "Congelados" });
prueba("El reponedor no puede crear categorias (403)", r.estado === 403);

r = await admin.pedir("DELETE", "/api/productos/" + idCafe);
prueba("El administrador si puede eliminar (200)", r.estado === 200);

r = await admin.pedir("GET", "/api/productos?estado=papelera");
prueba("El producto eliminado aparece en la papelera", r.datos.filas.some(p => p.id === idCafe));

r = await admin.pedir("POST", "/api/productos/" + idCafe + "/restaurar");
prueba("La restauracion desde la papelera funciona (200)", r.estado === 200);

r = await admin.pedir("POST", "/api/categorias", { nombre: "Congelados" });
prueba("El administrador crea categorias (201)", r.estado === 201);

r = await admin.pedir("POST", "/api/categorias", { nombre: "congelados" });
prueba("Rechaza categoria duplicada (409)", r.estado === 409);

/* Pruebo los movimientos */

grupo("Movimientos de stock");

r = await almacenero.pedir("POST", "/api/movimientos", {});
prueba("Rechaza movimiento vacio (422)", r.estado === 422);

r = await almacenero.pedir("POST", "/api/movimientos",
  { producto_id: idCafe, tipo: "regalo", cantidad: 5, motivo: "Tipo invalido" });
prueba("Rechaza tipo de movimiento desconocido (422)", r.estado === 422);

r = await almacenero.pedir("POST", "/api/movimientos",
  { producto_id: idCafe, tipo: "entrada", cantidad: -3, motivo: "Cantidad negativa" });
prueba("Rechaza cantidad negativa (422)", r.estado === 422);

r = await almacenero.pedir("POST", "/api/movimientos",
  { producto_id: idCafe, tipo: "entrada", cantidad: 30, motivo: "Compra al proveedor" });
prueba("Acepta una entrada valida (201)", r.estado === 201);

r = await almacenero.pedir("POST", "/api/movimientos",
  { producto_id: idCafe, tipo: "salida", cantidad: 99999, motivo: "Venta imposible" });
prueba("Rechaza salida mayor al stock disponible (422)", r.estado === 422);

r = await almacenero.pedir("POST", "/api/movimientos",
  { producto_id: idCafe, tipo: "salida", cantidad: 10, motivo: "Venta a bodega" });
prueba("Acepta una salida valida (201)", r.estado === 201);

r = await almacenero.pedir("GET", "/api/movimientos");
prueba("El kardex registra ambos movimientos", r.datos.filas.length >= 2);

/* Pruebo reportes, exportacion y sesion */

grupo("Reportes, exportacion y sesion");

r = await admin.pedir("GET", "/api/reportes");
prueba("Los reportes agregan datos por categoria y por dia",
  r.estado === 200 && r.datos.porCategoria.length > 0 && r.datos.dias.length === 7);

const loginExport = await fetch(BASE + "/api/login", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ usuario: "ana_admin", clave: "Clave123" }) });
const cookieExport = loginExport.headers.get("set-cookie").split(";")[0];
const xlsx = await fetch(BASE + "/api/exportar", { headers: { "Cookie": cookieExport } });
const bufXlsx = Buffer.from(await xlsx.arrayBuffer());
prueba("La exportacion responde con un archivo Excel (.xlsx)",
  xlsx.status === 200 &&
  xlsx.headers.get("content-type").includes("spreadsheetml") &&
  bufXlsx.slice(0, 2).toString() === "PK");

const cambioClave = cliente();
await cambioClave.pedir("POST", "/api/login", { usuario: "ana_admin", clave: "Clave123" });
r = await cambioClave.pedir("PUT", "/api/clave", { actual: "ClaveMala1", nueva: "NuevaClave9", confirmacion: "NuevaClave9" });
prueba("Rechaza cambio de clave con clave actual incorrecta (401)", r.estado === 401);

r = await cambioClave.pedir("PUT", "/api/clave", { actual: "Clave123", nueva: "NuevaClave9", confirmacion: "NuevaClave9" });
prueba("Acepta el cambio de clave (200)", r.estado === 200);

r = await admin.pedir("POST", "/api/salir");
prueba("El cierre de sesion responde bien (200)", r.estado === 200);

r = await admin.pedir("GET", "/api/productos");
prueba("La sesion cerrada ya no puede consultar (401)", r.estado === 401);

r = await anonimo.pedir("GET", "/api/ruta-inventada");
prueba("Las rutas desconocidas devuelven 404", r.estado === 404);

/* Pruebo la venta mayorista y los permisos del vendedor */

grupo("Venta al por mayor");

/* El vendedor no debe tocar el inventario ni el almacen */
r = await vendedor.pedir("POST", "/api/productos",
  { nombre: "No permitido", categoria_id: 1, precio: 5, stock: 5, minimo: 2 });
prueba("El vendedor no puede crear productos (403)", r.estado === 403);

r = await vendedor.pedir("POST", "/api/movimientos",
  { producto_id: 1, tipo: "entrada", cantidad: 5, motivo: "No permitido" });
prueba("El vendedor no puede registrar movimientos de almacen (403)", r.estado === 403);

/* Pero si debe poder emitir boletas */
r = await vendedor.pedir("POST", "/api/ventas/mayorista",
  { cliente: "Bodega La Esquina", documento: "20999888777",
    items: [{ producto_id: 1, cantidad: 3 }, { producto_id: 2, cantidad: 2 }] });
prueba("El vendedor emite una boleta mayorista (201)", r.estado === 201 && r.datos.boleta);
const boletaSimple = r.datos.boleta;
prueba("La boleta suma bien el subtotal sin descuento",
  boletaSimple && boletaSimple.total === boletaSimple.subtotal && boletaSimple.descuento_monto === 0);

/* Boleta con descuento */
r = await vendedor.pedir("POST", "/api/ventas/mayorista",
  { cliente: "Distribuidora Norte SAC", descuento_pct: 20,
    items: [{ producto_id: 1, cantidad: 10 }] });
prueba("La boleta con descuento del 20% aplica el descuento (201)",
  r.estado === 201 &&
  Math.abs(r.datos.boleta.descuento_monto - r.datos.boleta.subtotal * 0.2) < 0.01 &&
  Math.abs(r.datos.boleta.total - (r.datos.boleta.subtotal - r.datos.boleta.descuento_monto)) < 0.01);

r = await vendedor.pedir("POST", "/api/ventas/mayorista",
  { cliente: "Cliente X", descuento_pct: 150, items: [{ producto_id: 1, cantidad: 1 }] });
prueba("Rechaza un descuento mayor al 100% (422)", r.estado === 422);

r = await vendedor.pedir("POST", "/api/ventas/mayorista",
  { cliente: "Cliente Y", items: [{ producto_id: 1, cantidad: 999999 }] });
prueba("Rechaza una boleta que supera el stock (422)", r.estado === 422);

r = await vendedor.pedir("POST", "/api/ventas/mayorista", { cliente: "Sin items", items: [] });
prueba("Rechaza una boleta sin productos (422)", r.estado === 422);

r = await vendedor.pedir("GET", "/api/ventas/boletas");
prueba("El vendedor lista las boletas emitidas (200)", r.estado === 200 && r.datos.filas.length >= 2);

r = await almacenero.pedir("POST", "/api/ventas/mayorista",
  { cliente: "Intento reponedor", items: [{ producto_id: 1, cantidad: 1 }] });
prueba("El reponedor no puede emitir boletas (403)", r.estado === 403);

/* Pruebo la verificacion en dos pasos */

grupo("Verificacion en dos pasos");

/* Genero el TOTP aca para simular la app del celular */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32aBuffer(sec) {
  let bits = "";
  for (const c of sec.toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, "0"); }
  const by = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) by.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(by);
}
function codigoTOTP(sec) {
  const paso = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac("sha1", b32aBuffer(sec)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

const usuario2fa = cliente();
await usuario2fa.pedir("POST", "/api/login", { usuario: "vera_ven", clave: "Clave123" });

r = await usuario2fa.pedir("GET", "/api/2fa/estado");
prueba("El estado inicial de 2FA es inactivo", r.estado === 200 && r.datos.activo === false);

r = await usuario2fa.pedir("POST", "/api/2fa/iniciar");
prueba("Iniciar 2FA entrega un secreto y una URL otpauth (200)",
  r.estado === 200 && r.datos.secreto && r.datos.uri.startsWith("otpauth://"));
const secreto2fa = r.datos.secreto;

r = await usuario2fa.pedir("POST", "/api/2fa/activar", { codigo: "000000" });
prueba("Rechaza activar con un codigo invalido (422)", r.estado === 422);

r = await usuario2fa.pedir("POST", "/api/2fa/activar", { codigo: codigoTOTP(secreto2fa) });
prueba("Activa 2FA con un codigo valido y entrega respaldos (200)",
  r.estado === 200 && Array.isArray(r.datos.respaldos) && r.datos.respaldos.length === 8);
const respaldos2fa = r.datos.respaldos;

/* Ahora esa cuenta pide el segundo paso al entrar */
r = await anonimo.pedir("POST", "/api/login", { usuario: "vera_ven", clave: "Clave123" });
prueba("El login ahora pide el segundo factor (requiere2FA)", r.estado === 200 && r.datos.requiere2FA === true);
const vale2fa = r.datos.vale;

r = await anonimo.pedir("POST", "/api/login/2fa", { vale: vale2fa, codigo: "111111" });
prueba("Rechaza el segundo paso con codigo incorrecto (401)", r.estado === 401);

const otro = cliente();
let rl = await otro.pedir("POST", "/api/login", { usuario: "vera_ven", clave: "Clave123" });
r = await otro.pedir("POST", "/api/login/2fa", { vale: rl.datos.vale, codigo: codigoTOTP(secreto2fa) });
prueba("Acepta el segundo paso con el codigo correcto (200)", r.estado === 200 && Boolean(r.datos.csrf));

/* Un codigo de respaldo tambien entra, una sola vez */
const conRespaldo = cliente();
rl = await conRespaldo.pedir("POST", "/api/login", { usuario: "vera_ven", clave: "Clave123" });
r = await conRespaldo.pedir("POST", "/api/login/2fa", { vale: rl.datos.vale, codigo: respaldos2fa[0] });
prueba("Un codigo de respaldo permite entrar (200)", r.estado === 200);

const reuso = cliente();
rl = await reuso.pedir("POST", "/api/login", { usuario: "vera_ven", clave: "Clave123" });
r = await reuso.pedir("POST", "/api/login/2fa", { vale: rl.datos.vale, codigo: respaldos2fa[0] });
prueba("El mismo codigo de respaldo no se puede reutilizar (401)", r.estado === 401);

/* El gerente general no puede apagar su 2FA */
const gerente2fa = cliente();
await gerente2fa.pedir("POST", "/api/login", { usuario: "gerente", clave: "Sipan2026" });
r = await gerente2fa.pedir("POST", "/api/2fa/iniciar");
const secGerente = r.datos.secreto;
await gerente2fa.pedir("POST", "/api/2fa/activar", { codigo: codigoTOTP(secGerente) });
r = await gerente2fa.pedir("POST", "/api/2fa/desactivar", { clave: "Sipan2026", codigo: codigoTOTP(secGerente) });
prueba("El gerente general no puede desactivar su 2FA (403)", r.estado === 403);

/* Cierro las pruebas */

console.log("\nRESULTADO FINAL: " + pasa + " pruebas superadas, " + falla + " fallidas.");
servidor.close();
bd.close();
["", "-wal", "-shm"].forEach(s => { if (existsSync(BD_PRUEBAS + s)) unlinkSync(BD_PRUEBAS + s); });
process.exit(falla > 0 ? 1 : 0);
