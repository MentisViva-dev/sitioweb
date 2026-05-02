# Manual de Marca — Mentis Viva

> Documento de referencia para diseñadores, desarrolladores e IAs que trabajen
> con la identidad visual de **Mentis Viva**: editorial, centro psicológico
> y fundación.
>
> **Última actualización:** 2026-05-02
> **Versión del sistema:** 1.0
> **Mantenedor:** equipo Mentis Viva — `contacto@mentisviva.cl`

---

## 1. Esencia de marca

### 1.1 Identidad

**Mentis Viva** es un ecosistema chileno dedicado a transformar vidas a través
de la psicología, la lectura y la acción comunitaria. Opera tres líneas:

| Línea | Función | Tono dominante |
|---|---|---|
| **Centro Psicológico** | Atención clínica adulta y de pareja (ACT, DBT, Humanidad Compartida) | Cálido, profesional, empático |
| **Editorial** | Suscripción mensual de cajas curadas con libros + materiales terapéuticos | Cultivado, curioso, íntimo |
| **Fundación** | Talleres educativos, charlas, formación en colegios y comunidades | Esperanzador, social, cercano |

### 1.2 Posicionamiento

> *"Mente, cultura y compromiso social."*

Una marca que combina **rigor científico** y **sensibilidad humana**. No es
clínica fría ni autoayuda blanda — vive en el espacio honesto donde el
conocimiento se vuelve cuidado.

### 1.3 Tagline principal

**"Lee, Crece y Vive"** — para la editorial.
**"Mente, Cultura y Compromiso Social"** — paraguas general.

### 1.4 Voz y tono

| Atributo | Sí es | No es |
|---|---|---|
| Profesional | Riguroso, fundamentado, claro | Tecnicismo gratuito, jerga clínica innecesaria |
| Cálido | Cercano, empático, en segunda persona | Paternalista, condescendiente, terapéutico forzado |
| Curador | Selectivo, intencional, con criterio | Snob, elitista, hermético |
| Esperanzador | Realista pero optimista, posibilitador | Promesas vacías, motivacionalismo barato |

**Idioma:** español de Chile, neutro entendible para LATAM.
**Persona:** "tú" o "vos" según contexto, **nunca "usted"** salvo en términos legales.
**Acentuación:** uso correcto y completo de acentos. Es una marca culta.

---

## 2. Logotipo

### 2.1 Variantes disponibles

Todos los archivos están en `/assets/logos/` (PNG transparente, alta resolución).

| Archivo | Uso |
|---|---|
| `logo-color.png` | Logotipo principal a color sobre fondos claros |
| `logo-negro.png` | Logotipo en negro para impresión 1 tinta |
| `logo-blanco.png` | Logotipo en blanco para fondos oscuros / fotografías |
| `isotipo-color.png` | Isotipo (símbolo solo) a color |
| `isotipo-color-1/2/3.png` | Variaciones de isotipo a color |
| `isotipo-blanco.png` | Isotipo solo, en blanco |
| `variante-color.png` | Composición vertical color |
| `variante-blanco.png` | Composición vertical en blanco |

### 2.2 Reglas de uso

**Siempre:**
- Mantener proporciones originales (nunca estirar).
- Usar archivos vectoriales o PNG en alta resolución.
- Respetar el área de seguridad (mínimo igual a la altura de la "M" alrededor del logo).
- Tamaño mínimo digital: **42 px de altura** (logotipo completo).
- Tamaño mínimo digital: **24 px** (isotipo solo).

**Nunca:**
- Cambiar los colores corporativos.
- Aplicar sombras, brillos o efectos 3D.
- Rotar, reflejar o distorsionar.
- Usar versión a color sobre fondos saturados.
- Sobreponer texto al logo.
- Encerrarlo en formas (círculos, cuadrados) salvo en redes sociales.

### 2.3 Aplicación según contexto

| Contexto | Variante recomendada |
|---|---|
| Web pública (header) | `logo-color.png` |
| Web pública (footer oscuro) | `logo-blanco.png` |
| Email transaccional (encabezado) | `logo-color.png` |
| Documentos legales / facturas | `logo-negro.png` |
| Redes sociales (avatar) | `isotipo-color.png` |
| Watermark sobre fotografía | `logo-blanco.png` con 60% opacidad |
| Material impreso a 1 tinta | `logo-negro.png` |

---

## 3. Sistema de color

### 3.1 Paleta primaria

