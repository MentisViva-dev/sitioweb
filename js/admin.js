/* ========================================
   Mentis Viva - Admin CMS Logic v2
   ======================================== */

let siteData = null;
let currentPage = 'landing';
const MAX_IMAGE_SIZE = 6 * 1024 * 1024; // 6MB
let loginAttempts = parseInt(sessionStorage.getItem('mv_login_attempts') || '0');
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 300000; // 5 min lockout
let lockoutUntil = parseInt(sessionStorage.getItem('mv_lockout') || '0');

// Cloudflare Workers API base for the admin endpoints
const API_BASE = 'https://api.mentisviva.cl/api/admin';

// Stub for shipping endpoints (no Worker equivalent yet)
function shippingNotImplemented() {
  showAdminToast('Esta funcionalidad de envíos requiere endpoints adicionales en el backend Worker. Pendiente de implementación.');
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  // Check session by hitting /content; cookie is sent via credentials: 'include'.
  // localStorage flag is only used as a UX hint to avoid the login screen flashing.
  try {
    const res = await fetch(`${API_BASE}/content`, { credentials: 'include' });
    if (res.ok) {
      localStorage.setItem('mentisviva_admin_auth', 'true');
      showAdmin();
    } else {
      // 401 / not authenticated
      localStorage.removeItem('mentisviva_admin_auth');
    }
  } catch (e) {
    // Network error - clear UX flag and show login
    localStorage.removeItem('mentisviva_admin_auth');
  }
});

async function login() {
  const err = document.getElementById('loginError');

  // Rate limiting
  if (Date.now() < lockoutUntil) {
    const mins = Math.ceil((lockoutUntil - Date.now()) / 60000);
    err.style.display = 'block';
    err.textContent = `Demasiados intentos. Espera ${mins} minuto(s).`;
    return;
  }

  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;

  // Verify credentials server-side via Worker; cookie comes back as Set-Cookie
  const body = new URLSearchParams();
  body.append('username', user);
  body.append('password', pass);

  let authOk = false;
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (res.ok) {
      // Some workers return { ok: true }, but a 200 status is sufficient
      authOk = true;
      try {
        const data = await res.json();
        if (data && data.ok === false) authOk = false;
      } catch (_) { /* ignore non-JSON success */ }
    }
  } catch(e) {
    authOk = false;
  }
  if (authOk) {
    loginAttempts = 0;
    sessionStorage.removeItem('mv_login_attempts');
    sessionStorage.removeItem('mv_lockout');
    localStorage.setItem('mentisviva_admin_auth', 'true');
    showAdmin();
  } else {
    loginAttempts++;
    sessionStorage.setItem('mv_login_attempts', loginAttempts);
    if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      lockoutUntil = Date.now() + LOCKOUT_MS;
      sessionStorage.setItem('mv_lockout', lockoutUntil);
      err.style.display = 'block';
      err.textContent = 'Demasiados intentos. Cuenta bloqueada por 5 minutos.';
    } else {
      err.style.display = 'block';
      err.textContent = `Credenciales incorrectas (${MAX_LOGIN_ATTEMPTS - loginAttempts} intentos restantes)`;
    }
  }
}

async function logout() {
  try {
    await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
  } catch (e) { /* ignore */ }
  localStorage.removeItem('mentisviva_admin_auth');
  location.reload();
}

async function showAdmin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.querySelector('.admin-layout').classList.add('active');
  await loadData();
  populateAllForms();
  initImageUploads();
  initVisibilityToggles();
  renderAllSubmissions();
  updateSidebarBadges();
  showPage('dashboard');
}

async function loadData() {
  const stored = localStorage.getItem('mentisviva_content');
  if (stored) {
    siteData = JSON.parse(stored);
  } else {
    try {
      // Prefer the authoritative copy from the Worker; fall back to static JSON
      const res = await fetch(`${API_BASE}/content`, { credentials: 'include' });
      if (res.ok) {
        siteData = await res.json();
      } else {
        const staticRes = await fetch('data/content.json');
        siteData = await staticRes.json();
      }
    } catch (e) {
      console.error('Error loading data:', e);
      siteData = { global: {}, landing: {}, clinica: {}, editorial: {}, fundacion: {} };
    }
  }
}

function saveData() {
  try {
    const json = JSON.stringify(siteData);
    localStorage.setItem('mentisviva_content', json);
    const sizeMB = (json.length * 2 / 1024 / 1024).toFixed(1);
    showAdminToast(`Cambios guardados (${sizeMB}MB usado)`);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      showAdminToast('Error: almacenamiento lleno. Reduce el tamaño de las imágenes o elimina alguna.');
    } else {
      showAdminToast('Error al guardar: ' + e.message);
    }
    console.error('Save error:', e);
  }
}

function resetData() {
  localStorage.removeItem('mentisviva_content');
  location.reload();
}

