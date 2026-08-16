# BusinessBrain — interfaz web

Convierte el backend en una aplicación usable. React + TypeScript + Vite + Tailwind.

## Arrancar

```bash
npm run dev --workspace @businessbrain/web
```

El backend debe estar en `http://localhost:3000`; Vite proxea `/api` hacia él, así que el
frontend no necesita saber dónde vive la API ni lidiar con CORS.

## Principio: la interfaz nunca amplía autorización

Todo lo que decide quién puede hacer qué vive en el backend — `JwtAuthGuard`, `OrgRoleGuard`,
`@OrgRoles` y el alcance de colección. Cuando esta interfaz oculta un botón lo hace por
comodidad de lectura, jamás como control: la misma llamada hecha a mano seguiría dando 403.

## Lo que la interfaz NO puede aplanar

El backend calcula con cuidado tres condiciones que aquí deben verse siempre:

- **Frescura**: una conclusión cuya evidencia cambió no se presenta como vigente.
- **Origen de la curación**: una validación heredada de una versión anterior nunca se presenta
  como si la persona hubiera validado la afirmación actual.
- **Recuentos fuera de alcance**: versiones y cambios que el lector no puede ver se dicen como
  número. Omitirlos presentaría una historia incompleta como si fuera completa.

## Deuda consciente

El token de acceso vive en memoria y el de refresco en `localStorage`. No es lo ideal —un XSS
podría leerlo—, pero el backend no emite cookies `httpOnly` todavía. El cambio es de backend.