Los dos colores corporativos. Usados en CTAs, links, énfasis. Cada uno tiene
una connotación específica.

```
TEAL — Profundidad / conocimiento / calma                GREEN — Vida / crecimiento / esperanza
─────────────────────────────────                         ─────────────────────────────────
HEX     #2B8A9E                                           HEX     #7AC94F
RGB     43, 138, 158                                      RGB     122, 201, 79
HSL     189°, 57%, 39%                                    HSL     97°, 56%, 55%
CMYK    78%, 26%, 26%, 8%                                 CMYK    51%, 0%, 89%, 0%
PANTONE 7710 C (aprox)                                    PANTONE 367 C (aprox)
```

**Cuándo usar Teal:**
- Líneas asociadas a conocimiento, terapia, contenido editorial.
- Header, navegación, links primarios, botones principales del flujo de información.
- Páginas: `centro.html`, `editorial.html` como acento.

**Cuándo usar Green:**
- Acciones positivas, conversión, "siguiente paso".
- Botones de suscripción, registro, llamados a la acción de la fundación.
- Páginas: `fundacion.html` como acento principal.

### 3.2 Variaciones tonales

Cada color principal viene con variaciones para profundidad e interactividad.

```css
/* Teal */
--teal:        #2B8A9E    /* base */
--teal-dark:   #1E6B7B    /* hover, énfasis fuerte */
--teal-light:  #3BA8BF    /* gradientes, ilustraciones */
--teal-bg:     #E8F4F7    /* backgrounds suaves, badges */

/* Green */
--green:       #7AC94F    /* base */
--green-dark:  #5FA83A    /* hover, énfasis fuerte */
--green-light: #95D972    /* gradientes, ilustraciones */
--green-bg:    #EFF8E8    /* backgrounds suaves, badges */
```

### 3.3 Escala de neutros

11 escalones de gris diseñados para máxima legibilidad y jerarquía
informativa.

```css
--white:      #FFFFFF    /* Fondos principales */
--off-white:  #F8F9FA    /* Fondos secundarios */
--gray-50:    #F5F6F7    /* Sección alternada, hover sutil */
--gray-100:   #E9ECEF    /* Bordes de cards */
--gray-200:   #DEE2E6    /* Inputs en estado normal, divisores */
--gray-300:   #CED4DA    /* Inputs hover */
--gray-400:   #ADB5BD    /* Iconos decorativos, placeholders */
--gray-500:   #6C757D    /* Texto secundario, metadata */
--gray-600:   #495057    /* Texto importante en superficies grises */
--gray-700:   #343A40    /* Headers oscuros, footer */
--gray-800:   #212529    /* Texto sobre fondos muy claros */
```

### 3.4 Paleta de texto

```css
--text-primary:   #1A1A2E    /* Títulos y texto principal */
--text-secondary: #4A4A5A    /* Texto de párrafo */
--text-muted:     #6C757D    /* Captions, ayuda, metadata */
```

### 3.5 Colores semánticos (estados)

| Estado | Color base | Background suave | Uso |
|---|---|---|---|
| Éxito | `#7AC94F` (green) | `#EFF8E8` (green-bg) | Toasts OK, badges "Activo" |
| Información | `#2B8A9E` (teal) | `#E8F4F7` (teal-bg) | Avisos generales |
| Atención | `#F5A623` | `#FFF6E5` | Warnings no bloqueantes |
| Error | `#E63946` | `#FCE8EA` | Validaciones fallidas |
| Neutral | `#6C757D` (gray-500) | `#F5F6F7` (gray-50) | Estado pendiente, deshabilitado |

### 3.6 Reglas de contraste (WCAG AA)

- **Texto sobre fondo:** mínimo 4.5:1.
- **Texto grande (≥18pt):** mínimo 3:1.
- **Iconos / componentes UI:** mínimo 3:1.

Pares verificados:
- `--text-primary` sobre `--white` → **17.4:1** ✅
- `--text-secondary` sobre `--white` → **8.6:1** ✅
- `--white` sobre `--teal` → **4.7:1** ✅
- `--white` sobre `--green` → **2.6:1** ⚠️ (usar `--text-primary` sobre green o reservar para textos grandes)
- `--text-muted` sobre `--gray-50` → **4.8:1** ✅

### 3.7 Combinaciones prohibidas

- ❌ Teal sobre verde (mismo nivel de saturación, vibran).
- ❌ Verde claro sobre blanco para texto chico (contraste insuficiente).
- ❌ Cualquier neutro `gray-300`+ como texto principal.

