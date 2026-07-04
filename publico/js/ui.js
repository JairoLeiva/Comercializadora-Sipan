/* Aca tengo ayudas de interfaz */
/* Escapo texto, muestro avisos y notificaciones, y cambio el tema */

const UI = (() => {

  /* Escapo caracteres peligrosos antes de mostrarlos (evito XSS) */
  function limpiar(texto) {
    return String(texto ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function mostrarErrores(idCaja, errores) {
    const caja = document.getElementById(idCaja);
    if (!caja) return;
    if (!errores || errores.length === 0) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.className = "aviso aviso-error";
    caja.innerHTML = errores.map(e => "<p>" + limpiar(e) + "</p>").join("");
  }

  function ocultarAviso(idCaja) {
    const caja = document.getElementById(idCaja);
    if (caja) caja.hidden = true;
  }

  /* Notificacion que se va sola */
  function toast(mensaje, tipo) {
    let zona = document.getElementById("zona_toasts");
    if (!zona) {
      zona = document.createElement("div");
      zona.id = "zona_toasts";
      zona.className = "zona-toasts";
      zona.setAttribute("aria-live", "polite");
      document.body.appendChild(zona);
    }
    const aviso = document.createElement("div");
    aviso.className = "toast " + (tipo === "error" ? "toast-error" : "toast-exito");
    aviso.textContent = mensaje;
    zona.appendChild(aviso);
    setTimeout(() => aviso.classList.add("toast-fuera"), 3600);
    setTimeout(() => aviso.remove(), 4100);
  }

  function fecha(iso) {
    const f = new Date(iso);
    return f.toLocaleDateString("es-PE") + " " +
      f.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  }

  function moneda(valor) {
    return "S/ " + Number(valor).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* Guardo el tema claro u oscuro en el navegador */
  function aplicarTema() {
    const tema = localStorage.getItem("sipan_tema") || "claro";
    document.documentElement.dataset.tema = tema;
  }

  function alternarTema() {
    const nuevo = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
    localStorage.setItem("sipan_tema", nuevo);
    document.documentElement.dataset.tema = nuevo;
  }

  aplicarTema();

  return { limpiar, mostrarErrores, ocultarAviso, toast, fecha, moneda, alternarTema };
})();
