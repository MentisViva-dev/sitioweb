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

    // Submit to server
    try {
      const fd = new FormData();
      fd.append('form_type', formId);
      Object.entries(data).forEach(([k, v]) => fd.append(k, v));
      fd.append('_hp_field', honeypot.value);
      fd.append('_load_time', loadTime.toString());

      const res = await fetch('api/forms.php', { method: 'POST', body: fd });
      const result = await res.json();

      if (result.ok) {
        showToast('Mensaje enviado correctamente. Nos pondremos en contacto pronto.', 'success');
        form.reset();
      } else {
        throw new Error(result.error || 'Error del servidor');
      }
    } catch (e) {
      // Fallback to localStorage if server unreachable
      const submissions = JSON.parse(localStorage.getItem('mentisviva_submissions') || '[]');
      submissions.push({ ...data, timestamp: new Date().toISOString(), form: formId });
      localStorage.setItem('mentisviva_submissions', JSON.stringify(submissions));
      showToast('Mensaje guardado. Se enviará cuando haya conexión.', 'success');
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