---

## 4. Tipografía

### 4.1 Familias

```
TÍTULOS                                   TEXTO + UI
───────────                               ──────────
Cardo                                     Inter
Serif clásica con humanidad               Sans-serif moderna y legible
Fuente: Google Fonts (gratis)             Fuente: Google Fonts (gratis)
Pesos: 400, 700                           Pesos: 300, 400, 500, 600, 700
Estilos: Regular, Italic, Bold            Estilos: Regular
```

```css
--font-serif: 'Cardo', Georgia, serif;
--font-sans:  'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

**Importación recomendada:**

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cardo:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

### 4.2 Por qué Cardo + Inter

- **Cardo** evoca lo editorial (libros, manuscritos académicos) sin caer en lo
  rígido. Tiene cuerpo y personalidad — refleja la curaduría de la editorial.
- **Inter** es la fuente UI más legible del mundo a tamaños pequeños. Usada
  por Figma, GitHub, Notion. Garantiza accesibilidad en formularios.

**No reemplazar nunca por:** Times (frío), Comic Sans (informal), Helvetica (genérico),
Open Sans (saturado en web), Calibri (Microsoft).

### 4.3 Escala tipográfica

Usamos `clamp()` para escala fluida (responsive sin breakpoints).

```css
h1 { font-family: Cardo; font-weight: 700; font-size: clamp(2.2rem, 5vw, 3.5rem); line-height: 1.2; }
h2 { font-family: Cardo; font-weight: 700; font-size: clamp(1.8rem, 4vw, 2.8rem); line-height: 1.2; }
h3 { font-family: Cardo; font-weight: 700; font-size: clamp(1.3rem, 3vw, 1.8rem); line-height: 1.2; }
h4 { font-family: Cardo; font-weight: 700; font-size: clamp(1.1rem, 2vw, 1.4rem); line-height: 1.3; }
p  { font-family: Inter; font-weight: 400; font-size: 1.05rem; line-height: 1.8; color: var(--text-secondary); }

.lead    { font-size: 1.25rem; line-height: 1.7; }
.small   { font-size: 0.875rem; }
.caption { font-size: 0.75rem; color: var(--text-muted); }

/* Etiqueta de sección — uppercase, espaciada, decorativa */
.section-label {
  font-family: Inter;
  font-weight: 600;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--teal);
}
```

### 4.4 Reglas de uso tipográfico

**Sí:**
- Títulos siempre en serif (Cardo).
- Body siempre en sans-serif (Inter).
- Body line-height: 1.7-1.8 (lectura cómoda).
- Títulos line-height: 1.2 (compacto, impactante).
- Letter-spacing: solo en `.section-label` (2px) y mayúsculas decorativas.

**No:**
- Mezclar dos serifs distintas en una misma vista.
- Usar `font-weight: 100/200` (ilegible).
- Texto justificado en español (genera "ríos blancos").
- Más de 2-3 niveles tipográficos en un mismo bloque.

### 4.5 Texto en español: detalles

- Comillas tipográficas: «...» o "..." (nunca "...").
- Guión largo: — (em-dash) para incisos. Guión corto: - solo para palabras compuestas.
- Puntos suspensivos: … (un solo carácter, no ...).
- Raya de diálogo: — (em-dash).
- Acentos siempre, incluido en mayúsculas (Á, É, Í, Ó, Ú).

---

## 5. Sistema de espaciado

### 5.1 Grid base 8px

Todo el sistema se basa en múltiplos de **8px** (con excepciones de 4px para
fine-tuning de inputs).

```
4    spacing-2xs   espaciado fino dentro de inputs
8    spacing-xs    gap entre iconos y texto
12   spacing-sm    margen interno de tags
16   spacing-md    gap entre items de lista
24   spacing-lg    padding de cards pequeños
32   spacing-xl    gap entre secciones internas
48   spacing-2xl   margen entre bloques
64   spacing-3xl   margen de header de sección
80   spacing-4xl   espaciado entre secciones (mobile)
100  spacing-5xl   espaciado entre secciones (desktop)
```

### 5.2 Containers

```css
.container    { max-width: 1200px; padding: 0 24px; }
.container-sm { max-width: 800px;  padding: 0 24px; }
.container-xs { max-width: 600px;  padding: 0 24px; }
```

### 5.3 Padding de secciones

```css
.section    { padding: 100px 0; }   /* desktop */
.section-sm { padding: 60px 0; }    /* sub-secciones */