function exportData() {
  const blob = new Blob([JSON.stringify(siteData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mentisviva-content-backup.json';
  a.click();
  URL.revokeObjectURL(url);
  showAdminToast('Backup exportado');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      siteData = JSON.parse(ev.target.result);
      saveData();
      populateAllForms();
      initImageUploads();
      initVisibilityToggles();
      showAdminToast('Contenido importado correctamente');
    } catch {
      showAdminToast('Error: archivo JSON inválido');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ---- Navigation ----
const pageLabels = {
  'dashboard': 'Dashboard',
  'landing': 'Página Principal',
  'recursos': 'Recursos',
  'terminos': 'Términos y Condiciones',
  'subscribers': 'Suscriptores',
  'clinica': 'Centro',
  'editorial': 'Editorial',
  'fundacion': 'Fundación',
  'form-centro': 'Formularios Centro',
  'form-editorial': 'Formularios Editorial',
  'form-fundacion': 'Formularios Fundación',
  'global': 'Configuración Global',
  'shipping': 'Nómina de Envío',
  'surveys': 'Encuestas'
};

const saveFunctions = {
  'landing': saveLanding,
  'clinica': saveClinica,
  'editorial': saveEditorial,
  'fundacion': saveFundacion,
  'recursos': saveRecursos,
  'terminos': saveTerminos,
  'global': saveGlobal
};

function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  document.getElementById('pageTitle').textContent = pageLabels[page] || page;

  // Show/hide save button based on page type
  const saveBtn = document.getElementById('topbarSaveBtn');
  if (page.startsWith('form-') || page === 'dashboard' || page === 'subscribers' || page === 'shipping') {
    saveBtn.style.display = 'none';
  } else {
    saveBtn.style.display = '';
  }

  // Refresh dashboard/subscribers when navigating
  if (page === 'dashboard') populateDashboard();
  if (page === 'subscribers') loadSubscribers('all');
  if (page === 'shipping') {
    // Set default month to current
    const now = new Date();
    const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('rosterMonth').value = monthStr;
    loadRoster();
    loadShippingConfig();
  }
  if (page === 'surveys') {
    const now = new Date();
    document.getElementById('surveyMonth').value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    loadSurveyResults();
  }
}

function saveCurrentPage() {
  // Collect visibility toggles first
  collectVisibilityToggles();
  const fn = saveFunctions[currentPage];
  if (fn) fn();
  else showAdminToast('No hay cambios que guardar en esta sección');
}

// ---- Populate Forms ----
function populateAllForms() {
  if (!siteData) return;
  populateGlobal();
  populateLanding();
  populateRecursos();
  populateTerminos();
  populateClinica();
  populateEditorial();
  populateFundacion();
}

function populateGlobal() {
  const g = siteData.global;
  if (!g) return;
  setVal('g-siteName', g.siteName);
  setVal('g-logo', g.logo);
  setVal('g-logoBlanco', g.logoBlanco);
  setVal('g-isotipo', g.isotipo);
  setVal('g-isotipoClinica', g.isotipoClinica);
  setVal('g-isotipoEditorial', g.isotipoEditorial);
  setVal('g-isotipoFundacion', g.isotipoFundacion);
  if (g.footer) {
    setVal('g-email', g.footer.contacto?.email);
    setVal('g-telefono', g.footer.contacto?.telefono);
    setVal('g-direccion', g.footer.contacto?.direccion);
    setVal('g-instagram', g.footer.redes?.instagram);
    setVal('g-facebook', g.footer.redes?.facebook);
    setVal('g-tiktok', g.footer.redes?.tiktok);
    setVal('g-footerDesc', g.footer.descripcion);
    setVal('g-copyright', g.footer.copyright);
  }
  setVal('g-gaId', g.gaId || '');
}

function populateLanding() {
  const l = siteData.landing;
  if (!l) return;
  setVal('l-heroTitulo', l.hero?.titulo);
  setVal('l-heroSubtitulo', l.hero?.subtitulo);
  setVal('l-aboutTitulo', l.about?.titulo);
  setVal('l-aboutTexto', l.about?.texto);
  if (l.secciones) renderRepeater('landing-secciones', l.secciones, renderLandingSeccion);
}

function populateClinica() {
  const c = siteData.clinica;
  if (!c) return;
  setVal('c-bannerTitulo', c.banner?.titulo);
  setVal('c-bannerSubtitulo', c.banner?.subtitulo);
  setVal('c-bannerImage', c.banner?.backgroundImage);
  setVal('c-bannerOverlay', c.banner?.overlayOpacity != null ? c.banner.overlayOpacity : 85);
  setVal('c-enfoqueTitulo', c.enfoque?.titulo);
  setVal('c-enfoqueSubtitulo', c.enfoque?.subtitulo);
  setVal('c-enfoqueTexto', c.enfoque?.texto);
  setVal('c-enfoqueImagen', c.enfoque?.imagen || '');
  setVal('c-fraseTexto', c.fraseCompromiso?.texto);
  setVal('c-fraseAutor', c.fraseCompromiso?.autor);
  setVal('c-fraseImage', c.fraseCompromiso?.backgroundImage || '');
  setVal('c-fraseOverlay', c.fraseCompromiso?.overlayOpacity != null ? c.fraseCompromiso.overlayOpacity : 100);
  if (c.enfoque?.pilares) renderRepeater('clinica-pilares', c.enfoque.pilares, renderPilar);
  if (c.servicios) renderRepeater('clinica-servicios', c.servicios, renderServicio);
  if (c.testimonios) renderRepeater('clinica-testimonios', c.testimonios, renderTestimonio);
}

function populateEditorial() {
  const e = siteData.editorial;
  if (!e) return;
  setVal('e-bannerTitulo', e.banner?.titulo);
  setVal('e-bannerSubtitulo', e.banner?.subtitulo);
  setVal('e-bannerImage', e.banner?.backgroundImage);
  setVal('e-bannerOverlay', e.banner?.overlayOpacity != null ? e.banner.overlayOpacity : 85);
  setVal('e-sloganTitulo', e.slogan?.titulo);
  setVal('e-sloganTexto', e.slogan?.texto);
  setVal('e-countdownTitulo', e.countdown?.titulo);
  // Parse monthly format: "monthly:DAY:HOUR:MIN"
  if (e.countdown?.fechaObjetivo?.startsWith('monthly:')) {
    const parts = e.countdown.fechaObjetivo.split(':');
    setVal('e-countdownDay', parts[1] || '20');
    setVal('e-countdownHour', parts[2] || '10');
  } else {
    setVal('e-countdownDay', '20');
    setVal('e-countdownHour', '10');
  }
  setVal('e-countdownEvento', e.countdown?.textoEvento);
  setVal('e-countdownImage', e.countdown?.backgroundImage || '');
  setVal('e-countdownOverlay', e.countdown?.overlayOpacity != null ? e.countdown.overlayOpacity : 85);
  setVal('e-contactoTitulo', e.contacto?.titulo);
  setVal('e-contactoSubtitulo', e.contacto?.subtitulo);
  if (e.calugas) renderRepeater('editorial-calugas', e.calugas, renderCaluga);
  if (e.planes) renderRepeater('editorial-planes', e.planes, renderPlan);
  if (e.testimonios) renderRepeater('editorial-testimonios', e.testimonios, renderTestimonio);
}

function populateFundacion() {
  const f = siteData.fundacion;
  if (!f) return;
  setVal('f-bannerTitulo', f.banner?.titulo);
  setVal('f-bannerSubtitulo', f.banner?.subtitulo);
  setVal('f-bannerImage', f.banner?.backgroundImage);
  setVal('f-bannerOverlay', f.banner?.overlayOpacity != null ? f.banner.overlayOpacity : 85);
  setVal('f-misionTitulo', f.mision?.titulo);
  setVal('f-misionTexto', f.mision?.texto);
  setVal('f-queHacemosTitulo', f.queHacemos?.titulo);
  setVal('f-queHacemosTexto', f.queHacemos?.texto);
  setVal('f-queHacemosImage', f.queHacemos?.imagen || '');
  setVal('f-ctaTitulo', f.cta?.titulo);
  setVal('f-ctaTexto', f.cta?.texto);
  setVal('f-ctaImage', f.cta?.imagen || '');
  if (f.mision?.valores) renderRepeater('fundacion-valores', f.mision.valores, renderValor);
  if (f.queHacemos?.temas) renderRepeater('fundacion-temas', f.queHacemos.temas, renderTema);
  if (f.impacto?.stats) renderRepeater('fundacion-stats', f.impacto.stats, renderStat);
  if (f.charlas) renderRepeater('fundacion-charlas', f.charlas, renderCharla);
  if (f.galeria) renderRepeater('fundacion-galeria', f.galeria, renderGaleriaItem);
}

function populateRecursos() {
  const r = siteData.recursos;
  if (!r) return;
  setVal('r-bannerTitulo', r.banner?.titulo);
  setVal('r-bannerSubtitulo', r.banner?.subtitulo);
  setVal('r-bannerImage', r.banner?.backgroundImage || '');
  setVal('r-bannerOverlay', r.banner?.overlayOpacity != null ? r.banner.overlayOpacity : 85);
  if (r.items) renderRepeater('recursos-items', r.items, renderRecurso);
}

function populateTerminos() {
  const t = siteData.terminos;
  if (!t) return;
  setVal('t-titulo', t.titulo);
  setVal('t-fecha', t.fecha);
  setVal('t-contenido', t.contenido);
}

// ---- Save Sections ----
function saveTerminos() {
  if (!siteData.terminos) siteData.terminos = {};
  siteData.terminos.titulo = getVal('t-titulo');
  siteData.terminos.fecha = getVal('t-fecha');
  siteData.terminos.contenido = getVal('t-contenido');
  saveData();
}

function saveRecursos() {
  if (!siteData.recursos) siteData.recursos = {};
  if (!siteData.recursos.banner) siteData.recursos.banner = {};
  siteData.recursos.banner.titulo = getVal('r-bannerTitulo');
  siteData.recursos.banner.subtitulo = getVal('r-bannerSubtitulo');
  siteData.recursos.banner.backgroundImage = getVal('r-bannerImage');
  siteData.recursos.banner.overlayOpacity = parseInt(getVal('r-bannerOverlay')) || 85;
  siteData.recursos.items = collectRepeater('recursos-items', collectRecurso);
  saveData();
}

function saveGlobal() {
  if (!siteData.global) siteData.global = {};
  if (!siteData.global.footer) siteData.global.footer = { contacto: {}, redes: {} };
  if (!siteData.global.footer.contacto) siteData.global.footer.contacto = {};
  if (!siteData.global.footer.redes) siteData.global.footer.redes = {};
  siteData.global.siteName = getVal('g-siteName');
  siteData.global.logo = getVal('g-logo');
  siteData.global.logoBlanco = getVal('g-logoBlanco');
  siteData.global.isotipo = getVal('g-isotipo');
  siteData.global.isotipoClinica = getVal('g-isotipoClinica');
  siteData.global.isotipoEditorial = getVal('g-isotipoEditorial');
  siteData.global.isotipoFundacion = getVal('g-isotipoFundacion');
  siteData.global.footer.contacto.email = getVal('g-email');
  siteData.global.footer.contacto.telefono = getVal('g-telefono');
  siteData.global.footer.contacto.direccion = getVal('g-direccion');
  siteData.global.footer.redes.instagram = getVal('g-instagram');
  siteData.global.footer.redes.facebook = getVal('g-facebook');
  siteData.global.footer.redes.tiktok = getVal('g-tiktok');
  siteData.global.footer.descripcion = getVal('g-footerDesc');
  siteData.global.footer.copyright = getVal('g-copyright');
  siteData.global.gaId = getVal('g-gaId');
  saveData();
}

function saveLanding() {
  if (!siteData.landing) siteData.landing = {};
  if (!siteData.landing.hero) siteData.landing.hero = {};
  if (!siteData.landing.about) siteData.landing.about = {};
  siteData.landing.hero.titulo = getVal('l-heroTitulo');
  siteData.landing.hero.subtitulo = getVal('l-heroSubtitulo');
  siteData.landing.about.titulo = getVal('l-aboutTitulo');
  siteData.landing.about.texto = getVal('l-aboutTexto');
  siteData.landing.secciones = collectRepeater('landing-secciones', collectLandingSeccion);
  saveData();
}

function saveClinica() {
  if (!siteData.clinica) siteData.clinica = {};
  if (!siteData.clinica.banner) siteData.clinica.banner = {};
  if (!siteData.clinica.enfoque) siteData.clinica.enfoque = {};
  if (!siteData.clinica.fraseCompromiso) siteData.clinica.fraseCompromiso = {};
  siteData.clinica.banner.titulo = getVal('c-bannerTitulo');
  siteData.clinica.banner.subtitulo = getVal('c-bannerSubtitulo');
  siteData.clinica.banner.backgroundImage = getVal('c-bannerImage');
  siteData.clinica.banner.overlayOpacity = parseInt(getVal('c-bannerOverlay')) || 85;
  siteData.clinica.enfoque.titulo = getVal('c-enfoqueTitulo');
  siteData.clinica.enfoque.subtitulo = getVal('c-enfoqueSubtitulo');
  siteData.clinica.enfoque.texto = getVal('c-enfoqueTexto');
  siteData.clinica.enfoque.imagen = getVal('c-enfoqueImagen');
  siteData.clinica.fraseCompromiso.texto = getVal('c-fraseTexto');
  siteData.clinica.fraseCompromiso.autor = getVal('c-fraseAutor');
  siteData.clinica.fraseCompromiso.backgroundImage = getVal('c-fraseImage');
  siteData.clinica.fraseCompromiso.overlayOpacity = parseInt(getVal('c-fraseOverlay')) || 100;
  siteData.clinica.enfoque.pilares = collectRepeater('clinica-pilares', collectPilar);
  siteData.clinica.servicios = collectRepeater('clinica-servicios', collectServicio);
  siteData.clinica.testimonios = collectRepeater('clinica-testimonios', collectTestimonio);
  if (!siteData.clinica.formulario) siteData.clinica.formulario = {};
  saveData();
}

function saveEditorial() {
  if (!siteData.editorial) siteData.editorial = {};
  if (!siteData.editorial.banner) siteData.editorial.banner = {};
  if (!siteData.editorial.slogan) siteData.editorial.slogan = {};
  if (!siteData.editorial.countdown) siteData.editorial.countdown = {};
  if (!siteData.editorial.contacto) siteData.editorial.contacto = {};
  siteData.editorial.banner.titulo = getVal('e-bannerTitulo');
  siteData.editorial.banner.subtitulo = getVal('e-bannerSubtitulo');
  siteData.editorial.banner.backgroundImage = getVal('e-bannerImage');
  siteData.editorial.banner.overlayOpacity = parseInt(getVal('e-bannerOverlay')) || 85;
  siteData.editorial.slogan.titulo = getVal('e-sloganTitulo');
  siteData.editorial.slogan.texto = getVal('e-sloganTexto');
  siteData.editorial.countdown.titulo = getVal('e-countdownTitulo');
  siteData.editorial.countdown.fechaObjetivo = `monthly:${getVal('e-countdownDay') || 20}:${getVal('e-countdownHour') || 10}:00`;
  siteData.editorial.countdown.textoEvento = getVal('e-countdownEvento');
  siteData.editorial.countdown.backgroundImage = getVal('e-countdownImage');
  siteData.editorial.countdown.overlayOpacity = parseInt(getVal('e-countdownOverlay')) || 85;
  siteData.editorial.contacto.titulo = getVal('e-contactoTitulo');
  siteData.editorial.contacto.subtitulo = getVal('e-contactoSubtitulo');
  siteData.editorial.calugas = collectRepeater('editorial-calugas', collectCaluga);
  siteData.editorial.planes = collectRepeater('editorial-planes', collectPlan);
  siteData.editorial.testimonios = collectRepeater('editorial-testimonios', collectTestimonio);
  saveData();
}

function saveFundacion() {
  if (!siteData.fundacion) siteData.fundacion = {};
  if (!siteData.fundacion.banner) siteData.fundacion.banner = {};
  if (!siteData.fundacion.mision) siteData.fundacion.mision = {};
  if (!siteData.fundacion.queHacemos) siteData.fundacion.queHacemos = {};
  if (!siteData.fundacion.impacto) siteData.fundacion.impacto = {};
  if (!siteData.fundacion.cta) siteData.fundacion.cta = {};
  siteData.fundacion.banner.titulo = getVal('f-bannerTitulo');
  siteData.fundacion.banner.subtitulo = getVal('f-bannerSubtitulo');
  siteData.fundacion.banner.backgroundImage = getVal('f-bannerImage');
  siteData.fundacion.banner.overlayOpacity = parseInt(getVal('f-bannerOverlay')) || 85;
  siteData.fundacion.mision.titulo = getVal('f-misionTitulo');
  siteData.fundacion.mision.texto = getVal('f-misionTexto');
  siteData.fundacion.queHacemos.titulo = getVal('f-queHacemosTitulo');
  siteData.fundacion.queHacemos.texto = getVal('f-queHacemosTexto');
  siteData.fundacion.queHacemos.imagen = getVal('f-queHacemosImage');
  siteData.fundacion.cta.titulo = getVal('f-ctaTitulo');
  siteData.fundacion.cta.texto = getVal('f-ctaTexto');
  siteData.fundacion.cta.imagen = getVal('f-ctaImage');
  siteData.fundacion.mision.valores = collectRepeater('fundacion-valores', collectValor);
  siteData.fundacion.queHacemos.temas = collectRepeater('fundacion-temas', collectTema);
  siteData.fundacion.impacto.stats = collectRepeater('fundacion-stats', collectStat);
  siteData.fundacion.charlas = collectRepeater('fundacion-charlas', collectCharla);
  siteData.fundacion.galeria = collectRepeater('fundacion-galeria', collectGaleriaItem);
  saveData();
}

// ---- Visibility Toggles ----
function initVisibilityToggles() {
  const vis = siteData._visibility || {};
  document.querySelectorAll('[data-visibility]').forEach(toggle => {
    const path = toggle.getAttribute('data-visibility');
    // Check dedicated _visibility store first, then nested path
    const val = vis[path] !== undefined ? vis[path] : getNestedVal(siteData, path);
    toggle.checked = val !== false;
    const card = toggle.closest('.admin-card');
    if (card) card.classList.toggle('module-hidden', !toggle.checked);
    toggle.addEventListener('change', () => {
      const card = toggle.closest('.admin-card');
      if (card) card.classList.toggle('module-hidden', !toggle.checked);
    });
  });
}

function collectVisibilityToggles() {
  // Store all visibility flags in a dedicated _visibility object per page
  if (!siteData._visibility) siteData._visibility = {};
  document.querySelectorAll('[data-visibility]').forEach(toggle => {
    const path = toggle.getAttribute('data-visibility');
    siteData._visibility[path] = toggle.checked;
  });
}

function getNestedVal(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setNestedVal(obj, path, val) {
  const keys = path.split('.');
  let curr = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!curr[keys[i]]) curr[keys[i]] = {};
    curr = curr[keys[i]];
  }
  curr[keys[keys.length - 1]] = val;
}

// ---- Image Upload ----
function initImageUploads() {
  document.querySelectorAll('.image-upload').forEach(container => {
    const targetId = container.getAttribute('data-target');
    const currentVal = getVal(targetId);
    container.innerHTML = buildImageUploadHTML(targetId, currentVal);
    setupImageUploadEvents(container, targetId);
  });
}

function buildImageUploadHTML(targetId, currentVal) {
  const hasImage = currentVal && currentVal.length > 0;
  return `
    <div class="image-upload-tabs">
      <button class="image-upload-tab active" data-mode="file" onclick="switchImageTab(this,'file')"><i class="fa-solid fa-upload"></i> Subir archivo</button>
      <button class="image-upload-tab" data-mode="url" onclick="switchImageTab(this,'url')"><i class="fa-solid fa-link"></i> URL externa</button>
    </div>
    <div class="image-upload-body">
      <div class="image-mode-file">
        <input type="file" accept="image/*" data-for="${targetId}" onchange="handleFileUpload(this)">
      </div>
      <div class="image-mode-url" style="display:none">
        <input type="text" value="${esc(currentVal && !currentVal.startsWith('data:') ? currentVal : '')}" placeholder="https://ejemplo.com/imagen.jpg" data-url-for="${targetId}" onchange="handleUrlInput(this)">
      </div>
    </div>
    <div class="image-upload-preview ${hasImage ? '' : 'empty'}" data-preview-for="${targetId}">
      ${hasImage ? `<img src="${esc(currentVal)}">` : 'Sin imagen'}
    </div>
  `;
}

function switchImageTab(btn, mode) {
  const container = btn.closest('.image-upload');
  container.querySelectorAll('.image-upload-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  container.querySelector('.image-mode-file').style.display = mode === 'file' ? '' : 'none';
  container.querySelector('.image-mode-url').style.display = mode === 'url' ? '' : 'none';
}

function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > MAX_IMAGE_SIZE) {
    showAdminToast('La imagen excede el límite de 6MB');
    input.value = '';
    return;
  }
  const targetId = input.getAttribute('data-for');

  // Try server upload first, fallback to base64
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    uploadToServer(file, targetId);
  } else {
    // Local fallback: base64
    compressImage(file, 1200, 0.7, (compressed) => {
      setVal(targetId, compressed);
      updateImagePreview(targetId, compressed);
      showAdminToast('Imagen cargada (local)');
    });
  }
}

