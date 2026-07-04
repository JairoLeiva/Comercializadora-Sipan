# Sistema de Gestión de Inventario Web - Comercializadora Sipán S.A.C.

¡Hola! Este repositorio contiene el código fuente de un sistema de gestión web que desarrollé para automatizar el control de almacén, las ventas al por mayor y la auditoría de la empresa Comercializadora Sipán. 

Diseñé e implementé este proyecto como parte de mi Avance 2 para el curso de Diseño e Implementación de Arquitectura Empresarial en la Universidad Tecnológica del Perú (UTP).

## 1. El problema que busco resolver

Antes de este sistema, la distribuidora llevaba todo su inventario a mano utilizando cuadernos y hojas de Excel. Esto generaba problemas reales: consultar el stock tomaba mucho tiempo, había errores de cálculo en las ventas, no existían alertas cuando un producto estaba por agotarse y no había forma de auditar quién modificaba los datos. 

Para solucionar esto, construí esta plataforma web que centraliza toda la información en un servidor local, automatiza el kardex, emite boletas y genera reportes en tiempo real.

## 2. Arquitectura "Cero Dependencias" (Vanilla)

Una de las características técnicas que más destaco de mi proyecto es que decidí construirlo desde cero, sin utilizar frameworks ni librerías externas. Esto hace que el sistema sea extremadamente ligero, portátil y muy seguro. Lo estructuré en 3 capas bien definidas:

* **Frontend (Presentación):** Programé toda la interfaz únicamente con HTML, CSS y JavaScript puros. Incluso los gráficos de los reportes los genero matemáticamente dibujando con SVG nativo, sin librerías externas.
* **Backend (API REST y Lógica):** El servidor está hecho con Node.js puro. Yo mismo me encargué de manejar las rutas HTTP (GET, POST, PUT, DELETE) y las reglas de negocio sin usar Express u otros intermediarios.
* **Base de Datos:** Utilizo SQLite, aprovechando que ya viene integrado de forma nativa en las versiones recientes de Node.js, lo que me permite manejar transacciones seguras (ACID) sin instalar motores externos.

## 3. Modelo de Datos

Estructuré la base de datos con 10 tablas relacionadas mediante claves foráneas para garantizar que no existan datos huérfanos. Se dividen en tres grandes módulos:
* **Inventario:** `categorias`, `productos`, `movimientos`.
* **Ventas:** `boletas`, `boleta_items`, `tickets`.
* **Seguridad:** `usuarios`, `sesiones`, `intentos`, `auditoria`.

## 4. Seguridad y Criptografía

En este proyecto no confío únicamente en las validaciones visuales del navegador; el peso de la seguridad está en el servidor. Implementé las siguientes capas de protección:

* **Criptografía de contraseñas:** Ninguna clave se guarda en texto plano. Las proceso en el backend usando el algoritmo `scrypt` junto a una "sal" criptográfica única para cada cuenta.
* **Autenticación en 2 Pasos (2FA/TOTP):** Integré el estándar de contraseñas de un solo uso. Para roles altos (como el Gerente), es obligatorio escanear un QR y usar una app como Google Authenticator para iniciar sesión.
* **reCAPTCHA:** Integré la validación de Google, verificando el token directamente desde mi servidor contra los servidores de Google.
* **Defensas de Infraestructura:** El sistema bloquea temporalmente una cuenta si detecta 5 intentos de acceso fallidos (Fuerza Bruta). Además, utilizo consultas SQL parametrizadas para evitar Inyecciones SQL y exijo tokens dinámicos en cada petición para evitar ataques CSRF.

## 5. Módulos Principales

* **Roles Validados:** Existen 4 perfiles (Gerente General, Administrador, Vendedor y Reponedor). Si alguien intenta acceder a una ruta de la API sin el rol necesario, el servidor bloquea la acción inmediatamente.
* **Kardex Seguro:** El registro de entradas y salidas es inmutable. Como regla de negocio, el servidor rechaza cualquier salida que intente superar el stock físico disponible.
* **Ventas y Boletas:** Al emitir una venta, el sistema descuenta el stock de todos los productos en una sola transacción en bloque y genera una boleta con número correlativo automático.
* **Auditoría Silenciosa:** Cada acción que modifica la base de datos queda guardada en un historial con la fecha, el usuario y el motivo exacto de la operación.

## 6. Pruebas Automáticas (Testing)

Para demostrar que el sistema no solo se ve bien, sino que es robusto, programé un entorno de pruebas automáticas. Al correr un solo comando, el sistema crea una base de datos temporal y ejecuta **75 pruebas unitarias y de integración**. Estas pruebas revisan desde el correcto funcionamiento del login y los permisos, hasta que el stock no se descuadre en transacciones grandes. Actualmente el proyecto pasa las 75 pruebas sin fallos.

## 7. Cómo probarlo en tu computadora

Si deseas clonar y probar el sistema localmente, asegúrate de tener instalado **Node.js v22.5** o superior.

1. **Clonar el proyecto:**
   ```bash
   git clone [https://github.com/JairoLeiva/Comercializadora-Sipan.git](https://github.com/JairoLeiva/Comercializadora-Sipan.git)
   cd Comercializadora-Sipan