@media (max-width: 768px) {
  .section    { padding: 64px 0; }  /* mobile */
  .section-sm { padding: 40px 0; }
}
```

---

## 6. Border radius

Sistema progresivo, **siempre redondeado** (nunca esquinas a 90°). Refleja la
calidez de la marca.

```css
--radius-sm: 6px;    /* inputs, badges pequeños */
--radius-md: 12px;   /* cards, modales */
--radius-lg: 20px;   /* secciones destacadas, hero cards */
--radius-xl: 30px;   /* botones (forma de píldora) */
--radius-full: 9999px; /* avatares circulares, dots */
```

**Regla:** los botones SIEMPRE son pill-shaped (`--radius-xl`). Es una firma
de marca. **Nunca** botones cuadrados o con `border-radius: 4px`.

---

## 7. Sombras

Sistema de profundidad para jerarquía visual.

```css
--shadow-sm: 0 1px 3px rgba(0,0,0,0.08);     /* navbar al hacer scroll */
--shadow-md: 0 4px 12px rgba(0,0,0,0.10);    /* cards en hover suave */
--shadow-lg: 0 8px 30px rgba(0,0,0,0.12);    /* modales, dropdowns */
--shadow-xl: 0 20px 60px rgba(0,0,0,0.15);   /* hero card, popups destacados */

/* Sombras tintadas (énfasis con color de marca) */
--shadow-teal:  0 8px 25px rgba(43, 138, 158, 0.30);
--shadow-green: 0 8px 25px rgba(122, 201, 79, 0.30);
```

**Regla:** sombras tintadas SOLO en hover de botones primarios. Refuerza
la afordancia interactiva.

---

## 8. Componentes

### 8.1 Botones

Forma de **píldora** siempre. Tres jerarquías + un especial para fundación.

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 32px;
  border-radius: 30px;
  font-family: var(--font-sans);
  font-size: 1rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.3s ease;
}

/* Primario (teal) — acción principal de la página */
.btn-primary { background: var(--teal); color: white; }
.btn-primary:hover {
  background: var(--teal-dark);
  transform: translateY(-2px);
  box-shadow: var(--shadow-teal);
}

/* Secundario (outline teal) — acción alternativa */
.btn-secondary {
  background: transparent;
  color: var(--teal);
  border: 2px solid var(--teal);
}
.btn-secondary:hover {
  background: var(--teal);
  color: white;
}

/* Verde — conversión / suscripción / fundación */
.btn-green { background: var(--green); color: white; }
.btn-green:hover {
  background: var(--green-dark);
  transform: translateY(-2px);
  box-shadow: var(--shadow-green);
}

/* Blanco — sobre hero con foto/color */
.btn-white { background: white; color: var(--teal); }

/* Tamaños */
.btn-lg { padding: 18px 42px; font-size: 1.1rem; }
.btn-sm { padding: 10px 24px; font-size: 0.9rem; min-height: 44px; }

/* Accesibilidad */
.btn:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
```

**Reglas:**
- Máximo **un** `btn-primary` por vista (claridad jerárquica).
- Los botones contiene icono Font Awesome a la izquierda con `gap: 8px`.
- El icono va antes del texto: `[icono] Etiqueta`.
- Altura mínima clickeable en mobile: **44px** (Apple HIG).

### 8.2 Cards

```css
.card {
  background: white;
  border-radius: var(--radius-md);
  padding: 36px;
  border: 1px solid var(--gray-100);
  transition: all 0.3s ease;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  border-color: transparent;
}
```

**Variantes:**
- `.card-sm` — padding 24px, para listados densos.
- `.card-feature` — padding 48px, gradiente sutil de fondo, para destacar.
- `.card-image` — incluye imagen al tope con `object-fit: cover; aspect-ratio: 16/9;`.

### 8.3 Inputs

```css
input, select, textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: 0.95rem;
  font-family: var(--font-sans);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgba(43, 138, 158, 0.25);
}
input[aria-invalid="true"] {
  border-color: #E63946;
  box-shadow: 0 0 0 3px rgba(230, 57, 70, 0.20);
}

/* Label siempre arriba, nunca placeholder-as-label */
label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

/* Ayuda contextual debajo del input */
.field-hint {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 4px;
}
```

