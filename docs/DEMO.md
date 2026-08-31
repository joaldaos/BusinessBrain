# Enseñar BusinessBrain a una PYME

Cómo montar en unos minutos un escenario completo y reproducible, y qué contar mientras se
enseña.

El escenario **no es una maqueta**: todo se crea llamando a la API pública con la sesión de
una persona normal, con sus permisos. Si una regla de seguridad cambiara, la demo dejaría de
funcionar — y eso es correcto, porque significa que lo que se enseña es el producto.

---

## 1. Qué hace falta

- PostgreSQL con pgvector y Redis en marcha (los que ya usa el proyecto).
- El backend arrancado y respondiendo en `http://localhost:3999`.
- El frontend arrancado en `http://localhost:5173`.
- **Opcional pero muy recomendable**: una clave de OpenAI en la variable de entorno
  `OPENAI_API_KEY`.

### Sobre la clave de IA

La clave **nunca se escribe en el repositorio**. El script la lee del entorno, la envía a la
API para que la guarde cifrada en la organización de la demo, y no la imprime en ningún
momento.

Sin clave el escenario se monta igual, pero **la pregunta y el análisis no se pueden hacer**:
son los dos únicos pasos que necesitan el modelo. El script lo dice al terminar. Con la clave
puesta se vuelve a lanzar y se completan.

---

## 2. Desde una base limpia

```bash
npx prisma migrate reset --schema packages/database/prisma/schema.prisma
```

Borra la base, vuelve a aplicar las migraciones y ejecuta el seed. **El seed imprime las
credenciales de las dos cuentas base y no las guarda en ningún sitio**: cópialas de la
terminal en ese momento.

Lo importante es empezar sin datos: el escenario se apoya en que la empresa no existe todavía.

### Las dos cuentas base

| Cuenta | Para qué | Rol |
|---|---|---|
| `plataforma@businessbrain.dev` | Administrar BusinessBrain en `/platform` | `SUPERADMIN`, **sin ninguna empresa** |
| `demo@businessbrain.dev` | Usar el producto como cliente | `OWNER` de la empresa «BusinessBrain Demo» |

Son dos cuentas distintas a propósito: quien administra la plataforma no es dueño de los datos
de ningún cliente, y la API de cliente le responde 403 igual que a un desconocido. Cambiar de
sombrero exige cambiar de cuenta.

**Para fijar o cambiar una contraseña**, vuelve a sembrar con la variable puesta:

```bash
SEED_SUPERADMIN_PASSWORD='la-que-elijas' npx prisma db seed --schema packages/database/prisma/schema.prisma
```

Lo mismo con `SEED_DEMO_OWNER_PASSWORD`. Sin la variable, una cuenta que ya existe **no se
toca**: el seed lo dice en vez de imprimir una contraseña que no funcionaría. La otra vía es
«¿Has olvidado tu contraseña?» en la pantalla de entrada, que manda el enlace por correo.

---

## 3. Montar el escenario

```bash
node --env-file=apps/backend/.env scripts/demo.mjs
```

`--env-file` es lo que hace llegar `OPENAI_API_KEY` y `BB_API_URL` al script sin escribirlas
en ningún sitio. Si prefieres pasarla solo para esta ejecución:

```bash
OPENAI_API_KEY=sk-... node scripts/demo.mjs
```

El script va contando cada paso. Al terminar imprime el correo y la contraseña con los que
entrar.

### Qué deja montado

| Paso | Qué crea | Necesita IA |
|---|---|---|
| 1 | La cuenta de Ana Ruiz y la empresa **Panadería Ruiz** | no |
| 2 | La clave de IA de la empresa | sí |
| 3 | La colección **Comercial** y la fuente **Documentos de ventas** | no |
| 4 | Dos documentos reales: política de descuentos y condiciones de entrega | no |
| 5 | El objetivo *«El margen comercial no debe bajar del 30 %»* | no |
| 6 | La pregunta *«¿Cuál es nuestro descuento máximo para mayoristas?»* con su respuesta y sus fuentes | sí |
| 7 | El análisis, con sus conclusiones y sus recomendaciones | sí |
| 8 | El informe **Resumen para la gestoría** | no |
| 9 | La automatización **Barrido de los lunes** | no |

