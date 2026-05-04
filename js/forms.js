/* ========================================
   MentisViva - Form Handling (Secure)
   ======================================== */

function initContactForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  // Add honeypot field (hidden from users, bots fill it)
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = '_hp_field';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.style.cssText = 'position:absolute;left:-9999px;top:-9999px;opacity:0;height:0;width:0;pointer-events:none;';
  form.appendChild(honeypot);

  // Track form load time (bots submit instantly)
  const loadTime = Date.now();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Anti-bot checks
    if (honeypot.value) return;
    if (Date.now() - loadTime < 3000) {
      showToast('Por favor espera un momento antes de enviar', 'error');
      return;
    }

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    delete data._hp_field;

    // Sanitize all inputs
    Object.keys(data).forEach(key => {
      data[key] = sanitizeInput(data[key]);
    });

    // Validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!data.email || !emailRegex.test(data.email.trim())) {
      showToast('Ingresa un correo válido (ej: nombre@correo.cl)', 'error');
      return;
    }
    if (!data.nombre || data.nombre.trim().length < 2) {
      showToast('Por favor ingresa tu nombre completo', 'error');
      return;
    }
    if (data.nombre.length > 200) {
      showToast('El nombre es demasiado largo', 'error');
      return;
    }
    if (data.mensaje && data.mensaje.length > 5000) {
      showToast('El mensaje es demasiado largo (máx 5000 caracteres)', 'error');
      return;
    }
    if (data.telefono) {
      const phone = data.telefono.replace(/\s/g, '');
      if (phone.length > 3) {
        const phoneRegex = /^\+\d{10,15}$/;
        if (!phoneRegex.test(phone)) {
          showToast('Ingresa un teléfono válido (ej: +56 9 1234 5678)', 'error');
          return;
        }
      }
    }

    // Rate limit: max 3 submissions per 10 minutes
    const recentSubs = JSON.parse(sessionStorage.getItem('mv_form_times') || '[]');
    const tenMinAgo = Date.now() - 600000;
    const recent = recentSubs.filter(t => t > tenMinAgo);
    if (recent.length >= 3) {
      showToast('Has enviado demasiados mensajes. Intenta más tarde.', 'error');
      return;
    }
    recent.push(Date.now());
    sessionStorage.setItem('mv_form_times', JSON.stringify(recent));

    // reCAPTCHA token (opcional — si está cargado en la página)
    let recaptchaToken = '';
    try {
      if (typeof grecaptcha !== 'undefined' && grecaptcha.execute) {
        recaptchaToken = await new Promise((resolve) => {
          grecaptcha.ready(() => {
            grecaptcha.execute('6LemE68sAAAAAGellDaWBKrXxYKJ1mu30SK8V1r0', { action: 'contact' })
              .then(resolve, () => resolve(''));
          });
        });
      }
    } catch (_) {}

    // Submit to Cloudflare Worker (api.mentisviva.cl)
    // El backend espera: nombre, email, telefono, mensaje, source, website (honeypot), recaptcha_token
    try {
      const payload = {
        nombre: data.nombre || '',
        email: data.email || '',
        telefono: data.telefono || '',
        mensaje: data.mensaje || data.consulta || data.tipoConsulta || '',
        source: formId,
        website: honeypot.value, // backend espera "website" como honeypot
        recaptcha_token: recaptchaToken,
      };
      // Mantener cualquier campo extra del formulario sin sobreescribir los anteriores
      Object.entries(data).forEach(([k, v]) => {
        if (!(k in payload) && k !== '_hp_field') payload[k] = v;
      });

      const res = await fetch('https://api.mentisviva.cl/api/forms/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));

      if (res.ok && result.ok !== false) {
        showToast(result.message || 'Mensaje enviado correctamente. Nos pondremos en contacto pronto.', 'success');
        form.reset();
      } else {
        throw new Error(result.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      // Fallback offline: guarda en localStorage para no perder el mensaje del usuario
      const submissions = JSON.parse(localStorage.getItem('mentisviva_submissions') || '[]');
      submissions.push({ ...data, timestamp: new Date().toISOString(), form: formId });
      localStorage.setItem('mentisviva_submissions', JSON.stringify(submissions));
      showToast('No pudimos enviar tu mensaje (sin conexión). Quedó guardado y reintentaremos pronto.', 'success');
      form.reset();
    }
  });
}

// Sanitize user input - strip HTML tags and dangerous characters
function sanitizeInput(str) {
  if (!str) return '';
  return String(str)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .trim();
}
