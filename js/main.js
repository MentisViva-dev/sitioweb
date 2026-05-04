/* ========================================
   MentisViva - Main JavaScript
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initNavbarScroll();
  trackPageView();
  initGA4();
});

// Called after dynamic content renders
function initMobileCarousels() {
  // Mobile: progress bar para feedback de scroll horizontal
  if (window.innerWidth <= 768) {
    document.querySelectorAll('.mobile-carousel').forEach(carousel => {
      if (carousel.nextElementSibling?.classList.contains('carousel-progress')) return;
      if (carousel.children.length <= 1) return;
      addProgressBar(carousel);
    });
  }
  // Desktop + mobile: flechas de navegación universales (replican el estilo del catálogo).
  // En móvil están ocultas vía CSS; en desktop solo aparecen si hay overflow.
  initDesktopCarouselArrows();
}

/**
 * Envuelve carruseles horizontales con dos flechas chevron (estilo catálogo)
 * para navegar en desktop. NO toca el catálogo (.catalogo-carrusel) — ese
 * tiene su propia implementación y queda intacto.
 *
 * Selectores cubiertos:
 *   - .mobile-carousel  (testimonios, calugas, charlas, galería, pilares, landing-cards)
 *   - .servicios-grid   (centro.html, ya scrollable en desktop)
 *
 * Las flechas se ocultan automáticamente cuando no hay nada más que scrollear
 * en esa dirección (se desactivan con [disabled], que vía CSS las hace
 * invisibles + no clickeables).
 */
function initDesktopCarouselArrows() {
  const selectors = ['.mobile-carousel', '.servicios-grid'];
  document.querySelectorAll(selectors.join(',')).forEach(carousel => {
    // No tocar el catálogo (tiene su propia implementación)
    if (carousel.classList.contains('catalogo-carrusel')) return;
    // Idempotente: si ya está envuelto, salir
    if (carousel.parentElement?.classList.contains('carousel-arrow-wrapper')) return;
    // Necesitamos al menos 2 hijos para que tenga sentido
    if (carousel.children.length <= 1) return;

    attachCarouselArrows(carousel);
  });
}

function attachCarouselArrows(carousel) {
  const wrapper = document.createElement('div');
  wrapper.className = 'carousel-arrow-wrapper';
  carousel.parentNode.insertBefore(wrapper, carousel);
  wrapper.appendChild(carousel);

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'carousel-arrow carousel-arrow-prev';
  prev.setAttribute('aria-label', 'Anterior');
  prev.innerHTML = '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'carousel-arrow carousel-arrow-next';
  next.setAttribute('aria-label', 'Siguiente');
  next.innerHTML = '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';

  wrapper.appendChild(prev);
  wrapper.appendChild(next);

  function scrollByAmount(dir) {
    const step = Math.max(200, Math.round(carousel.clientWidth * 0.8));
    carousel.scrollBy({ left: dir * step, behavior: 'smooth' });
  }

  function updateArrows() {
    const max = carousel.scrollWidth - carousel.clientWidth;
    if (max <= 4) {
      // Sin overflow — ocultar ambas flechas
      prev.disabled = true;
      next.disabled = true;
      return;
    }
    prev.disabled = carousel.scrollLeft <= 4;
    next.disabled = carousel.scrollLeft >= max - 4;
  }

  prev.addEventListener('click', () => scrollByAmount(-1));
  next.addEventListener('click', () => scrollByAmount(1));
  carousel.addEventListener('scroll', updateArrows, { passive: true });
  window.addEventListener('resize', updateArrows);
  // Re-evaluar al cargar imágenes (cambian scrollWidth)
  carousel.querySelectorAll('img').forEach(img => {
    if (!img.complete) img.addEventListener('load', updateArrows, { once: true });
  });

  // Estado inicial — esperar al próximo frame para que el layout esté listo
  requestAnimationFrame(updateArrows);
  setTimeout(updateArrows, 300);
}

function addProgressBar(container) {
  if (container.nextElementSibling?.classList.contains('carousel-progress')) return;
  const track = document.createElement('div');
  track.className = 'carousel-progress';
  const bar = document.createElement('div');
  bar.className = 'carousel-progress-bar';
  track.appendChild(bar);
  container.after(track);

  function update() {
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll <= 0) { bar.style.width = '100%'; bar.style.transform = ''; return; }
    const pct = container.scrollLeft / maxScroll;
    const trackW = 120;
    const barW = Math.max(30, (container.clientWidth / container.scrollWidth) * trackW);
    bar.style.width = barW + 'px';
    bar.style.transform = 'translateX(' + (pct * (trackW - barW)) + 'px)';
  }

  container.addEventListener('scroll', update, { passive: true });
  setTimeout(update, 300);
}

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .stagger-children').forEach(el => {
    observer.observe(el);
  });
}

function initNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  const isLanding = navbar.classList.contains('navbar-hidden');
  const scrollThreshold = isLanding ? 100 : 20;

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > scrollThreshold);
  }, { passive: true });
}

// ---- Local Page View Tracker ----
function trackPageView() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const today = new Date().toISOString().slice(0, 10);
  const stats = JSON.parse(localStorage.getItem('mentisviva_stats') || '{}');
  if (!stats[today]) stats[today] = {};
  if (!stats[today][page]) stats[today][page] = 0;
  stats[today][page]++;
  // Keep only last 90 days
  const keys = Object.keys(stats).sort();
  while (keys.length > 90) {
    delete stats[keys.shift()];
  }
  localStorage.setItem('mentisviva_stats', JSON.stringify(stats));
}

// ---- Google Analytics 4 ----
function initGA4() {
  try {
    const content = JSON.parse(localStorage.getItem('mentisviva_content') || '{}');
    const gaId = content.global?.gaId;
    if (!gaId || gaId.trim() === '') return;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', gaId);
  } catch (e) {}
}


function showToast(message, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  // Live region: error toasts are assertive (interrupts), success/info polite.
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.setAttribute('aria-atomic', 'true');
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
