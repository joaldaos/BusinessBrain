# @businessbrain/config

## Responsabilidad
Configuración base compartida (TypeScript, ESLint) para todos los paquetes y apps del monorepo. Evita que cada app repita o diverja en reglas de compilación/lint.

## Dependencias
Ninguna en tiempo de ejecución. Se consume vía `extends` desde `tsconfig.json`/`.eslintrc.cjs` de cada app o paquete.

## Flujo de funcionamiento
No tiene lógica propia: es un conjunto de archivos de configuración (`tsconfig.base.json`, `eslint-preset.cjs`) referenciados por el resto del monorepo mediante rutas de paquete de workspace (`@businessbrain/config`).

## Endpoints
No aplica (no es un servicio).

## Decisiones de diseño
- Se crea **antes** de que exista `apps/frontend` porque `apps/backend` ya necesita una base de `tsconfig`, y así no hay que retro-unificar cuando el frontend llegue en la fase 8.
- Deliberadamente no incluye reglas específicas de React/Next — se añadirán cuando `apps/frontend` exista, sin romper a los consumidores actuales.

## Ampliaciones futuras
- Preset de ESLint específico para React (fase 8).
- Configuración de Prettier compartida, si se decide centralizarla.
