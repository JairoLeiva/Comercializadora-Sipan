/* Aca pongo mis reglas de validacion */
/* Uso el mismo archivo en el navegador y en el servidor */

const Validacion = (() => {

  const CORREO = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const USUARIO = /^[a-zA-Z0-9_]{4,20}$/;
  const NOMBRE = /^[a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1 ]{3,60}$/;

  function vacio(valor) {
    return valor === undefined || valor === null || String(valor).trim() === "";
  }

  function registroUsuario(datos) {
    const errores = [];

    if (vacio(datos.nombre)) errores.push("El nombre completo es obligatorio.");
    else if (!NOMBRE.test(String(datos.nombre).trim())) errores.push("El nombre solo admite letras y espacios, entre 3 y 60 caracteres.");

    if (vacio(datos.usuario)) errores.push("El nombre de usuario es obligatorio.");
    else if (!USUARIO.test(String(datos.usuario).trim())) errores.push("El usuario admite letras, numeros y guion bajo, entre 4 y 20 caracteres.");

    if (vacio(datos.correo)) errores.push("El correo es obligatorio.");
    else if (!CORREO.test(String(datos.correo).trim())) errores.push("El formato del correo no es valido.");

    errores.push(...clave(datos.clave));

    if (vacio(datos.confirmacion)) errores.push("Debe repetir la clave.");
    else if (datos.clave !== datos.confirmacion) errores.push("Las claves no coinciden.");

    return errores;
  }

  function clave(valor) {
    const errores = [];
    if (vacio(valor)) { errores.push("La clave es obligatoria."); return errores; }
    if (valor.length < 8) errores.push("La clave necesita al menos 8 caracteres.");
    if (valor.length > 72) errores.push("La clave no puede superar 72 caracteres.");
    if (!/[A-Z]/.test(valor)) errores.push("La clave necesita una letra mayuscula.");
    if (!/[a-z]/.test(valor)) errores.push("La clave necesita una letra minuscula.");
    if (!/[0-9]/.test(valor)) errores.push("La clave necesita un numero.");
    return errores;
  }

  function fuerzaClave(valor) {
    let puntos = 0;
    if (!valor) return 0;
    if (valor.length >= 8) puntos++;
    if (/[A-Z]/.test(valor) && /[a-z]/.test(valor)) puntos++;
    if (/[0-9]/.test(valor)) puntos++;
    if (/[^A-Za-z0-9]/.test(valor) && valor.length >= 10) puntos++;
    return puntos;
  }

  function inicioSesion(datos) {
    const errores = [];
    if (vacio(datos.usuario)) errores.push("Ingrese su usuario o correo.");
    if (vacio(datos.clave)) errores.push("Ingrese su clave.");
    return errores;
  }

  function producto(datos) {
    const errores = [];

    if (vacio(datos.nombre)) errores.push("El nombre del producto es obligatorio.");
    else {
      const largo = String(datos.nombre).trim().length;
      if (largo < 3 || largo > 100) errores.push("El nombre del producto debe tener entre 3 y 100 caracteres.");
    }

    if (vacio(datos.categoria_id)) errores.push("Debe elegir una categoria.");
    else if (!Number.isInteger(Number(datos.categoria_id))) errores.push("La categoria no es valida.");

    if (vacio(datos.precio)) errores.push("El precio es obligatorio.");
    else {
      const precio = Number(datos.precio);
      if (Number.isNaN(precio)) errores.push("El precio debe ser un numero.");
      else if (precio <= 0) errores.push("El precio debe ser mayor a cero.");
      else if (precio > 100000) errores.push("El precio supera el limite permitido.");
    }

    errores.push(...enteroEnRango(datos.stock, "El stock", 0, 1000000));
    errores.push(...enteroEnRango(datos.minimo, "El stock minimo", 0, 100000));

    if (!vacio(datos.codigo_barras) && !/^[a-zA-Z0-9-]{4,64}$/.test(String(datos.codigo_barras).trim()))
      errores.push("El codigo de barras admite letras, numeros y guion, entre 4 y 64 caracteres.");

    return errores;
  }

  function movimiento(datos) {
    const errores = [];

    if (vacio(datos.producto_id)) errores.push("Debe elegir un producto.");

    if (datos.tipo !== "entrada" && datos.tipo !== "salida")
      errores.push("El tipo debe ser entrada o salida.");

    if (vacio(datos.cantidad)) errores.push("La cantidad es obligatoria.");
    else {
      const cantidad = Number(datos.cantidad);
      if (!Number.isInteger(cantidad)) errores.push("La cantidad debe ser un numero entero.");
      else if (cantidad <= 0) errores.push("La cantidad debe ser mayor a cero.");
      else if (cantidad > 1000000) errores.push("La cantidad supera el limite permitido.");
    }

    if (vacio(datos.motivo)) errores.push("El motivo es obligatorio.");
    else {
      const largo = String(datos.motivo).trim().length;
      if (largo < 3 || largo > 120) errores.push("El motivo debe tener entre 3 y 120 caracteres.");
    }

    return errores;
  }

  function categoria(nombre) {
    const errores = [];
    if (vacio(nombre)) errores.push("El nombre de la categoria es obligatorio.");
    else if (!/^[a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1 ]{3,30}$/.test(String(nombre).trim()))
      errores.push("La categoria solo admite letras, entre 3 y 30 caracteres.");
    return errores;
  }

  function ticket(datos) {
    const errores = [];
    const tipos = ["nota", "venta", "reposicion", "incidencia"];
    const prioridades = ["baja", "media", "alta"];

    if (!tipos.includes(datos.tipo)) errores.push("El tipo de ticket no es valido.");
    if (!prioridades.includes(datos.prioridad)) errores.push("La prioridad no es valida.");

    if (!vacio(datos.producto_id) && !Number.isInteger(Number(datos.producto_id)))
      errores.push("El producto elegido no es valido.");

    if (datos.tipo === "venta") {
      if (vacio(datos.producto_id)) errores.push("Una venta necesita un producto.");
      if (vacio(datos.cantidad)) errores.push("Una venta necesita la cantidad vendida.");
      else {
        const cantidad = Number(datos.cantidad);
        if (!Number.isInteger(cantidad)) errores.push("La cantidad debe ser un numero entero.");
        else if (cantidad <= 0) errores.push("La cantidad debe ser mayor a cero.");
        else if (cantidad > 1000000) errores.push("La cantidad supera el limite permitido.");
      }
    }

    if (vacio(datos.titulo)) errores.push("El titulo del ticket es obligatorio.");
    else {
      const largo = String(datos.titulo).trim().length;
      if (largo < 3 || largo > 80) errores.push("El titulo debe tener entre 3 y 80 caracteres.");
    }

    if (vacio(datos.detalle)) errores.push("El detalle del ticket es obligatorio.");
    else {
      const largo = String(datos.detalle).trim().length;
      if (largo < 5 || largo > 300) errores.push("El detalle debe tener entre 5 y 300 caracteres.");
    }

    return errores;
  }

  function boletaMayorista(datos) {
    const errores = [];

    if (vacio(datos.cliente)) errores.push("El nombre del cliente es obligatorio.");
    else {
      const largo = String(datos.cliente).trim().length;
      if (largo < 2 || largo > 80) errores.push("El nombre del cliente debe tener entre 2 y 80 caracteres.");
    }

    if (!Array.isArray(datos.items) || datos.items.length === 0)
      errores.push("La boleta debe tener al menos un producto.");
    else {
      if (datos.items.length > 100) errores.push("La boleta no puede tener mas de 100 lineas.");
      datos.items.forEach((linea, i) => {
        const n = i + 1;
        if (vacio(linea.producto_id) || !Number.isInteger(Number(linea.producto_id)))
          errores.push("La linea " + n + " no tiene un producto valido.");
        const cantidad = Number(linea.cantidad);
        if (vacio(linea.cantidad) || !Number.isInteger(cantidad) || cantidad <= 0)
          errores.push("La linea " + n + " necesita una cantidad entera mayor a cero.");
        else if (cantidad > 1000000)
          errores.push("La cantidad de la linea " + n + " supera el limite permitido.");
      });
    }

    if (!vacio(datos.descuento_pct)) {
      const pct = Number(datos.descuento_pct);
      if (Number.isNaN(pct)) errores.push("El descuento debe ser un numero.");
      else if (pct < 0) errores.push("El descuento no puede ser negativo.");
      else if (pct > 100) errores.push("El descuento no puede superar el 100%.");
    }

    if (!vacio(datos.documento) && String(datos.documento).trim().length > 20)
      errores.push("El documento del cliente es demasiado largo.");
    if (!vacio(datos.direccion) && String(datos.direccion).trim().length > 120)
      errores.push("La direccion es demasiado larga.");
    if (!vacio(datos.observacion) && String(datos.observacion).trim().length > 200)
      errores.push("La observacion es demasiado larga.");

    return errores;
  }

  function enteroEnRango(valor, nombre, min, max) {
    if (vacio(valor)) return [nombre + " es obligatorio."];
    const numero = Number(valor);
    if (!Number.isInteger(numero)) return [nombre + " debe ser un numero entero."];
    if (numero < min) return [nombre + " no puede ser menor a " + min + "."];
    if (numero > max) return [nombre + " supera el limite permitido."];
    return [];
  }

  return { registroUsuario, inicioSesion, producto, movimiento, categoria, ticket, boletaMayorista, clave, fuerzaClave, vacio };
})();

/* Lo exporto para usarlo en el servidor */
if (typeof module !== "undefined") module.exports = Validacion;
