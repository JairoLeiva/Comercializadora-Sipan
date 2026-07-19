/* Aca esta toda la logica del panel */
/* Manejo las vistas: inventario, movimientos, ventas, tickets, reportes, usuarios, auditoria y perfil */

(async () => {

  /* Al arrancar, valido la sesion con el servidor */

  let perfil, permisos;
  try {
    const sesion = await Api.get("/api/sesion");
    perfil = sesion.perfil;
    permisos = sesion.permisos || {};
    Api.guardarCsrf(sesion.csrf);
  } catch {
    window.location.href = "index.html";
    return;
  }

  const esGerencia = perfil.rol === "gerente_general" || perfil.rol === "administrador";
  const puede = accion => !!permisos[accion];

  document.getElementById("usuario_activo").textContent = perfil.nombre;
  document.getElementById("rol_activo").textContent = perfil.rolNombre || perfil.rol;

  /* Ajusto el menu y los botones a lo que el rol puede hacer (el servidor igual bloquea) */
  function mostrarSegunPermiso(id, permitido) {
    const el = document.getElementById(id);
    if (el) el.hidden = !permitido;
  }

  mostrarSegunPermiso("nav_movimientos", puede("movimientos"));
  mostrarSegunPermiso("nav_ventas", puede("vender"));
  mostrarSegunPermiso("nav_tickets", puede("tickets"));
  mostrarSegunPermiso("nav_reportes", puede("reportes"));
  mostrarSegunPermiso("nav_usuarios", puede("usuarios_ver"));
  mostrarSegunPermiso("nav_auditoria", puede("auditoria"));

  if (puede("papelera")) document.getElementById("opcion_papelera").hidden = false;
  if (puede("categorias")) document.getElementById("boton_categoria").hidden = false;
  if (!puede("inventario_editar")) document.getElementById("boton_nuevo").hidden = true;
  if (!puede("exportar")) document.getElementById("boton_exportar").hidden = true;

  document.getElementById("boton_tema").addEventListener("click", UI.alternarTema);

  document.getElementById("boton_salir").addEventListener("click", async () => {
    try { await Api.post("/api/salir"); } catch {}
    Api.limpiarCsrf();
    window.location.href = "index.html";
  });

  document.querySelectorAll("[data-cerrar]").forEach(boton =>
    boton.addEventListener("click", () => document.getElementById(boton.dataset.cerrar).close()));

  /* Guardo las categorias para reusarlas en los selectores */

  let categorias = [];
  async function cargarCategorias() {
    categorias = await Api.get("/api/categorias");
    const opciones = categorias.map(c =>
      '<option value="' + c.id + '">' + UI.limpiar(c.nombre) + "</option>").join("");
    document.getElementById("filtro_categoria").innerHTML =
      '<option value="">Todas las categorias</option>' + opciones;
    document.getElementById("p_categoria").innerHTML =
      '<option value="">Seleccionar</option>' + opciones;
  }
  await cargarCategorias();

  /* Cambio de vista segun el hash de la URL */

  const titulos = {
    inventario: "Inventario", movimientos: "Movimientos de stock",
    ventas: "Venta al por mayor", tickets: "Tickets y notas", reportes: "Reportes",
    usuarios: "Usuarios", auditoria: "Auditoria", perfil: "Mi perfil"
  };
  const cargadores = {
    inventario: cargarInventario, movimientos: cargarMovimientos, ventas: cargarVentas,
    tickets: cargarTickets, reportes: cargarReportes, usuarios: cargarUsuarios,
    auditoria: cargarAuditoria, perfil: cargarPerfil
  };
  /* Que rol necesita cada vista */
  const permisoVista = {
    movimientos: "movimientos", ventas: "vender", tickets: "tickets",
    reportes: "reportes", usuarios: "usuarios_ver", auditoria: "auditoria"
  };

  function navegar() {
    let vista = window.location.hash.replace("#", "") || "inventario";
    if (!titulos[vista] || (permisoVista[vista] && !puede(permisoVista[vista]))) vista = "inventario";

    document.querySelectorAll(".vista").forEach(s => { s.hidden = true; });
    const activa = document.getElementById("vista_" + vista);
    activa.hidden = false;
    activa.classList.remove("vista-entra");
    void activa.offsetWidth;
    activa.classList.add("vista-entra");

    document.getElementById("titulo_vista").textContent = titulos[vista];
    document.querySelectorAll(".nav-item").forEach(a =>
      a.classList.toggle("nav-activo", a.dataset.vista === vista));

    cargadores[vista]().catch(error => UI.toast(error.errores?.[0] || "Error al cargar.", "error"));
  }

  window.addEventListener("hashchange", navegar);

  /* Aca armo la vista de inventario */

  const filtros = { buscar: "", categoria: "", estado: "", orden: "codigo", dir: "asc", pagina: 1 };
  let paginasInventario = 1;
  let idEliminar = null;

  const buscador = document.getElementById("buscador");
  let esperaBusqueda;
  buscador.addEventListener("input", () => {
    clearTimeout(esperaBusqueda);
    esperaBusqueda = setTimeout(() => {
      filtros.buscar = buscador.value;
      filtros.pagina = 1;
      cargarInventario();
    }, 250);
  });

  document.getElementById("filtro_categoria").addEventListener("change", e => {
    filtros.categoria = e.target.value; filtros.pagina = 1; cargarInventario();
  });
  document.getElementById("filtro_estado").addEventListener("change", e => {
    filtros.estado = e.target.value; filtros.pagina = 1; cargarInventario();
  });

  document.querySelectorAll(".orden").forEach(boton =>
    boton.addEventListener("click", () => {
      const columna = boton.dataset.orden;
      filtros.dir = filtros.orden === columna && filtros.dir === "asc" ? "desc" : "asc";
      filtros.orden = columna;
      cargarInventario();
    }));

  document.getElementById("pagina_atras").addEventListener("click", () => {
    if (filtros.pagina > 1) { filtros.pagina--; cargarInventario(); }
  });
  document.getElementById("pagina_adelante").addEventListener("click", () => {
    if (filtros.pagina < paginasInventario) { filtros.pagina++; cargarInventario(); }
  });

  async function cargarInventario() {
    const consulta = new URLSearchParams({
      buscar: filtros.buscar, categoria: filtros.categoria, estado: filtros.estado,
      orden: filtros.orden, dir: filtros.dir, pagina: filtros.pagina
    });
    const datos = await Api.get("/api/productos?" + consulta);
    paginasInventario = datos.paginas;

    document.getElementById("dato_total").textContent = datos.resumen.total;
    document.getElementById("dato_valor").textContent = UI.moneda(datos.resumen.valor);
    document.getElementById("dato_bajos").textContent = datos.resumen.bajos;
    document.getElementById("dato_categorias").textContent = datos.resumen.categorias;

    const franja = document.getElementById("franja_alerta");
    franja.hidden = datos.resumen.bajos === 0;
    if (datos.resumen.bajos > 0)
      document.getElementById("texto_alerta").textContent =
        datos.resumen.bajos + (datos.resumen.bajos === 1 ? " producto esta" : " productos estan") +
        " por debajo de su stock minimo.";

    document.getElementById("conteo_resultados").textContent =
      datos.total + (datos.total === 1 ? " producto" : " productos");
    document.getElementById("pagina_actual").textContent =
      "Pagina " + datos.pagina + " de " + datos.paginas;
    document.getElementById("pagina_atras").disabled = datos.pagina <= 1;
    document.getElementById("pagina_adelante").disabled = datos.pagina >= datos.paginas;

    pintarFilas(datos.filas);
  }

  function pintarFilas(filas) {
    const cuerpo = document.getElementById("cuerpo_tabla");

    if (filas.length === 0) {
      cuerpo.innerHTML =
        '<tr><td colspan="7"><div class="tabla-vacia">' +
        '<img src="img/caja.svg" alt="" width="56" height="56">' +
        "<p>No hay productos que coincidan con la busqueda.</p></div></td></tr>";
      return;
    }

    cuerpo.innerHTML = filas.map(p => {
      const bajo = p.stock < p.minimo;
      const nivel = Math.min(100, Math.round((p.stock / Math.max(p.minimo * 4, 1)) * 100));
      const enPapelera = p.activo === 0;

      const acciones = enPapelera
        ? (puede("papelera") ? '<button class="boton-mini" data-restaurar="' + p.id + '">Restaurar</button>' : '<span class="minimo">En papelera</span>')
        : (puede("inventario_editar") ? '<button class="boton-mini" data-editar="' + p.id + '">Editar</button>' : "") +
          (puede("producto_eliminar") ? '<button class="boton-mini boton-mini-rojo" data-eliminar="' + p.id + '">Eliminar</button>' : "") +
          (puede("vender") ? '<button class="boton-mini boton-mini-venta" data-vender="' + p.id + '">Vender</button>' : "");

      return "<tr" + (bajo && !enPapelera ? ' class="fila-alerta"' : "") + ">" +
        '<td class="celda-codigo">' + UI.limpiar(p.codigo) + "</td>" +
        "<td>" + UI.limpiar(p.nombre) + "</td>" +
        '<td><span class="etiqueta">' + UI.limpiar(p.categoria) + "</span></td>" +
        '<td class="celda-num">' + UI.moneda(p.precio) + "</td>" +
        '<td class="celda-num">' + p.stock + ' <span class="minimo">min ' + p.minimo + "</span></td>" +
        '<td><div class="nivel"><div class="nivel-relleno' + (bajo ? " nivel-bajo" : "") +
          '" style="width:' + nivel + '%"></div></div>' +
          (bajo && !enPapelera ? '<span class="marca-bajo">Reponer</span>' : "") + "</td>" +
        '<td class="celda-acciones">' + acciones + "</td></tr>";
    }).join("");
  }

  /* Botones de cada fila */

  document.getElementById("cuerpo_tabla").addEventListener("click", async evento => {
    const { editar, eliminar, restaurar, vender } = evento.target.dataset;

    if (vender) {
      /* Voy a vender con el producto ya elegido */
      ventaPreseleccion = Number(vender);
      window.location.hash = "#ventas";
      return;
    }

    if (editar) {
      const consulta = new URLSearchParams({ buscar: "", estado: filtros.estado, pagina: filtros.pagina, orden: filtros.orden, dir: filtros.dir, categoria: filtros.categoria });
      const datos = await Api.get("/api/productos?" + consulta);
      const producto = datos.filas.find(p => p.id === Number(editar));
      if (producto) abrirModalProducto(producto);
    }

    if (eliminar) {
      const fila = evento.target.closest("tr");
      idEliminar = Number(eliminar);
      document.getElementById("resumen_eliminar").innerHTML =
        "<dt>Producto</dt><dd>" + fila.children[1].innerHTML + "</dd>" +
        "<dt>Codigo</dt><dd>" + fila.children[0].innerHTML + "</dd>";
      document.getElementById("modal_eliminar").showModal();
    }

    if (restaurar) {
      try {
        const respuesta = await Api.post("/api/productos/" + restaurar + "/restaurar");
        UI.toast(respuesta.mensaje);
        cargarInventario();
      } catch (error) { UI.toast(error.errores[0], "error"); }
    }
  });

  document.getElementById("boton_confirmar_eliminar").addEventListener("click", async () => {
    if (!idEliminar) return;
    try {
      const respuesta = await Api.del("/api/productos/" + idEliminar);
      UI.toast(respuesta.mensaje);
      cargarInventario();
    } catch (error) { UI.toast(error.errores[0], "error"); }
    idEliminar = null;
    document.getElementById("modal_eliminar").close();
  });

  /* Alta y edicion de un producto */

  const modalProducto = document.getElementById("modal_producto");
  const formProducto = document.getElementById("form_producto");

  function abrirModalProducto(producto) {
    formProducto.reset();
    UI.ocultarAviso("aviso_producto");
    formProducto.dataset.id = producto ? producto.id : "";
    document.getElementById("titulo_modal").textContent =
      producto ? "Editar " + producto.codigo : "Nuevo producto";

    if (producto) {
      formProducto.nombre.value = producto.nombre;
      formProducto.categoria_id.value = producto.categoria_id;
      formProducto.precio.value = producto.precio;
      formProducto.stock.value = producto.stock;
      formProducto.minimo.value = producto.minimo;
      formProducto.codigo_barras.value = producto.codigo_barras || "";
    } else {
      formProducto.minimo.value = 10;
    }

    modalProducto.showModal();
    formProducto.nombre.focus();
  }

  document.getElementById("boton_nuevo").addEventListener("click", () => abrirModalProducto(null));

  document.getElementById("p_escanear").addEventListener("click", () => {
    Escaner.abrirCamara(codigo => { formProducto.codigo_barras.value = codigo; });
  });

  formProducto.addEventListener("submit", async evento => {
    evento.preventDefault();

    const datos = {
      nombre: formProducto.nombre.value,
      categoria_id: formProducto.categoria_id.value,
      precio: formProducto.precio.value,
      stock: formProducto.stock.value,
      minimo: formProducto.minimo.value,
      codigo_barras: formProducto.codigo_barras.value
    };

    const errores = Validacion.producto(datos);
    if (errores.length) { UI.mostrarErrores("aviso_producto", errores); return; }

    try {
      const id = formProducto.dataset.id;
      const respuesta = id
        ? await Api.put("/api/productos/" + id, datos)
        : await Api.post("/api/productos", datos);
      modalProducto.close();
      UI.toast(respuesta.mensaje);
      cargarInventario();
    } catch (error) {
      UI.mostrarErrores("aviso_producto", error.errores);
    }
  });

  /* Nueva categoria (solo gerencia) */

  const modalCategoria = document.getElementById("modal_categoria");
  const formCategoria = document.getElementById("form_categoria");

  document.getElementById("boton_categoria").addEventListener("click", () => {
    formCategoria.reset();
    UI.ocultarAviso("aviso_categoria");
    modalCategoria.showModal();
  });

  formCategoria.addEventListener("submit", async evento => {
    evento.preventDefault();
    const errores = Validacion.categoria(formCategoria.nombre.value);
    if (errores.length) { UI.mostrarErrores("aviso_categoria", errores); return; }

    try {
      const respuesta = await Api.post("/api/categorias", { nombre: formCategoria.nombre.value });
      modalCategoria.close();
      UI.toast(respuesta.mensaje);
      await cargarCategorias();
    } catch (error) {
      UI.mostrarErrores("aviso_categoria", error.errores);
    }
  });

  /* Descargo el Excel usando la sesion del navegador */

  document.getElementById("boton_exportar").addEventListener("click", () => {
    window.location.href = "/api/exportar";
    UI.toast("Descargando inventario en CSV.");
  });

  /* Aca armo la vista de movimientos */

  let paginaMov = 1, paginasMov = 1;

  async function cargarMovimientos() {
    /* Lleno el selector con todo el inventario, pagina por pagina */
    const selector = document.getElementById("m_producto");
    const primera = await Api.get("/api/productos?pagina=1&orden=nombre");

    let filas = primera.filas;
    for (let p = 2; p <= primera.paginas; p++) {
      const lote = await Api.get("/api/productos?pagina=" + p + "&orden=nombre");
      filas = filas.concat(lote.filas);
    }
    selector.innerHTML = '<option value="">Seleccionar producto</option>' +
      filas.map(f => '<option value="' + f.id + '">' +
        UI.limpiar(f.codigo + " / " + f.nombre + " (stock " + f.stock + ")") + "</option>").join("");

    await cargarTablaMovimientos();
  }

  /* Al escanear busco el producto por su codigo de barras y lo selecciono */
  async function seleccionarPorCodigoBarras(codigo, selector) {
    try {
      const producto = await Api.get("/api/productos/codigo/" + encodeURIComponent(codigo));
      selector.value = producto.id;
      UI.toast("Producto encontrado: " + producto.nombre);
    } catch (error) {
      UI.toast(error.errores[0], "error");
    }
  }

  Escaner.usb(document.getElementById("m_escaner"),
    codigo => seleccionarPorCodigoBarras(codigo, document.getElementById("m_producto")));
  document.getElementById("m_escaner_camara").addEventListener("click", () => {
    Escaner.abrirCamara(codigo => seleccionarPorCodigoBarras(codigo, document.getElementById("m_producto")));
  });

  function rangoMovimientos() {
    const desde = document.getElementById("mov_desde").value;
    const hasta = document.getElementById("mov_hasta").value;
    let parametros = "";
    if (desde) parametros += "&desde=" + encodeURIComponent(desde);
    if (hasta) parametros += "&hasta=" + encodeURIComponent(hasta);
    return parametros;
  }

  async function cargarTablaMovimientos() {
    const datos = await Api.get("/api/movimientos?pagina=" + paginaMov + rangoMovimientos());
    paginasMov = datos.paginas;

    document.getElementById("mov_actual").textContent = "Pagina " + datos.pagina + " de " + datos.paginas;
    document.getElementById("mov_atras").disabled = datos.pagina <= 1;
    document.getElementById("mov_adelante").disabled = datos.pagina >= datos.paginas;

    const cuerpo = document.getElementById("tabla_movimientos");
    if (datos.filas.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="6"><div class="tabla-vacia"><p>Aun no hay movimientos registrados.</p></div></td></tr>';
      return;
    }

    cuerpo.innerHTML = datos.filas.map(m =>
      "<tr>" +
      '<td class="celda-codigo">' + UI.fecha(m.fecha) + "</td>" +
      "<td>" + UI.limpiar(m.producto) + "</td>" +
      '<td><span class="sello sello-' + m.tipo + '">' + (m.tipo === "entrada" ? "Entrada" : "Salida") + "</span></td>" +
      '<td class="celda-num">' + m.cantidad + "</td>" +
      "<td>" + UI.limpiar(m.motivo) + "</td>" +
      '<td class="celda-codigo">' + UI.limpiar(m.usuario) + "</td></tr>").join("");
  }

  document.getElementById("mov_atras").addEventListener("click", () => {
    if (paginaMov > 1) { paginaMov--; cargarTablaMovimientos(); }
  });
  document.getElementById("mov_adelante").addEventListener("click", () => {
    if (paginaMov < paginasMov) { paginaMov++; cargarTablaMovimientos(); }
  });
  document.getElementById("mov_filtrar").addEventListener("click", () => {
    paginaMov = 1;
    cargarTablaMovimientos();
  });
  document.getElementById("mov_limpiar").addEventListener("click", () => {
    document.getElementById("mov_desde").value = "";
    document.getElementById("mov_hasta").value = "";
    paginaMov = 1;
    cargarTablaMovimientos();
  });

  document.getElementById("form_movimiento").addEventListener("submit", async evento => {
    evento.preventDefault();
    const form = evento.target;

    const datos = {
      producto_id: form.producto_id.value,
      tipo: form.tipo.value,
      cantidad: form.cantidad.value,
      motivo: form.motivo.value
    };

    const errores = Validacion.movimiento(datos);
    if (errores.length) { UI.mostrarErrores("aviso_movimiento", errores); return; }

    try {
      const respuesta = await Api.post("/api/movimientos", datos);
      UI.ocultarAviso("aviso_movimiento");
      UI.toast(respuesta.mensaje);
      form.cantidad.value = "";
      form.motivo.value = "";
      paginaMov = 1;
      cargarMovimientos();
    } catch (error) {
      UI.mostrarErrores("aviso_movimiento", error.errores);
    }
  });

  /* Aca armo la vista de venta mayorista */

  let ventaProductos = [];      /* productos para elegir */
  let ventaLineas = [];         /* lineas de la boleta */
  let ventaPreseleccion = null; /* producto que viene del boton Vender */
  let paginaBoletas = 1, paginasBoletas = 1;

  async function cargarVentas() {
    /* Traigo todos los productos para elegir */
    const primera = await Api.get("/api/productos?pagina=1&orden=nombre");
    let filas = primera.filas;
    for (let p = 2; p <= primera.paginas; p++) {
      const lote = await Api.get("/api/productos?pagina=" + p + "&orden=nombre");
      filas = filas.concat(lote.filas);
    }
    ventaProductos = filas;

    const selector = document.getElementById("v_producto");
    selector.innerHTML = '<option value="">Seleccionar producto</option>' +
      filas.map(f => '<option value="' + f.id + '" data-precio="' + f.precio + '" data-stock="' + f.stock + '">' +
        UI.limpiar(f.codigo + " / " + f.nombre + " (stock " + f.stock + ")") + "</option>").join("");

    if (ventaPreseleccion) {
      selector.value = String(ventaPreseleccion);
      document.getElementById("v_cantidad").focus();
      ventaPreseleccion = null;
    }

    await cargarBoletas();
  }

  function agregarLinea() {
    const selector = document.getElementById("v_producto");
    const id = Number(selector.value);
    const cantidad = Number(document.getElementById("v_cantidad").value);

    if (!id) { UI.toast("Elija un producto.", "error"); return; }
    if (!Number.isInteger(cantidad) || cantidad <= 0) { UI.toast("Ingrese una cantidad valida.", "error"); return; }

    const prod = ventaProductos.find(p => p.id === id);
    if (!prod) return;

    const yaExiste = ventaLineas.find(l => l.producto_id === id);
    const acumulada = (yaExiste ? yaExiste.cantidad : 0) + cantidad;
    if (acumulada > prod.stock) {
      UI.toast(prod.nombre + ": solo hay " + prod.stock + " en stock.", "error"); return;
    }

    if (yaExiste) yaExiste.cantidad = acumulada;
    else ventaLineas.push({ producto_id: id, codigo: prod.codigo, nombre: prod.nombre, precio: prod.precio, cantidad });

    document.getElementById("v_cantidad").value = "";
    selector.value = "";
    pintarLineasVenta();
  }

  function quitarLinea(id) {
    ventaLineas = ventaLineas.filter(l => l.producto_id !== id);
    pintarLineasVenta();
  }

  function pintarLineasVenta() {
    const cuerpo = document.getElementById("v_lineas");
    if (ventaLineas.length === 0) {
      cuerpo.innerHTML = '<tr class="linea-vacia"><td colspan="5">Agregue productos a la boleta.</td></tr>';
    } else {
      cuerpo.innerHTML = ventaLineas.map(l => {
        const importe = l.precio * l.cantidad;
        return "<tr>" +
          "<td><strong>" + UI.limpiar(l.nombre) + "</strong><br><span class='minimo'>" + UI.limpiar(l.codigo) + "</span></td>" +
          '<td class="celda-num">' + l.cantidad + "</td>" +
          '<td class="celda-num">' + UI.moneda(l.precio) + "</td>" +
          '<td class="celda-num">' + UI.moneda(importe) + "</td>" +
          '<td class="celda-acciones"><button class="boton-mini boton-mini-rojo" data-quitar="' + l.producto_id + '">Quitar</button></td></tr>';
      }).join("");
    }
    recalcularTotales();
  }

  function recalcularTotales() {
    const subtotal = ventaLineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
    const usar = document.getElementById("v_usar_descuento").checked;
    const pct = usar ? Math.min(100, Math.max(0, Number(document.getElementById("v_descuento").value) || 0)) : 0;
    const monto = subtotal * pct / 100;
    const total = subtotal - monto;

    document.getElementById("v_subtotal").textContent = UI.moneda(subtotal);
    document.getElementById("linea_descuento").hidden = !usar || pct === 0;
    document.getElementById("v_pct_texto").textContent = pct;
    document.getElementById("v_monto_descuento").textContent = "- " + UI.moneda(monto);
    document.getElementById("v_total").textContent = UI.moneda(total);
  }

  /* Al escanear agrego 1 unidad, si el producto ya estaba solo le sumo una mas */
  async function agregarPorCodigoBarras(codigo) {
    try {
      const producto = await Api.get("/api/productos/codigo/" + encodeURIComponent(codigo));
      document.getElementById("v_producto").value = producto.id;
      const campoCantidad = document.getElementById("v_cantidad");
      if (!campoCantidad.value) campoCantidad.value = 1;
      agregarLinea();
    } catch (error) {
      UI.toast(error.errores[0], "error");
    }
  }

  Escaner.usb(document.getElementById("v_escaner"), agregarPorCodigoBarras);
  document.getElementById("v_escaner_camara").addEventListener("click", () => {
    Escaner.abrirCamara(agregarPorCodigoBarras);
  });

  document.getElementById("v_agregar").addEventListener("click", agregarLinea);
  document.getElementById("v_cantidad").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); agregarLinea(); }
  });
  document.getElementById("v_lineas").addEventListener("click", e => {
    const id = e.target.dataset.quitar;
    if (id) quitarLinea(Number(id));
  });
  document.getElementById("v_usar_descuento").addEventListener("change", e => {
    document.getElementById("caja_descuento").hidden = !e.target.checked;
    recalcularTotales();
  });
  document.getElementById("v_descuento").addEventListener("input", recalcularTotales);

  document.getElementById("form_venta").addEventListener("submit", async evento => {
    evento.preventDefault();
    const form = evento.target;

    if (ventaLineas.length === 0) {
      UI.mostrarErrores("aviso_venta", ["Agregue al menos un producto a la boleta."]); return;
    }

    const usar = document.getElementById("v_usar_descuento").checked;
    const datos = {
      cliente: form.cliente.value,
      documento: form.documento.value,
      direccion: form.direccion.value,
      observacion: form.observacion.value,
      descuento_pct: usar ? document.getElementById("v_descuento").value : 0,
      items: ventaLineas.map(l => ({ producto_id: l.producto_id, cantidad: l.cantidad }))
    };

    const errores = Validacion.boletaMayorista(datos);
    if (errores.length) { UI.mostrarErrores("aviso_venta", errores); return; }

    const boton = document.getElementById("v_emitir");
    boton.disabled = true; boton.textContent = "Emitiendo...";

    try {
      const respuesta = await Api.post("/api/ventas/mayorista", datos);
      UI.ocultarAviso("aviso_venta");
      UI.toast(respuesta.mensaje);
      mostrarBoleta(respuesta.boleta);
      /* Limpio todo para la siguiente venta */
      ventaLineas = [];
      form.reset();
      document.getElementById("caja_descuento").hidden = true;
      pintarLineasVenta();
      paginaBoletas = 1;
      await cargarVentas();
    } catch (error) {
      UI.mostrarErrores("aviso_venta", error.errores);
    } finally {
      boton.disabled = false; boton.textContent = "Emitir boleta";
    }
  });

  async function cargarBoletas() {
    const datos = await Api.get("/api/ventas/boletas?pagina=" + paginaBoletas);
    paginasBoletas = datos.paginas;

    document.getElementById("bol_actual").textContent = "Pagina " + datos.pagina + " de " + datos.paginas;
    document.getElementById("bol_atras").disabled = datos.pagina <= 1;
    document.getElementById("bol_adelante").disabled = datos.pagina >= datos.paginas;

    const cuerpo = document.getElementById("tabla_boletas");
    if (datos.filas.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="5"><div class="tabla-vacia"><p>Aun no se han emitido boletas.</p></div></td></tr>';
      return;
    }
    cuerpo.innerHTML = datos.filas.map(b =>
      "<tr>" +
      '<td class="celda-codigo">' + UI.limpiar(b.numero) + "</td>" +
      '<td class="celda-codigo">' + UI.fecha(b.creado) + "</td>" +
      "<td>" + UI.limpiar(b.cliente) + "</td>" +
      '<td class="celda-num">' + UI.moneda(b.total) + "</td>" +
      '<td class="celda-acciones"><button class="boton-mini" data-boleta="' + b.id + '">Ver / Imprimir</button></td></tr>').join("");
  }

  document.getElementById("tabla_boletas").addEventListener("click", async evento => {
    const id = evento.target.dataset.boleta;
    if (!id) return;
    try {
      const datos = await Api.get("/api/ventas/boleta/" + id);
      const b = datos.boleta;
      mostrarBoleta({
        id: b.id, numero: b.numero, cliente: b.cliente, documento: b.documento || "",
        direccion: b.direccion || "", observacion: b.observacion || "",
        subtotal: b.subtotal, descuento_pct: b.descuento_pct, descuento_monto: b.descuento_monto,
        total: b.total, vendedor: b.vendedor, creado: b.creado, items: datos.items
      });
    } catch (error) { UI.toast(error.errores[0], "error"); }
  });

  document.getElementById("bol_atras").addEventListener("click", () => {
    if (paginaBoletas > 1) { paginaBoletas--; cargarBoletas(); }
  });
  document.getElementById("bol_adelante").addEventListener("click", () => {
    if (paginaBoletas < paginasBoletas) { paginaBoletas++; cargarBoletas(); }
  });

  /* Armo la boleta para imprimir */
  let boletaActualId = null;

  function mostrarBoleta(b) {
    boletaActualId = b.id || null;
    document.getElementById("boton_pdf_boleta").hidden = !boletaActualId;
    const filas = b.items.map(it =>
      "<tr>" +
      "<td>" + UI.limpiar(it.codigo) + "</td>" +
      "<td>" + UI.limpiar(it.nombre) + "</td>" +
      '<td class="der">' + it.cantidad + "</td>" +
      '<td class="der">' + UI.moneda(it.precio) + "</td>" +
      '<td class="der">' + UI.moneda(it.importe) + "</td></tr>").join("");

    const lineaDescuento = b.descuento_pct > 0
      ? '<div class="bol-total-fila"><span>Descuento (' + b.descuento_pct + '%)</span><span>- ' + UI.moneda(b.descuento_monto) + "</span></div>"
      : "";

    document.getElementById("boleta_papel").innerHTML =
      '<div class="bol-encabezado">' +
        '<div class="bol-marca">' +
          '<strong>COMERCIALIZADORA SIPAN S.A.C.</strong>' +
          "<span>Distribucion mayorista de abarrotes</span>" +
          "<span>Chiclayo - Lambayeque, Peru</span>" +
          "<span>RUC 20xxxxxxxxx</span>" +
        "</div>" +
        '<div class="bol-tipo">' +
          "<span>BOLETA DE VENTA</span>" +
          "<strong>" + UI.limpiar(b.numero) + "</strong>" +
        "</div>" +
      "</div>" +
      '<div class="bol-datos">' +
        "<div><span>Cliente:</span> " + UI.limpiar(b.cliente) + "</div>" +
        (b.documento ? "<div><span>RUC/DNI:</span> " + UI.limpiar(b.documento) + "</div>" : "") +
        (b.direccion ? "<div><span>Direccion:</span> " + UI.limpiar(b.direccion) + "</div>" : "") +
        "<div><span>Fecha:</span> " + UI.fecha(b.creado) + "</div>" +
        "<div><span>Atendio:</span> " + UI.limpiar(b.vendedor) + "</div>" +
      "</div>" +
      '<table class="bol-tabla"><thead><tr>' +
        "<th>Codigo</th><th>Descripcion</th><th class='der'>Cant.</th><th class='der'>P. Unit.</th><th class='der'>Importe</th>" +
      "</tr></thead><tbody>" + filas + "</tbody></table>" +
      '<div class="bol-totales">' +
        '<div class="bol-total-fila"><span>Subtotal</span><span>' + UI.moneda(b.subtotal) + "</span></div>" +
        lineaDescuento +
        '<div class="bol-total-fila bol-total-final"><span>TOTAL</span><span>' + UI.moneda(b.total) + "</span></div>" +
      "</div>" +
      (b.observacion ? '<div class="bol-observacion"><span>Observacion:</span> ' + UI.limpiar(b.observacion) + "</div>" : "") +
      '<div class="bol-pie">' +
        "<span>" + enLetras(b.total) + "</span>" +
        "<span class='bol-gracias'>Gracias por su compra</span>" +
      "</div>";

    document.getElementById("modal_boleta").showModal();
  }

  document.getElementById("boton_pdf_boleta").addEventListener("click", () => {
    if (boletaActualId) window.location.href = "/api/ventas/boleta/" + boletaActualId + "/pdf";
  });

  document.getElementById("boton_imprimir_boleta").addEventListener("click", () => {
    document.body.classList.add("imprimiendo-boleta");
    window.print();
    setTimeout(() => document.body.classList.remove("imprimiendo-boleta"), 500);
  });

  /* Paso el total a letras */
  function enLetras(monto) {
    const soles = Math.floor(monto);
    const centimos = Math.round((monto - soles) * 100);
    const unidades = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
      "diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve"];
    const decenas = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
    const centenas = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
      "seiscientos", "setecientos", "ochocientos", "novecientos"];

    function tresCifras(n) {
      if (n === 0) return "";
      if (n === 100) return "cien";
      let t = "";
      const c = Math.floor(n / 100), resto = n % 100;
      if (c) t += centenas[c] + " ";
      if (resto < 20) t += unidades[resto];
      else {
        const d = Math.floor(resto / 10), u = resto % 10;
        if (d === 2 && u) t += "veinti" + unidades[u];
        else t += decenas[d] + (u ? " y " + unidades[u] : "");
      }
      return t.trim();
    }

    let texto;
    if (soles === 0) texto = "cero";
    else if (soles < 1000) texto = tresCifras(soles);
    else {
      const miles = Math.floor(soles / 1000), resto = soles % 1000;
      texto = (miles === 1 ? "mil" : tresCifras(miles) + " mil") + (resto ? " " + tresCifras(resto) : "");
    }
    return "Son: " + texto.toUpperCase() + " CON " + String(centimos).padStart(2, "0") + "/100 SOLES";
  }

  /* Aca armo la vista de tickets */

  let paginaTickets = 1, paginasTickets = 1;

  async function cargarProductosEn(selector) {
    const primera = await Api.get("/api/productos?pagina=1&orden=nombre");
    let filas = primera.filas;
    for (let p = 2; p <= primera.paginas; p++) {
      const lote = await Api.get("/api/productos?pagina=" + p + "&orden=nombre");
      filas = filas.concat(lote.filas);
    }
    selector.innerHTML = '<option value="">Sin producto especifico</option>' +
      filas.map(f => '<option value="' + f.id + '">' +
        UI.limpiar(f.codigo + " / " + f.nombre) + "</option>").join("");
  }

  async function cargarTickets() {
    await cargarProductosEn(document.getElementById("t_producto"));
    await cargarTablaTickets();
  }

  async function cargarTablaTickets() {
    const estado = document.getElementById("ticket_estado").value;
    const datos = await Api.get("/api/tickets?estado=" + estado + "&pagina=" + paginaTickets);
    paginasTickets = datos.paginas;

    document.getElementById("ticket_actual").textContent = "Pagina " + datos.pagina + " de " + datos.paginas;
    document.getElementById("ticket_atras").disabled = datos.pagina <= 1;
    document.getElementById("ticket_adelante").disabled = datos.pagina >= datos.paginas;

    const cuerpo = document.getElementById("tabla_tickets");
    if (datos.filas.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="6"><div class="tabla-vacia"><p>No hay tickets en este estado.</p></div></td></tr>';
      return;
    }

    cuerpo.innerHTML = datos.filas.map(t =>
      "<tr>" +
      '<td class="celda-codigo">' + UI.fecha(t.creado) + "</td>" +
      '<td><span class="etiqueta">' + UI.limpiar(t.tipo) + "</span></td>" +
      "<td><strong>" + UI.limpiar(t.titulo) + (t.tipo === "venta" && t.cantidad ? " (" + t.cantidad + " und.)" : "") +
      "</strong><br><span class='minimo'>" + UI.limpiar(t.detalle) + "</span></td>" +
      "<td>" + (t.producto ? UI.limpiar(t.codigo + " / " + t.producto) : "General") + "</td>" +
      '<td><span class="marca-bajo prioridad-' + t.prioridad + '">' + UI.limpiar(t.prioridad) + "</span></td>" +
      '<td class="celda-acciones">' + (t.estado === "abierto"
        ? '<button class="boton-mini" data-cerrar-ticket="' + t.id + '">Cerrar</button>'
        : '<span class="minimo">Cerrado</span>') + "</td></tr>").join("");
  }

  document.getElementById("ticket_estado").addEventListener("change", () => {
    paginaTickets = 1;
    cargarTablaTickets();
  });
  document.getElementById("ticket_atras").addEventListener("click", () => {
    if (paginaTickets > 1) { paginaTickets--; cargarTablaTickets(); }
  });
  document.getElementById("ticket_adelante").addEventListener("click", () => {
    if (paginaTickets < paginasTickets) { paginaTickets++; cargarTablaTickets(); }
  });
  document.getElementById("tabla_tickets").addEventListener("click", async evento => {
    const id = evento.target.dataset.cerrarTicket;
    if (!id) return;
    try {
      const respuesta = await Api.post("/api/tickets/" + id + "/cerrar");
      UI.toast(respuesta.mensaje);
      cargarTablaTickets();
    } catch (error) { UI.toast(error.errores[0], "error"); }
  });

  function actualizarCampoVenta() {
    const esVenta = document.getElementById("t_tipo").value === "venta";
    document.getElementById("campo_t_cantidad").hidden = !esVenta;
    document.getElementById("t_cantidad").required = esVenta;
    document.querySelector("#form_ticket button[type=submit]").textContent =
      esVenta ? "Registrar venta" : "Guardar ticket";
  }
  document.getElementById("t_tipo").addEventListener("change", actualizarCampoVenta);

  document.getElementById("form_ticket").addEventListener("submit", async evento => {
    evento.preventDefault();
    const form = evento.target;
    const datos = {
      producto_id: form.producto_id.value,
      tipo: form.tipo.value,
      prioridad: form.prioridad.value,
      titulo: form.titulo.value,
      detalle: form.detalle.value,
      cantidad: form.tipo.value === "venta" ? form.cantidad.value : undefined
    };

    const errores = Validacion.ticket(datos);
    if (errores.length) { UI.mostrarErrores("aviso_ticket", errores); return; }

    try {
      const respuesta = await Api.post("/api/tickets", datos);
      UI.ocultarAviso("aviso_ticket");
      UI.toast(respuesta.mensaje);
      form.reset();
      actualizarCampoVenta();
      paginaTickets = 1;
      cargarTickets();
    } catch (error) {
      UI.mostrarErrores("aviso_ticket", error.errores);
    }
  });

  /* Aca armo los reportes; los graficos los dibujo yo con SVG */

  async function cargarReportes() {
    const desde = document.getElementById("rep_desde").value;
    const hasta = document.getElementById("rep_hasta").value;
    const partes = [];
    if (desde) partes.push("desde=" + encodeURIComponent(desde));
    if (hasta) partes.push("hasta=" + encodeURIComponent(hasta));

    const datos = await Api.get("/api/reportes" + (partes.length ? "?" + partes.join("&") : ""));
    pintarBarras(datos.porCategoria);
    pintarLineas(datos.dias);
    pintarRanking(datos.masMovidos);
    pintarCriticos(datos.criticos);
    pintarTiposProducto(datos.tiposProducto);
    pintarResumenTickets(datos.tickets);

    document.getElementById("titulo_grafico_dias").textContent =
      datos.rango && datos.rango.desde && datos.rango.hasta
        ? "Movimientos del " + datos.rango.desde + " al " + datos.rango.hasta
        : "Movimientos de los ultimos 7 dias";
  }

  document.getElementById("rep_filtrar").addEventListener("click", cargarReportes);
  document.getElementById("rep_limpiar").addEventListener("click", () => {
    document.getElementById("rep_desde").value = "";
    document.getElementById("rep_hasta").value = "";
    cargarReportes();
  });
  document.getElementById("rep_pdf").addEventListener("click", () => {
    const desde = document.getElementById("rep_desde").value;
    const hasta = document.getElementById("rep_hasta").value;
    const partes = [];
    if (desde) partes.push("desde=" + encodeURIComponent(desde));
    if (hasta) partes.push("hasta=" + encodeURIComponent(hasta));
    window.location.href = "/api/reportes/pdf" + (partes.length ? "?" + partes.join("&") : "");
  });

  function pintarBarras(categorias) {
    const mayor = Math.max(...categorias.map(c => c.valor), 1);
    document.getElementById("grafico_categorias").innerHTML = categorias.map(c => {
      const ancho = Math.max(2, Math.round((c.valor / mayor) * 100));
      return '<div class="barra-fila">' +
        '<span class="barra-nombre">' + UI.limpiar(c.nombre) + "</span>" +
        '<div class="barra-pista"><div class="barra-relleno" style="width:' + ancho + '%"></div></div>' +
        '<span class="barra-valor">' + UI.moneda(c.valor) + "</span></div>";
    }).join("");
  }

  function pintarLineas(dias) {
    const ancho = 560, alto = 200, margen = 24;
    const mayor = Math.max(...dias.map(d => Math.max(d.entradas, d.salidas)), 1);

    const punto = (indice, valor) => {
      const x = margen + (indice * (ancho - 2 * margen)) / Math.max(dias.length - 1, 1);
      const y = alto - margen - (valor / mayor) * (alto - 2 * margen);
      return x + "," + y;
    };

    const lineaEntradas = dias.map((d, i) => punto(i, d.entradas)).join(" ");
    const lineaSalidas = dias.map((d, i) => punto(i, d.salidas)).join(" ");
    const rotulos = dias.map((d, i) => {
      const x = margen + (i * (ancho - 2 * margen)) / Math.max(dias.length - 1, 1);
      return '<text x="' + x + '" y="' + (alto - 6) + '" class="eje">' + d.dia.slice(5) + "</text>";
    }).join("");

    document.getElementById("grafico_dias").innerHTML =
      '<svg viewBox="0 0 ' + ancho + " " + alto + '" role="img" aria-label="Movimientos por dia">' +
      '<line x1="' + margen + '" y1="' + (alto - margen) + '" x2="' + (ancho - margen) + '" y2="' + (alto - margen) + '" class="linea-eje"/>' +
      '<polyline points="' + lineaEntradas + '" class="linea-entradas"/>' +
      '<polyline points="' + lineaSalidas + '" class="linea-salidas"/>' +
      dias.map((d, i) => '<circle cx="' + punto(i, d.entradas).split(",")[0] + '" cy="' + punto(i, d.entradas).split(",")[1] + '" r="3.5" class="punto-entrada"/>').join("") +
      dias.map((d, i) => '<circle cx="' + punto(i, d.salidas).split(",")[0] + '" cy="' + punto(i, d.salidas).split(",")[1] + '" r="3.5" class="punto-salida"/>').join("") +
      rotulos + "</svg>";
  }

  function pintarRanking(lista) {
    const caja = document.getElementById("lista_movidos");
    if (lista.length === 0) {
      caja.innerHTML = "<li class='auditoria-vacia'>Aun no hay movimientos para medir.</li>";
      return;
    }
    const mayor = Math.max(...lista.map(m => m.unidades), 1);
    caja.innerHTML = lista.map(m =>
      "<li><span class='ranking-nombre'>" + UI.limpiar(m.nombre) + "</span>" +
      '<div class="barra-pista"><div class="barra-relleno barra-maiz" style="width:' +
      Math.max(4, Math.round((m.unidades / mayor) * 100)) + '%"></div></div>' +
      '<span class="barra-valor">' + m.unidades + " ud</span></li>").join("");
  }

  function pintarCriticos(lista) {
    const caja = document.getElementById("lista_criticos");
    if (lista.length === 0) {
      caja.innerHTML = "<li class='auditoria-vacia'>Ningun producto esta bajo su minimo.</li>";
      return;
    }
    caja.innerHTML = lista.map(p =>
      "<li><span class='celda-codigo'>" + UI.limpiar(p.codigo) + "</span>" +
      "<span>" + UI.limpiar(p.nombre) + "</span>" +
      '<span class="marca-bajo">' + p.stock + " / min " + p.minimo + "</span></li>").join("");
  }

  function pintarTiposProducto(lista) {
    const caja = document.getElementById("tabla_tipos_producto");
    if (!lista.length) {
      caja.innerHTML = "<p class='auditoria-vacia'>Aun no hay categorias.</p>";
      return;
    }
    caja.innerHTML = "<table><thead><tr><th>Tipo</th><th>Productos</th><th>Unidades</th><th>Valor</th></tr></thead><tbody>" +
      lista.map(t => "<tr><td>" + UI.limpiar(t.nombre) + "</td><td class='celda-num'>" +
        t.productos + "</td><td class='celda-num'>" + t.unidades + "</td><td class='celda-num'>" +
        UI.moneda(t.valor) + "</td></tr>").join("") + "</tbody></table>";
  }

  function pintarResumenTickets(lista) {
    const caja = document.getElementById("tabla_resumen_tickets");
    if (!lista.length) {
      caja.innerHTML = "<p class='auditoria-vacia'>Aun no hay tickets registrados.</p>";
      return;
    }
    caja.innerHTML = "<table><thead><tr><th>Tipo</th><th>Estado</th><th>Total</th></tr></thead><tbody>" +
      lista.map(t => "<tr><td>" + UI.limpiar(t.tipo) + "</td><td>" +
        UI.limpiar(t.estado) + "</td><td class='celda-num'>" + t.total + "</td></tr>").join("") +
      "</tbody></table>";
  }

  /* Aca armo la vista de usuarios */

  let rolesDisponibles = {};
  let usuariosCargados = [];

  async function cargarUsuarios() {
    if (!esGerencia) return;
    const datos = await Api.get("/api/usuarios");
    rolesDisponibles = datos.roles;
    usuariosCargados = datos.filas;

    const selector = document.getElementById("u_rol");
    selector.innerHTML = Object.entries(datos.roles).map(([valor, nombre]) =>
      '<option value="' + valor + '">' + UI.limpiar(nombre) + "</option>").join("");

    document.getElementById("tabla_usuarios").innerHTML = datos.filas.map(u =>
      "<tr>" +
      "<td>" + UI.limpiar(u.nombre) + "</td>" +
      '<td class="celda-codigo">' + UI.limpiar(u.usuario) + "</td>" +
      "<td>" + UI.limpiar(u.correo) + "</td>" +
      '<td><span class="etiqueta">' + UI.limpiar(datos.roles[u.rol] || u.rol) + "</span></td>" +
      '<td class="celda-codigo">' + UI.fecha(u.creado) + "</td>" +
      '<td class="celda-acciones"><button class="boton-mini" data-cambiar-rol="' + u.id + '">Cambiar rol</button></td></tr>').join("");
  }

  const modalRol = document.getElementById("modal_rol");
  let usuarioRolObjetivo = null;

  document.getElementById("tabla_usuarios").addEventListener("click", evento => {
    const id = evento.target.dataset.cambiarRol;
    if (!id) return;
    usuarioRolObjetivo = usuariosCargados.find(u => String(u.id) === id);
    if (!usuarioRolObjetivo) return;

    document.getElementById("resumen_rol").textContent =
      "Usuario: " + usuarioRolObjetivo.usuario + " (" + (rolesDisponibles[usuarioRolObjetivo.rol] || usuarioRolObjetivo.rol) + ")";
    const selector = document.getElementById("r_rol");
    selector.innerHTML = Object.entries(rolesDisponibles).map(([valor, nombre]) =>
      '<option value="' + valor + '"' + (valor === usuarioRolObjetivo.rol ? " selected" : "") + '>' + UI.limpiar(nombre) + "</option>").join("");
    document.getElementById("form_rol").reset();
    selector.value = usuarioRolObjetivo.rol;
    UI.ocultarAviso("aviso_rol");
    modalRol.showModal();
  });

  document.getElementById("form_rol").addEventListener("submit", async evento => {
    evento.preventDefault();
    if (!usuarioRolObjetivo) return;
    const form = evento.target;
    const datos = { rol: form.rol.value, clave: form.clave.value };

    if (Validacion.vacio(datos.clave)) { UI.mostrarErrores("aviso_rol", ["Ingrese su clave para confirmar."]); return; }

    try {
      const respuesta = await Api.put("/api/usuarios/" + usuarioRolObjetivo.id + "/rol", datos);
      UI.ocultarAviso("aviso_rol");
      UI.toast(respuesta.mensaje);
      modalRol.close();
      cargarUsuarios();
    } catch (error) {
      UI.mostrarErrores("aviso_rol", error.errores);
    }
  });

  document.getElementById("form_usuario").addEventListener("submit", async evento => {
    evento.preventDefault();
    const form = evento.target;
    const datos = {
      nombre: form.nombre.value,
      usuario: form.usuario.value,
      correo: form.correo.value,
      rol: form.rol.value,
      clave: form.clave.value,
      confirmacion: form.confirmacion.value
    };

    const errores = Validacion.registroUsuario(datos);
    if (!datos.rol) errores.push("Debe elegir un rol.");
    if (errores.length) { UI.mostrarErrores("aviso_usuario", errores); return; }

    try {
      const respuesta = await Api.post("/api/usuarios", datos);
      UI.ocultarAviso("aviso_usuario");
      UI.toast(respuesta.mensaje);
      form.reset();
      cargarUsuarios();
    } catch (error) {
      UI.mostrarErrores("aviso_usuario", error.errores);
    }
  });

  /* Aca armo el bloque de respaldos de la base de datos */

  function tamanoLegible(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function cargarRespaldos() {
    const datos = await Api.get("/api/respaldos");
    document.getElementById("resp_info").textContent =
      "Se crea uno automatico cada " + datos.horas + " horas y se conservan los ultimos " + datos.maximo + ".";

    const cuerpo = document.getElementById("tabla_respaldos");
    if (datos.archivos.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="4"><div class="tabla-vacia"><p>Aun no hay respaldos.</p></div></td></tr>';
      return;
    }
    cuerpo.innerHTML = datos.archivos.map(a =>
      "<tr>" +
      '<td class="celda-codigo">' + UI.limpiar(a.nombre) + "</td>" +
      "<td>" + UI.fecha(a.creado) + "</td>" +
      '<td class="celda-num">' + tamanoLegible(a.tamano) + "</td>" +
      '<td class="celda-acciones"><a class="boton-mini" href="/api/respaldos/' +
      encodeURIComponent(a.nombre) + '">Descargar</a></td></tr>').join("");
  }

  document.getElementById("resp_crear").addEventListener("click", async () => {
    const boton = document.getElementById("resp_crear");
    boton.disabled = true;
    boton.textContent = "Creando...";
    try {
      const respuesta = await Api.post("/api/respaldos");
      UI.toast(respuesta.mensaje);
      await cargarRespaldos();
    } catch (error) {
      UI.toast(error.errores[0], "error");
    } finally {
      boton.disabled = false;
      boton.textContent = "Respaldar ahora";
    }
  });

  /* Aca armo la vista de auditoria */

  let paginaAud = 1, paginasAud = 1;

  async function cargarAuditoria() {
    await cargarRespaldos();
    const datos = await Api.get("/api/auditoria?pagina=" + paginaAud);
    paginasAud = datos.paginas;

    document.getElementById("aud_actual").textContent = "Pagina " + datos.pagina + " de " + datos.paginas;
    document.getElementById("aud_atras").disabled = datos.pagina <= 1;
    document.getElementById("aud_adelante").disabled = datos.pagina >= datos.paginas;

    document.getElementById("tabla_auditoria").innerHTML = datos.filas.map(a =>
      "<tr>" +
      '<td class="celda-codigo">' + UI.fecha(a.fecha) + "</td>" +
      "<td>" + UI.limpiar(a.usuario) + "</td>" +
      '<td><span class="etiqueta">' + UI.limpiar(a.tipo) + "</span></td>" +
      "<td>" + UI.limpiar(a.detalle) + "</td></tr>").join("");
  }

  document.getElementById("aud_atras").addEventListener("click", () => {
    if (paginaAud > 1) { paginaAud--; cargarAuditoria(); }
  });
  document.getElementById("aud_adelante").addEventListener("click", () => {
    if (paginaAud < paginasAud) { paginaAud++; cargarAuditoria(); }
  });

  /* Aca armo la vista de mi perfil */

  const descripcionesRol = {
    gerente_general: "Control total del sistema. Crea cuentas, asigna cualquier rol, define categorias y ve toda la auditoria. Su cuenta exige verificacion en dos pasos.",
    administrador: "Administra el inventario y las cuentas del dia a dia. Puede casi todo, salvo nombrar o destituir a un gerente general.",
    vendedor: "Atiende el mostrador: registra ventas, emite boletas mayoristas, consulta el inventario y levanta tickets. No modifica el catalogo ni las cuentas.",
    reponedor: "Cuida las existencias: registra entradas y salidas, edita datos de producto y mantiene el stock al dia. No vende al publico ni administra cuentas."
  };

  async function cargarPerfil() {
    document.getElementById("ficha_perfil").innerHTML =
      "<dt>Nombre</dt><dd>" + UI.limpiar(perfil.nombre) + "</dd>" +
      "<dt>Usuario</dt><dd>" + UI.limpiar(perfil.usuario) + "</dd>" +
      "<dt>Rol</dt><dd>" + UI.limpiar(perfil.rolNombre || perfil.rol) + "</dd>";

    document.getElementById("rol_descripcion").innerHTML =
      "<strong>Que puede hacer su rol</strong><p>" +
      UI.limpiar(descripcionesRol[perfil.rol] || "") + "</p>";

    await cargarEstado2FA();
  }

  /* Activar y desactivar el 2FA */

  let secretoActivacion = null;

  async function cargarEstado2FA() {
    const estado = await Api.get("/api/2fa/estado");

    const sello = document.getElementById("sello_2fa");
    const texto = document.getElementById("estado_2fa_texto");
    document.getElementById("bloque_2fa_off").hidden = true;
    document.getElementById("bloque_2fa_config").hidden = true;
    document.getElementById("bloque_2fa_on").hidden = true;

    if (estado.activo) {
      sello.textContent = "Activa";
      sello.className = "sello-2fa sello-2fa-on";
      texto.textContent = "Su cuenta pide un codigo al iniciar sesion.";
      document.getElementById("bloque_2fa_on").hidden = false;
      document.getElementById("respaldos_texto").textContent =
        "Le quedan " + estado.respaldosRestantes + " codigos de respaldo.";
      document.getElementById("nota_obligatorio_2fa").hidden = !estado.obligatorio;
      document.getElementById("boton_desactivar_2fa").hidden = estado.obligatorio;
    } else {
      sello.textContent = estado.obligatorio ? "Requerida" : "Inactiva";
      sello.className = "sello-2fa " + (estado.obligatorio ? "sello-2fa-req" : "sello-2fa-off");
      texto.textContent = estado.obligatorio
        ? "Como gerente general, deberia activarla cuanto antes."
        : "Refuerce su cuenta con un segundo factor.";
      document.getElementById("bloque_2fa_off").hidden = false;
    }
  }

  document.getElementById("boton_activar_2fa").addEventListener("click", async () => {
    try {
      const datos = await Api.post("/api/2fa/iniciar");
      secretoActivacion = datos.secreto;
      document.getElementById("secreto_2fa").textContent = datos.secreto.replace(/(.{4})/g, "$1 ").trim();
      document.getElementById("qr_2fa").innerHTML = generarQR(datos.uri);
      document.getElementById("codigo_activar").value = "";
      UI.ocultarAviso("aviso_activar_2fa");
      document.getElementById("bloque_2fa_off").hidden = true;
      document.getElementById("bloque_2fa_config").hidden = false;
    } catch (error) { UI.toast(error.errores[0], "error"); }
  });

  document.getElementById("boton_cancelar_2fa").addEventListener("click", () => {
    secretoActivacion = null;
    cargarEstado2FA();
  });

  document.getElementById("boton_confirmar_2fa").addEventListener("click", async () => {
    const codigo = document.getElementById("codigo_activar").value.trim();
    if (!/^\d{6}$/.test(codigo)) {
      UI.mostrarErrores("aviso_activar_2fa", ["Ingrese el codigo de 6 digitos."]); return;
    }
    try {
      const respuesta = await Api.post("/api/2fa/activar", { codigo });
      UI.toast(respuesta.mensaje);
      mostrarRespaldos(respuesta.respaldos);
      perfil.dosfaActivo = true;
      await cargarEstado2FA();
    } catch (error) {
      UI.mostrarErrores("aviso_activar_2fa", error.errores);
    }
  });

  function mostrarRespaldos(codigos) {
    document.getElementById("lista_respaldos").innerHTML =
      codigos.map(c => "<li>" + UI.limpiar(c) + "</li>").join("");
    document.getElementById("modal_respaldos").showModal();
  }

  document.getElementById("copiar_respaldos").addEventListener("click", () => {
    const texto = Array.from(document.querySelectorAll("#lista_respaldos li"))
      .map(li => li.textContent).join("\n");
    navigator.clipboard?.writeText(texto).then(
      () => UI.toast("Codigos copiados."),
      () => UI.toast("No se pudo copiar.", "error"));
  });

  /* Desactivar el 2FA */
  const modalDesactivar2FA = document.getElementById("modal_desactivar_2fa");
  document.getElementById("boton_desactivar_2fa").addEventListener("click", () => {
    document.getElementById("form_desactivar_2fa").reset();
    UI.ocultarAviso("aviso_desactivar_2fa");
    modalDesactivar2FA.showModal();
  });

  document.getElementById("form_desactivar_2fa").addEventListener("submit", async evento => {
    evento.preventDefault();
    const form = evento.target;
    try {
      const respuesta = await Api.post("/api/2fa/desactivar", {
        clave: form.clave.value, codigo: form.codigo.value.trim()
      });
      UI.toast(respuesta.mensaje);
      modalDesactivar2FA.close();
      perfil.dosfaActivo = false;
      await cargarEstado2FA();
    } catch (error) {
      UI.mostrarErrores("aviso_desactivar_2fa", error.errores);
    }
  });

  document.getElementById("form_clave").addEventListener("submit", async evento => {
    evento.preventDefault();
    const form = evento.target;

    try {
      const respuesta = await Api.put("/api/clave", {
        actual: form.actual.value,
        nueva: form.nueva.value,
        confirmacion: form.confirmacion.value
      });
      UI.ocultarAviso("aviso_clave");
      UI.toast(respuesta.mensaje);
      form.reset();
    } catch (error) {
      UI.mostrarErrores("aviso_clave", error.errores);
    }
  });

  navegar();
})();