Se puede volver a lanzar sobre la misma base: reutiliza lo que ya existe en vez de duplicarlo.

### Por qué sube la exigencia de fiabilidad

El script pone el listón de la empresa en 0,95. No es un truco: es un escenario real —una
asesoría o una clínica ponen el listón así— y es lo que hace que el análisis tenga **algo que
contar** sobre dos documentos recién leídos. Con el listón por defecto el análisis termina
bien y no encuentra nada, que es correcto pero no se puede enseñar.

---

## 4. El recorrido, en cinco minutos

Entra con el correo y la contraseña que imprime el script.

1. **Inicio** — «Esto es lo que BusinessBrain sabe de tu empresa, y esto es lo único que
   espera de ti hoy.» Se ven las recomendaciones esperando decisión, con su número.
2. **Conocimiento** — la cadena *fuentes → documentos → comprensión → respuestas*, y los dos
   documentos que la empresa ha subido. «Todo lo que sabe sale de aquí.»
3. **Preguntar** — se escribe la pregunta. Llega la respuesta **con las fuentes de las que
   sale**. Es el momento que explica el producto entero.
4. **Análisis** — «Y esto lo ha buscado él solo.» Se ven las conclusiones y las propuestas.
5. **Comprensión** — se abre una conclusión y se ve su evidencia y si sigue vigente.
6. **Objetivos** — «BusinessBrain detecta cosas; tú decides cuáles importan.»
7. **Recomendaciones** — se acepta o se descarta una. Queda constancia; no ejecuta nada.
8. **Automatizaciones** — «Cada lunes a las ocho, esto se hace solo.»
9. **Informes** — se descarga el PDF con las citas.

### Lo que conviene decir en voz alta

- **Nada se inventa.** Cada respuesta lleva las fuentes de las que sale, y cuando no hay
  material suficiente el sistema lo dice en vez de rellenar.
- **Nadie ve lo que no le corresponde.** El informe y las respuestas se componen con las
  colecciones concedidas a quien pregunta: dos personas de la misma empresa pueden recibir
  contenidos distintos, y eso es correcto.
- **Ninguna recomendación se ejecuta sola.** Aceptar deja constancia de la decisión.
- **La clave de IA es de la empresa.** El consumo se factura en su cuenta, no en la nuestra.

---

## 5. Qué NO se puede enseñar todavía

- **Google Drive y Gmail**: la demo no los conecta. Exigen credenciales de OAuth reales y el
  consentimiento de una cuenta de Google; con las de prueba el flujo no es enseñable.
- **Recomendaciones sobre varios documentos**: con dos documentos, las propuestas que produce
  el motor son las que corresponden a dos documentos. Para una demo más rica hace falta subir
  más material.
- **Recomendaciones repetidas**: con dos documentos que fallan por el mismo motivo, el motor
  propone dos veces lo mismo. Es correcto —son dos documentos— pero en una demo se ve raro.
  Con más material variado no ocurre.

## 6. Sobre el lenguaje de las conclusiones

El motor de comprensión redacta y guarda su propio resumen, en su vocabulario: «la confianza
cayó a 0.64, por debajo del umbral 0.95 configurado por la organización».

Ese texto **ya no es lo que se lee**, ni en pantalla ni en el PDF. Ambos lo traducen a partir
de los hechos que el propio motor guarda, y dejan el original donde se comprueba: «Ver el
detalle técnico» en la pantalla, y el «Anexo · detalle técnico» al final del PDF.

Nada se ha reescrito en la base de datos y no hace falta ninguna migración: el PDF se compone
cada vez que se pide, así que una conclusión de hace meses también se cuenta bien. Y si
mañana el motor emite una señal que nadie ha traducido todavía, se enseña su texto tal cual
en vez de inventarse un titular.