function uploadToServer(file, targetId) {
  showAdminToast('Comprimiendo y subiendo...');

  // Compress in browser, then upload as a file via the Worker
  compressImageToBlob(file, 1200, 0.75, (blob) => {
    showAdminToast('Subiendo al servidor...');
    const formData = new FormData();
    formData.append('file', blob, (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg');

    fetch(`${API_BASE}/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    })
    .then(r => r.json())
    .then(result => {
      if (result.ok || result.url) {
        const url = result.url || result.location;
        setVal(targetId, url);
        updateImagePreview(targetId, url);
        const origKB = Math.round(file.size / 1024);
        const compKB = Math.round((result.s || blob.size) / 1024);
        showAdminToast(`Imagen subida (${origKB}KB → ${compKB}KB)`);
      } else {
        showAdminToast('Error: ' + (result.error || 'desconocido'));
      }
    })
    .catch(() => {
      // On failure, fall back to base64-in-content
      compressImage(file, 1200, 0.75, (base64str) => {
        showAdminToast('Error de conexión. Guardando local...');
        setVal(targetId, base64str);
        updateImagePreview(targetId, base64str);
      });
    });
  });
}

function compressImageToBlob(file, maxDim, quality, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(callback, 'image/jpeg', quality);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function compressImage(file, maxDim, quality, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleUrlInput(input) {
  const targetId = input.getAttribute('data-url-for');
  setVal(targetId, input.value);
  updateImagePreview(targetId, input.value);
}

function updateImagePreview(targetId, src) {
  const preview = document.querySelector(`[data-preview-for="${targetId}"]`);
  if (!preview) return;
  if (src) {
    preview.className = 'image-upload-preview';
    preview.innerHTML = `<img src="${esc(src)}">`;
  } else {
    preview.className = 'image-upload-preview empty';
    preview.innerHTML = 'Sin imagen';
  }
}

function setupImageUploadEvents(container, targetId) {}

// ---- Submissions (from server) ----
let cachedSubmissions = [];

async function loadSubmissionsFromServer() {
  try {
    const res = await fetch(`${API_BASE}/forms`, { credentials: 'include' });
    const data = await res.json();
    const list = data.submissions || data.forms || data.items || (Array.isArray(data) ? data : []);
    cachedSubmissions = list.map(s => ({
      id: s.id,
      nombre: s.nombre,
      email: s.email,
      telefono: s.telefono,
      tipoConsulta: s.tipo_consulta || s.tipoConsulta,
      mensaje: s.comment || s.mensaje,
      timestamp: s.created_at || s.createdAt || s.timestamp,
      form: s.form_type || s.formType || s.form,
      is_read: !!parseInt(s.is_read || s.isRead || 0)
    }));
  } catch(e) { console.error('Error loading submissions:', e); }
}

function getSubmissions() {
  return cachedSubmissions;
}

function getReadStatus() {
  const status = {};
  cachedSubmissions.forEach(s => { if (s.is_read) status[s.timestamp] = true; });
  return status;
}

function setReadStatus(status) {
  // No-op: read status is managed server-side now
}

async function renderAllSubmissions() {
  await loadSubmissionsFromServer();
  ['centro', 'editorial', 'fundacion'].forEach(page => filterSubmissions(page));
  updateSidebarBadges();
}

function updateSidebarBadges() {
  const subs = getSubmissions();
  const readStatus = getReadStatus();
  const formMap = { centro: 'contactFormCentro', editorial: 'contactFormEditorial', fundacion: 'contactFormFundacion' };
  ['centro', 'editorial', 'fundacion'].forEach(page => {
    const unread = subs.filter(s => s.form === formMap[page] && !readStatus[s.timestamp]).length;
    const badge = document.getElementById('badge-' + page);
    if (badge) {
      badge.textContent = unread;
      badge.classList.toggle('has-unread', unread > 0);
    }
  });
}

function filterSubmissions(page) {
  const formMap = {
    'centro': 'contactFormCentro',
    'editorial': 'contactFormEditorial',
    'fundacion': 'contactFormFundacion'
  };
  const allSubs = getSubmissions();
  const readStatus = getReadStatus();
  const searchEl = document.getElementById(`filter-${page}-search`);
  const statusEl = document.getElementById(`filter-${page}-status`);
  const sortEl = document.getElementById(`filter-${page}-sort`);
  const container = document.getElementById(`submissions-${page}`);
  if (!container) return;

  let subs = allSubs.filter(s => s.form === formMap[page]);

  // Search filter
  const search = searchEl ? searchEl.value.toLowerCase() : '';
  if (search) {
    subs = subs.filter(s => {
      const text = Object.values(s).join(' ').toLowerCase();
      return text.includes(search);
    });
  }

  // Read/unread filter
  const statusFilter = statusEl ? statusEl.value : 'all';
  if (statusFilter === 'unread') {
    subs = subs.filter(s => !readStatus[s.timestamp]);
  } else if (statusFilter === 'read') {
    subs = subs.filter(s => readStatus[s.timestamp]);
  }

  // Sort
  const sort = sortEl ? sortEl.value : 'newest';
  subs.sort((a, b) => {
    const da = new Date(a.timestamp), db = new Date(b.timestamp);
    return sort === 'newest' ? db - da : da - db;
  });

  if (subs.length === 0) {
    container.innerHTML = '<div class="no-submissions"><i class="fa-solid fa-inbox" style="font-size:2rem;display:block;margin-bottom:12px"></i>No hay mensajes</div>';
    return;
  }

  container.innerHTML = subs.map(s => {
    const isRead = readStatus[s.timestamp];
    const nombre = s.nombre || 'Sin nombre';
    const email = s.email || '';
    const tipo = s.tipoConsulta || '';
    const preview = s.mensaje ? s.mensaje.substring(0, 100) + (s.mensaje.length > 100 ? '...' : '') : 'Sin mensaje';
    const date = new Date(s.timestamp).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const tipoTag = tipo ? `<span style="background:var(--admin-primary);color:white;padding:2px 8px;border-radius:10px;font-size:0.7rem;margin-left:6px">${esc(tipo)}</span>` : '';
    return `
      <div class="submission-card ${isRead ? 'read' : 'unread'}" onclick="openSubmission('${esc(s.timestamp)}')">
        <div class="sub-unread-dot"></div>
        <div class="sub-info">
          <div class="sub-name">${esc(nombre)} ${tipoTag}</div>
          <div class="sub-preview" style="margin-top:2px">${email ? '<strong>' + esc(email) + '</strong> — ' : ''}${esc(preview)}</div>
        </div>
        <div class="sub-date">${date}</div>
      </div>
    `;
  }).join('');
}

function openSubmission(timestamp) {
  const subs = getSubmissions();
  const sub = subs.find(s => s.timestamp === timestamp);
  if (!sub) return;

  // Mark as read on server
  if (sub.id && !sub.is_read) {
    fetch(`${API_BASE}/forms/${encodeURIComponent(sub.id)}/read`, {
      method: 'POST',
      credentials: 'include'
    }).catch(() => {});
    sub.is_read = true;
  }
  const readStatus = getReadStatus();

  const body = document.getElementById('modalBody');
  const actions = document.getElementById('modalActions');
  const date = new Date(sub.timestamp).toLocaleString('es-CL');

  let fields = '';
  if (sub.nombre) fields += modalField('Nombre', sub.nombre);
  if (sub.email) fields += modalField('Email', sub.email, `<button class="copy-btn" onclick="copyText('${esc(sub.email)}', this)"><i class="fa-solid fa-copy"></i> Copiar</button>`);
  if (sub.telefono) fields += modalField('Teléfono', sub.telefono, `<button class="copy-btn" onclick="copyText('${esc(sub.telefono)}', this)"><i class="fa-solid fa-copy"></i> Copiar</button>`);
  if (sub.tipoConsulta) fields += modalField('Tipo de consulta', sub.tipoConsulta);
  if (sub.mensaje) fields += `<div class="modal-field"><div class="modal-field-label">Mensaje</div><div class="modal-field-value message">${esc(sub.mensaje)}</div></div>`;
  fields += modalField('Fecha', date);
  fields += modalField('Formulario', sub.form);

  body.innerHTML = fields;

  const isRead = readStatus[timestamp];
  actions.innerHTML = `
    <button class="btn-admin btn-admin-outline btn-admin-sm" onclick="toggleReadStatus('${esc(timestamp)}')">
      <i class="fa-solid ${isRead ? 'fa-envelope' : 'fa-envelope-open'}"></i> ${isRead ? 'Marcar como no leído' : 'Marcar como leído'}
    </button>
    <button class="btn-admin btn-admin-sm" style="background:#E74C3C;color:white;margin-left:8px" onclick="deleteSubmission(${sub.id || 0}, '${esc(timestamp)}')">
      <i class="fa-solid fa-trash"></i> Borrar
    </button>
  `;

  document.getElementById('submissionModal').classList.add('active');
  renderAllSubmissions();
}

function modalField(label, value, extra) {
  return `<div class="modal-field"><div class="modal-field-label">${label}</div><div class="modal-field-value">${esc(value)} ${extra || ''}</div></div>`;
}

function closeModal() {
  document.getElementById('submissionModal').classList.remove('active');
}

async function deleteSubmission(id, timestamp) {
  if (!confirm('¿Eliminar este mensaje? Esta acción no se puede deshacer.')) return;
  if (id) {
    try {
      await fetch(`${API_BASE}/forms/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
    } catch(e) {}
  }
  // Remove from cache
  cachedSubmissions = cachedSubmissions.filter(s => s.timestamp !== timestamp);
  closeModal();
  renderAllSubmissions();
  showAdminToast('Mensaje eliminado');
}

function toggleReadStatus(timestamp) {
  const sub = cachedSubmissions.find(s => s.timestamp === timestamp);
  if (sub && sub.id) {
    sub.is_read = !sub.is_read;
    if (sub.is_read) {
      fetch(`${API_BASE}/forms/${encodeURIComponent(sub.id)}/read`, {
        method: 'POST',
        credentials: 'include'
      }).catch(() => {});
    }
  }
  closeModal();
  renderAllSubmissions();
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<i class="fa-solid fa-copy"></i> Copiar';
    }, 2000);
  });
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.id === 'submissionModal') closeModal();
});

