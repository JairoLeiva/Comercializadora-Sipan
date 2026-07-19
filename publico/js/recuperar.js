/* Recuperacion de clave, primero pido el enlace y despues elijo la clave nueva */

(() => {

  const formRecuperar = document.getElementById("form_recuperar");
  const formRestablecer = document.getElementById("form_restablecer");

  /* Paso 1, pedir el enlace por correo */

  if (formRecuperar) {
    Captcha.iniciar("captcha_recuperar");

    formRecuperar.addEventListener("submit", async evento => {
      evento.preventDefault();
      const boton = formRecuperar.querySelector("button[type=submit]");

      const datos = {
        identidad: formRecuperar.identidad.value,
        empresa_web: formRecuperar.empresa_web.value,
        captcha: Captcha.token("captcha_recuperar")
      };

      if (Validacion.vacio(datos.identidad)) {
        UI.mostrarErrores("aviso_recuperar", ["Ingrese su usuario o correo."]); return;
      }
      if (!Captcha.verificar("captcha_recuperar")) {
        UI.mostrarErrores("aviso_recuperar", ["Complete la verificacion antes de continuar."]); return;
      }

      boton.disabled = true;
      boton.textContent = "Enviando";

      try {
        const respuesta = await Api.post("/api/recuperar", datos);
        UI.ocultarAviso("aviso_recuperar");
        const caja = document.getElementById("aviso_recuperar");
        caja.hidden = false;
        caja.className = "aviso aviso-exito";
        caja.innerHTML = "<p>" + UI.limpiar(respuesta.mensaje) + "</p>";
        formRecuperar.reset();
        Captcha.reiniciar("captcha_recuperar");
      } catch (error) {
        UI.mostrarErrores("aviso_recuperar", error.errores);
        Captcha.reiniciar("captcha_recuperar");
      } finally {
        boton.disabled = false;
        boton.textContent = "Enviar enlace de recuperacion";
      }
    });
  }

  /* Paso 2, elegir la clave nueva siguiendo el enlace del correo */

  if (formRestablecer) {
    const subtitulo = document.getElementById("subtitulo_restablecer");
    const tok = new URLSearchParams(window.location.search).get("token");

    async function verificarEnlace() {
      if (!tok) {
        subtitulo.textContent = "Este enlace no es valido. Pida uno nuevo desde la pagina de recuperacion.";
        return;
      }
      try {
        await Api.get("/api/recuperar/" + encodeURIComponent(tok));
        subtitulo.textContent = "Elija la clave nueva para su cuenta.";
        formRestablecer.hidden = false;
      } catch (error) {
        subtitulo.textContent = (error.errores && error.errores[0]) || "El enlace no es valido o ya vencio.";
      }
    }
    verificarEnlace();

    const campoClave = formRestablecer.clave;
    const barra = document.getElementById("fuerza_barra");
    const textoFuerza = document.getElementById("fuerza_texto");
    const niveles = ["Muy debil", "Debil", "Aceptable", "Fuerte", "Muy fuerte"];

    campoClave.addEventListener("input", () => {
      const puntos = Validacion.fuerzaClave(campoClave.value);
      barra.style.width = (puntos * 25) + "%";
      barra.dataset.nivel = puntos;
      textoFuerza.textContent = campoClave.value ? niveles[puntos] : "";
    });

    formRestablecer.addEventListener("submit", async evento => {
      evento.preventDefault();
      const boton = formRestablecer.querySelector("button[type=submit]");

      const datos = {
        token: tok,
        clave: formRestablecer.clave.value,
        confirmacion: formRestablecer.confirmacion.value
      };

      const errores = Validacion.clave(datos.clave);
      if (Validacion.vacio(datos.confirmacion)) errores.push("Debe repetir la clave.");
      else if (datos.clave !== datos.confirmacion) errores.push("Las claves no coinciden.");
      if (errores.length) { UI.mostrarErrores("aviso_restablecer", errores); return; }

      boton.disabled = true;
      boton.textContent = "Guardando";

      try {
        const respuesta = await Api.post("/api/restablecer", datos);
        UI.ocultarAviso("aviso_restablecer");
        formRestablecer.hidden = true;
        subtitulo.textContent = respuesta.mensaje;
        setTimeout(() => { window.location.href = "index.html"; }, 2200);
      } catch (error) {
        UI.mostrarErrores("aviso_restablecer", error.errores);
        boton.disabled = false;
        boton.textContent = "Guardar clave nueva";
      }
    });
  }
})();
