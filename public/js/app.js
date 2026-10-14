/* ============================================================
   XOLANI DRIVING SCHOOL — MAIN APP JS
   ============================================================ */

// ─── PAGE LOADER ────────────────────────────────────────────
window.addEventListener('load', () => {
  const loader = document.getElementById('page-loader');
  if (loader) { loader.classList.add('hidden'); setTimeout(() => loader.remove(), 400); }
});

// ─── TOAST ──────────────────────────────────────────────────
const Toast = (() => {
  let container;
  function getContainer() {
    if (!container) {
      container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        container.id = 'toast-container';
        document.body.appendChild(container);
      }
    }
    return container;
  }
  function show(message, type = 'info', title = '', duration = 4200) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const titles = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type]||icons.info}</span>
      <div class="toast-content"><div class="toast-title">${title||titles[type]}</div>${message?`<div class="toast-msg">${message}</div>`:''}</div>
      <button class="toast-x" data-action="toast-close">✕</button>`;
    getContainer().appendChild(t);
    if (duration > 0) setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, duration);
    return t;
  }
  return {
    show,
    success: (m, ttl) => show(m, 'success', ttl),
    error:   (m, ttl) => show(m, 'error',   ttl),
    warning: (m, ttl) => show(m, 'warning', ttl),
    info:    (m, ttl) => show(m, 'info',    ttl),
  };
})();

// ─── MODAL ──────────────────────────────────────────────────
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
  },
  close(id) {
    const el = id ? document.getElementById(id) : null;
    if (el) el.classList.remove('open');
    else document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    document.body.style.overflow = '';
  }
};
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) Modal.close();
  const ob = e.target.closest('[data-open]');  if (ob) Modal.open(ob.dataset.open);
  const cb = e.target.closest('[data-close]'); if (cb) Modal.close(cb.dataset.close);
});

// ─── PUBLIC NAVBAR ──────────────────────────────────────────
const pubNav = document.getElementById('pub-nav');
if (pubNav) window.addEventListener('scroll', () => pubNav.classList.toggle('scrolled', scrollY > 40));

const ham = document.getElementById('hamburger');
const mobMenu = document.getElementById('mob-menu');
if (ham && mobMenu) {
  ham.addEventListener('click', () => {
    const open = mobMenu.classList.toggle('open');
    const [s1, s2, s3] = ham.querySelectorAll('span');
    if (open) { s1.style.transform = 'rotate(45deg) translateY(7px)'; s2.style.opacity = '0'; s3.style.transform = 'rotate(-45deg) translateY(-7px)'; }
    else       { [s1,s2,s3].forEach(s => { s.style.transform = ''; s.style.opacity = ''; }); }
  });
}

// ─── SIDEBAR TOGGLE (DASHBOARD) ─────────────────────────────
const sidebar  = document.getElementById('sidebar');
const sbOverlay = document.getElementById('sb-overlay');
const sbToggle  = document.getElementById('sb-toggle');
const sbClose   = document.getElementById('sb-close');
function openSidebar()  { sidebar?.classList.add('open'); sbOverlay?.classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeSidebar() { sidebar?.classList.remove('open'); sbOverlay?.classList.remove('show'); document.body.style.overflow = ''; }
sbToggle?.addEventListener('click', openSidebar);
sbOverlay?.addEventListener('click', closeSidebar);
sbClose?.addEventListener('click', closeSidebar);

// ─── ACTIVE NAV HIGHLIGHT ───────────────────────────────────
const curPath = location.pathname;
document.querySelectorAll('.nav-item[href]').forEach(a => {
  if (a.getAttribute('href') !== '/' && curPath.startsWith(a.getAttribute('href'))) a.classList.add('active');
  else if (a.getAttribute('href') === '/' && curPath === '/') a.classList.add('active');
});

// ─── DROPDOWN ───────────────────────────────────────────────
document.addEventListener('click', e => {
  const tog = e.target.closest('[data-dropdown]');
  if (tog) {
    const menu = document.getElementById(tog.dataset.dropdown);
    document.querySelectorAll('.dropdown-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
    menu?.classList.toggle('open');
    e.stopPropagation();
    return;
  }
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
});

// ─── FETCH HELPER ───────────────────────────────────────────
async function api(url, options = {}) {
  try {
    const opts = {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers: { 
        'Content-Type': 'application/json', 
        ...options.headers 
      },
      credentials: 'include',
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    };
    
    const res = await fetch(url, opts);
    const data = await res.json();
    
    // ⭐ ONLY redirect on 401/403 status codes, NOT on error messages
    if (res.status === 401 || res.status === 403) {
      Toast.error('Session expired. Redirecting to login...');
      setTimeout(() => {
        window.location.href = '/auth/login.html';
      }, 1500);
      return { success: false, error: 'Session expired' };
    }
    
    // Handle server errors
    if (!res.ok) {
      return { success: false, error: data.error || 'Server error occurred' };
    }
    
    return data;
  } catch (error) {
    console.error('API Error:', error);
    Toast.error('Network error. Please check your connection.');
    return { success: false, error: 'Network error' };
  }
}

// ─── FORM SUBMIT HELPER ─────────────────────────────────────
async function submitForm(formEl, opts = {}) {
  if (typeof formEl === 'string') formEl = document.getElementById(formEl);
  if (!formEl) return;
  const btn = formEl.querySelector('[type=submit]');
  const origHTML = btn?.innerHTML;
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processing…'; }
    const fd = new FormData(formEl);
    const body = opts.json
      ? JSON.stringify(Object.fromEntries(fd))
      : new URLSearchParams(fd).toString();
    const headers = opts.json ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/x-www-form-urlencoded' };
    const res = await fetch(opts.action || formEl.action, { method: opts.method || 'POST', headers, body });
    const data = await res.json();
    if (data.success) {
      Toast.success(data.message || 'Done!');
      opts.closeModal && Modal.close(opts.closeModal);
      opts.reset && formEl.reset();
      opts.onSuccess && opts.onSuccess(data);
      opts.reload && setTimeout(() => location.reload(), 1100);
      opts.redirect && setTimeout(() => location.href = opts.redirect, 1100);
    } else {
      Toast.error(data.error || 'Something went wrong.');
      opts.onError && opts.onError(data);
    }
  } catch (err) {
    Toast.error('Network error. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
  }
}

// ─── TABLE SEARCH ───────────────────────────────────────────
function filterTable(inputId, tableId) {
  const input = document.getElementById(inputId);
  const table = document.getElementById(tableId);
  if (!input || !table) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    table.querySelectorAll('tbody tr').forEach(r => r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none');
  });
}

// ─── COUNTER ANIMATION ──────────────────────────────────────
const counterObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting || e.target.dataset.done) return;
    e.target.dataset.done = '1';
    const target = parseInt(e.target.dataset.count);
    if (!target) return;
    let cur = 0;
    const step = target / 60;
    const t = setInterval(() => {
      cur = Math.min(cur + step, target);
      e.target.textContent = Math.floor(cur).toLocaleString();
      if (cur >= target) clearInterval(t);
    }, 16);
  });
}, { threshold: 0.5 });
document.querySelectorAll('[data-count]').forEach(el => counterObs.observe(el));

// ─── PROGRESS BAR ANIMATE ───────────────────────────────────
const barObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const bar = e.target;
    const w = bar.dataset.width;
    if (w) { bar.style.width = '0'; setTimeout(() => { bar.style.width = w; }, 80); }
    barObs.unobserve(bar);
  });
});
document.querySelectorAll('.progress-bar[data-width]').forEach(el => barObs.observe(el));

// ─── QR CODE LOADER ─────────────────────────────────────────
async function showQR(lessonId) {
  try {
    const data = await api(`/admin/schedule/${lessonId}/qr`);
    if (data.success) {
      document.getElementById('qr-img').src = data.qrCode;
      document.getElementById('qr-date').textContent = data.date;
      document.getElementById('qr-time').textContent = data.time;
      Modal.open('qr-modal');
    } else Toast.error('Failed to load QR code.');
  } catch { Toast.error('Error loading QR code.'); }
}

// ─── NOTIFICATION BADGE ─────────────────────────────────────
async function refreshNotifBadge() {
  try {
    const data = await api('/api/notifications/unread-count');
    document.querySelectorAll('.notif-badge').forEach(b => {
      b.textContent = data.count || 0;
      b.style.display = data.count > 0 ? 'flex' : 'none';
    });
  } catch {}
}
if (document.querySelector('.notif-badge')) { refreshNotifBadge(); setInterval(refreshNotifBadge, 60000); }

// ─── CONFIRM ────────────────────────────────────────────────
function confirmAction(msg, cb) { if (confirm(msg)) cb(); }

// ─── CURRENCY / DATE HELPERS ────────────────────────────────
function fmtCurrency(n) { return `R ${parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('en-ZA', {day:'2-digit',month:'short',year:'numeric'}) : '—'; }
function fmtTime(s) { if (!s) return '—'; const [h,m] = s.split(':'); const hr = +h; return `${hr>12?hr-12:hr}:${m} ${hr>=12?'PM':'AM'}`; }

