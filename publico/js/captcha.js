/* Aca manejo la verificacion humana del login con el reCAPTCHA de Google */

const Captcha = (() => {

  /* Esta es mi clave de sitio de reCAPTCHA v2 (casilla No soy un robot) */
  const CLAVE_SITIO = "6LeM_0MtAAAAALECkSmVnbY4yNxvDHZ2QA4JIi_N";

  const idsWidget = {};
  const pendientes = [];
  let listo = false;

  function renderizar(idContenedor) {
    const caja = document.getElementById(idContenedor);
    if (!caja || idsWidget[idContenedor] !== undefined) return;
    idsWidget[idContenedor] = grecaptcha.render(caja, { sitekey: CLAVE_SITIO });
  }

  /* Google llama a esto apenas termina de cargar el script */
  window.grecaptchaListo = function () {
    listo = true;
    pendientes.splice(0).forEach(renderizar);
  };

  function iniciar(idContenedor) {
    if (listo && window.grecaptcha) renderizar(idContenedor);
    else pendientes.push(idContenedor);
  }

  function verificar(idContenedor) {
    const id = idsWidget[idContenedor];
    return id !== undefined && window.grecaptcha && grecaptcha.getResponse(id).length > 0;
  }

  /* Devuelvo el token para que el servidor lo valide con Google */
  function token(idContenedor) {
    const id = idsWidget[idContenedor];
    return id !== undefined && window.grecaptcha ? grecaptcha.getResponse(id) : "";
  }

  function reiniciar(idContenedor) {
    const id = idsWidget[idContenedor];
    if (id !== undefined && window.grecaptcha) grecaptcha.reset(id);
  }

  return { iniciar, verificar, token, reiniciar };
})();