// ---- Repeater Renderers ----
function renderRepeater(containerId, items, renderFn) {
  const container = document.getElementById(containerId);
  if (!container || !items) return;
  container.innerHTML = items.map((item, i) => renderFn(item, i)).join('');
}

function renderTestimonio(t, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Nombre</label><input value="${esc(t.nombre)}" data-key="nombre"></div>
      <div class="admin-field"><label>Rating (1-5)</label><input type="number" min="1" max="5" value="${t.rating}" data-key="rating"></div>
    </div>
    <div class="admin-field"><label>Texto</label><textarea data-key="texto">${esc(t.texto)}</textarea></div>
  </div>`;
}

function renderPilar(p, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field"><label>Título</label><input value="${esc(p.titulo)}" data-key="titulo"></div>
    <div class="admin-field"><label>Descripción</label><textarea data-key="descripcion">${esc(p.descripcion)}</textarea></div>
  </div>`;
}

function renderServicio(s, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Título</label><input value="${esc(s.titulo)}" data-key="titulo"></div>
      <div class="admin-field"><label>Icono FA</label><input value="${esc(s.icono)}" data-key="icono"></div>
    </div>
    <div class="admin-field"><label>Descripción</label><textarea data-key="descripcion">${esc(s.descripcion)}</textarea></div>
    <div class="admin-field"><label><input type="checkbox" ${s.destacado ? 'checked' : ''} data-key="destacado"> Destacado</label></div>
  </div>`;
}

function renderLandingSeccion(s, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Título</label><input value="${esc(s.titulo)}" data-key="titulo"></div>
      <div class="admin-field"><label>URL</label><input value="${esc(s.url)}" data-key="url"></div>
    </div>
    <div class="admin-field-row">
      <div class="admin-field"><label>Icono FA</label><input value="${esc(s.icono)}" data-key="icono"></div>
      <div class="admin-field"><label>Color (teal/green/celeste)</label><input value="${esc(s.color)}" data-key="color"></div>
    </div>
    <div class="admin-field"><label>Descripción</label><textarea data-key="descripcion">${esc(s.descripcion)}</textarea></div>
  </div>`;
}