**Regla obligatoria:** label visible **siempre arriba**, nunca dentro del
placeholder. Es accesibilidad y reduce errores de usuario un 40%.

### 8.4 Navbar

```
- Posición: fixed, top: 0
- Fondo: rgba(255,255,255,0.95) con backdrop-filter: blur(20px)
- Altura: 72px
- Logo a la izquierda, navegación a la derecha
- Links: pill-shaped en hover (radius-xl, padding 8px 18px)
- Estado scrolled: agrega box-shadow-sm
- Mobile: hamburger menu desliza desde top con border-radius bottom
```

### 8.5 Badges / chips

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: none;
}
.badge-success { background: var(--green-bg); color: var(--green-dark); }
.badge-info    { background: var(--teal-bg);  color: var(--teal-dark); }
.badge-warning { background: #FFF6E5;          color: #B8761A; }
.badge-error   { background: #FCE8EA;          color: #C72030; }
.badge-neutral { background: var(--gray-100);  color: var(--gray-600); }
```

### 8.6 Modales

```
- Overlay: rgba(20,25,35,0.7) con backdrop-filter: blur(4px)
- Content: white, border-radius-lg (20px), max-width: 600px
- Padding: 32px
- Sombra: shadow-xl
- Cerrar: botón X arriba derecha, circular, hover rota 90deg
- Animación entrada: opacity 0→1 + scale 0.97→1 (250ms)
- Focus trap obligatorio
- Cierre con Escape obligatorio
- role="dialog" y aria-modal="true" obligatorios
```

---

## 9. Iconografía

### 9.1 Sistema

**Font Awesome 6 Solid + Brands** — una sola familia, toda la marca.

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
```

### 9.2 Reglas de uso

- Tamaño base: hereda `font-size` del contenedor (`em`-based).
- Color: hereda `color` del contenedor (nunca hard-coded).
- **Siempre `aria-hidden="true"`** si es decorativo.
- **Siempre `aria-label`** si es interactivo y solo-icono.
- En botones: `<i class="fa-solid fa-X" aria-hidden="true"></i> Texto` (orden: icono → texto).
- Tamaños recomendados: 16px (inline), 20px (botones), 24px (cards), 48px (hero cards).

### 9.3 Iconos clave del sistema

```
Marca / valores:
  fa-book-open      Editorial, lectura
  fa-brain          Psicología, mente
  fa-heart          Cuidado, fundación
  fa-clock          Tiempo, historia
  fa-magnifying-glass   Curaduría, búsqueda
  fa-gift           Sorpresas, regalos
  fa-truck          Envíos, despacho
  fa-rocket         Lanzamiento, novedad

Funcionales / UI:
  fa-user, fa-envelope, fa-phone
  fa-credit-card, fa-shield-halved
  fa-pen, fa-trash, fa-plus, fa-xmark
  fa-circle-check, fa-exclamation-triangle, fa-info-circle
  fa-spinner (con fa-spin para loading)
  fa-right-to-bracket (login), fa-right-from-bracket (logout)
```

### 9.4 No usar

- ❌ Iconos de otra librería (Material Icons, Heroicons) — incoherencia.
- ❌ Iconos en color sólido distinto al texto del contenedor.
- ❌ Iconos a tamaño <12px (ilegibles).

---

## 10. Imágenes y fotografía

### 10.1 Estilo

**Calidez documental.** Personas reales en momentos auténticos: leyendo en
casa, en consulta, en talleres. **No stock photo genérico** ni gente sonriendo
forzadamente.

| Sí | No |
|---|---|
| Luz natural, atardecer cálido | Luz fluorescente fría |
| Personas en contextos cotidianos | Personas con auriculares de oficina |
| Detalle de manos, libros, tazas | Manos sosteniendo bombillas (clichés) |
| Espacios habitados (libreros, cafeterías) | Oficinas blancas vacías |
| Diversidad real chilena/latinoamericana | Modelos europeos |

### 10.2 Tratamiento

- **Aspect ratios:** 16:9 (hero), 4:3 (cards), 1:1 (avatares, redes), 2:3 (portadas libros).
- **Formato:** WebP preferido, JPG fallback. PNG solo para transparencias.
- **Tamaños responsive:** servir `srcset` con 400, 800, 1600px.
- **Blur-up loading:** `loading="lazy"` + LQIP (low-quality image placeholder).
- **Procesamiento:** ligero ajuste de calidez (+temperatura ~5), sombras suavizadas. **No saturar**.

### 10.3 Overlay

Para texto sobre imagen, aplicar overlay oscuro con opacidad ajustable:

```css
.hero-banner::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(26, 26, 46, calc(var(--overlay-opacity) / 100));
}
```

`--overlay-opacity` configurable desde el CMS (0-100).

### 10.4 Portadas de libros (catálogo editorial)

- Aspect ratio: **2:3** (proporción libro estándar).
- `object-fit: cover` con `border-radius: 8px`.
- Sombra sutil: `0 8px 24px rgba(0,0,0,0.18)`.
- Fallback si no carga: gradiente gray-100 → gray-200 con icono `fa-book` centrado.

---

## 11. Animación y movimiento

### 11.1 Principios

- **Función > decoración.** Cada animación informa o guía.
- **Rápido pero perceptible.** 200-400ms ideal. <150ms se pierde, >600ms aburre.
- **Easing natural.** `ease`, `ease-out`, `cubic-bezier(0.4, 0, 0.2, 1)`. **Nunca `linear`** salvo en spinners.
- **Respeta `prefers-reduced-motion`.**

### 11.2 Transiciones estándar

```css
--transition: all 0.3s ease;

/* Hover de botones */
.btn:hover { transform: translateY(-2px); }

/* Hover de cards */
.card:hover { transform: translateY(-4px); }

/* Reveal on scroll (fade-in + sube 16px) */
.fade-in {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.fade-in.visible { opacity: 1; transform: translateY(0); }

/* Stagger children — delays escalonados de 80ms */
.stagger-children > *:nth-child(1) { transition-delay: 0ms; }
.stagger-children > *:nth-child(2) { transition-delay: 80ms; }
.stagger-children > *:nth-child(3) { transition-delay: 160ms; }
.stagger-children > *:nth-child(4) { transition-delay: 240ms; }
```

### 11.3 Reduced motion (obligatorio)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 11.4 No hacer

- ❌ Parallax extremo (causa mareo).
- ❌ Auto-playing carousels que no se pausan al hacer hover.
- ❌ Hover effects en mobile.
- ❌ Animaciones largas (>800ms) en interacciones rápidas.

---

## 12. Layout y grid

### 12.1 Breakpoints

```css
/* Mobile-first. Solo breakpoints up. */
/* base:        320-767px (móvil)        */
@media (min-width: 768px)  { /* tablet */ }
@media (min-width: 1024px) { /* laptop */ }
@media (min-width: 1280px) { /* desktop */ }
@media (min-width: 1600px) { /* widescreen */ }
```

### 12.2 Grid de páginas

- **Hero:** full-width, mínimo 60vh, máximo 80vh.
- **Sección estándar:** padding 100px (desktop) / 64px (mobile), centro 1200px.
- **Cards en grid:** `display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px;`.
- **Hero text:** max-width: 720px (lectura cómoda).

### 12.3 Reglas de proporción

- **Regla 1/3:** secciones largas se dividen 1/3 imagen + 2/3 texto (o viceversa).
- **Aire generoso:** mejor un componente con padding 36px que 4 amontonados.
- **Centrado para impacto, alineado a izquierda para lectura.** Hero centrado, body alineado izquierda.

---

## 13. Accesibilidad — no negociable

### 13.1 Requisitos WCAG AA

- ✅ Contraste de texto 4.5:1.
- ✅ Tamaño de texto ajustable hasta 200% sin scroll horizontal.
- ✅ Foco visible en todos los interactivos (`:focus-visible` con outline 2px teal).
- ✅ Labels en inputs.
- ✅ `alt` en todas las imágenes (descriptivo, no "imagen de").
- ✅ Encabezados jerárquicos sin saltos (h1 → h2 → h3, nunca h1 → h3).
- ✅ Navegación por teclado completa (Tab → orden lógico).
- ✅ Skip link al inicio: `<a href="#main" class="skip-link">Saltar al contenido</a>`.

### 13.2 ARIA recomendado

```html
<!-- Botón con solo icono -->
<button aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>

<!-- Modal -->
<div role="dialog" aria-modal="true" aria-labelledby="modalTitle">
  <h2 id="modalTitle">Título</h2>
</div>

<!-- Mensajes dinámicos -->
<div role="status" aria-live="polite"></div>  <!-- toasts, info -->
<div role="alert"  aria-live="assertive"></div>  <!-- errores críticos -->

<!-- Inputs con error -->
<input aria-invalid="true" aria-describedby="email-error">
<span id="email-error" role="alert">Email inválido</span>
```

### 13.3 Lenguaje inclusivo y claro

- Evitar términos técnicos sin contexto.
- No asumir conocimiento previo (terapéutico, financiero, tecnológico).
- Usar modismos chilenos solo cuando aporten calidez, evitar localismos cerrados.
- Botones con verbos de acción: "Suscribirme", "Quiero saber más", "Reservar hora" — **no** "Click aquí".

---

## 14. Tono según contexto

### 14.1 Microcopy de ejemplo

| Situación | ✅ Sí decir | ❌ No decir |
|---|---|---|
| CTA principal | "Suscríbete y recibe tu primera caja" | "Click aquí para suscribirse" |
| Email enviado | "Revisa tu correo. Te enviamos un enlace para verificar tu cuenta." | "Email enviado. OK." |
| Error de pago | "No pudimos procesar tu pago. Intenta de nuevo o usa otra tarjeta." | "ERROR 500. Payment failed." |
| Empty state | "Aún no tienes suscripción activa. Mira nuestros planes." | "No data found." |
| Loading | "Estamos preparando tus opciones de envío..." | "Loading..." |
| Confirmación destructiva | "¿Estás seguro/a de cancelar? Mantendrás acceso hasta el 25." | "Are you sure?" |
| Éxito de cancelación | "Lamentamos verte partir. Tu suscripción termina el 25." | "Cancelled." |

### 14.2 Tono por canal

| Canal | Estilo |
|---|---|
| **Web pública** | Cálido, introductorio, vendedor sin presión |
| **Web logueado / panel** | Más directo, funcional, próximo |
| **Email transaccional** | Formal pero cercano, breve, con CTA único |
| **Email marketing** | Editorial, narrativo, con criterio |
| **Redes sociales** | Visual primero, copy de 1-2 líneas, con personalidad |
| **Términos y privacidad** | Formal, claro, sin legalismos innecesarios |

---

## 15. Patrones específicos del producto

### 15.1 Catálogo de libros (`editorial.html`)

- Carrusel horizontal con `scroll-snap`.
- Cards de 240px ancho, portada 2:3.
- Filtros por categoría como pills (radius-full).
- Modal al click con detalle completo + botones a tiendas (Amazon, Buscalibre, etc).
- Color de cada tienda según marca (Amazon naranja `#FF9900`, Buscalibre azul `#0066B3`).

### 15.2 Estados de plan

| Estado | Badge | Color |
|---|---|---|
| `none` | "Sin plan" | gray-100 |
| `pending` | "Pendiente de pago" | warning |
| `active` | "Activo" | green-bg |
| `cancel_pending` | "Termina el [fecha]" | warning |
| `paused` | "Pausado hasta [fecha]" | teal-bg |
| `cancelled` | "Cancelado" | gray-100 |

### 15.3 Cuenta regresiva (countdown)

- Tipografía monoespaciada para los números (`font-variant-numeric: tabular-nums`).
- Separadores ":" en color teal a 0.6 opacidad.
- Labels (Días, Horas, Minutos, Segundos) en `text-muted`, uppercase, letter-spacing 1px.

### 15.4 Toasts

- Posición: `bottom: 24px; right: 24px;`.
- Animación: slide-in desde derecha + fade.
- Auto-dismiss: 4 segundos.
- Tipos: `.toast-success`, `.toast-error`, `.toast-info`, `.toast-warning`.
- Cerrable manualmente con botón X.

---

## 16. Variables CSS completas (referencia)

Copiar y pegar como sistema completo:

```css
:root {
  /* Colores primarios */
  --teal: #2B8A9E;
  --teal-dark: #1E6B7B;
  --teal-light: #3BA8BF;
  --teal-bg: #E8F4F7;
  --green: #7AC94F;
  --green-dark: #5FA83A;
  --green-light: #95D972;
  --green-bg: #EFF8E8;

  /* Neutros */
  --white: #FFFFFF;
  --off-white: #F8F9FA;
  --gray-50: #F5F6F7;
  --gray-100: #E9ECEF;
  --gray-200: #DEE2E6;
  --gray-300: #CED4DA;
  --gray-400: #ADB5BD;
  --gray-500: #6C757D;
  --gray-600: #495057;
  --gray-700: #343A40;
  --gray-800: #212529;

  /* Texto */
  --text-primary: #1A1A2E;
  --text-secondary: #4A4A5A;
  --text-muted: #6C757D;

  /* Estados */
  --success: #7AC94F;
  --info: #2B8A9E;
  --warning: #F5A623;
  --error: #E63946;

  /* Sombras */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.10);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
  --shadow-xl: 0 20px 60px rgba(0,0,0,0.15);
  --shadow-teal: 0 8px 25px rgba(43, 138, 158, 0.30);
  --shadow-green: 0 8px 25px rgba(122, 201, 79, 0.30);

  /* Border radius */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-xl: 30px;
  --radius-full: 9999px;

  /* Spacing (base 8px) */
  --space-2xs: 4px;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;
  --space-4xl: 80px;
  --space-5xl: 100px;

  /* Transition */
  --transition: all 0.3s ease;
  --transition-fast: all 0.15s ease;
  --transition-slow: all 0.5s ease;

  /* Tipografía */
  --font-serif: 'Cardo', Georgia, serif;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* Z-index */
  --z-base: 1;
  --z-dropdown: 100;
  --z-navbar: 1000;
  --z-modal: 2000;
  --z-toast: 9999;

  /* Breakpoints (referencia, usar en JS) */
  --bp-tablet: 768px;
  --bp-laptop: 1024px;
  --bp-desktop: 1280px;
  --bp-wide: 1600px;
}
```

---

## 17. Para IAs y modelos generativos

Si una IA va a generar mockups, copy o componentes nuevos, debe:

1. **Leer todo este documento antes de generar nada.**
2. **Usar exclusivamente las variables CSS de §16.** No inventar colores nuevos.
3. **Respetar la jerarquía tipográfica de §4.3.** Headings siempre Cardo, body siempre Inter.
4. **Aplicar el border-radius `--radius-xl` a botones siempre.** Es firma de marca.
5. **No generar copy en inglés salvo nombres de tecnologías.**
6. **No usar lenguaje terapéutico forzado** ("sana tus heridas", "abraza tu yo interior").
7. **Verificar accesibilidad** (contraste, alt, labels) antes de entregar.
8. **Si el contexto es Editorial:** privilegiar teal y serif. Si es Fundación: privilegiar green. Si es Centro: balanceado, más teal.
9. **Si genera mockup:** respetar grid 8px, sombras de §7, espaciado de §5.
10. **Si tiene duda:** preguntar antes de inventar.

### Prompt template recomendado para IAs visuales

```
Diseña [componente] siguiendo el manual de marca de Mentis Viva:
- Paleta: usar SOLO colores de la sección 3 (teal #2B8A9E, green #7AC94F, neutros).
- Tipografía: Cardo (serif, títulos), Inter (sans, body).
- Border-radius: botones pill (30px), cards 12px.
- Sombras suaves, calidez documental en imágenes.
- Estilo cálido pero riguroso, evitar clichés terapéuticos.
- Accesibilidad WCAG AA obligatoria.
```

---

## 18. Activos y archivos

| Archivo | Ubicación | Descripción |
|---|---|---|
| Logos PNG | `/assets/logos/` | 10 variantes (color, blanco, negro, isotipo) |
| Imágenes hero | `/assets/uploads/` | Subidas vía CMS, gestionadas por admin |
| CSS sistema | `/css/styles.css` | Variables + componentes globales |
| CSS específico | `/css/{landing,centro,editorial,fundacion,recursos,cuenta,admin}.css` | Por página |
| Tipografías | Google Fonts CDN | Cardo + Inter |
| Iconos | Font Awesome 6 CDN | Solid + Brands |
| `content.json` | `/data/content.json` | Contenido editable del CMS (textos, imágenes, etc.) |

---

## 19. Mantenimiento de este documento

- **Cualquier cambio en el sistema debe actualizar este documento ANTES.**
- **Cambios mayores:** crear branch `brand/v2`, discutir con equipo, mergear.
- **Versionado:** `1.0` actual. Subir minor (`1.1`) para añadidos, major (`2.0`) para refactor de sistema.
- **Responsable:** equipo Mentis Viva. Última palabra editorial: dirección.

---

## 20. Contacto

- **Email general:** contacto@mentisviva.cl
- **Web:** https://mentisviva.cl
- **Repo design system:** (cuando se cree, agregar URL)

---

*"Cada decisión visual es una decisión emocional. Diseñar para Mentis Viva
es diseñar para alguien que necesita ser tomado en serio sin que se le hable
desde arriba. Calidez con criterio."*
