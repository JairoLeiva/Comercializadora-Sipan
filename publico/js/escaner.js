/* Lector de codigo de barras, funciona con la camara o con un lector USB */

const Escaner = (() => {

  let alDetectar = null;
  let controles = null;

  function dialogo() { return document.getElementById("modal_escaner"); }
  function video() { return document.getElementById("escaner_video"); }

  async function abrirCamara(callback) {
    const caja = dialogo();
    if (!caja) return;
    alDetectar = callback;
    caja.showModal();

    if (!window.ZXing || !window.ZXing.BrowserMultiFormatReader) {
      UI.toast("No se pudo cargar el lector de camara. Revise su conexion a internet.", "error");
      cerrarCamara();
      return;
    }

    try {
      const lector = new ZXing.BrowserMultiFormatReader();
      controles = await lector.decodeFromVideoDevice(undefined, video(), (resultado, error, ctrl) => {
        if (resultado) {
          const codigo = resultado.getText();
          ctrl.stop();
          controles = null;
          caja.close();
          if (alDetectar) alDetectar(codigo);
        }
      });
    } catch (error) {
      UI.toast("No se pudo acceder a la camara. Revise los permisos del navegador.", "error");
      cerrarCamara();
    }
  }

  function cerrarCamara() {
    if (controles) { controles.stop(); controles = null; }
    const caja = dialogo();
    if (caja && caja.open) caja.close();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const boton = document.getElementById("escaner_cerrar");
    if (boton) boton.addEventListener("click", cerrarCamara);
    const caja = dialogo();
    if (caja) caja.addEventListener("cancel", cerrarCamara);
  });

  /* Un lector USB escribe el codigo como si fuera un teclado y termina con Enter */
  function usb(input, callback) {
    input.addEventListener("keydown", evento => {
      if (evento.key !== "Enter") return;
      evento.preventDefault();
      const codigo = input.value.trim();
      input.value = "";
      if (codigo) callback(codigo);
    });
  }

  return { abrirCamara, cerrarCamara, usb };
})();
