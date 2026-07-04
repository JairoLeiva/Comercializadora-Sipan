/* Aca centralizo las llamadas al servidor */
/* Adjunto el token de seguridad en cada llamada */

const Api = (() => {

  function tokenCsrf() { return sessionStorage.getItem("sipan_csrf") || ""; }

  async function llamar(metodo, ruta, cuerpo) {
    const opciones = {
      method: metodo,
      headers: { "Content-Type": "application/json", "X-Token": tokenCsrf() }
    };
    if (cuerpo !== undefined) opciones.body = JSON.stringify(cuerpo);

    let respuesta;
    try {
      respuesta = await fetch(ruta, opciones);
    } catch {
      throw { errores: ["No hay conexion con el servidor. Verifique que este encendido."] };
    }

    /* Si la sesion vencio, vuelvo al login */
    if (respuesta.status === 401 && !ruta.includes("/login") && !ruta.includes("/sesion")) {
      sessionStorage.removeItem("sipan_csrf");
      window.location.href = "index.html";
      throw { errores: ["Sesion vencida."] };
    }

    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw { estado: respuesta.status, errores: datos.errores || ["Error inesperado."] };
    return datos;
  }

  return {
    get: ruta => llamar("GET", ruta),
    post: (ruta, cuerpo) => llamar("POST", ruta, cuerpo),
    put: (ruta, cuerpo) => llamar("PUT", ruta, cuerpo),
    del: ruta => llamar("DELETE", ruta),
    guardarCsrf: token => sessionStorage.setItem("sipan_csrf", token),
    limpiarCsrf: () => sessionStorage.removeItem("sipan_csrf")
  };
})();
