# VERITAS — versión ligera para pruebas en Render

Sin disco, sin módulos nativos y con pocas dependencias. Los datos viven en memoria: **al reiniciar o cuando Render duerme el servicio se borran** (la cuenta de administrador se vuelve a crear sola). Sirve para probar todo el flujo, no para producción.

## Subir a Render (plan gratis)
1. Sube esta carpeta a un repositorio de GitHub (`.gitignore` ya excluye `node_modules`).
2. En Render: **New > Web Service**, elige el repositorio.
3. Runtime: **Node**. Build Command: `npm install`. Start Command: `npm start`.
4. En **Environment** agrega estas variables:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = una clave larga cualquiera
   - `ADMIN_EMAIL` y `ADMIN_PASSWORD` = tu acceso de administrador
   - `MODO_PRUEBA` = `1`
5. Despliega y abre la URL `https://tu-app.onrender.com` (ya trae HTTPS, que la cámara necesita).

## Probar el flujo
1. **Registrarse como profesional** (5 pasos). En el paso del teléfono, el código aparece en un aviso en pantalla.
2. Entra con el correo del administrador a **Administración**, revisa y **aprueba** al profesional.
3. Entra como profesional a **Mi panel > Transmisión en vivo** y pulsa INICIAR.
4. Desde otro celular o ventana de incógnito, crea una cuenta de usuario, entra a la categoría y mira la transmisión. Prueba el chat, el botón Apoyar y revisa las ganancias en el panel.

## Notas
- El servicio gratis de Render se duerme tras unos minutos sin uso y tarda en despertar. Se pierden los datos.
- Para el uso real: base de datos persistente, SMS real, pasarela de pagos, servidor TURN y comparación facial automática.
