# Sistema de Gestión de Inventario Web - Comercializadora Sipán S.A.C.

Este repositorio contiene el código fuente de un sistema de gestión integral desarrollado para automatizar el control de almacén, ventas al por mayor y auditoría de Comercializadora Sipán[cite: 1, 2]. 

El proyecto fue diseñado e implementado como parte del curso de Diseño e Implementación de Arquitectura Empresarial de la Facultad de Ingeniería de la Universidad Tecnológica del Perú (UTP), bajo la autoría de Jairo Fabian Leiva Torres[cite: 2].

## 1. Descripción y Solución del Problema

Antes de la implementación, la distribuidora mayorista gestionaba su inventario de abarrotes y productos de limpieza mediante hojas de cálculo y registros físicos[cite: 1, 2]. Esto generaba tiempos de consulta prolongados, falta de alertas de quiebre de stock y nula trazabilidad sobre las modificaciones[cite: 1, 2].

La solución implementada es una plataforma web robusta que centraliza la información en un servidor, automatiza el kardex, emite comprobantes de venta y genera reportes en tiempo real, eliminando por completo la dependencia de procesos manuales[cite: 1, 2].

## 2. Arquitectura del Sistema (Cero Dependencias Externas)

El sistema ha sido construido bajo un enfoque de **Cero Dependencias** (Vanilla), lo que garantiza un bajo acoplamiento, alta portabilidad y máxima seguridad al no depender de librerías de terceros[cite: 1, 2]. Se estructura en un modelo de 3 capas[cite: 1, 2]:

* **Capa de Presentación (Cliente):** Interfaz desarrollada puramente con HTML, CSS y JavaScript[cite: 1, 2]. No se utilizan frameworks de diseño, y los gráficos de los reportes son renderizados matemáticamente mediante SVG nativo.
* **Capa de Lógica de Negocio (Servidor / API REST):** Desarrollado en Node.js puro (versión 22.5+), sin la utilización de frameworks intermediarios como Express[cite: 1, 2]. Controla las reglas de negocio, validaciones y la comunicación mediante métodos HTTP (GET, POST, PUT, DELETE)[cite: 1, 2].
* **Capa de Datos:** Integrada directamente en el servidor utilizando el motor SQLite nativo de Node.js, garantizando transacciones seguras (ACID)[cite: 1, 2].

## 3. Modelo de Datos Relacional

La base de datos asegura la integridad referencial y se compone de 10 tablas estratégicamente agrupadas[cite: 1, 2]:

1. **Inventario:** `categorias`, `productos`, `movimientos`[cite: 1, 2].
2. **Ventas y Atención:** `boletas`, `boleta_items`, `tickets`[cite: 1, 2].
3. **Seguridad y Control:** `usuarios`, `sesiones`, `intentos`, `auditoria`[cite: 1, 2].

## 4. Capas de Seguridad y Criptografía

El sistema no confía en las validaciones del cliente e implementa seguridad de grado empresarial directamente en el servidor[cite: 1, 2]:

* **Criptografía de Contraseñas:** Las claves nunca se almacenan en texto plano[cite: 1, 2]. Se procesan mediante el algoritmo `scrypt` combinado con una "sal" criptográfica única por usuario.
* **Autenticación de Dos Factores (2FA/TOTP):** Implementación del estándar de contraseña de un solo uso basada en el tiempo, compatible con Google Authenticator[cite: 1, 2]. Es de uso obligatorio para cuentas de alta jerarquía[cite: 1, 2].
* **Protección contra ataques automatizados:** Integración de Google reCAPTCHA validado directamente contra los servidores de Google[cite: 1, 2].
* **Defensa de Infraestructura:** 
  * Prevención de ataques de Fuerza Bruta: Bloqueo temporal de cuentas tras 5 intentos fallidos[cite: 1, 2].
  * Prevención SQLi: Uso estricto de consultas SQL parametrizadas[cite: 1, 2].
  * Prevención CSRF: Tokens dinámicos requeridos en cada operación de escritura[cite: 1, 2].
  * Cabeceras de seguridad HTTP configuradas desde el backend[cite: 1, 2].

## 5. Módulos y Funcionalidades Principales

* **Control de Acceso por Roles:** Los permisos se validan en el servidor, impidiendo accesos forzados a la API[cite: 1]. Se dividen en Gerente General (Control total), Administrador, Vendedor y Reponedor[cite: 1, 2].
* **Kardex Transaccional:** Registro inmutable de entradas y salidas de almacén[cite: 1, 2]. Una salida es rechazada por el servidor si supera el stock disponible[cite: 1, 2].
* **Facturación Mayorista:** Emisión de boletas con numeración correlativa y procesamiento de operaciones en bloque bajo una única transacción SQL[cite: 1, 2].
* **Alertas Inteligentes:** El sistema detecta y resalta visualmente productos que perforan su stock mínimo preconfigurado[cite: 1, 2].
* **Trazabilidad:** Un módulo de auditoría registra silenciosamente cada acción, guardando la fecha, el usuario responsable y el detalle de la operación[cite: 1, 2].

## 6. Aseguramiento de Calidad (Testing)

El repositorio incluye un motor de pruebas automatizadas (Test-Driven Development)[cite: 1]. Al ejecutar el comando de testeo, el sistema despliega una base de datos temporal y ejecuta **75 pruebas unitarias y de integración**[cite: 1, 2]. Estas auditan desde la seguridad de los endpoints hasta el correcto descuento de inventario en transacciones simultáneas[cite: 1].

## 7. Instrucciones de Despliegue Local

Para ejecutar el sistema, se requiere contar con **Node.js v22.5** o superior[cite: 1].

1. **Clonar el proyecto:**
   ```bash
   git clone [https://github.com/JairoLeiva/Comercializadora-Sipan.git](https://github.com/JairoLeiva/Comercializadora-Sipan.git)
   cd Comercializadora-Sipan