function renderCaluga(c, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Título</label><input value="${esc(c.titulo)}" data-key="titulo"></div>
      <div class="admin-field"><label>Icono FA</label><input value="${esc(c.icono)}" data-key="icono"></div>
    </div>
    <div class="admin-field"><label>Descripción</label><textarea data-key="descripcion">${esc(c.descripcion)}</textarea></div>
  </div>`;
}

function renderPlan(p, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Nombre</label><input value="${esc(p.nombre)}" data-key="nombre"></div>
      <div class="admin-field"><label>Precio</label><input value="${esc(p.precio)}" data-key="precio"></div>
    </div>
    <div class="admin-field-row">
      <div class="admin-field"><label>Periodo</label><input value="${esc(p.periodo)}" data-key="periodo"></div>
      <div class="admin-field"><label>Botón CTA</label><input value="${esc(p.ctaTexto)}" data-key="ctaTexto"></div>
    </div>
    <div class="admin-field"><label>Descripción</label><input value="${esc(p.descripcion)}" data-key="descripcion"></div>
    <div class="admin-field"><label>Beneficios (uno por línea)</label><textarea data-key="beneficios">${p.beneficios ? p.beneficios.join('\n') : ''}</textarea></div>
    <div class="admin-field"><label><input type="checkbox" ${p.destacado ? 'checked' : ''} data-key="destacado"> Destacado</label></div>
  </div>`;
}

function renderValor(v, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Título</label><input value="${esc(v.titulo)}" data-key="titulo"></div>
      <div class="admin-field"><label>Icono FA</label><input value="${esc(v.icono)}" data-key="icono"></div>
    </div>
    <div class="admin-field"><label>Descripción</label><textarea data-key="descripcion">${esc(v.descripcion)}</textarea></div>
  </div>`;
}

function renderTema(t, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field"><label>Tema</label><input value="${esc(t)}" data-key="value"></div>
  </div>`;
}

function renderStat(s, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Número</label><input value="${esc(s.numero)}" data-key="numero"></div>
      <div class="admin-field"><label>Etiqueta</label><input value="${esc(s.label)}" data-key="label"></div>
    </div>
  </div>`;
}

function renderCharla(c, i) {
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Título</label><input value="${esc(c.titulo)}" data-key="titulo"></div>
      <div class="admin-field"><label>Fecha</label><input type="date" value="${c.fecha}" data-key="fecha"></div>
    </div>
    <div class="admin-field"><label>Lugar</label><input value="${esc(c.lugar)}" data-key="lugar"></div>
    <div class="admin-field"><label>Descripción</label><textarea data-key="descripcion">${esc(c.descripcion)}</textarea></div>
    <div class="admin-field"><label>URL Imagen</label><input value="${esc(c.imagen)}" data-key="imagen"></div>
  </div>`;
}

