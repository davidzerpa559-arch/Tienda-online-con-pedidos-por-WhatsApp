# Menú Local — despliegue en Railway

Este directorio es la unidad independiente de despliegue. Railway debe usar **`railway-deploy` como Root Directory**; su `package-lock.json` y `npm start` no dependen del gestor del monorepo.

## Antes del primer despliegue

1. Sube el repositorio a GitHub.
2. En Railway, crea un proyecto desde el repositorio y establece el Root Directory en `railway-deploy`.
3. Añade un **Volume** y móntalo en `/data`. Sin ese volumen, Railway puede eliminar `database.sqlite` al reemplazar la instancia.
4. Configura estas variables en Railway:
   - `ADMIN_PIN`: PIN privado de al menos 4 caracteres.
   - `SESSION_SECRET`: secreto aleatorio largo (al menos 32 caracteres).
   - `IMGBB_API_KEY`: clave de ImgBB.
   - `MACRODROID_WEBHOOK_TOKEN`: token separado para autenticar el webhook.
   - `DATABASE_FILE=/data/database.sqlite`
   - `PUBLIC_BASE_URL`: URL HTTPS pública de Railway.
   - `NODE_ENV=production`
5. Railway entrega `PORT`; no fijes ese valor en producción.
6. Despliega. El health check consulta `/api/healthz`.
7. Abre `/admin`, guarda WhatsApp, los datos de Pago Móvil, la dirección, el horario y las zonas. El webhook de MacroDroid se configura en los ajustes del negocio.

## Imágenes y pedidos

Las imágenes se recortan en el navegador a proporción 1:1 y se envían al servidor. El servidor las reenvía a ImgBB sin exponer su clave al público. Los pedidos quedan guardados como `pending_verification`; el envío del webhook informa la referencia y el monto, pero la verificación bancaria debe realizarla la automatización configurada. El pedido se conserva aunque el servicio de webhook esté temporalmente fuera de línea.

El directorio `public/` contiene la compilación del frontend que sirve Railway. Railway solo instala el `package-lock.json` de este directorio y arranca Express con `npm start`; no ejecuta pnpm ni instala dependencias del monorepo. Si cambias la interfaz en el proyecto de Replit, genera una compilación de producción allí, sincroniza los archivos resultantes con `railway-deploy/public/` y confirma esos archivos en GitHub antes del siguiente despliegue.

## Variables locales

Para desarrollo fuera de Replit, copia `.env.example` como `.env` y completa los secretos. `npm install` instala las dependencias; `npm start` inicia Express. En producción, define `DATABASE_FILE=/data/database.sqlite` y monta el volumen exactamente en `/data`.
