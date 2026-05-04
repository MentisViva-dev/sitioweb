/* ========================================
   Mentis Viva - Content Management System
   Loads content from localStorage (CMS) or default JSON
   ======================================== */

const ContentManager = {
  data: null,

  // Map pages to their isotipo key
  isotipoMap: {
    'index.html': 'isotipo',
    'centro.html': 'isotipoClinica',
    'editorial.html': 'isotipoEditorial',
    'fundacion.html': 'isotipoFundacion'
  },

  // Map pages to their brand text
  brandTextMap: {
    'index.html': 'Mentis Viva',
    'centro.html': 'Centro Mentis Viva',
    'editorial.html': 'Editorial Mentis Viva',
    'fundacion.html': 'Fundaci\u00f3n Mentis Viva',
    'recursos.html': 'Recursos Mentis Viva'
  },

  // Fallback global data when fetch fails (e.g. file:// protocol)
  fallbackGlobal: {
    siteName: "Mentis Viva",
    logo: "assets/logos/logo-color.png",
    logoBlanco: "assets/logos/logo-blanco.png",
    isotipo: "assets/logos/isotipo-color.png",
    isotipoClinica: "assets/logos/isotipo-color-1.png",
    isotipoEditorial: "assets/logos/isotipo-color-2.png",
    isotipoFundacion: "assets/logos/isotipo-color-3.png",
    nav: {
      items: [
        { label: "Inicio", url: "index.html" },
        { label: "Centro", url: "centro.html" },
        { label: "Editorial", url: "editorial.html" },
        { label: "Fundaci\u00f3n", url: "fundacion.html" }
      ]
    },
    footer: {
      descripcion: "Mentis Viva es un ecosistema dedicado al bienestar psicol\u00f3gico, la cultura literaria y el compromiso social.",
      contacto: {
        email: "contacto@mentisviva.cl",
        telefono: "+56 9 5370 7346",
        direccion: "Santiago, Chile"
      },
      redes: {
        instagram: "https://instagram.com/mentisviva",
        facebook: "https://facebook.com/mentisviva",
        tiktok: "https://tiktok.com/@mentisviva"
      },
      copyright: "\u00a9 2026 Mentis Viva. Todos los derechos reservados."
    }
  },

  // Fallback landing data when fetch fails
  fallbackLanding: {
    hero: {
      titulo: "Mente, Cultura y Compromiso Social",
      subtitulo: "Un ecosistema dedicado a transformar vidas a trav\u00e9s de la psicolog\u00eda, la lectura y la acci\u00f3n comunitaria."
    },
    secciones: [
      {
        titulo: "Centro Psicol\u00f3gico",
        descripcion: "Terapias contextuales con enfoque en ACT y DBT, desde una mirada de humanidad compartida y compasi\u00f3n. Sesiones individuales, grupales, terapias de pareja y coaching para tu bienestar emocional.",
        icono: "fa-brain",
        url: "centro.html",
        color: "teal"
      },
      {
        titulo: "Editorial",
        descripcion: "Lee, Crece y Vive. Libros que integran la psicolog\u00eda con la vida cotidiana, cuidadosamente curados para tu desarrollo personal.",
        icono: "fa-book-open",
        url: "editorial.html",
        color: "green"
      },
      {
        titulo: "Fundaci\u00f3n",
        descripcion: "Comprometidos con la educaci\u00f3n psicol\u00f3gica. Charlas y talleres en centros educacionales para construir una sociedad m\u00e1s consciente.",
        icono: "fa-heart",
        url: "fundacion.html",
        color: "celeste"
      }
    ],
    about: {
      titulo: "Sobre Mentis Viva",
      texto: "Nacimos con la convicci\u00f3n de que el bienestar psicol\u00f3gico es un derecho fundamental. Nuestro enfoque integra la pr\u00e1ctica cl\u00ednica, la difusi\u00f3n cultural a trav\u00e9s de la lectura, y la acci\u00f3n social directa en comunidades educativas."
    }
  },

  // Fallback clinica data
  fallbackClinica: {
    banner: { titulo: "Centro Psicol\u00f3gico Mentis Viva", subtitulo: "Tu bienestar emocional es nuestra prioridad", backgroundImage: "", overlayOpacity: 85 },
    enfoque: {
      titulo: "Nuestro Enfoque Terap\u00e9utico", subtitulo: "ACT y Humanidad Compartida", imagen: "",
      texto: "En Mentis Viva trabajamos desde la Terapia de Aceptaci\u00f3n y Compromiso (ACT) y la Humanidad Compartida. Creemos que el sufrimiento humano es parte natural de la vida, y nuestro objetivo no es eliminarlo, sino ayudarte a construir una vida rica y significativa a pesar de las dificultades.",
      pilares: [
        { titulo: "Aceptaci\u00f3n", descripcion: "Aprender a estar presente con las emociones dif\u00edciles sin luchar contra ellas." },
        { titulo: "Compromiso", descripcion: "Identificar tus valores m\u00e1s profundos y tomar acciones concretas." },
        { titulo: "Humanidad Compartida", descripcion: "Reconocer tu potencial \u00fanico y cultivar relaciones aut\u00e9nticas." }
      ]
    },
    servicios: [
      { titulo: "Terapia Individual", descripcion: "Sesiones personalizadas en un espacio seguro y confidencial.", icono: "fa-user", destacado: false },
      { titulo: "Terapia Grupal", descripcion: "Grupos terap\u00e9uticos donde la experiencia compartida potencia el crecimiento.", icono: "fa-users", destacado: false },
      { titulo: "Coaching Psicol\u00f3gico", descripcion: "Sesiones orientadas a objetivos espec\u00edficos.", icono: "fa-rocket", destacado: false }
    ],
    formulario: { titulo: "Agenda tu Sesi\u00f3n", subtitulo: "Comp\u00e1rtenos tus datos y nos pondremos en contacto contigo" },
    testimonios: [
      { nombre: "Mar\u00eda G.", texto: "Mentis Viva me ayud\u00f3 a encontrar herramientas reales para manejar mi ansiedad.", rating: 5 },
      { nombre: "Carlos R.", texto: "Las sesiones grupales fueron transformadoras.", rating: 5 },
      { nombre: "Andrea P.", texto: "El coaching me permiti\u00f3 tomar decisiones importantes con claridad.", rating: 5 }
    ],
    fraseCompromiso: { texto: "Porque cada mente merece ser escuchada, cada emoci\u00f3n validada, y cada persona tiene el derecho de vivir una vida plena y con sentido.", autor: "Equipo Mentis Viva", backgroundImage: "", overlayOpacity: 100 }
  },

  // Fallback editorial data
  fallbackEditorial: {
    banner: { titulo: "Editorial Mentis Viva", subtitulo: "Donde la psicolog\u00eda y la literatura se encuentran", backgroundImage: "", overlayOpacity: 85 },
    slogan: { titulo: "Lee, Crece y Vive", texto: "Creemos profundamente que la lectura es una herramienta terap\u00e9utica en s\u00ed misma." },
    calugas: [
      { titulo: "Profundidad Psicol\u00f3gica", descripcion: "Cada t\u00edtulo es elegido por su capacidad de explorar la condici\u00f3n humana.", icono: "fa-brain" },
      { titulo: "Historia", descripcion: "Narrativas que trascienden el tiempo.", icono: "fa-clock-rotate-left" },
      { titulo: "Curadores", descripcion: "Nuestro equipo selecciona cuidadosamente cada obra.", icono: "fa-magnifying-glass" },
      { titulo: "Sorpresas", descripcion: "Cada entrega incluye elementos inesperados.", icono: "fa-gift" }
    ],
    countdown: { titulo: "Tu viaje literario contin\u00faa en...", fechaObjetivo: "2026-06-01T00:00:00", textoEvento: "Pr\u00f3ximo lanzamiento editorial" },
    planes: [
      { nombre: "Lector Curioso", precio: "$12.990", periodo: "/mes", descripcion: "Perfecto para comenzar", beneficios: ["1 libro mensual", "Marcap\u00e1ginas exclusivo"], destacado: false, ctaTexto: "Comenzar" },
      { nombre: "Explorador Mental", precio: "$19.990", periodo: "/mes", descripcion: "Nuestra selecci\u00f3n m\u00e1s popular", beneficios: ["1 libro mensual", "Kit terap\u00e9utico", "Webinar mensual"], destacado: true, ctaTexto: "Elegir plan" },
      { nombre: "Mente Plena", precio: "$29.990", periodo: "/mes", descripcion: "La experiencia completa", beneficios: ["2 libros mensuales", "Kit premium", "Sesi\u00f3n grupal"], destacado: false, ctaTexto: "Elegir plan" }
    ],
    testimonios: [
      { nombre: "Valentina M.", texto: "Cada libro es exactamente lo que necesito leer.", rating: 5 },
      { nombre: "Diego S.", texto: "Los ejercicios de reflexi\u00f3n han sido muy \u00fatiles.", rating: 5 },
      { nombre: "Francisca L.", texto: "La comunidad de lectores es incre\u00edble.", rating: 5 }
    ],
    contacto: { titulo: "Cont\u00e1ctanos", subtitulo: "\u00bfTienes dudas sobre nuestros planes?" }
  },

  // Fallback fundacion data
  fallbackFundacion: {
    banner: { titulo: "Fundaci\u00f3n Mentis Viva", subtitulo: "Educando mentes, transformando comunidades", backgroundImage: "", overlayOpacity: 85 },
    mision: {
      titulo: "Nuestra Misi\u00f3n", texto: "Creemos que la educaci\u00f3n psicol\u00f3gica es un pilar fundamental para construir una sociedad m\u00e1s consciente.",
      valores: [
        { titulo: "Accesibilidad", descripcion: "La salud mental no es un privilegio, es un derecho.", icono: "fa-universal-access" },
        { titulo: "Prevenci\u00f3n", descripcion: "Educamos antes de que surja la crisis.", icono: "fa-shield-heart" },
        { titulo: "Comunidad", descripcion: "Trabajamos con la comunidad educativa completa.", icono: "fa-people-group" }
      ]
    },
    queHacemos: {
      titulo: "\u00bfQu\u00e9 Hacemos?", texto: "Realizamos charlas y talleres en establecimientos educacionales.",
      temas: ["Ansiedad y manejo del estr\u00e9s en adolescentes", "Bullying y convivencia escolar", "Regulaci\u00f3n emocional", "Autoestima y construcci\u00f3n de identidad", "Comunicaci\u00f3n efectiva en la familia", "Primeros auxilios psicol\u00f3gicos para docentes", "Intervenci\u00f3n en crisis", "Humanidad compartida"]
    },
    impacto: { stats: [{ numero: "25+", label: "Charlas realizadas" }, { numero: "2.000+", label: "Personas alcanzadas" }, { numero: "15+", label: "Centros educacionales" }, { numero: "98%", label: "Satisfacci\u00f3n" }] },
    charlas: [
      { titulo: "Regulaci\u00f3n Emocional en Adolescentes", descripcion: "Taller pr\u00e1ctico sobre mindfulness.", fecha: "2026-03-15", lugar: "Santiago", imagen: "" },
      { titulo: "Primeros Auxilios Psicol\u00f3gicos", descripcion: "Capacitaci\u00f3n a docentes.", fecha: "2026-02-20", lugar: "Valpara\u00edso", imagen: "" }
    ],
    cta: { titulo: "\u00bfQuieres que visitemos tu centro educacional?", texto: "Estamos comprometidos con llevar educaci\u00f3n psicol\u00f3gica de calidad a todo Chile." },
    galeria: []
  },

  async init() {
    // Si ya inicializamos antes en esta página, retornar la promesa cacheada.
    // Esto permite que múltiples consumidores llamen init() sin duplicar el fetch.
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      // Estrategia: primero intentamos /api/content (Worker, leído del CMS).
      // Si falla (404 = no hay contenido publicado todavía, o red caída) usamos
      // el static data/content.json del repo (snapshot inicial). localStorage
      // es SOLO último recurso offline.
      const cb = '?v=' + Date.now();
      try {
        // 1) API del CMS publicado (refleja cambios del admin inmediatamente)
        let response = await fetch('https://api.mentisviva.cl/api/content' + cb, { cache: 'no-store' });
        if (!response.ok) {
          // 2) Static file del repo (Pages) — fallback si el CMS no tiene nada publicado
          response = await fetch('data/content.json' + cb, { cache: 'no-store' });
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        this.data = await response.json();
        // Guardamos como respaldo offline (no como fuente de verdad)
        try { localStorage.setItem('mentisviva_content', JSON.stringify(this.data)); } catch(_){}
      } catch (e) {
        console.warn('content.json fetch failed, using cache or fallback:', e);
        const stored = localStorage.getItem('mentisviva_content');
        if (stored) {
          try { this.data = JSON.parse(stored); }
          catch(_) { this.data = null; }
        }
        if (!this.data) {
          // Fallback final (file:// o sin red ni cache)
          this.data = { global: this.fallbackGlobal, landing: this.fallbackLanding, clinica: this.fallbackClinica, editorial: this.fallbackEditorial, fundacion: this.fallbackFundacion };
        }
      }
      // Notificar a los listeners que se montaron antes que terminara init()
      // (catalogo.js usa este evento — sin él, defer-scripts ven this.data=null
      // y abortan en silencio, ocultando su sección).
      try {
        document.dispatchEvent(new CustomEvent('contentmanager:ready', { detail: this.data }));
      } catch(_) {}
      return this.data;
    })();
    return this._initPromise;
  },

  get(path) {
    if (!this.data) return null;
    return path.split('.').reduce((obj, key) => obj?.[key], this.data);
  },

  save(data) {
    this.data = data;
    localStorage.setItem('mentisviva_content', JSON.stringify(data));
  },

  reset() {
    localStorage.removeItem('mentisviva_content');
  },

  getIsotipo(currentPage) {
    const global = this.get('global');
    if (!global) return '';
    const key = this.isotipoMap[currentPage] || 'isotipo';
    return global[key] || global.isotipo;
  },

  renderNavbar(currentPage) {
    const global = this.get('global');
    if (!global) return;

    const nav = document.getElementById('navbar');
    if (!nav) return;

    const isotipo = this.getIsotipo(currentPage);
    const brandText = this.brandTextMap[currentPage] || 'Mentis Viva';
    const pageVis = global.pageVisibility || {};
    const items = global.nav.items.filter(item => pageVis[item.url] !== false);
    const linksHtml = items.map(item => {
      const isActive = item.url === currentPage ? 'active' : '';
      return `<a href="${item.url}" class="${isActive}">${item.label}</a>`;
    }).join('');

    nav.innerHTML = `
      <div class="container">
        <a href="index.html" class="navbar-brand">
          <img src="${isotipo}" alt="${global.siteName} - Centro Psicol\u00f3gico, Editorial y Fundaci\u00f3n" class="navbar-logo" loading="eager" fetchpriority="high" decoding="sync">
          <span class="navbar-brand-text">${brandText}</span>
        </a>
        <nav class="navbar-links" id="navLinks">
          ${linksHtml}
        </nav>
        <button class="navbar-toggle" id="navToggle" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
      </div>
    `;

    document.getElementById('navToggle')?.addEventListener('click', () => {
      document.getElementById('navLinks').classList.toggle('open');
    });
  },

  renderFooter() {
    const global = this.get('global');
    if (!global) return;

    const footer = document.getElementById('footer');
    if (!footer) return;

    const f = global.footer;
    footer.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <img src="assets/logos/isotipo-blanco.png" alt="${global.siteName} - Bienestar emocional y salud mental Chile" loading="lazy" decoding="async">
            <p>${f.descripcion}</p>
          </div>
          <div>
            <h4>Navegaci\u00f3n</h4>
            <div class="footer-links">
              ${global.nav.items.filter(i => (global.pageVisibility || {})[i.url] !== false).map(i => `<a href="${i.url}">${i.label}</a>`).join('')}
            </div>
          </div>
          <div>
            <h4>Contacto</h4>
            <div class="footer-links">
              <a href="mailto:${f.contacto.email}"><i class="fa-solid fa-envelope"></i> ${f.contacto.email}</a>
              <a href="tel:${f.contacto.telefono}"><i class="fa-solid fa-phone"></i> ${f.contacto.telefono}</a>
            </div>
          </div>
          <div>
            <h4>S\u00edguenos</h4>
            <div class="footer-social">
              <a href="${f.redes.instagram}" target="_blank" rel="noopener" aria-label="Instagram"><i class="fa-brands fa-instagram"></i></a>
              <a href="${f.redes.facebook}" target="_blank" rel="noopener" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
              <a href="${f.redes.tiktok}" target="_blank" rel="noopener" aria-label="TikTok"><i class="fa-brands fa-tiktok"></i></a>
            </div>
          </div>
        </div>
        <div class="footer-bottom">
          <p>${f.copyright}</p>
          <p style="margin-top:8px"><a href="terminos.html" style="color:rgba(255,255,255,0.5);font-size:0.82rem;text-decoration:underline">T\u00e9rminos y Condiciones</a></p>
          <p class="footer-credit">P\u00e1gina desarrollada por <a href="https://synapsisux.cl" target="_blank" rel="noopener" style="color:rgba(255,255,255,0.4);text-decoration:underline">SynapsisUX</a></p>
        </div>
      </div>
    `;
  },

  renderTestimonials(containerId, testimonials) {
    const container = document.getElementById(containerId);
    if (!container || !testimonials) return;

    container.innerHTML = testimonials.map(t => `
      <div class="testimonial-card fade-in">
        <div class="quote-icon">\u201C</div>
        <div class="testimonial-stars">${'<i class="fa-solid fa-star"></i>'.repeat(t.rating)}</div>
        <p class="testimonial-text">${t.texto}</p>
        <p class="testimonial-author">${t.nombre}</p>
      </div>
    `).join('');
  },

  // Check if a module is visible (default: true if not set)
  isVisible(path) {
    // Check dedicated _visibility store first
    if (this.data?._visibility && this.data._visibility[path] !== undefined) {
      return this.data._visibility[path] !== false;
    }
    // Fallback to nested path
    const val = path.split('.').reduce((obj, key) => obj?.[key], this.data);
    return val !== false;
  },

  // Hide a section element if its module is not visible.
  // Si está visible, también remueve un display:none inline (anti-FOUC) que
  // hayamos puesto en el HTML para evitar el flash al cargar la página.
  toggleSection(sectionEl, visibilityPath) {
    if (!sectionEl) return false;
    if (!this.isVisible(visibilityPath)) {
      sectionEl.style.display = 'none';
      return false;
    }
    // Si tenía display:none por anti-FOUC, devolver al default del CSS
    if (sectionEl.style.display === 'none') {
      sectionEl.style.display = '';
    }
    return true;
  },

  // Sanitize string to prevent XSS
  sanitize(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // Sanitize URL - only allow safe protocols
  sanitizeUrl(url) {
    if (!url) return '';
    const s = String(url).trim();
    if (s.startsWith('javascript:') || s.startsWith('data:text') || s.startsWith('vbscript:')) return '';
    return s;
  },

  // Sanitize image src - allow data: images and http(s)
  sanitizeImg(src) {
    if (!src) return '';
    const s = String(src).trim();
    if (s.startsWith('data:image/')) return s;
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('assets/')) return s;
    if (/^[a-zA-Z0-9_./-]+$/.test(s)) return s; // relative safe paths
    return '';
  }
};