function renderRecurso(r, i) {
  const imgId = 'recurso-img-' + i;
  const previewId = 'recurso-preview-' + i;
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field-row">
      <div class="admin-field"><label>Título</label><input value="${esc(r.titulo)}" data-key="titulo"></div>
      <div class="admin-field"><label>Categoría</label><input value="${esc(r.categoria)}" data-key="categoria" placeholder="Libro, Artículo, Guía..."></div>
    </div>
    <div class="admin-field"><label>Descripción (usa Enter para párrafos)</label><textarea data-key="descripcion" rows="4">${esc(r.descripcion)}</textarea></div>
    <div class="admin-field-row">
      <div class="admin-field"><label>Fecha</label><input type="date" value="${r.fecha || ''}" data-key="fecha"></div>
      <div class="admin-field"><label>URL del recurso</label><input value="${esc(r.url)}" data-key="url" placeholder="https://..."></div>
    </div>
    <div class="admin-field"><label>Imagen (subir o URL)</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input value="${esc(r.imagen)}" data-key="imagen" id="${imgId}" placeholder="URL de imagen o sube una..." style="flex:1;min-width:200px">
        <label style="background:var(--admin-primary);color:white;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:0.85rem;white-space:nowrap">
          <i class="fa-solid fa-upload"></i> Subir
          <input type="file" accept="image/*" style="display:none" onchange="uploadRecursoImage(this, '${imgId}', '${previewId}')">
        </label>
      </div>
      <div id="${previewId}" style="margin-top:8px">
        ${r.imagen ? `<img src="${esc(r.imagen)}" style="max-height:120px;border-radius:8px;border:1px solid var(--admin-border)">` : ''}
      </div>
    </div>
  </div>`;
}

async function uploadRecursoImage(input, imgFieldId, previewId) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > MAX_IMAGE_SIZE) { showAdminToast('Imagen muy grande (máx 6MB)'); return; }

  // Compress image
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = async () => {
    let w = img.width, h = img.height;
    const maxDim = 1200;
    if (w > maxDim || h > maxDim) {
      if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
      else { w = Math.round(w * maxDim / h); h = maxDim; }
    }
    canvas.width = w; canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    canvas.toBlob(async (blob) => {
      const fd = new FormData();
      fd.append('file', blob, (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg');
      try {
        const res = await fetch(`${API_BASE}/upload`, {
          method: 'POST',
          credentials: 'include',
          body: fd
        });
        const data = await res.json();
        const url = data.url || data.location;
        if ((data.ok || url) && url) {
          document.getElementById(imgFieldId).value = url;
          document.getElementById(previewId).innerHTML = '<img src="' + url + '" style="max-height:120px;border-radius:8px;border:1px solid var(--admin-border)">';
          showAdminToast('Imagen subida');
        } else {
          showAdminToast('Error: ' + (data.error || 'No se pudo subir'));
        }
      } catch(e) {
        showAdminToast('Error de conexión');
      }
    }, 'image/jpeg', 0.8);
  };
  img.src = URL.createObjectURL(file);
}

function renderGaleriaItem(url, i) {
  const src = typeof url === 'string' ? url : '';
  return `<div class="repeater-item" data-index="${i}">
    <button class="remove-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
    <div class="admin-field"><label>URL de Imagen</label><input value="${esc(src)}" data-key="value" placeholder="https://ejemplo.com/foto.jpg"></div>
    ${src ? `<div style="margin-top:8px;max-height:80px;overflow:hidden;border-radius:6px"><img src="${esc(src)}" style="max-width:100%;max-height:80px;object-fit:cover"></div>` : ''}
  </div>`;
}

// ---- Collectors ----
function collectRepeater(containerId, collectFn) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('.repeater-item')).map(collectFn);
}

function collectTestimonio(el) {
  return { nombre: el.querySelector('[data-key="nombre"]').value, texto: el.querySelector('[data-key="texto"]').value, rating: parseInt(el.querySelector('[data-key="rating"]').value) || 5 };
}
function collectPilar(el) {
  return { titulo: el.querySelector('[data-key="titulo"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value };
}
function collectServicio(el) {
  return { titulo: el.querySelector('[data-key="titulo"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value, icono: el.querySelector('[data-key="icono"]').value, destacado: el.querySelector('[data-key="destacado"]').checked };
}
function collectLandingSeccion(el) {
  return { titulo: el.querySelector('[data-key="titulo"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value, icono: el.querySelector('[data-key="icono"]').value, url: el.querySelector('[data-key="url"]').value, color: el.querySelector('[data-key="color"]').value };
}
function collectCaluga(el) {
  return { titulo: el.querySelector('[data-key="titulo"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value, icono: el.querySelector('[data-key="icono"]').value };
}
function collectPlan(el) {
  return { nombre: el.querySelector('[data-key="nombre"]').value, precio: el.querySelector('[data-key="precio"]').value, periodo: el.querySelector('[data-key="periodo"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value, beneficios: el.querySelector('[data-key="beneficios"]').value.split('\n').filter(b => b.trim()), destacado: el.querySelector('[data-key="destacado"]').checked, ctaTexto: el.querySelector('[data-key="ctaTexto"]').value };
}
function collectValor(el) {
  return { titulo: el.querySelector('[data-key="titulo"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value, icono: el.querySelector('[data-key="icono"]').value };
}
function collectTema(el) { return el.querySelector('[data-key="value"]').value; }
function collectRecurso(el) {
  return { titulo: el.querySelector('[data-key="titulo"]').value, categoria: el.querySelector('[data-key="categoria"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value, fecha: el.querySelector('[data-key="fecha"]').value, url: el.querySelector('[data-key="url"]').value, imagen: el.querySelector('[data-key="imagen"]').value };
}
function collectGaleriaItem(el) { return el.querySelector('[data-key="value"]').value; }
function collectStat(el) {
  return { numero: el.querySelector('[data-key="numero"]').value, label: el.querySelector('[data-key="label"]').value };
}
function collectCharla(el) {
  return { titulo: el.querySelector('[data-key="titulo"]').value, fecha: el.querySelector('[data-key="fecha"]').value, lugar: el.querySelector('[data-key="lugar"]').value, descripcion: el.querySelector('[data-key="descripcion"]').value, imagen: el.querySelector('[data-key="imagen"]').value };
}

// ---- Add Item Functions ----
function addTestimonio(containerId) {
  const c = document.getElementById(containerId);
  c.insertAdjacentHTML('beforeend', renderTestimonio({ nombre: '', texto: '', rating: 5 }, c.children.length));
}
function addPilar() {
  const c = document.getElementById('clinica-pilares');
  c.insertAdjacentHTML('beforeend', renderPilar({ titulo: '', descripcion: '' }, c.children.length));
}
function addServicio() {
  const c = document.getElementById('clinica-servicios');
  c.insertAdjacentHTML('beforeend', renderServicio({ titulo: '', descripcion: '', icono: 'fa-star', destacado: false }, c.children.length));
}
function addCaluga() {
  const c = document.getElementById('editorial-calugas');
  c.insertAdjacentHTML('beforeend', renderCaluga({ titulo: '', descripcion: '', icono: 'fa-star' }, c.children.length));
}
function addPlan() {
  const c = document.getElementById('editorial-planes');
  c.insertAdjacentHTML('beforeend', renderPlan({ nombre: '', precio: '', periodo: '/mes', descripcion: '', beneficios: [], destacado: false, ctaTexto: 'Elegir plan' }, c.children.length));
}
function addValor() {
  const c = document.getElementById('fundacion-valores');
  c.insertAdjacentHTML('beforeend', renderValor({ titulo: '', descripcion: '', icono: 'fa-star' }, c.children.length));
}
function addTema() {
  const c = document.getElementById('fundacion-temas');
  c.insertAdjacentHTML('beforeend', renderTema('', c.children.length));
}
function addStat() {
  const c = document.getElementById('fundacion-stats');
  c.insertAdjacentHTML('beforeend', renderStat({ numero: '', label: '' }, c.children.length));
}
function addCharla() {
  const c = document.getElementById('fundacion-charlas');
  c.insertAdjacentHTML('beforeend', renderCharla({ titulo: '', fecha: '', lugar: '', descripcion: '', imagen: '' }, c.children.length));
}
function addRecurso() {
  const c = document.getElementById('recursos-items');
  c.insertAdjacentHTML('beforeend', renderRecurso({ titulo: '', categoria: '', descripcion: '', fecha: '', url: '', imagen: '' }, c.children.length));
}
function addGaleriaItem() {
  const c = document.getElementById('fundacion-galeria');
  c.insertAdjacentHTML('beforeend', renderGaleriaItem('', c.children.length));
}
function addLandingSeccion() {
  const c = document.getElementById('landing-secciones');
  c.insertAdjacentHTML('beforeend', renderLandingSeccion({ titulo: '', descripcion: '', icono: 'fa-star', url: '', color: 'teal' }, c.children.length));
}

// ---- Helpers ----
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

// ---- Dashboard ----
async function populateDashboard() {
  // Load page visibility into dashboard toggles
  const pageVis = siteData?.global?.pageVisibility || {};
  document.querySelectorAll('#dash-page-toggles [data-page-visibility]').forEach(cb => {
    cb.checked = pageVis[cb.getAttribute('data-page-visibility')] !== false;
  });

  // Load submissions from server first
  await loadSubmissionsFromServer();
  const subs = getSubmissions();
  const readStatus = getReadStatus();
  const formMap = { centro: 'contactFormCentro', editorial: 'contactFormEditorial', fundacion: 'contactFormFundacion' };

  ['centro', 'editorial', 'fundacion'].forEach(page => {
    const pageSubs = subs.filter(s => s.form === formMap[page]);
    const unread = pageSubs.filter(s => !readStatus[s.timestamp]).length;
    const el = document.getElementById('dash-unread-' + page);
    const label = document.getElementById('dash-unread-' + page + '-label');
    if (el) el.textContent = pageSubs.length;
    if (label) label.textContent = unread > 0 ? unread + ' sin leer' : 'todo leído';
    if (label) label.style.color = unread > 0 ? 'var(--admin-danger)' : 'var(--admin-green)';
  });

  // Page view stats from localStorage
  const stats = JSON.parse(localStorage.getItem('mentisviva_stats') || '{}');
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  let viewsToday = 0, viewsWeek = 0, viewsMonth = 0, viewsTotal = 0;
  const pageBreakdown = {};

  Object.entries(stats).forEach(([date, pages]) => {
    const d = new Date(date);
    const daysDiff = Math.floor((now - d) / 86400000);
    const total = Object.values(pages).reduce((s, v) => s + v, 0);

    if (date === today) viewsToday = total;
    if (daysDiff < 7) viewsWeek += total;
    if (daysDiff < 30) viewsMonth += total;
    viewsTotal += total;

    Object.entries(pages).forEach(([page, count]) => {
      if (!pageBreakdown[page]) pageBreakdown[page] = 0;
      pageBreakdown[page] += count;
    });
  });

  document.getElementById('dash-views-today').textContent = viewsToday;
  document.getElementById('dash-views-week').textContent = viewsWeek;
  document.getElementById('dash-views-month').textContent = viewsMonth;
  document.getElementById('dash-views-total').textContent = viewsTotal;

  // Page breakdown
  const breakdownEl = document.getElementById('dash-page-breakdown');
  if (breakdownEl) {
    const sorted = Object.entries(pageBreakdown).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      breakdownEl.innerHTML = '<p style="color:var(--admin-muted)">Aún no hay datos de visitas.</p>';
    } else {
      const max = sorted[0][1];
      breakdownEl.innerHTML = sorted.map(([page, count]) => {
        const pct = Math.round(count / max * 100);
        const label = page.replace('.html', '').replace('index', 'Inicio');
        return `<div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>${label}</span><strong>${count}</strong></div>
          <div style="height:8px;background:var(--admin-bg);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--admin-primary);border-radius:4px"></div></div>
        </div>`;
      }).join('');
    }
  }

  // GA status
  const gaStatus = document.getElementById('dash-ga-status');
  if (gaStatus) {
    const gaId = siteData?.global?.gaId;
    if (gaId && gaId.trim()) {
      gaStatus.innerHTML = `<p style="color:var(--admin-green)"><i class="fa-solid fa-check-circle"></i> Google Analytics activo: <strong>${esc(gaId)}</strong></p>
        <p style="font-size:0.82rem;color:var(--admin-muted);margin-top:8px">Para ver el dashboard completo, visita <a href="https://analytics.google.com" target="_blank" style="color:var(--admin-primary)">analytics.google.com</a></p>`;
    } else {
      gaStatus.innerHTML = `<p style="color:var(--admin-muted)"><i class="fa-solid fa-exclamation-circle"></i> Google Analytics no configurado.</p>
        <p style="font-size:0.82rem;color:var(--admin-muted);margin-top:8px">Configura tu ID de medición en <strong>Configuración Global &gt; Google Analytics</strong> para obtener datos reales de visitas.</p>`;
    }
  }
}

// ---- Page Visibility (quick save from dashboard) ----
function savePageVisibility() {
  if (!siteData.global) siteData.global = {};
  siteData.global.pageVisibility = {};
  document.querySelectorAll('[data-page-visibility]').forEach(cb => {
    siteData.global.pageVisibility[cb.getAttribute('data-page-visibility')] = cb.checked;
  });
  try {
    localStorage.setItem('mentisviva_content', JSON.stringify(siteData));
    showAdminToast('Visibilidad actualizada. Haz clic en Publicar para aplicar en mentisviva.cl');
  } catch(e) {
    showAdminToast('Error al guardar');
  }
}

// ---- Publish ----
// Cookie auth via /api/admin/login. No more in-memory hashes.

async function publishContent() {
  if (!siteData) {
    showAdminToast('No hay datos para publicar');
    return;
  }

  // Save current page first
  collectVisibilityToggles();
  const fn = saveFunctions[currentPage];
  if (fn) fn();

  const json = JSON.stringify(siteData, null, 2);
  const sizeMB = (json.length / 1024 / 1024).toFixed(2);

  if (json.length > 10 * 1024 * 1024) {
    showAdminToast('Contenido muy grande (' + sizeMB + 'MB). Reduce imágenes.');
    return;
  }

  showAdminToast('Publicando...');

  try {
    // 1. Save the full content payload
    const saveRes = await fetch(`${API_BASE}/save`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: json
    });

    let saveResult = {};
    try { saveResult = await saveRes.json(); } catch(_) {}
    if (!saveRes.ok || saveResult.ok === false || saveResult.success === false) {
      showAdminToast('Error al guardar: ' + (saveResult.error || saveRes.status));
      return;
    }

    // 2. Trigger publish to KV / Pages
    const pubRes = await fetch(`${API_BASE}/publish`, {
      method: 'POST',
      credentials: 'include'
    });

    let pubResult = {};
    try { pubResult = await pubRes.json(); } catch(_) {}

    if (pubRes.ok && pubResult.ok !== false && pubResult.success !== false) {
      showAdminToast('Publicado en mentisviva.cl (' + sizeMB + 'MB)');
    } else {
      showAdminToast('Error al publicar: ' + (pubResult.error || pubRes.status) + '. Descargando archivo...');
      downloadContentJson(json);
      showPublishInstructions();
    }
  } catch (e) {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
      showAdminToast('Publicación automática solo funciona en el hosting (mentisviva.cl). Descargando archivo...');
      downloadContentJson(json);
      showPublishInstructions();
    } else {
      showAdminToast('Error de conexión. Reintentando...');
      try {
        const saveRes2 = await fetch(`${API_BASE}/save`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: json
        });
        const pubRes2 = await fetch(`${API_BASE}/publish`, {
          method: 'POST',
          credentials: 'include'
        });
        if (saveRes2.ok && pubRes2.ok) {
          showAdminToast('Publicado en mentisviva.cl (' + sizeMB + 'MB)');
        } else {
          showAdminToast('Error al publicar tras reintento');
          downloadContentJson(json);
        }
      } catch (e2) {
        showAdminToast('No se pudo publicar. Verifica el backend en api.mentisviva.cl');
        downloadContentJson(json);
      }
    }
  }
}

function downloadContentJson(json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'content.json';
  a.click();
  URL.revokeObjectURL(url);
}

function showPublishInstructions() {
  const body = document.getElementById('modalBody');
  const actions = document.getElementById('modalActions');

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <i class="fa-solid fa-rocket" style="font-size:2.5rem;color:var(--admin-primary)"></i>
      <h3 style="margin-top:12px;font-size:1.1rem">Publicar cambios en mentisviva.cl</h3>
    </div>
    <div class="modal-field">
      <div class="modal-field-label">Paso 1</div>
      <div class="modal-field-value">El archivo <strong>content.json</strong> se descargó automáticamente.</div>
    </div>
    <div class="modal-field">
      <div class="modal-field-label">Paso 2</div>
      <div class="modal-field-value">Entra al <strong>File Manager</strong> de tu cPanel en el hosting.</div>
    </div>
    <div class="modal-field">
      <div class="modal-field-label">Paso 3</div>
      <div class="modal-field-value">Navega a <strong>public_html/data/</strong></div>
    </div>
    <div class="modal-field">
      <div class="modal-field-label">Paso 4</div>
      <div class="modal-field-value">Sube el archivo <strong>content.json</strong> descargado, reemplazando el existente.</div>
    </div>
    <div class="modal-field">
      <div class="modal-field-label">Paso 5</div>
      <div class="modal-field-value">Listo. Los cambios estarán visibles en <a href="https://mentisviva.cl" target="_blank" style="color:var(--admin-primary)">mentisviva.cl</a> inmediatamente.</div>
    </div>
    <div style="margin-top:16px;padding:12px;background:#FFF8E1;border-radius:8px;font-size:0.85rem">
      <strong><i class="fa-solid fa-lightbulb" style="color:#E6A817"></i> Importante:</strong> Las imágenes subidas desde el CMS se guardan dentro del content.json. Si el archivo es muy pesado (>5MB), considera usar URLs externas para las imágenes.
    </div>
  `;

  actions.innerHTML = `<button class="btn-admin btn-admin-primary" onclick="closeModal()">Entendido</button>`;
  document.getElementById('submissionModal').classList.add('active');
}

