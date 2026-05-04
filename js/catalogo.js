/* ============================================================================
   CATÁLOGO DE LIBROS — Mentis Viva Editorial
   Pegar como /js/catalogo.js y enlazar desde editorial.html ANTES de
   countdown.js:
       <script src="js/catalogo.js" defer></script>

   Requisitos:
     - ContentManager (de js/content.js) ya cargado al ejecutarse.
     - Estructura editorial.catalogo en data/content.json (ver patch 01).
     - HTML insertado de 02_editorial_html_section.html.
     - CSS de 03_catalogo.css.

   Patrón seguro:
     - NUNCA usa innerHTML con datos del CMS (usa createElement + textContent).
     - Modal con focus trap, Escape para cerrar, click fuera para cerrar.
     - Carrusel con scroll-snap nativo + flechas + teclado (←/→) + dots mobile.
     - Filtros por categoría (con "todos" implícito si no hay categoria seleccionada).
     - Si la portada falla, muestra fallback con icono.
     - Todos los enlaces de tienda abren en pestaña nueva con rel=noopener.
   ============================================================================ */

(function () {
  'use strict';

  // -------------------- Estado interno --------------------
  let _libros = [];
  let _categorias = [];
  let _categoriaActiva = 'todos';
  let _ultimoFocus = null;        // Para devolver el focus al cerrar el modal

  // -------------------- Inicialización --------------------
  function init() {
    if (typeof ContentManager === 'undefined' || !ContentManager.get) {
      // Si ContentManager aún no está, reintentar cuando esté listo
      document.addEventListener('contentmanager:ready', init, { once: true });
      return;
    }

    const cat = ContentManager.get('editorial.catalogo');
    const visible = ContentManager.get('_meta.editorial.catalogo._visible');

    const seccion = document.getElementById('catalogoSection');
    if (!seccion) return;

    if (visible === false) {
      seccion.style.display = 'none';
      return;
    }

    if (!cat || !Array.isArray(cat.libros) || cat.libros.length === 0) {
      // No hay libros configurados todavía: ocultar la sección entera
      seccion.style.display = 'none';
      return;
    }

    // Título y subtítulo
    document.getElementById('catalogoTitulo').textContent = cat.titulo || 'Nuestro Catálogo';
    document.getElementById('catalogoSubtitulo').textContent = cat.subtitulo || '';

    // Datos
    _categorias = Array.isArray(cat.categorias) ? cat.categorias.slice() : [];
    if (!_categorias.find(c => c.id === 'todos')) {
      _categorias.unshift({ id: 'todos', nombre: 'Todos' });
    }
    _libros = cat.libros.slice();

    renderFiltros();
    renderCards();
    bindCarrusel();
    bindModal();
  }

  // -------------------- Filtros --------------------
  function renderFiltros() {
    const cont = document.getElementById('catalogoFiltros');
    cont.innerHTML = ''; // safe: cont no contiene datos de usuario

    _categorias.forEach((categoria, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'catalogo-filtro' + (categoria.id === _categoriaActiva ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', categoria.id === _categoriaActiva ? 'true' : 'false');
      btn.dataset.cat = categoria.id;
      btn.textContent = categoria.nombre || categoria.id;
      btn.addEventListener('click', () => filtrarPorCategoria(categoria.id));
      cont.appendChild(btn);
    });
  }

  function filtrarPorCategoria(catId) {
    _categoriaActiva = catId;
    document.querySelectorAll('.catalogo-filtro').forEach(b => {
      const isActive = b.dataset.cat === catId;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    renderCards();
    // reset scroll del carrusel
    const carrusel = document.getElementById('catalogoCarrusel');
    if (carrusel) carrusel.scrollLeft = 0;
  }

  // -------------------- Cards (sin innerHTML con datos de CMS) --------------------
  function renderCards() {
    const carrusel = document.getElementById('catalogoCarrusel');
    const empty = document.getElementById('catalogoEmpty');
    if (!carrusel) return;

    carrusel.innerHTML = '';

    const libros = (_categoriaActiva === 'todos')
      ? _libros
      : _libros.filter(l => l.categoriaId === _categoriaActiva);

    if (libros.length === 0) {
      empty.hidden = false;
      actualizarFlechas();
      renderDots(0);
      return;
    }
    empty.hidden = true;

    libros.forEach((libro, idx) => {
      carrusel.appendChild(crearCardLibro(libro, idx));
    });

    actualizarFlechas();
    renderDots(libros.length);
  }

  function crearCardLibro(libro, idx) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'libro-card';
    card.setAttribute('aria-label', 'Ver detalles del libro: ' + (libro.titulo || ''));
    card.dataset.libroId = libro.id || ('idx-' + idx);

    // Portada
    const portada = document.createElement('div');
    portada.className = 'libro-card-portada';

    if (libro.portada) {
      const img = document.createElement('img');
      img.src = libro.portada;
      img.alt = 'Portada de ' + (libro.titulo || 'libro');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = function () {
        const fb = crearFallbackPortada();
        portada.innerHTML = '';
        portada.appendChild(fb);
      };
      portada.appendChild(img);
    } else {
      portada.appendChild(crearFallbackPortada());
    }

    if (libro.destacado) {
      const badge = document.createElement('span');
      badge.className = 'libro-card-destacado';
      const i = document.createElement('i');
      i.className = 'fa-solid fa-crown';
      i.setAttribute('aria-hidden', 'true');
      badge.appendChild(i);
      badge.appendChild(document.createTextNode(' Destacado'));
      portada.appendChild(badge);
    }

    card.appendChild(portada);

    // Body
    const body = document.createElement('div');
    body.className = 'libro-card-body';

    const cat = _categorias.find(c => c.id === libro.categoriaId);
    if (cat) {
      const span = document.createElement('span');
      span.className = 'libro-card-categoria';
      span.textContent = cat.nombre || cat.id;
      body.appendChild(span);
    }

    const titulo = document.createElement('h3');
    titulo.className = 'libro-card-titulo';
    titulo.textContent = libro.titulo || 'Sin título';
    body.appendChild(titulo);

    if (libro.autor) {
      const autor = document.createElement('p');
      autor.className = 'libro-card-autor';
      autor.textContent = 'por ' + libro.autor;
      body.appendChild(autor);
    }

    if (libro.resumenCorto) {
      const resumen = document.createElement('p');
      resumen.className = 'libro-card-resumen';
      resumen.textContent = libro.resumenCorto;
      body.appendChild(resumen);
    }

    const cta = document.createElement('span');
    cta.className = 'libro-card-cta';
    cta.appendChild(document.createTextNode('Ver detalles '));
    const ctaIcon = document.createElement('i');
    ctaIcon.className = 'fa-solid fa-arrow-right';
    ctaIcon.setAttribute('aria-hidden', 'true');
    cta.appendChild(ctaIcon);
    body.appendChild(cta);

    card.appendChild(body);

    card.addEventListener('click', () => abrirModal(libro));

    return card;
  }

  function crearFallbackPortada() {
    const fb = document.createElement('div');
    fb.className = 'libro-card-portada-fallback';
    const i = document.createElement('i');
    i.className = 'fa-solid fa-book';
    i.setAttribute('aria-hidden', 'true');
    fb.appendChild(i);
    return fb;
  }

  // -------------------- Carrusel: flechas, teclado, dots --------------------
  function bindCarrusel() {
    const carrusel = document.getElementById('catalogoCarrusel');
    const prev = document.getElementById('catalogoPrev');
    const next = document.getElementById('catalogoNext');

    function scrollByCard(dir) {
      const card = carrusel.querySelector('.libro-card');
      if (!card) return;
      const gap = 20; // mismo que .catalogo-carrusel { gap: 20px }
      const step = card.offsetWidth + gap;
      carrusel.scrollBy({ left: dir * step, behavior: 'smooth' });
    }

    prev.addEventListener('click', () => scrollByCard(-1));
    next.addEventListener('click', () => scrollByCard(1));

    carrusel.addEventListener('scroll', actualizarFlechas, { passive: true });
    window.addEventListener('resize', actualizarFlechas);

    // Teclado en el carrusel
    carrusel.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); scrollByCard(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollByCard(-1); }
      else if (e.key === 'Home') { e.preventDefault(); carrusel.scrollTo({ left: 0, behavior: 'smooth' }); }
      else if (e.key === 'End') { e.preventDefault(); carrusel.scrollTo({ left: carrusel.scrollWidth, behavior: 'smooth' }); }
    });

    actualizarFlechas();
  }

  function actualizarFlechas() {
    const carrusel = document.getElementById('catalogoCarrusel');
    const prev = document.getElementById('catalogoPrev');
    const next = document.getElementById('catalogoNext');
    if (!carrusel || !prev || !next) return;

    const max = carrusel.scrollWidth - carrusel.clientWidth;
    prev.disabled = carrusel.scrollLeft <= 4;
    next.disabled = carrusel.scrollLeft >= max - 4;

    actualizarDotActivo();
  }

  function renderDots(total) {
    const dots = document.getElementById('catalogoDots');
    if (!dots) return;
    dots.innerHTML = '';
    if (total <= 1) return;
    for (let i = 0; i < total; i++) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'catalogo-dot' + (i === 0 ? ' active' : '');
      d.setAttribute('aria-label', 'Ir al libro ' + (i + 1));
      d.dataset.idx = String(i);
      d.addEventListener('click', () => {
        const carrusel = document.getElementById('catalogoCarrusel');
        const cards = carrusel.querySelectorAll('.libro-card');
        if (cards[i]) cards[i].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      });
      dots.appendChild(d);
    }
  }

  function actualizarDotActivo() {
    const carrusel = document.getElementById('catalogoCarrusel');
    const dots = document.querySelectorAll('.catalogo-dot');
    if (!carrusel || dots.length === 0) return;
    const card = carrusel.querySelector('.libro-card');
    if (!card) return;
    const gap = 20;
    const step = card.offsetWidth + gap;
    const idx = Math.round(carrusel.scrollLeft / step);
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  // -------------------- Modal --------------------
  function bindModal() {
    const modal = document.getElementById('catalogoModal');
    if (!modal) return;

    // Click en overlay o en cualquier elemento con [data-cerrar]
    modal.addEventListener('click', (e) => {
      if (e.target.matches('[data-cerrar]')) cerrarModal();
    });

    // Escape para cerrar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) cerrarModal();
    });
  }

  function abrirModal(libro) {
    const modal = document.getElementById('catalogoModal');
    if (!modal) return;

    _ultimoFocus = document.activeElement;

    // Portada
    const portadaImg = document.getElementById('modalPortada');
    if (libro.portada) {
      portadaImg.src = libro.portada;
      portadaImg.alt = 'Portada de ' + (libro.titulo || 'libro');
      portadaImg.style.display = '';
    } else {
      portadaImg.style.display = 'none';
    }

    // Destacado badge
    const badge = document.getElementById('modalDestacadoBadge');
    badge.hidden = !libro.destacado;

    // Categoría
    const cat = _categorias.find(c => c.id === libro.categoriaId);
    document.getElementById('modalCategoria').textContent = cat ? (cat.nombre || cat.id) : '';

    // Título y autor
    document.getElementById('catalogoModalTitulo').textContent = libro.titulo || '';
    document.getElementById('modalAutor').textContent = libro.autor ? ('por ' + libro.autor) : '';

    // Meta (páginas, año, idioma)
    const meta = document.getElementById('modalMeta');
    meta.innerHTML = '';
    if (libro.paginas) appendMeta(meta, 'fa-file-lines', libro.paginas + ' páginas');
    if (libro.anio)    appendMeta(meta, 'fa-calendar', String(libro.anio));
    if (libro.idioma)  appendMeta(meta, 'fa-language', libro.idioma);

    // Descripción larga (separada por \n en párrafos)
    const desc = document.getElementById('modalDescripcion');
    desc.innerHTML = '';
    const parrafos = (libro.descripcionLarga || libro.resumenCorto || '').split(/\n\s*\n|\n/);
    parrafos.forEach(p => {
      const t = p.trim();
      if (!t) return;
      const el = document.createElement('p');
      el.textContent = t;
      desc.appendChild(el);
    });

    // Tiendas
    const tiendas = document.getElementById('modalTiendas');
    tiendas.innerHTML = '';
    if (Array.isArray(libro.tiendas) && libro.tiendas.length > 0) {
      libro.tiendas.forEach(t => tiendas.appendChild(crearBotonTienda(t)));
      tiendas.parentElement.style.display = '';
    } else {
      tiendas.parentElement.style.display = 'none';
    }

    // Mostrar
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('catalogo-modal-open');

    // Focus al modal
    const content = modal.querySelector('.catalogo-modal-content');
    setTimeout(() => content && content.focus(), 50);

    // Focus trap
    modal.addEventListener('keydown', focusTrap);
  }

  function cerrarModal() {
    const modal = document.getElementById('catalogoModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('catalogo-modal-open');
    modal.removeEventListener('keydown', focusTrap);
    if (_ultimoFocus && _ultimoFocus.focus) _ultimoFocus.focus();
  }

  function focusTrap(e) {
    if (e.key !== 'Tab') return;
    const modal = document.getElementById('catalogoModal');
    const focusables = modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function appendMeta(parent, iconClass, text) {
    const li = document.createElement('li');
    const i = document.createElement('i');
    i.className = 'fa-solid ' + iconClass;
    i.setAttribute('aria-hidden', 'true');
    li.appendChild(i);
    li.appendChild(document.createTextNode(' ' + text));
    parent.appendChild(li);
  }

  function crearBotonTienda(tienda) {
    // Validar URL: solo aceptar http(s) — previene javascript: u otros esquemas
    const url = String(tienda.url || '').trim();
    const a = document.createElement('a');
    if (/^https?:\/\//i.test(url)) {
      a.href = url;
    } else {
      a.href = '#';
      a.setAttribute('aria-disabled', 'true');
    }
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
    a.className = 'modal-tienda-btn';

    // Color de fondo por marca (si está)
    const color = String(tienda.color || '').replace(/^#/, '');
    if (/^[0-9A-Fa-f]{6}$/.test(color)) {
      a.style.background = '#' + color;
    }

    // Icono (si está, debe ser una clase Font Awesome válida — sólo permitimos
    // letras, números, guiones, espacios y "fa-")
    if (tienda.icono && /^[\sa-zA-Z0-9\-]+$/.test(tienda.icono)) {
      const i = document.createElement('i');
      i.className = 'fa-brands ' + tienda.icono + ' brand-icon';
      i.setAttribute('aria-hidden', 'true');
      a.appendChild(i);
    } else {
      const i = document.createElement('i');
      i.className = 'fa-solid fa-cart-shopping brand-icon';
      i.setAttribute('aria-hidden', 'true');
      a.appendChild(i);
    }

    a.appendChild(document.createTextNode(' ' + (tienda.nombre || 'Comprar')));
    a.appendChild(document.createTextNode(' '));
    const ext = document.createElement('i');
    ext.className = 'fa-solid fa-up-right-from-square';
    ext.style.fontSize = '0.75rem';
    ext.setAttribute('aria-hidden', 'true');
    a.appendChild(ext);

    return a;
  }

  // -------------------- Bootstrap --------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
