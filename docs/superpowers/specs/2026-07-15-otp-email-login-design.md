# OTP Email Login — Design

**Fecha:** 2026-07-15
**Proyecto:** Draw (React + Vite + Excalidraw + PocketBase)
**Decisión:** Login solo con OTP por correo. Se elimina el login con contraseña de la UI. Correos enviados por PocketBase vía SMTP de Brevo.

## Contexto

- Backend: PocketBase en `https://pb.raulzarza.com` (requiere ≥ 0.23 para OTP nativo; verificar en admin antes de implementar).
- SDK `pocketbase@0.27` ya instalado; soporta `requestOTP` y `authWithOTP` (verificado en dist).
- Motivación: usuario bloqueado por contraseña olvidada; sin flujo de recuperación. OTP elimina contraseñas.
- Toda la UI vive en `components/DrawCanvas.tsx` (función `AuthPanel`).

## Enfoque elegido

OTP nativo de PocketBase + SMTP Brevo. Cero código de backend. Alternativas descartadas: colección OTP custom con pb_hooks (reimplementa seguridad sin necesidad), magic links (UX pobre en móvil).

## Flujo de usuario

1. **Paso email:** un solo campo de correo + botón "Enviar código".
2. La app llama `pb.collection("users").requestOTP(email)`.
   - Si el usuario no existe (error de requestOTP), la app crea la cuenta con `create({ email, password: <aleatoria 32 chars>, passwordConfirm })` y reintenta `requestOTP`. Signup y login son el mismo flujo.
3. **Paso código:** input para el código (8 dígitos por defecto en PB), botones "Reenviar código" y "Cambiar correo".
4. `pb.collection("users").authWithOTP(otpId, code)` — el `otpId` viene de la respuesta de `requestOTP`. Sesión resultante idéntica a la actual (`pb.authStore`); el resto de la app no cambia.
5. Al reenviar, se reemplaza el `otpId` por el de la última solicitud.

## Cambios en la app (`components/DrawCanvas.tsx`)

- `AuthPanel`: reescribir a máquina de dos estados (`"email"` | `"code"`).
  - Estado: `email`, `otpId`, `code`, `status`, `isSubmitting`.
  - Eliminar: campo contraseña, toggle signin/signup, validación de longitud de password, `AuthMode` donde deje de usarse.
- `getAuthErrorMessage`: adaptar a errores OTP (código inválido/expirado, demasiados intentos).
- Traducciones ES/EN nuevas: enviar código, código enviado a X, reenviar, cambiar correo, código inválido o expirado, etc. Eliminar las de contraseña que queden sin uso.
- Los disparadores existentes (`openAuthPrompt`) siguen funcionando; `initialMode` deja de tener sentido y se elimina o ignora.

## Configuración del servidor (manual, fuera del código)

1. PB admin → Settings → Mail settings: SMTP `smtp-relay.brevo.com`, puerto 587, login de Brevo + SMTP key, sender verificado en Brevo.
2. Colección `users` → Options → habilitar "One-time password (OTP)". Duración y longitud por defecto.
3. Opcional (recomendado tras validar OTP en prod): desactivar "Identity/password" auth para impedir login con contraseñas viejas.
4. Probar el template del correo OTP desde el admin.

## Manejo de errores

- Código incorrecto o expirado → mensaje claro, permite reintentar o reenviar.
- `requestOTP` de PB responde genérico para no revelar si el correo existe; la auto-creación de cuenta mantiene esa propiedad (el usuario siempre recibe "código enviado").
- Rate limiting: el propio PB limita solicitudes OTP.
- Fallo SMTP (Brevo caído/mal configurado): PB devuelve error en requestOTP → mensaje "No se pudo enviar el código, intenta más tarde".

## Fuera de alcance

- Verificación de email (`verified`) — OTP ya prueba posesión del correo; no se exige el flag.
- Migración/limpieza de contraseñas existentes.
- Templates HTML custom de Brevo.

## Criterio de éxito

Usuario escribe su correo (nuevo o existente), recibe código de Brevo, entra, y sus dibujos cargan. Cuenta `raulzarza.dev@gmail.com` accesible sin conocer la contraseña vieja.