// ---- Subscribers ----
let currentSubFilter = 'all';

async function checkPlanConsistency() {
  const el = document.getElementById('planConsistencyResult');
  el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
  try {
    const res = await fetch(`${API_BASE}/subscribers?action=check_plans`, {
      credentials: 'include'
    });
    const d = await res.json();
    if (d.ok) {
      if (d.issues_found === 0) {
        el.innerHTML = '<div style="padding:16px;background:#E8F5E9;border-radius:8px;color:#2E7D32"><i class="fa-solid fa-circle-check" style="margin-right:8px"></i><strong>Todo correcto.</strong> ' + d.total_active + ' suscriptores activos de ' + d.total_users + ' usuarios totales. No se encontraron inconsistencias.</div>';
      } else {
        let html = '<div style="padding:16px;background:#FFF3E0;border-radius:8px;color:#E65100;margin-bottom:12px"><i class="fa-solid fa-exclamation-triangle" style="margin-right:8px"></i><strong>' + d.issues_found + ' problemas encontrados.</strong> ' + d.auto_fixed + ' corregidos automáticamente.</div>';
        if (d.missing_plan && d.missing_plan.length > 0) {
          html += '<p style="font-weight:600;margin:12px 0 8px;font-size:0.85rem">Usuarios con cobros activos pero sin plan (corregidos):</p>';
          d.missing_plan.forEach(u => {
            html += '<div style="padding:8px 12px;background:var(--admin-bg);border-radius:6px;margin-bottom:4px;font-size:0.85rem"><strong>' + esc(u.nombre) + ' ' + esc(u.apellido) + '</strong> (' + esc(u.email) + ') → Plan restaurado a: ' + esc(u.order_plan) + '</div>';
          });
        }
        if (d.missing_orders && d.missing_orders.length > 0) {
          html += '<p style="font-weight:600;margin:12px 0 8px;font-size:0.85rem;color:#E65100">Usuarios con plan activo pero sin cobros (requiere revisión manual):</p>';
          d.missing_orders.forEach(u => {
            html += '<div style="padding:8px 12px;background:#FFF8E1;border-radius:6px;margin-bottom:4px;font-size:0.85rem"><strong>' + esc(u.nombre) + ' ' + esc(u.apellido) + '</strong> (' + esc(u.email) + ') — Plan: ' + esc(u.plan_nombre || 'NULL') + '</div>';
          });
        }
        html += '<p style="font-size:0.8rem;color:var(--admin-muted);margin-top:12px">' + d.total_active + ' activos de ' + d.total_users + ' totales</p>';
        el.innerHTML = html;
      }
    } else {
      el.innerHTML = '<span style="color:#E74C3C">Error: ' + (d.error || '') + '</span>';
    }
  } catch(e) {
    el.innerHTML = '<span style="color:#E74C3C">Error de conexión</span>';
  }
}

