/* Aca manejo la verificacion humana del login */
/* Si pongo mi clave de sitio uso el reCAPTCHA de Google; si no, uso una suma como respaldo */

const Captcha = (() => {

  /* Esta es mi clave de sitio de reCAPTCHA v2 (casilla No soy un robot) */
  const CLAVE_SITIO = "6LeM_0MtAAAAALECkSmVnbY4yNxvDHZ2QA4JIi_N";

  let retoLocal = null;

  function iniciar(idContenedor) {
    const caja = document.getElementById(idContenedor);
    if (!caja) return;

    /* Si tengo clave y el script de Google cargo, muestro la casilla oficial */
    if (CLAVE_SITIO && window.grecaptcha) {
      grecaptcha.render(caja, { sitekey: CLAVE_SITIO });
      caja.dataset.modo = "google";
      return;
    }

    /* Respaldo sin internet: una suma simple que un robot basico no resuelve */
    const a = Math.floor(Math.random() * 8) + 1;
    const b = Math.floor(Math.random() * 8) + 1;
    retoLocal = a + b;
    caja.dataset.modo = "local";
    caja.innerHTML =
      '<label class="campo-etiqueta" for="captcha_local">Verificacion: cuanto es ' + a + " + " + b + "</label>" +
      '<input id="captcha_local" class="campo-entrada" type="text" inputmode="numeric" autocomplete="off" placeholder="Escriba el resultado">';
  }

  /* Reviso en el navegador que la persona haya resuelto el reto */
  function verificar(idContenedor) {
    const caja = document.getElementById(idContenedor);
    if (!caja) return false;

    if (caja.dataset.modo === "google") {
      return window.grecaptcha && grecaptcha.getResponse().length > 0;
    }

    const respuesta = document.getElementById("captcha_local");
    return respuesta && Number(respuesta.value.trim()) === retoLocal;
  }

  /* Devuelvo el token para que el servidor lo valide con Google */
  function token(idContenedor) {
    const caja = document.getElementById(idContenedor);
    if (!caja) return "";
    if (caja.dataset.modo === "google") return window.grecaptcha ? grecaptcha.getResponse() : "";
    const respuesta = document.getElementById("captcha_local");
    return respuesta ? respuesta.value.trim() : "";
  }

  function reiniciar(idContenedor) {
    const caja = document.getElementById(idContenedor);
    if (caja && caja.dataset.modo === "google") grecaptcha.reset();
    else iniciar(idContenedor);
  }

  return { iniciar, verificar, token, reiniciar };
})();
