/* ========================================
   MentisViva - Countdown Timer
   Supports both fixed date and monthly recurrence
   ======================================== */

function initCountdown(targetDate) {
  const daysEl = document.getElementById('countdown-days');
  const hoursEl = document.getElementById('countdown-hours');
  const minutesEl = document.getElementById('countdown-minutes');
  const secondsEl = document.getElementById('countdown-seconds');

  if (!daysEl || !hoursEl || !minutesEl || !secondsEl) return;

  function getNextTarget() {
    // Check if targetDate is a monthly config (e.g. "monthly:20:10:00")
    if (typeof targetDate === 'string' && targetDate.startsWith('monthly:')) {
      const parts = targetDate.split(':');
      const day = parseInt(parts[1]) || 20;
      const hour = parseInt(parts[2]) || 0;
      const minute = parseInt(parts[3]) || 0;

      const now = new Date();
      let target = new Date(now.getFullYear(), now.getMonth(), day, hour, minute, 0);

      // If already passed this month, go to next month
      if (target.getTime() <= now.getTime()) {
        target.setMonth(target.getMonth() + 1);
      }
      return target.getTime();
    }
    // Fallback: fixed date
    return new Date(targetDate).getTime();
  }

  let target = getNextTarget();

  function update() {
    const now = new Date().getTime();
    let diff = target - now;

    // If countdown reached zero, recalculate for next month
    if (diff <= 0) {
      target = getNextTarget();
      diff = target - now;
    }

    if (diff <= 0) {
      daysEl.textContent = '00';
      hoursEl.textContent = '00';
      minutesEl.textContent = '00';
      secondsEl.textContent = '00';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    daysEl.textContent = String(days).padStart(2, '0');
    hoursEl.textContent = String(hours).padStart(2, '0');
    minutesEl.textContent = String(minutes).padStart(2, '0');
    secondsEl.textContent = String(seconds).padStart(2, '0');
  }

  update();
  setInterval(update, 1000);
}
