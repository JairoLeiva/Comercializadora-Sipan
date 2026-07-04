/* Acceso al sistema contra la API del servidor */

(() => {

  const formLogin = document.getElementById("form_login");
  const formRegistro = document.getElementById("form_registro");

  /* Inicio de sesion */

  if (formLogin) {
    Captcha.iniciar("captcha_login");

    formLogin.addEventListener("submit", async evento => {
      evento.preventDefault();
      const boton = formLogin.querySelector("button[type=submit]");

      const datos = {
        usuario: formLogin.usuario.value,
        clave: formLogin.clave.value,
        empresa_web: formLogin.empresa_web.value,
        captcha: Captcha.token("captcha_login")
      };

      const errores = Validacion.inicioSesion(datos);
      if (errores.length) { UI.mostrarErrores("aviso_login", errores); return; }

      if (!Captcha.verificar("captcha_login")) {
        UI.mostrarErrores("aviso_login", ["Complete la verificacion antes de continuar."]);
        return;
      }

      boton.disabled = true;
      boton.textContent = "Verificando";

      try {
        const respuesta = await Api.post("/api/login", datos);

        /* La cuenta pide un segundo factor: se muestra el formulario del codigo */
        if (respuesta.requiere2FA) {
          mostrarPaso2FA(respuesta.vale, respuesta.usuario);
          boton.disabled = false;
          boton.textContent = "Entrar al sistema";
          return;
        }

        Api.guardarCsrf(respuesta.csrf);
        window.location.href = "panel.html";
      } catch (error) {
        UI.mostrarErrores("aviso_login", error.errores);
        Captcha.reiniciar("captcha_login");
        boton.disabled = false;
        boton.textContent = "Entrar al sistema";
      }
    });

    /* Segundo paso: verificacion en dos pasos */
    const form2FA = document.getElementById("form_2fa");
    let vale2FA = null;

    function mostrarPaso2FA(vale, usuario) {
      vale2FA = vale;
      formLogin.hidden = true;
      form2FA.hidden = false;
      UI.ocultarAviso("aviso_login");
      UI.ocultarAviso("aviso_2fa");
      document.getElementById("texto_2fa").textContent =
        "Hola " + usuario + ". Ingrese el codigo de 6 digitos de su app de autenticacion.";
      form2FA.codigo.value = "";
      form2FA.codigo.focus();
    }

    document.getElementById("cancelar_2fa").addEventListener("click", () => {
      vale2FA = null;
      form2FA.hidden = true;
      formLogin.hidden = false;
      Captcha.reiniciar("captcha_login");
    });

    form2FA.addEventListener("submit", async evento => {
      evento.preventDefault();
      if (!vale2FA) return;
      const boton = form2FA.querySelector("button[type=submit]");
      const codigo = form2FA.codigo.value.trim();

      if (!codigo) { UI.mostrarErrores("aviso_2fa", ["Ingrese el codigo de verificacion."]); return; }

      boton.disabled = true;
      boton.textContent = "Verificando";

      try {
        const respuesta = await Api.post("/api/login/2fa", { vale: vale2FA, codigo });
        Api.guardarCsrf(respuesta.csrf);
        window.location.href = "panel.html";
      } catch (error) {
        UI.mostrarErrores("aviso_2fa", error.errores);
        boton.disabled = false;
        boton.textContent = "Verificar y entrar";
      }
    });
  }

  /* Registro de cuenta */

  if (formRegistro) {
    Captcha.iniciar("captcha_registro");

    const campoClave = formRegistro.clave;
    const barra = document.getElementById("fuerza_barra");
    const textoFuerza = document.getElementById("fuerza_texto");
    const niveles = ["Muy debil", "Debil", "Aceptable", "Fuerte", "Muy fuerte"];

    campoClave.addEventListener("input", () => {
      const puntos = Validacion.fuerzaClave(campoClave.value);
      barra.style.width = (puntos * 25) + "%";
      barra.dataset.nivel = puntos;
      textoFuerza.textContent = campoClave.value ? niveles[puntos] : "";
    });

    formRegistro.addEventListener("submit", async evento => {
      evento.preventDefault();
      const boton = formRegistro.querySelector("button[type=submit]");

      const datos = {
        nombre: formRegistro.nombre.value,
        usuario: formRegistro.usuario.value,
        correo: formRegistro.correo.value,
        clave: formRegistro.clave.value,
        confirmacion: formRegistro.confirmacion.value,
        empresa_web: formRegistro.empresa_web.value,
        captcha: Captcha.token("captcha_registro")
      };

      const errores = Validacion.registroUsuario(datos);
      if (errores.length) { UI.mostrarErrores("aviso_registro", errores); return; }

      if (!Captcha.verificar("captcha_registro")) {
        UI.mostrarErrores("aviso_registro", ["Complete la verificacion antes de continuar."]);
        return;
      }

      boton.disabled = true;
      boton.textContent = "Creando cuenta";

      try {
        const respuesta = await Api.post("/api/registro", datos);
        UI.ocultarAviso("aviso_registro");
        const caja = document.getElementById("aviso_registro");
        caja.hidden = false;
        caja.className = "aviso aviso-exito";
        caja.innerHTML = "<p>" + UI.limpiar(respuesta.mensaje) +
          (respuesta.rol === "administrador" ? " Su cuenta tiene rol de administrador." : "") + "</p>";
        setTimeout(() => { window.location.href = "index.html"; }, 2200);
      } catch (error) {
        UI.mostrarErrores("aviso_registro", error.errores);
        Captcha.reiniciar("captcha_registro");
        boton.disabled = false;
        boton.textContent = "Crear cuenta";
      }
    });
  }
})();
