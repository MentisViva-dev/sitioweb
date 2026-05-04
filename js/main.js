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
  if (window.innerWidth > 768) return;
  document.querySelectorAll('.mobile-carousel').forEach(carousel => {
    if (carousel.nextElementSibling?.classList.contains('carousel-progress')) return;
    if (carousel.children.length <= 1) return;
    addProgressBar(carousel);
  });
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
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