function loadSubscribers(filter) {
  currentSubFilter = filter || 'all';

  // Highlight active filter
  document.querySelectorAll('[id^="sub-filter-"]').forEach(el => {
    el.style.borderColor = el.id === 'sub-filter-' + currentSubFilter ? 'var(--admin-primary)' : 'var(--admin-border)';
  });

  const url = `${API_BASE}/subscribers?filter=${encodeURIComponent(currentSubFilter)}`;
  fetch(url, { credentials: 'include' })
    .then(r => r.json())
    .then(d => {
      // Some Workers return { ok: true, users, counts }; others return arrays directly.
      if (d && d.ok === false) {
        document.getElementById('subscribersTable').innerHTML = '<p style="color:var(--admin-danger)">Error: ' + (d.error||'') + '</p>';
        return;
      }

      // Update counts
      if (d.counts) {
        document.getElementById('sub-count-total').textContent = d.counts.total || 0;
        document.getElementById('sub-count-active').textContent = d.counts.active || 0;
        document.getElementById('sub-count-pending').textContent = d.counts.pending || 0;
        document.getElementById('sub-count-cancelled').textContent = d.counts.cancelled || 0;
        document.getElementById('sub-count-none').textContent = d.counts.none || 0;
      }

      const users = d.users || d.subscribers || (Array.isArray(d) ? d : []);
      if (users.length === 0) {
        document.getElementById('subscribersTable').innerHTML = '<p style="color:var(--admin-muted);text-align:center;padding:30px">No hay suscriptores con este filtro</p>';
        return;
      }

      const statusMap = { active: 'Activo', pending: 'Pendiente', cancelled: 'Cancelado', none: 'Sin plan' };
      const statusColors = { active: 'var(--admin-green)', pending: '#E6A817', cancelled: 'var(--admin-danger)', none: 'var(--admin-muted)' };

      let html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;min-width:1000px">';
      html += '<thead><tr style="background:var(--admin-bg);text-align:left">';
      html += '<th style="padding:10px 12px">Nombre</th>';
      html += '<th style="padding:10px 12px">Email</th>';
      html += '<th style="padding:10px 12px">Teléfono</th>';
      html += '<th style="padding:10px 12px">Dirección</th>';
      html += '<th style="padding:10px 12px">Comuna</th>';
      html += '<th style="padding:10px 12px">Plan</th>';
      html += '<th style="padding:10px 12px">Envío</th>';
      html += '<th style="padding:10px 12px">Cobro del mes</th>';
      html += '<th style="padding:10px 12px">Suscripción</th>';
      html += '<th style="padding:10px 12px">Registro</th>';
      html += '</tr></thead><tbody>';

      users.forEach(u => {
        const status = u.plan_status || 'none';
        const color = statusColors[status] || 'var(--admin-muted)';
        const date = new Date(u.created_at).toLocaleDateString('es-CL');
        const addr = [u.direccion, u.numero].filter(Boolean).join(' ') + (u.depto ? ', Depto ' + u.depto : '');
        const shipping = u.shipping_method ? u.shipping_method + ' ($' + Number(u.shipping_cost || 0).toLocaleString('es-CL') + ')' : '-';
        const paymentVerified = parseInt(u.payment_verified || 0);
        const paymentIcon = status === 'active'
          ? (paymentVerified ? '<span style="color:var(--admin-green);font-weight:600">&#x2705; Cobrado</span>' : '<span style="color:#E6A817;font-weight:600">&#x23F3; Por cobrar</span>')
          : (status === 'none' ? '<span style="color:var(--admin-muted)">Sin plan</span>' : '<span style="color:var(--admin-muted)">-</span>');
        html += `<tr style="border-bottom:1px solid var(--admin-border)">
          <td style="padding:10px 12px;font-weight:500">${esc(u.nombre)} ${esc(u.apellido)}</td>
          <td style="padding:10px 12px">${esc(u.email)}</td>
          <td style="padding:10px 12px">${esc(u.telefono || '-')}</td>
          <td style="padding:10px 12px;font-size:0.8rem">${esc(addr || '-')}</td>
          <td style="padding:10px 12px">${esc(u.comuna || '-')}</td>
          <td style="padding:10px 12px">${esc(u.plan_nombre || 'Sin plan')}</td>
          <td style="padding:10px 12px;font-size:0.8rem">${shipping}</td>
          <td style="padding:10px 12px;font-size:0.8rem">${paymentIcon}</td>
          <td style="padding:10px 12px"><span style="color:${color};font-weight:600">${statusMap[status] || status}</span></td>
          <td style="padding:10px 12px;color:var(--admin-muted)">${date}</td>
        </tr>`;
      });

      html += '</tbody></table></div>';
      document.getElementById('subscribersTable').innerHTML = html;
    })
    .catch(() => {
      document.getElementById('subscribersTable').innerHTML = '<p style="color:var(--admin-danger)">Error de conexión</p>';
    });
}

function exportSubscribers() {
  // The export endpoint is a GET that streams a CSV. The Worker validates the
  // session cookie, so this opens a same-cookie browser context.
  window.open(`${API_BASE}/subscribers/export.csv`, '_blank');
}

// ---- Shipping/Roster Management ----
// NOTE: The Cloudflare Worker backend does not yet expose shipping endpoints.
// Every operation below stubs out with a "pending implementation" toast until
// /api/admin/shipping/* (or equivalent) is added on the Worker.

async function loadRoster() {
  // No backend endpoint yet - clear the table and inform the user.
  const tbody = document.getElementById('rosterTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--text-muted)">Funcionalidad pendiente de implementación en backend.</td></tr>';
  }
  ['rosterTotal', 'rosterQueued', 'rosterShipped', 'rosterDelivered'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '-';
  });
}

function renderRoster(roster, counts) {
  // Kept for compatibility; not invoked while the backend is missing.
  const tbody = document.getElementById('rosterTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--text-muted)">Funcionalidad pendiente de implementación en backend.</td></tr>';
  }
}

async function generateRoster() {
  shippingNotImplemented();
}

async function createShipitShipments() {
  shippingNotImplemented();
}

async function updateShipitTracking() {
  shippingNotImplemented();
}

function exportRoster() {
  shippingNotImplemented();
}

async function deleteRosterEntry(id) {
  shippingNotImplemented();
}

async function clearRoster() {
  shippingNotImplemented();
}

async function loadShippingConfig() {
  // Silent stub: clear any pre-existing form values without shouting at the user
  // every time they navigate to the shipping page.
  ['cfgWidth','cfgHeight','cfgLength','cfgWeight','cfgOrigin','cfgShipDay','cfgCutoffDays','cfgNotifyDays','cfgMinShipping'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function saveShippingConfig() {
  shippingNotImplemented();
}

// ---- Survey/CSAT Management ----

async function loadSurveyResults(month) {
  if (!month) month = document.getElementById('surveyMonth').value;
  const params = new URLSearchParams();
  if (month && month !== 'all') params.append('month', month);
  const url = `${API_BASE}/surveys${params.toString() ? '?' + params.toString() : ''}`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (data && data.ok !== false) renderSurveyResults(data);
  } catch (e) { showAdminToast('Error cargando encuestas'); }
}

function loadSurveyResultsAll() {
  document.getElementById('surveyMonth').value = '';
  loadSurveyResults('all');
}

function renderSurveyResults(data) {
  const delivery = data.by_type?.delivery || {};
  const content = data.by_type?.content || {};

  document.getElementById('csatDeliveryAvg').textContent = delivery.average ? parseFloat(delivery.average).toFixed(1) + '/5' : '-';
  document.getElementById('csatDeliveryCount').textContent = (delivery.responded || 0) + ' respuestas';
  document.getElementById('csatContentAvg').textContent = content.average ? parseFloat(content.average).toFixed(1) + '/5' : '-';
  document.getElementById('csatContentCount').textContent = (content.responded || 0) + ' respuestas';

  const totalSent = (delivery.sent || 0) + (content.sent || 0);
  const totalResp = (delivery.responded || 0) + (content.responded || 0);
  const rate = totalSent > 0 ? Math.round((totalResp / totalSent) * 100) : 0;
  document.getElementById('csatResponseRate').textContent = rate + '%';
  document.getElementById('csatResponseDetail').textContent = totalResp + '/' + totalSent + ' encuestas';

  renderDistBars('csatDeliveryBars', delivery.distribution || {}, '#2B8A9E');
  renderDistBars('csatContentBars', content.distribution || {}, '#7AC94F');
  renderCsatComments(data.responses || []);
}

function renderDistBars(id, dist, color) {
  const el = document.getElementById(id);
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  const emojis = {5:'\u{1F929}', 4:'\u{1F60A}', 3:'\u{1F610}', 2:'\u{1F615}', 1:'\u{1F61F}'};
  let html = '';
  for (let i = 5; i >= 1; i--) {
    const cnt = dist[i] || 0;
    const pct = Math.round((cnt / total) * 100);
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      + '<span style="width:28px;text-align:center;font-size:1.2rem">' + emojis[i] + '</span>'
      + '<div style="flex:1;background:var(--gray-100);border-radius:4px;height:24px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:4px;transition:width 0.5s"></div>'
      + '</div>'
      + '<span style="width:75px;font-size:0.8rem;color:var(--text-muted);text-align:right">' + cnt + ' (' + pct + '%)</span>'
      + '</div>';
  }
  el.innerHTML = html || '<p style="color:var(--text-muted);text-align:center;padding:12px">Sin datos</p>';
}

function renderCsatComments(responses) {
  const el = document.getElementById('csatComments');
  const withComments = responses.filter(r => r.comment && r.comment.trim());
  if (!withComments.length) {
    el.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">No hay comentarios</p>';
    return;
  }
  const emojis = {5:'\u{1F929}', 4:'\u{1F60A}', 3:'\u{1F610}', 2:'\u{1F615}', 1:'\u{1F61F}'};
  const typeLabels = {delivery:'Entrega', content:'Contenido'};
  el.innerHTML = withComments.slice(0, 50).map(r => {
    const date = r.responded_at ? new Date(r.responded_at).toLocaleDateString('es-CL') : '';
    return '<div style="padding:16px;border-bottom:1px solid var(--gray-100)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      + '<strong>' + esc((r.nombre||'') + ' ' + (r.apellido||'')) + '</strong>'
      + '<div><span style="font-size:0.8rem;color:var(--text-muted)">' + (typeLabels[r.survey_type]||'') + '</span>'
      + ' <span>' + (emojis[r.score]||'') + ' ' + r.score + '/5</span></div></div>'
      + '<p style="font-size:0.95rem;color:var(--text-secondary);line-height:1.6;margin:0">“' + esc(r.comment) + '”</p>'
      + '<span style="font-size:0.75rem;color:var(--text-muted)">' + date + ' · ' + (r.shipment_month||'') + '</span></div>';
  }).join('');
}

function showAdminToast(msg) {
  let toast = document.querySelector('.admin-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'admin-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show', 'success');
  setTimeout(() => toast.classList.remove('show', 'success'), 3000);
}