// ============================================================
// UNIVERSAL EVENT DELEGATION — FIXES ALL INLINE ONCLICK ISSUES
// ============================================================
(function() {
  // ─── Helper: Fix all inline onclick attributes ───
  function fixInlineOnclicks() {
    // Find ALL elements with onclick attributes
    document.querySelectorAll('[onclick]').forEach(el => {
      const onclickValue = el.getAttribute('onclick');
      el.removeAttribute('onclick');
      
      // Try to extract the function call
      const match = onclickValue.match(/^(\w+)\(([^)]*)\)/);
      if (match) {
        const funcName = match[1];
        const args = match[2] ? match[2].split(',').map(a => a.trim().replace(/['"]/g, '')) : [];
        
        el.addEventListener('click', function(e) {
          if (typeof window[funcName] === 'function') {
            window[funcName](...args);
          } else {
            console.warn(`Function "${funcName}" not found for element:`, el);
          }
        });
      }
    });
  }

  // ─── Handle toast close buttons ──────────────────────────
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-action="toast-close"]');
    if (btn) {
      const toast = btn.closest('.toast');
      if (toast) {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
      }
    }
  });

  // ─── Handle ALL data-action buttons ──────────────────────
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    if (btn.dataset.action === 'toast-close') return;
    
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const active = btn.dataset.active === 'true';
    
    switch(action) {
      case 'edit':
        if (typeof editPackage === 'function') editPackage(id);
        else if (typeof editStudent === 'function') editStudent(id);
        else if (typeof editInstructor === 'function') editInstructor(id);
        else if (typeof editVehicle === 'function') editVehicle(id);
        else if (typeof editLesson === 'function') editLesson(id);
        else console.warn('Unknown edit function for action:', action);
        break;
        
      case 'delete':
        if (typeof deletePackage === 'function') deletePackage(id);
        else if (typeof deleteStudent === 'function') deleteStudent(id);
        else if (typeof deleteInstructor === 'function') deleteInstructor(id);
        else if (typeof deleteVehicle === 'function') deleteVehicle(id);
        else if (typeof deleteLesson === 'function') deleteLesson(id);
        else console.warn('Unknown delete function for action:', action);
        break;
        
      case 'toggle':
        if (typeof togglePackage === 'function') togglePackage(id, active);
        else if (typeof toggleInstructor === 'function') toggleInstructor(id);
        else if (typeof toggleVehicle === 'function') toggleVehicle(id);
        else if (typeof toggleStudent === 'function') toggleStudent(id);
        else if (typeof toggleLesson === 'function') toggleLesson(id);
        else console.warn('Unknown toggle function for action:', action);
        break;
        
      case 'activate':
        if (typeof activatePackage === 'function') activatePackage(id);
        else if (typeof toggleInstructor === 'function') toggleInstructor(id);
        else if (typeof toggleVehicle === 'function') toggleVehicle(id);
        else console.warn('Unknown activate function for action:', action);
        break;
        
      case 'deactivate':
        if (typeof deactivatePackage === 'function') deactivatePackage(id);
        else if (typeof toggleInstructor === 'function') toggleInstructor(id);
        else if (typeof toggleVehicle === 'function') toggleVehicle(id);
        else console.warn('Unknown deactivate function for action:', action);
        break;
        
      case 'view':
        if (typeof viewStudent === 'function') viewStudent(id);
        else if (typeof viewInstructor === 'function') viewInstructor(id);
        else if (typeof viewLesson === 'function') viewLesson(id);
        else console.warn('Unknown view function for action:', action);
        break;
        
      case 'mark':
        if (typeof markAttendance === 'function') markAttendance(id);
        else if (typeof markStatus === 'function') markStatus(id);
        else console.warn('Unknown mark function for action:', action);
        break;
        
      default:
        console.warn('Unknown action:', action);
    }
  });

  // ─── Handle Save/Create buttons ──────────────────────────
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-save]');
    if (!btn) return;
    
    const formId = btn.dataset.form || btn.dataset.save;
    if (typeof savePackage === 'function') {
      savePackage();
    } else if (typeof saveStudent === 'function') {
      saveStudent();
    } else if (typeof saveInstructor === 'function') {
      saveInstructor();
    } else if (typeof saveVehicle === 'function') {
      saveVehicle();
    } else if (typeof saveLesson === 'function') {
      saveLesson();
    } else if (typeof savePayment === 'function') {
      savePayment();
    } else if (typeof saveEnrollment === 'function') {
      saveEnrollment();
    } else {
      console.warn('No save function found for:', formId);
    }
  });

  // ─── Fix all existing inline onclicks on page load ──────
  document.addEventListener('DOMContentLoaded', function() {
    fixInlineOnclicks();
    
    document.querySelectorAll('[onclick*="save"], [onclick*="Save"]').forEach(el => {
      const onclickValue = el.getAttribute('onclick');
      if (onclickValue) {
        el.removeAttribute('onclick');
        const match = onclickValue.match(/^(\w+)\(/);
        if (match) {
          const funcName = match[1];
          el.addEventListener('click', function(e) {
            if (typeof window[funcName] === 'function') {
              window[funcName]();
            }
          });
        }
      }
    });
  });

})();

// ─── GLOBAL EXPOSE ──────────────────────────────────────────
Object.assign(window, { 
  Toast, Modal, api, submitForm, filterTable, confirmAction, 
  showQR, fmtCurrency, fmtDate, fmtTime
});

