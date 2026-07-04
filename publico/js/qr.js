/* Uso la libreria qrcode.js (MIT) para el QR del 2FA; la dejo dentro del proyecto por la seguridad del navegador */

function generarQR(uri) {
  try {
    /* version automatica y correccion media */
    const qr = qrcode(0, "M");
    qr.addData(uri);
    qr.make();

    const modulos = qr.getModuleCount();
    const pixel = 5;
    const quiet = 4;
    const total = (modulos + quiet * 2) * pixel;

    let rects = "";
    for (let r = 0; r < modulos; r++) {
      for (let c = 0; c < modulos; c++) {
        if (qr.isDark(r, c)) {
          const x = (c + quiet) * pixel;
          const y = (r + quiet) * pixel;
          rects += '<rect x="' + x + '" y="' + y + '" width="' + pixel + '" height="' + pixel + '"/>';
        }
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + total + '" height="' + total +
      '" viewBox="0 0 ' + total + " " + total + '" shape-rendering="crispEdges" role="img" aria-label="Codigo QR de verificacion">' +
      '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>' +
      '<g fill="#0F3A40">' + rects + "</g></svg>";
  } catch (e) {
    return '<p class="minimo">No se pudo generar el QR. Use la clave manual de abajo.</p>';
  }
}
