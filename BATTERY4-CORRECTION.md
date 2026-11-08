# Corrección de la batería 4 (coherencia)

Fecha: 2026-11-08

El chequeo `unfulfilled-contracts` de `battery4-coherence` tenía falsos
positivos, así que esta corrida se volvió a puntuar con la batería corregida.
`batteries-report.json` se deja sin cambios: es el resultado original.

Defectos corregidos:

1. La URL base (`${API_URL}/auth/token`) se tomaba como parte de la ruta
   (`:param/auth/token`) y nunca coincidía con la ruta del backend.
2. Se escaneaban el bundle compilado (`frontend/dist/`) y el código de prueba.
3. Las rutas armadas en tiempo de ejecución (`${BASE}${path}`) contaban como
   incumplidas; ahora se listan aparte como `unresolved`.

| Versión | unfulfilled-contracts | count | unresolved |
|---|---|---|---|
| Original (`batteries-report.json`) | falla | 8 | — |
| Corregida (`battery4-coherence-corrected.json`) | pasa | 0 | 0 |

Batería original: sha256 `8eda3af325c326da1e01aaceca7335b601ebde708b590db9c6b4966bedb2f49f`.
Batería corregida: sha256 `476f24b0f926b2b0552d561108eded5947819764259c99e3dacff8d4c5c07061`.

La corrección se congeló antes de conocer el resultado de C3 y se aplica por
igual a C1, C2 y C3.
