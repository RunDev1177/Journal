/**
 * Daily Journal - Modern Trading Journal Web Application
 * Core JavaScript Logic
 *
 * Requirements:
 * - Credentials: run / 88888888
 * - Storage: LocalStorage + IndexedDB (for screenshots)
 * - Google Sheet ID: 1eq4VpN24Npj8VKIa1dELC0zHvwfHc3gEOS1GnAjkQks
 * - Multi-Portfolio + Sheet Sync (create & delete tabs)
 * - Ctrl+V clipboard paste for screenshots + Lightbox
 * - Analytics: Win Rate, Total PnL, Profit Factor, Avg Win/Loss, Max Drawdown
 * - Visualizations: Equity Curve (Chart.js) + Daily P&L Calendar
 * - Export: CSV/Excel
 */

(function () {
  'use strict';

  // ================= CONFIG & CONSTANTS =================

  const STORAGE_KEYS = {
    AUTH: 'daily_journal_auth_token',
    PORTFOLIOS: 'daily_journal_portfolios_v1',
    ACTIVE_PORTFOLIO: 'daily_journal_active_port_v1',
    TRADES: 'daily_journal_trades_v1',
    SYNC_URL: 'daily_journal_apps_script_url_v1',
    LAST_SYNC: 'daily_journal_last_sync_time_v1'
  };

  const DEFAULT_SYNC_URL = 'https://script.google.com/macros/s/AKfycbxaWga9CMjYrxqpsEYYJVCd8Ex5IIyXHc7irsXresouueGvn2Kh-b0FHBTfshnXnN48VA/exec';

  const GOOGLE_SHEET_ID = '1eq4VpN24Npj8VKIa1dELC0zHvwfHc3gEOS1GnAjkQks';

  // Default Portfolios if none exist
  const DEFAULT_PORTFOLIOS = [
    { id: 'port_xauusd', name: 'XAUUSD (ทองคำ)', capital: 1000, riskPerTrade: 1, desc: 'พอร์ตเทรดทองคำ Gold Spot' },
    { id: 'port_eurusd', name: 'EURUSD', capital: 1000, riskPerTrade: 1, desc: 'พอร์ตเทรดคู่เงินหลัก EURUSD' },
    { id: 'port_set50', name: 'SET50', capital: 50000, riskPerTrade: 1, desc: 'พอร์ตเทรดดัชนีหุ้นไทย TFEX SET50' }
  ];

  // Default initial sample trade if fresh install
  const SAMPLE_TRADES = [
    {
      id: 'trade_' + (Date.now() - 86400000 * 2),
      portfolioId: 'port_xauusd',
      symbol: 'XAUUSD',
      position: 'BUY',
      lot: 0.1,
      entryPrice: 2640.5,
      exitPrice: 2655.0,
      sl: 2635.0,
      tp: 2655.0,
      rr: 2.64,
      pnl: 145.0,
      entryTime: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 16),
      status: 'TP',
      strategy: 'Breakout & Retest Support',
      emotionBefore: 'มั่นใจตามแผน',
      emotionAfter: 'พอใจ ทำตามแผนได้ดี',
      lessons: 'เข้าตามระบบ ไม่รีบปิดก่อนถึง TP',
      nextPlan: 'รอสัญญาณแท่งเทียนยืนยันเหมือนเดิม',
      tvBefore: '',
      tvAfter: '',
      imgBeforeId: null,
      imgAfterId: null
    },
    {
      id: 'trade_' + (Date.now() - 86400000),
      portfolioId: 'port_xauusd',
      symbol: 'XAUUSD',
      position: 'SELL',
      lot: 0.1,
      entryPrice: 2660.0,
      exitPrice: 2665.0,
      sl: 2665.0,
      tp: 2645.0,
      rr: 3.0,
      pnl: -50.0,
      entryTime: new Date(Date.now() - 86400000).toISOString().slice(0, 16),
      status: 'SL',
      strategy: 'Supply Zone Rejection',
      emotionBefore: 'กลัวตกรถ (FOMO)',
      emotionAfter: 'เฉยๆ ยอมรับผลลัพธ์',
      lessons: 'ฝืนเข้าก่อนมีสัญญาณ Price Action แท้จริง ชน SL ตามวินัย',
      nextPlan: 'ห้ามเทรดตอนไม่มี Setup ชัดเจน',
      tvBefore: '',
      tvAfter: '',
      imgBeforeId: null,
      imgAfterId: null
    }
  ];

  // ================= STATE =================
  let state = {
    isAuthenticated: false,
    currentUser: 'run',
    portfolios: [],
    activePortfolioId: 'ALL',
    trades: [],
    syncUrl: '',
    calendarDate: new Date(),
    filters: {
      search: '',
      outcome: 'ALL',
      symbol: 'ALL'
    },
    equityChartInstance: null,
    editingTradeId: null,
    focusedDropzone: null // for clipboard paste targeting
  };

  // ================= INDEXED DB (FOR IMAGES) =================
  let dbPromise = null;
  function getDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('DailyJournalImagesDB', 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('images')) {
            db.createObjectStore('images', { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  async function saveImageToDB(base64Data) {
    if (!base64Data) return null;
    try {
      const db = await getDB();
      const id = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        const store = tx.objectStore('images');
        store.put({ id, data: base64Data });
        tx.oncomplete = () => resolve(id);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('IndexedDB save failed, using memory fallback:', err);
      return base64Data; // fallback
    }
  }

  async function getImageFromDB(idOrData) {
    if (!idOrData) return null;
    if (idOrData.startsWith('data:image')) return idOrData;
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readonly');
        const store = tx.objectStore('images');
        const req = store.get(idOrData);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      return null;
    }
  }

  // ================= TOAST NOTIFICATION =================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // ================= STORAGE HELPERS =================
  function loadStateFromStorage() {
    // 1. Auth check
    state.isAuthenticated = sessionStorage.getItem(STORAGE_KEYS.AUTH) === 'true';

    // 2. Portfolios
    const storedPortfolios = localStorage.getItem(STORAGE_KEYS.PORTFOLIOS);
    if (storedPortfolios) {
      try {
        state.portfolios = JSON.parse(storedPortfolios);
      } catch (e) {
        state.portfolios = DEFAULT_PORTFOLIOS;
      }
    } else {
      state.portfolios = DEFAULT_PORTFOLIOS;
      savePortfoliosToStorage();
    }

    // 3. Active Portfolio
    state.activePortfolioId = localStorage.getItem(STORAGE_KEYS.ACTIVE_PORTFOLIO) || 'ALL';

    // 4. Trades
    const storedTrades = localStorage.getItem(STORAGE_KEYS.TRADES);
    if (storedTrades) {
      try {
        state.trades = JSON.parse(storedTrades);
      } catch (e) {
        state.trades = SAMPLE_TRADES;
      }
    } else {
      state.trades = SAMPLE_TRADES;
      saveTradesToStorage();
    }

    // Auto-link/sanitize trades whose portfolioId doesn't match an existing portfolio
    // Auto-link/sanitize trades: แสดงพอร์ตใครพอร์ตมัน
    if (Array.isArray(state.trades) && Array.isArray(state.portfolios) && state.portfolios.length > 0) {
      let tradesChanged = false;
      state.trades.forEach(trade => {
        // Fix any misattributed trades from Google Sheet sheet indices (trade_gs_<sIdx>_...)
        if (typeof trade.id === 'string' && trade.id.startsWith('trade_gs_')) {
          const parts = trade.id.split('_');
          const sIdx = parseInt(parts[2], 10);
          if (!isNaN(sIdx) && state.portfolios[sIdx]) {
            if (trade.portfolioId !== state.portfolios[sIdx].id) {
              trade.portfolioId = state.portfolios[sIdx].id;
              trade.portfolioName = state.portfolios[sIdx].name;
              tradesChanged = true;
            }
          }
        }

        const portExists = state.portfolios.some(p => p.id === trade.portfolioId);
        if (!portExists) {
          // Match by EXACT name or EXACT normalized ID (no .includes)
          const tName = (trade.portfolioName || '').trim().toLowerCase();
          const tId = (trade.portfolioId || '').replace(/^port_/, '');
          const matched = state.portfolios.find(p => {
            const pNorm = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
            const pName = (p.name || '').trim().toLowerCase();
            return (tName && pName === tName) || (tId && pNorm === tId);
          });
          if (matched) {
            trade.portfolioId = matched.id;
            trade.portfolioName = matched.name;
            tradesChanged = true;
          }
        } else {
          // Sync portfolioName with current portfolio name
          const p = state.portfolios.find(item => item.id === trade.portfolioId);
          if (p && trade.portfolioName !== p.name) {
            trade.portfolioName = p.name;
            tradesChanged = true;
          }
        }
      });
      if (tradesChanged) {
        saveTradesToStorage();
      }

      // Check active portfolio validity
      if (state.activePortfolioId !== 'ALL') {
        const activeExists = state.portfolios.some(p => p.id === state.activePortfolioId);
        if (!activeExists) {
          const matchedActive = state.portfolios.find(p => {
            const pNorm = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
            const aId = state.activePortfolioId.replace(/^port_/, '');
            return aId && pNorm === aId;
          });
          state.activePortfolioId = matchedActive ? matchedActive.id : (state.portfolios[0] ? state.portfolios[0].id : 'ALL');
          saveActivePortfolioToStorage();
        }
      }
    }

    // 5. Apps Script URL
    state.syncUrl = localStorage.getItem(STORAGE_KEYS.SYNC_URL) || DEFAULT_SYNC_URL;
  }

  function savePortfoliosToStorage() {
    localStorage.setItem(STORAGE_KEYS.PORTFOLIOS, JSON.stringify(state.portfolios));
  }

  function saveTradesToStorage() {
    localStorage.setItem(STORAGE_KEYS.TRADES, JSON.stringify(state.trades));
  }

  function saveActivePortfolioToStorage() {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PORTFOLIO, state.activePortfolioId);
  }

  function saveSyncUrlToStorage(url) {
    state.syncUrl = url;
    localStorage.setItem(STORAGE_KEYS.SYNC_URL, url);
  }

  // ================= AUTHENTICATION VIA CODE.GS =================
  function initAuth() {
    const loginOverlay = document.getElementById('login-overlay');
    const appContainer = document.getElementById('app-container');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const btnLogout = document.getElementById('btn-logout');
    const btnSubmit = document.getElementById('btn-login-submit');

    // Toggle Web App URL input on login screen
    const toggleSyncUrl = document.getElementById('toggle-login-sync-url');
    const wrapperSyncUrl = document.getElementById('wrapper-login-sync-url');
    const loginSyncUrlInput = document.getElementById('login-sync-url');

    if (toggleSyncUrl && wrapperSyncUrl) {
      if (loginSyncUrlInput) {
        loginSyncUrlInput.value = state.syncUrl || DEFAULT_SYNC_URL;
      }
      toggleSyncUrl.addEventListener('click', (e) => {
        e.preventDefault();
        wrapperSyncUrl.classList.toggle('hidden');
      });
    }

    if (state.isAuthenticated) {
      loginOverlay.classList.add('hidden');
      appContainer.classList.remove('hidden');
    } else {
      loginOverlay.classList.remove('hidden');
      appContainer.classList.add('hidden');
    }

    function triggerLoginError(message) {
      loginError.textContent = message || '⚠️ ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      loginError.classList.remove('hidden');
      loginError.style.animation = 'none';
      void loginError.offsetWidth; // trigger reflow
      loginError.style.animation = 'shake 0.3s ease';
    }

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username').value.trim();
      const passwordInput = document.getElementById('login-password').value.trim();

      let targetSyncUrl = state.syncUrl || DEFAULT_SYNC_URL;
      if (loginSyncUrlInput && loginSyncUrlInput.value.trim()) {
        targetSyncUrl = loginSyncUrlInput.value.trim();
      }

      if (!targetSyncUrl) {
        if (wrapperSyncUrl) wrapperSyncUrl.classList.remove('hidden');
        triggerLoginError('⚠️ กรุณาระบุ Google Apps Script Web App URL ด้านล่างเพื่อตรวจสอบรหัสผ่านกับ Code.gs');
        return;
      }

      // Check credentials with Code.gs
      btnSubmit.disabled = true;
      const originalSubmitText = btnSubmit.innerHTML;
      btnSubmit.innerHTML = '<span>กำลังเข้าสู่ระบบ... ⏳</span>';

      try {
        const response = await fetch(targetSyncUrl, {
          method: 'POST',
          body: JSON.stringify({
            action: 'LOGIN',
            username: usernameInput,
            password: passwordInput
          }),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });

        const result = await response.json();

        if (result && result.status === 'success') {
          saveSyncUrlToStorage(targetSyncUrl);
          state.isAuthenticated = true;
          state.currentUser = result.username || usernameInput;
          sessionStorage.setItem(STORAGE_KEYS.AUTH, 'true');
          loginError.classList.add('hidden');
          loginOverlay.classList.add('hidden');
          appContainer.classList.remove('hidden');
          showToast(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับคุณ ${state.currentUser}`, 'success');
          renderAll();
        } else {
          triggerLoginError(result.message || '⚠️ ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }
      } catch (err) {
        console.warn('Login request error:', err);
        triggerLoginError('⚠️ ไม่สามารถเชื่อมต่อกับ Code.gs ได้ (กรุณาตรวจ Web App URL)');
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalSubmitText;
      }
    });

    const handleLogout = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      state.isAuthenticated = false;
      state.currentUser = null;
      sessionStorage.removeItem(STORAGE_KEYS.AUTH);
      localStorage.removeItem(STORAGE_KEYS.AUTH);
      sessionStorage.clear();

      loginOverlay.classList.remove('hidden');
      appContainer.classList.add('hidden');

      const passInput = document.getElementById('login-password');
      if (passInput) passInput.value = '';

      const loginError = document.getElementById('login-error');
      if (loginError) loginError.classList.add('hidden');

      showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    };

    if (btnLogout) btnLogout.onclick = handleLogout;
    const btnSettingsLogout = document.getElementById('btn-settings-logout');
    if (btnSettingsLogout) btnSettingsLogout.onclick = handleLogout;

    // Delegate click to ensure logout button always triggers
    document.addEventListener('click', (e) => {
      const target = e.target.closest('#btn-settings-logout, #btn-logout');
      if (target) {
        handleLogout(e);
      }
    });
  }

  // ================= PORTFOLIO MANAGEMENT =================
  function renderPortfolioSelector() {
    const select = document.getElementById('portfolio-select');
    const modalSelect = document.getElementById('trade-portfolio');
    if (!select) return;

    select.innerHTML = '<option value="ALL">📁 ทุกพอร์ตการเทรด</option>';
    if (modalSelect) modalSelect.innerHTML = '';

    state.portfolios.forEach(port => {
      const opt = document.createElement('option');
      opt.value = port.id;
      opt.textContent = `${port.name}`;
      select.appendChild(opt);

      if (modalSelect) {
        const modalOpt = document.createElement('option');
        modalOpt.value = port.id;
        modalOpt.textContent = `${port.name}`;
        modalSelect.appendChild(modalOpt);
      }
    });

    select.value = state.activePortfolioId;

    select.onchange = (e) => {
      state.activePortfolioId = e.target.value;
      saveActivePortfolioToStorage();
      renderAll();
      showToast(`เปลี่ยนมุมมองเป็น: ${getPortfolioName(state.activePortfolioId)}`, 'info');
    };
  }

  function getPortfolioName(portId) {
    if (portId === 'ALL') return 'ทุกพอร์ต';
    const found = state.portfolios.find(p => p.id === portId);
    if (found) return found.name;
    const foundNorm = state.portfolios.find(p => {
      const pNorm = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
      const pId = String(portId || '').replace(/^port_/, '');
      return pId && pNorm === pId;
    });
    return foundNorm ? foundNorm.name : portId;
  }

  function renderPortfolioModalList() {
    const listContainer = document.getElementById('portfolio-items-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    if (!state.portfolios || state.portfolios.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 2rem 1rem;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">💼</div>
          <div>ยังไม่มีพอร์ตการเทรด</div>
        </div>
      `;
      return;
    }

    state.portfolios.forEach(port => {
      const card = document.createElement('div');
      card.className = 'portfolio-item-card';
      const cap = Number(port.capital) || 0;
      const riskVal = (port.riskPerTrade !== undefined && port.riskPerTrade !== null && port.riskPerTrade !== '') ? Number(port.riskPerTrade) : 1;
      const riskDollar = cap > 0 ? (cap * riskVal) / 100 : 0;
      const riskDollarStr = riskDollar > 0 ? ` ($${formatMoney(riskDollar)})` : '';

      card.innerHTML = `
        <div class="portfolio-item-info">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <h5 style="margin: 0; font-size: 1rem; font-weight: 600; color: var(--text-primary);">${escapeHtml(port.name)}</h5>
            <span class="badge badge-teal" style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px;">เสี่ยง ${riskVal}% / ไม้</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <span>💰 ทุน: <strong style="color: var(--text-secondary);">$${cap.toLocaleString()}</strong></span>
            <span>• 🛡️ ความเสี่ยง: <strong style="color: #00c087;">${riskVal}%${riskDollarStr}</strong></span>
            ${port.desc ? `<span>• <em>${escapeHtml(port.desc)}</em></span>` : ''}
          </div>
        </div>
        <div class="portfolio-item-actions" style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-ghost btn-sm btn-edit-portfolio" data-port-id="${port.id}" title="แก้ไขพอร์ต">
            ✏️ แก้ไข
          </button>
          <button type="button" class="btn btn-ghost btn-sm text-loss btn-delete-portfolio" data-port-id="${port.id}" title="ลบพอร์ต">
            🗑️ ลบ
          </button>
        </div>
      `;

      card.querySelector('.btn-edit-portfolio').onclick = () => openEditPortfolio(port.id);
      card.querySelector('.btn-delete-portfolio').onclick = () => openDeletePortfolioModal(port.id);
      listContainer.appendChild(card);
    });
  }

  function openEditPortfolio(portId) {
    const port = state.portfolios.find(p => p.id === portId);
    if (!port) return;

    const form = document.getElementById('form-create-portfolio');
    const formTitle = document.getElementById('portfolio-form-title');
    const editIdInput = document.getElementById('edit-port-id');
    const nameInput = document.getElementById('new-port-name');
    const capInput = document.getElementById('new-port-capital');
    const descInput = document.getElementById('new-port-desc');
    const riskInput = document.getElementById('new-port-risk');
    const submitBtn = document.getElementById('btn-submit-create-port');
    const btnToggle = document.getElementById('btn-toggle-create-port');

    if (editIdInput) editIdInput.value = port.id;
    if (nameInput) nameInput.value = port.name;
    if (capInput) capInput.value = port.capital;
    if (descInput) descInput.value = port.desc || '';
    if (riskInput) riskInput.value = (port.riskPerTrade !== undefined && port.riskPerTrade !== null && port.riskPerTrade !== '') ? port.riskPerTrade : 1;
    updatePortRiskHint();
    if (formTitle) {
      formTitle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16" style="vertical-align: -2px; margin-right: 4px;">
        <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
        <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>
      </svg> แก้ไขข้อมูลพอร์ต "${escapeHtml(port.name)}"`;
    }
    if (submitBtn) submitBtn.textContent = '💾 บันทึกการแก้ไข';

    if (form) {
      form.classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (btnToggle) {
      btnToggle.innerHTML = '✕ ปิดฟอร์ม';
      btnToggle.className = 'btn btn-ghost btn-sm';
    }
    if (nameInput) setTimeout(() => nameInput.focus(), 60);
  }

  function resetPortfolioForm() {
    const form = document.getElementById('form-create-portfolio');
    const formTitle = document.getElementById('portfolio-form-title');
    const editIdInput = document.getElementById('edit-port-id');
    const capInput = document.getElementById('new-port-capital');
    const riskInput = document.getElementById('new-port-risk');
    const submitBtn = document.getElementById('btn-submit-create-port');
    const btnToggle = document.getElementById('btn-toggle-create-port');

    if (form) form.reset();
    if (editIdInput) editIdInput.value = '';
    if (capInput) capInput.value = '1000';
    if (riskInput) riskInput.value = '1';
    updatePortRiskHint();
    if (formTitle) formTitle.textContent = '➕ สร้างพอร์ตใหม่';
    if (submitBtn) submitBtn.textContent = '➕ เพิ่มพอร์ตและสร้าง Sheet';
    if (btnToggle) {
      btnToggle.innerHTML = '➕ เพิ่มพอร์ต';
      btnToggle.className = 'btn btn-teal btn-sm';
    }
  }

  function updatePortRiskHint() {
    const capInput = document.getElementById('new-port-capital');
    const riskInput = document.getElementById('new-port-risk');
    const hintEl = document.getElementById('new-port-risk-hint');
    if (!hintEl) return;

    const cap = parseFloat(capInput?.value) || 0;
    const risk = parseFloat(riskInput?.value);

    if (!isNaN(risk) && risk > 0) {
      const dollarRisk = (cap * risk) / 100;
      hintEl.innerHTML = `💡 เสี่ยง <strong>$${formatMoney(dollarRisk)}</strong> ต่อไม้ (${risk}% ของทุน $${Number(cap).toLocaleString()})`;
    } else {
      hintEl.textContent = '';
    }
  }

  async function updatePortfolio(portId, name, capital, desc, riskPerTrade) {
    const port = state.portfolios.find(p => p.id === portId);
    if (!port) return;

    port.name = name.trim();
    port.capital = Number(capital) || 0;
    port.desc = (desc || '').trim();
    port.riskPerTrade = (riskPerTrade !== '' && riskPerTrade !== null && !isNaN(riskPerTrade)) ? Number(riskPerTrade) : 1;

    savePortfoliosToStorage();
    renderPortfolioSelector();
    renderPortfolioModalList();
    renderAll();
    showToast(`แก้ไขข้อมูลพอร์ต "${port.name}" เรียบร้อยแล้ว (กดปุ่ม Upload เพื่ออัปเดต Google Sheets)`, 'success');
  }

  async function createPortfolio(name, capital, desc, riskPerTrade) {
    const newPort = {
      id: 'port_' + Date.now(),
      name: name.trim(),
      capital: Number(capital) || 0,
      desc: desc.trim(),
      riskPerTrade: (riskPerTrade !== '' && riskPerTrade !== null && !isNaN(riskPerTrade)) ? Number(riskPerTrade) : 1
    };

    state.portfolios.push(newPort);
    savePortfoliosToStorage();
    renderPortfolioSelector();
    renderPortfolioModalList();
    showToast(`เพิ่มพอร์ต "${newPort.name}" สำเร็จ (กดปุ่ม Upload เพื่อสร้างและส่งขึ้น Google Sheets)`, 'success');
  }

  let portfolioPendingDeleteId = null;

  function openDeletePortfolioModal(portId) {
    const target = state.portfolios.find(p => p.id === portId);
    if (!target) return;

    portfolioPendingDeleteId = portId;
    const modal = document.getElementById('modal-confirm-delete-port');
    const msgEl = document.getElementById('delete-port-confirm-message');
    if (msgEl) {
      msgEl.innerHTML = `ต้องการที่จะลบ <strong>${escapeHtml(target.name)}</strong> หรือไม่`;
    }
    if (modal) modal.classList.remove('hidden');
  }

  function closeDeletePortfolioModal() {
    portfolioPendingDeleteId = null;
    const modal = document.getElementById('modal-confirm-delete-port');
    if (modal) modal.classList.add('hidden');
  }

  async function confirmDeletePortfolio() {
    if (!portfolioPendingDeleteId) return;
    const portId = portfolioPendingDeleteId;
    const target = state.portfolios.find(p => p.id === portId);
    if (!target) {
      closeDeletePortfolioModal();
      return;
    }

    const portName = target.name;
    closeDeletePortfolioModal();

    state.portfolios = state.portfolios.filter(p => p.id !== portId);
    state.trades = state.trades.filter(t => t.portfolioId !== portId);
    if (state.activePortfolioId === portId) {
      state.activePortfolioId = 'ALL';
      saveActivePortfolioToStorage();
    }
    savePortfoliosToStorage();
    saveTradesToStorage();
    renderPortfolioSelector();
    renderPortfolioModalList();
    renderAll();
    showToast(`ลบพอร์ต "${portName}" เรียบร้อยแล้ว`, 'info');

    // สั่งลบ Tab ใน Google Sheets ทันทีเมื่อกดลบ
    if (state.syncUrl) {
      try {
        const res = await callAppsScriptWebhook('DELETE_SHEET', { sheetName: portName });
        const resData = await res.json().catch(() => null);
        if (resData && resData.status === 'success') {
          showToast(`🗑️ ลบ Tab "${portName}" ใน Google Sheets เรียบร้อย`, 'success');
        }
      } catch (err) {
        console.warn('Sync delete sheet error:', err);
      }
    }
  }

  // ================= TRADE CALCULATIONS & METRICS =================
  function getTradePnL(trade) {
    if (!trade) return 0;

    // Determine portfolio capital & risk
    let cap = 1000;
    let riskPct = 1;

    const port = state.portfolios.find(p => p.id === trade.portfolioId) ||
      state.portfolios.find(p => (p.name || '').trim().toLowerCase() === (trade.portfolioName || '').trim().toLowerCase());

    if (port) {
      cap = Number(port.capital) || 1000;
      riskPct = (port.riskPerTrade !== undefined && port.riskPerTrade !== null && port.riskPerTrade !== '')
        ? Number(port.riskPerTrade)
        : 1;
    }

    const riskDollar = (cap * riskPct) / 100;
    const st = String(trade.status || '').toUpperCase();

    // Link directly to TP / SL
    if (st === 'TP' || st === 'WIN') {
      const rr = Number(trade.rr) > 0 ? Number(trade.rr) : 1;
      return riskDollar * rr;
    }
    if (st === 'SL' || st === 'LOSS') {
      return -riskDollar;
    }
    if (st === 'BE') {
      return 0;
    }

    // If explicit non-zero pnl is recorded on trade, use it
    if (trade.pnl !== undefined && trade.pnl !== null && trade.pnl !== '' && Number(trade.pnl) !== 0) {
      return Number(trade.pnl);
    }

    return 0;
  }

  function getFilteredTrades() {
    return state.trades.filter(trade => {
      // 1. Portfolio filter
      if (state.activePortfolioId !== 'ALL') {
        const matchesId = trade.portfolioId === state.activePortfolioId;
        let matchesName = false;
        if (!matchesId) {
          const activePort = state.portfolios.find(p => p.id === state.activePortfolioId);
          const activePortName = activePort ? (activePort.name || '').trim().toLowerCase() : '';
          const tradePort = state.portfolios.find(p => p.id === trade.portfolioId);
          const tradePortName = tradePort ? (tradePort.name || '').trim().toLowerCase() : (trade.portfolioName || '').trim().toLowerCase();
          matchesName = Boolean(activePortName && tradePortName && (activePortName === tradePortName));
        }
        if (!matchesId && !matchesName) {
          return false;
        }
      }
      // 2. Outcome / Status filter
      if (state.filters.outcome && state.filters.outcome !== 'ALL') {
        const f = state.filters.outcome;
        const tPnl = getTradePnL(trade);
        if (f === 'รอ' && trade.status !== 'รอ' && trade.status !== 'WAITING') return false;
        if (f === 'กำลังถือ' && trade.status !== 'กำลังถือ' && trade.status !== 'OPEN' && trade.status !== 'ถืออยู่') return false;
        if (f === 'TP' && trade.status !== 'TP' && tPnl <= 0) return false;
        if (f === 'SL' && trade.status !== 'SL' && tPnl >= 0) return false;
        if (f === 'BE' && trade.status !== 'BE' && tPnl !== 0) return false;
        if (f === 'WIN' && trade.status !== 'TP' && tPnl <= 0) return false;
        if (f === 'LOSS' && trade.status !== 'SL' && tPnl >= 0) return false;
        if (f === 'OPEN' && trade.status !== 'กำลังถือ' && trade.status !== 'OPEN' && trade.status !== 'ถืออยู่') return false;
      }

      // 3. Symbol filter
      if (state.filters.symbol !== 'ALL' && trade.symbol !== state.filters.symbol) {
        return false;
      }

      // 4. Keyword search
      if (state.filters.search) {
        const query = state.filters.search.toLowerCase();
        const str = `${trade.symbol} ${trade.strategy} ${trade.lessons} ${trade.nextPlan} ${trade.emotionBefore} ${trade.emotionAfter}`.toLowerCase();
        if (!str.includes(query)) return false;
      }

      return true;
    });
  }

  function calculateMetrics(tradesList) {
    const isClosedTrade = (t) => t.status === 'TP' || t.status === 'SL' || t.status === 'BE' || t.status === 'CLOSED';
    const closedTrades = tradesList.filter(isClosedTrade);
    const totalCount = closedTrades.length;

    let wins = 0;
    let losses = 0;
    let be = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;
    let netPnl = 0;
    let totalRR = 0;
    let rrCount = 0;

    // Equity tracking for Drawdown
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;

    // Sort closed trades ascending by exit time for accurate curve and drawdown
    const sorted = [...closedTrades].sort((a, b) => new Date(a.exitTime || a.entryTime) - new Date(b.exitTime || b.entryTime));

    sorted.forEach(t => {
      const pnl = getTradePnL(t);
      netPnl += pnl;
      cumulative += pnl;

      if (cumulative > peak) {
        peak = cumulative;
      }
      const dd = peak - cumulative;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }

      if (t.status === 'TP' || pnl > 0) {
        wins++;
        totalWinPnl += pnl;
      } else if (t.status === 'SL' || pnl < 0) {
        losses++;
        totalLossPnl += Math.abs(pnl);
      } else {
        be++;
      }

      if (t.rr && Number(t.rr) > 0) {
        totalRR += Number(t.rr);
        rrCount++;
      }
    });

    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : (totalWinPnl > 0 ? 99.99 : 0);
    const avgWin = wins > 0 ? totalWinPnl / wins : 0;
    const avgLoss = losses > 0 ? totalLossPnl / losses : 0;
    const avgRR = rrCount > 0 ? totalRR / rrCount : 0;

    // Capital for DD %
    let activeCapital = 1000;
    if (state.activePortfolioId !== 'ALL') {
      const p = state.portfolios.find(item => item.id === state.activePortfolioId);
      if (p) activeCapital = p.capital || 1000;
    } else {
      activeCapital = state.portfolios.reduce((sum, p) => sum + (p.capital || 0), 0) || 1000;
    }
    const maxDrawdownPct = activeCapital > 0 ? (maxDrawdown / activeCapital) * 100 : 0;

    const openCount = tradesList.length - totalCount;

    return {
      totalCount: tradesList.length,
      closedCount: totalCount,
      openCount,
      wins,
      losses,
      be,
      winRate,
      netPnl,
      profitFactor,
      avgWin,
      avgLoss,
      avgRR,
      maxDrawdown,
      maxDrawdownPct
    };
  }

  function renderMetrics() {
    const trades = getFilteredTrades();
    const metrics = calculateMetrics(trades);

    const winRateEl = document.getElementById('metric-win-rate');
    if (winRateEl) winRateEl.textContent = `${metrics.winRate.toFixed(1)}%`;
    const winCountEl = document.getElementById('metric-win-count');
    if (winCountEl) winCountEl.textContent = `ชนะ ${metrics.wins} / แพ้ ${metrics.losses} ไม้ (เสมอ ${metrics.be})`;

    const totalTradesEl = document.getElementById('metric-total-trades');
    if (totalTradesEl) totalTradesEl.textContent = metrics.totalCount;
    const totalTradesSubEl = document.getElementById('metric-total-trades-sub');
    if (totalTradesSubEl) totalTradesSubEl.textContent = `ปิดแล้ว ${metrics.closedCount} / กำลังถือ ${metrics.openCount} ไม้`;

    const tpCountEl = document.getElementById('metric-tp-count');
    if (tpCountEl) tpCountEl.textContent = metrics.wins;
    const slCountEl = document.getElementById('metric-sl-count');
    if (slCountEl) slCountEl.textContent = metrics.losses;

    const tpRate = metrics.closedCount > 0 ? ((metrics.wins / metrics.closedCount) * 100).toFixed(1) : '0.0';
    const slRate = metrics.closedCount > 0 ? ((metrics.losses / metrics.closedCount) * 100).toFixed(1) : '0.0';

    const tpSlSubEl = document.getElementById('metric-tp-sl-sub');
    if (tpSlSubEl) {
      tpSlSubEl.textContent = `TP ${tpRate}% (${metrics.wins}) / SL ${slRate}% (${metrics.losses})`;
    }

    const tpSubEl = document.getElementById('metric-tp-sub');
    if (tpSubEl) {
      tpSubEl.textContent = `Take Profit (${tpRate}%)`;
    }

    const slSubEl = document.getElementById('metric-sl-sub');
    if (slSubEl) {
      slSubEl.textContent = `Stop Loss (${slRate}%)`;
    }

    // Risk metric (Card 4 - อันขวา)
    const riskValEl = document.getElementById('metric-risk-val');
    const riskSubEl = document.getElementById('metric-risk-sub');
    if (riskValEl) {
      let cap = 0;
      let riskPct = 1;
      let isSinglePort = false;

      if (state.activePortfolioId !== 'ALL') {
        const activePort = state.portfolios.find(p => p.id === state.activePortfolioId);
        if (activePort) {
          isSinglePort = true;
          cap = Number(activePort.capital) || 0;
          riskPct = (activePort.riskPerTrade !== undefined && activePort.riskPerTrade !== null && activePort.riskPerTrade !== '') ? Number(activePort.riskPerTrade) : 1;
        }
      } else {
        cap = state.portfolios.reduce((sum, p) => sum + (Number(p.capital) || 0), 0);
        const totalDollarRisk = state.portfolios.reduce((sum, p) => {
          const pCap = Number(p.capital) || 0;
          const pRisk = (p.riskPerTrade !== undefined && p.riskPerTrade !== null && p.riskPerTrade !== '') ? Number(p.riskPerTrade) : 1;
          return sum + (pCap * pRisk) / 100;
        }, 0);
        riskPct = cap > 0 ? Number(((totalDollarRisk / cap) * 100).toFixed(1)) : 1;
      }

      const dollarRisk = cap > 0 ? (cap * riskPct) / 100 : 0;
      riskValEl.textContent = `${riskPct}%`;

      if (riskSubEl) {
        if (isSinglePort) {
          riskSubEl.textContent = `≈ $${formatMoney(dollarRisk)} ต่อไม้ (ทุน $${cap.toLocaleString()})`;
        } else {
          riskSubEl.textContent = `≈ $${formatMoney(dollarRisk)} ต่อไม้ (รวมทุกพอร์ต)`;
        }
      }
    }

    // Legacy elements if present
    const pnlEl = document.getElementById('metric-total-pnl');
    if (pnlEl) {
      pnlEl.textContent = `${metrics.netPnl >= 0 ? '+' : ''}$${formatMoney(metrics.netPnl)}`;
      pnlEl.className = 'metric-value ' + (metrics.netPnl >= 0 ? 'text-win' : 'text-loss');
    }
    const pfEl = document.getElementById('metric-profit-factor');
    if (pfEl) pfEl.textContent = metrics.profitFactor.toFixed(2);
    const avgWinEl = document.getElementById('metric-avg-win');
    if (avgWinEl) avgWinEl.textContent = `+$${formatMoney(metrics.avgWin)}`;
    const avgLossEl = document.getElementById('metric-avg-loss');
    if (avgLossEl) avgLossEl.textContent = `-$${formatMoney(metrics.avgLoss)}`;
    const rrAvgEl = document.getElementById('metric-rr-avg');
    if (rrAvgEl) rrAvgEl.textContent = `Avg R:R: 1 : ${metrics.avgRR.toFixed(2)}`;
    const maxDdEl = document.getElementById('metric-max-dd');
    if (maxDdEl) maxDdEl.textContent = `-$${formatMoney(metrics.maxDrawdown)}`;
    const maxDdPctEl = document.getElementById('metric-max-dd-pct');
    if (maxDdPctEl) maxDdPctEl.textContent = `(${metrics.maxDrawdownPct.toFixed(2)}%)`;

    // Portfolio title in chart card
    const chartPortNameEl = document.getElementById('chart-portfolio-name');
    if (chartPortNameEl) chartPortNameEl.textContent = getPortfolioName(state.activePortfolioId);
  }

  // ================= EQUITY CURVE CHART (CHART.JS) =================
  function renderEquityChart() {
    const canvas = document.getElementById('equityChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isClosedTrade = (t) => t.status === 'TP' || t.status === 'SL' || t.status === 'BE' || t.status === 'CLOSED';
    const filtered = getFilteredTrades()
      .filter(isClosedTrade)
      .sort((a, b) => new Date(a.exitTime || a.entryTime) - new Date(b.exitTime || b.entryTime));

    // Base initial capital
    let startCapital = 0;
    if (state.activePortfolioId !== 'ALL') {
      const p = state.portfolios.find(item => item.id === state.activePortfolioId);
      if (p) startCapital = Number(p.capital) || 0;
    } else {
      startCapital = state.portfolios.reduce((acc, p) => acc + (Number(p.capital) || 0), 0);
    }

    const labels = ['จุดเริ่มต้น'];
    const dataPoints = [startCapital];

    let runningCapital = startCapital;
    filtered.forEach((trade, index) => {
      const pnl = getTradePnL(trade);
      runningCapital += pnl;
      const dateStr = trade.exitTime ? new Date(trade.exitTime).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' }) : `#${index + 1}`;
      labels.push(`${dateStr} (${trade.symbol})`);
      dataPoints.push(runningCapital);
    });

    if (state.equityChartInstance) {
      state.equityChartInstance.destroy();
    }

    // Gradient fill for teal
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(0, 128, 128, 0.45)');
    gradient.addColorStop(1, 'rgba(0, 128, 128, 0.0)');

    state.equityChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Equity ($)',
          data: dataPoints,
          borderColor: '#008080',
          borderWidth: 2.5,
          backgroundColor: gradient,
          fill: true,
          tension: 0.3,
          pointRadius: labels.length > 25 ? 1 : 4,
          pointBackgroundColor: '#26e2e2',
          pointBorderColor: '#1a1a1a',
          pointBorderWidth: 1.5,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#222222',
            titleColor: '#ffffff',
            bodyColor: '#26e2e2',
            borderColor: 'rgba(0, 128, 128, 0.5)',
            borderWidth: 1,
            callbacks: {
              label: function (context) {
                const val = context.raw;
                const idx = context.dataIndex;
                let diffStr = '';
                if (idx > 0 && idx <= filtered.length) {
                  const trade = filtered[idx - 1];
                  const pnl = getTradePnL(trade);
                  const sign = pnl >= 0 ? '+' : '';
                  diffStr = ` (${sign}$${formatMoney(pnl)})`;
                }
                return ` ยอดพอร์ต: $${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${diffStr}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#888888',
              maxTicksLimit: 8,
              font: { family: "'Inter', 'Prompt', sans-serif" }
            }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            ticks: {
              color: '#888888',
              font: { family: "'Inter', 'Prompt', sans-serif" },
              callback: function (val) {
                return '$' + val.toLocaleString();
              }
            }
          }
        }
      }
    });
  }

  // ================= DAILY P&L CALENDAR =================
  function renderCalendar() {
    const grid = document.getElementById('calendar-days-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid || !label) return;

    const currentYear = state.calendarDate.getFullYear();
    const currentMonth = state.calendarDate.getMonth(); // 0 - 11

    const monthNames = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    label.textContent = `${monthNames[currentMonth]} ${currentYear + 543}`;

    // Compute PnL per day for the current month
    const dailyPnLMap = {};
    const relevantTrades = state.trades.filter(t => {
      if (state.activePortfolioId !== 'ALL' && t.portfolioId !== state.activePortfolioId) return false;
      if (t.status !== 'CLOSED') return false;
      return true;
    });

    relevantTrades.forEach(trade => {
      const dateStr = trade.exitTime || trade.entryTime;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        const dayNum = d.getDate();
        dailyPnLMap[dayNum] = (dailyPnLMap[dayNum] || 0) + getTradePnL(trade);
      }
    });

    grid.innerHTML = '';

    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Blank cells before first day
    for (let i = 0; i < firstDayIndex; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-day-cell empty';
      grid.appendChild(blank);
    }

    const today = new Date();
    const isThisMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;

    // Actual month days
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell';
      if (isThisMonth && today.getDate() === day) {
        cell.classList.add('today');
      }

      const pnl = dailyPnLMap[day];
      let pnlHtml = '';

      if (pnl !== undefined) {
        if (pnl > 0) {
          cell.classList.add('has-win');
          pnlHtml = `<span class="cal-day-pnl text-win">+$${formatMoney(pnl)}</span>`;
        } else if (pnl < 0) {
          cell.classList.add('has-loss');
          pnlHtml = `<span class="cal-day-pnl text-loss">-$${formatMoney(Math.abs(pnl))}</span>`;
        } else {
          cell.classList.add('has-be');
          pnlHtml = `<span class="cal-day-pnl text-muted">$0.00</span>`;
        }
      }

      cell.innerHTML = `
        <span class="cal-day-num">${day}</span>
        ${pnlHtml}
      `;

      grid.appendChild(cell);
    }
  }

  // ================= TRADES TABLE & LIST =================
  function renderStatusBadge(status, isWin, isLoss) {
    if (status === 'รอ' || status === 'WAITING') {
      return '<span class="badge badge-subtle">รอ</span>';
    }
    if (status === 'กำลังถือ' || status === 'OPEN' || status === 'ถืออยู่') {
      return '<span class="badge badge-teal">กำลังถือ</span>';
    }
    if (status === 'TP') {
      return '<span class="badge badge-win">TP</span>';
    }
    if (status === 'SL') {
      return '<span class="badge badge-loss">SL</span>';
    }
    if (status === 'BE') {
      return '<span class="badge badge-be">BE</span>';
    }
    return `<span class="badge ${isWin ? 'badge-win' : (isLoss ? 'badge-loss' : 'badge-be')}">${status === 'CLOSED' ? 'ปิดแล้ว' : escapeHtml(status || '-')}</span>`;
  }

  function getTradingViewThumbnail(url) {
    if (!url) return '';
    const trimmed = url.trim();
    if (!trimmed) return '';

    // 1. Direct image extensions
    if (/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(trimmed)) {
      return trimmed;
    }

    // 2. TradingView snapshot link (/x/ID)
    const match = trimmed.match(/tradingview\.com\/x\/([a-zA-Z0-9]+)/i);
    if (match && match[1]) {
      const id = match[1];
      const firstChar = id.charAt(0).toLowerCase();
      return `https://s3.tradingview.com/snapshots/${firstChar}/${id}.png`;
    }

    // 3. TradingView S3 direct snapshot
    if (trimmed.includes('s3.tradingview.com/snapshots/')) {
      return trimmed;
    }

    return trimmed;
  }

  function formatCompactDateTime(dateStr) {
    if (!dateStr) return '-';
    // Match YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm or YYYY/MM/DD
    const matchIso = String(dateStr).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}))?/);
    if (matchIso) {
      const year = parseInt(matchIso[1], 10);
      const month = parseInt(matchIso[2], 10);
      const day = parseInt(matchIso[3], 10);
      const hour = matchIso[4] !== undefined ? parseInt(matchIso[4], 10) : 0;
      const min = matchIso[5] !== undefined ? parseInt(matchIso[5], 10) : 0;

      const dd = String(day).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      const thaiYear = year < 2400 ? year + 543 : year;
      const yy = String(thaiYear % 100).padStart(2, '0');
      const hhStr = String(hour).padStart(2, '0');
      const minStr = String(min).padStart(2, '0');
      return `${dd}${mm}${yy} ${hhStr}:${minStr}`;
    }

    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const thaiYear = d.getFullYear() < 2400 ? d.getFullYear() + 543 : d.getFullYear();
      const yy = String(thaiYear % 100).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${dd}${mm}${yy} ${hh}:${min}`;
    }

    return String(dateStr);
  }

  async function renderTradesTable() {
    const tbody = document.getElementById('trades-tbody');
    const emptyState = document.getElementById('trades-empty-state');
    if (!tbody) return;

    const trades = getFilteredTrades().sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));

    if (trades.length === 0) {
      tbody.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    tbody.innerHTML = '';

    for (const trade of trades) {
      const tr = document.createElement('tr');
      const pnl = getTradePnL(trade);
      const isWin = pnl > 0;
      const isLoss = pnl < 0;
      const pnlColorClass = isWin ? 'text-win' : (isLoss ? 'text-loss' : 'text-muted');
      const sign = isWin ? '+' : '';

      const portName = getPortfolioName(trade.portfolioId);
      const entryDateFormatted = formatCompactDateTime(trade.entryTime);

      // 1. Resolve Before source
      let beforeSrc = '';
      let beforeLink = trade.tvBefore || null;
      if (trade.imgBeforeId) {
        beforeSrc = await getImageFromDB(trade.imgBeforeId);
      } else if (trade.tvBefore) {
        beforeSrc = getTradingViewThumbnail(trade.tvBefore);
      }

      // 2. Resolve After source
      let afterSrc = '';
      let afterLink = trade.tvAfter || null;
      if (trade.imgAfterId) {
        afterSrc = await getImageFromDB(trade.imgAfterId);
      } else if (trade.tvAfter) {
        afterSrc = getTradingViewThumbnail(trade.tvAfter);
      }

      // 3. Build thumbnails HTML
      let imgBeforeHtml = '';
      if (beforeSrc) {
        imgBeforeHtml = `
          <div class="thumb-item" data-trade-id="${trade.id}" data-type="before" title="ก่อนเข้าเทรด (Before)">
            <img src="${escapeHtml(beforeSrc)}" class="thumb-preview" alt="Setup"
                 onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.thumb-fallback'); if(fb) fb.style.display='inline-flex';">
            <span class="thumb-preview thumb-fallback" style="display: none;" title="ดูกราฟ (Before)">📈</span>
            <span class="thumb-tag">B</span>
          </div>
        `;
      }

      let imgAfterHtml = '';
      if (afterSrc) {
        imgAfterHtml = `
          <div class="thumb-item" data-trade-id="${trade.id}" data-type="after" title="หลังปิดออเดอร์ (After)">
            <img src="${escapeHtml(afterSrc)}" class="thumb-preview" alt="Result"
                 onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.thumb-fallback'); if(fb) fb.style.display='inline-flex';">
            <span class="thumb-preview thumb-fallback" style="display: none;" title="ดูกราฟ (After)">📊</span>
            <span class="thumb-tag thumb-tag-after">A</span>
          </div>
        `;
      }

      tr.innerHTML = `
        <td data-label="วันเวลา"><small class="text-muted">${entryDateFormatted}</small></td>
        <td data-label="สินทรัพย์" class="td-symbol">
          <strong>${escapeHtml(trade.symbol)}</strong>
        </td>
        <td data-label="ฝั่ง">
          <span class="pos-pill ${trade.position === 'BUY' ? 'pos-buy' : 'pos-sell'}">${trade.position}</span>
        </td>
        <td data-label="ขนาด Lot">${trade.lot}</td>
        <td data-label="ราคาเข้า">${trade.entryPrice}</td>
        <td data-label="ระยะ SL">${trade.slPips != null && trade.slPips !== '' ? `<span class="badge badge-subtle">${trade.slPips}</span>` : '-'}</td>
        <td data-label="กราฟ">
          <div class="img-thumbnails-cell">
            ${imgBeforeHtml}
            ${imgAfterHtml}
            ${(!imgBeforeHtml && !imgAfterHtml) ? '<span class="text-muted text-sm">-</span>' : ''}
          </div>
        </td>
        <td data-label="สถานะ">
          ${renderStatusBadge(trade.status, isWin, isLoss)}
        </td>
        <td data-label="จัดการ" class="td-actions">
          <div style="display: flex; gap: 6px; align-items: center; justify-content: flex-end;">
            <button type="button" class="btn-action-icon btn-edit-trade" title="แก้ไขการเทรด" aria-label="แก้ไข">✏️</button>
            <button type="button" class="btn-action-icon text-loss btn-delete-trade" title="ลบรายการนี้" aria-label="ลบ">🗑️</button>
          </div>
        </td>
      `;

      // Event handlers
      tr.querySelector('.btn-edit-trade').onclick = () => openEditTradeModal(trade.id);
      tr.querySelector('.btn-delete-trade').onclick = () => deleteTrade(trade.id);

      // Gallery click handlers on thumbnails
      tr.querySelectorAll('.thumb-item').forEach(thumb => {
        thumb.onclick = (e) => {
          e.preventDefault();
          openGalleryForTrade(thumb.dataset.tradeId, thumb.dataset.type);
        };
      });

      tbody.appendChild(tr);
    }
  }

  function updateSymbolFilterOptions() {
    const select = document.getElementById('filter-symbol');
    if (!select) return;

    const symbols = Array.from(new Set(state.trades.map(t => t.symbol))).filter(Boolean);
    const currentVal = select.value;

    select.innerHTML = '<option value="ALL">คู่เทรด: ทั้งหมด</option>';
    symbols.forEach(sym => {
      const opt = document.createElement('option');
      opt.value = sym;
      opt.textContent = sym;
      select.appendChild(opt);
    });

    if (symbols.includes(currentVal)) {
      select.value = currentVal;
    }
  }

  // ================= TRADE MODAL (ADD / EDIT) =================
  function updateTradePortfolioRiskHint() {
    const portSelect = document.getElementById('trade-portfolio');
    const hintEl = document.getElementById('trade-portfolio-risk-info');
    if (!portSelect || !hintEl) return;

    const portId = portSelect.value;
    const port = state.portfolios.find(p => p.id === portId);
    if (port) {
      const cap = Number(port.capital) || 0;
      const riskVal = (port.riskPerTrade !== undefined && port.riskPerTrade !== null && port.riskPerTrade !== '') ? Number(port.riskPerTrade) : 1;
      const dollarRisk = cap > 0 ? (cap * riskVal) / 100 : 0;
      const dollarStr = dollarRisk > 0 ? ` ($${formatMoney(dollarRisk)} ต่อไม้)` : '';
      hintEl.innerHTML = `🛡️ ความเสี่ยงพอร์ตนี้: <strong>${riskVal}%</strong>${dollarStr}`;
      hintEl.style.display = 'block';
    } else {
      hintEl.innerHTML = '';
      hintEl.style.display = 'none';
    }
  }

  function openAddTradeModal() {
    state.editingTradeId = null;
    document.getElementById('modal-trade-title').textContent = '📝 บันทึกการเทรดใหม่';
    document.getElementById('form-trade').reset();
    document.getElementById('trade-id').value = '';

    // Set defaults
    if (state.activePortfolioId !== 'ALL') {
      document.getElementById('trade-portfolio').value = state.activePortfolioId;
    } else if (state.portfolios.length > 0) {
      document.getElementById('trade-portfolio').value = state.portfolios[0].id;
    }
    updateTradePortfolioRiskHint();

    const nowIso = new Date().toISOString().slice(0, 16);
    document.getElementById('trade-entry-time').value = nowIso;
    document.getElementById('trade-exit-time').value = nowIso;
    if (document.getElementById('trade-sl-pips')) document.getElementById('trade-sl-pips').value = '';
    if (document.getElementById('trade-tv-before')) document.getElementById('trade-tv-before').value = '';
    if (document.getElementById('trade-tv-after')) document.getElementById('trade-tv-after').value = '';
    if (document.getElementById('trade-status')) document.getElementById('trade-status').value = 'รอ';

    // Reset images
    resetImageDropzones();

    document.getElementById('modal-trade').classList.remove('hidden');
  }

  async function openEditTradeModal(tradeId) {
    const trade = state.trades.find(t => t.id === tradeId);
    if (!trade) return;

    state.editingTradeId = tradeId;
    document.getElementById('modal-trade-title').textContent = `✏️ แก้ไขการเทรด: ${trade.symbol}`;
    document.getElementById('trade-id').value = trade.id;
    document.getElementById('trade-portfolio').value = trade.portfolioId;
    updateTradePortfolioRiskHint();
    document.getElementById('trade-symbol').value = trade.symbol;

    const radio = document.querySelector(`input[name="trade-position"][value="${trade.position}"]`);
    if (radio) radio.checked = true;

    document.getElementById('trade-lot').value = trade.lot;
    document.getElementById('trade-entry-price').value = trade.entryPrice;
    if (document.getElementById('trade-sl-pips')) document.getElementById('trade-sl-pips').value = trade.slPips ?? '';
    if (document.getElementById('trade-exit-price')) document.getElementById('trade-exit-price').value = trade.exitPrice || '';
    if (document.getElementById('trade-sl')) document.getElementById('trade-sl').value = trade.sl || '';
    if (document.getElementById('trade-tp')) document.getElementById('trade-tp').value = trade.tp || '';
    if (document.getElementById('trade-rr')) document.getElementById('trade-rr').value = trade.rr || '';
    if (document.getElementById('trade-pnl')) document.getElementById('trade-pnl').value = trade.pnl ?? '';
    let statusVal = trade.status || 'รอ';
    if (statusVal === 'OPEN' || statusVal === 'ถืออยู่') statusVal = 'กำลังถือ';
    else if (statusVal === 'WAITING') statusVal = 'รอ';
    else if (statusVal === 'CLOSED') {
      if (Number(trade.pnl) > 0) statusVal = 'TP';
      else if (Number(trade.pnl) < 0) statusVal = 'SL';
      else statusVal = 'BE';
    }
    const statusSelect = document.getElementById('trade-status');
    if (statusSelect) {
      statusSelect.value = statusVal;
      if (!statusSelect.value) statusSelect.value = 'รอ';
    }
    document.getElementById('trade-entry-time').value = trade.entryTime || '';
    document.getElementById('trade-exit-time').value = trade.exitTime || '';
    document.getElementById('trade-strategy').value = trade.strategy || '';
    document.getElementById('trade-emotion-before').value = trade.emotionBefore || 'มั่นใจตามแผน';
    document.getElementById('trade-emotion-after').value = trade.emotionAfter || 'พอใจ ทำตามแผนได้ดี';
    if (document.getElementById('trade-lessons')) document.getElementById('trade-lessons').value = trade.lessons || '';
    if (document.getElementById('trade-next-plan')) document.getElementById('trade-next-plan').value = trade.nextPlan || '';
    if (document.getElementById('trade-tv-before')) document.getElementById('trade-tv-before').value = trade.tvBefore || '';
    if (document.getElementById('trade-tv-after')) document.getElementById('trade-tv-after').value = trade.tvAfter || '';

    // Set images
    resetImageDropzones();
    if (trade.imgBeforeId) {
      const url = await getImageFromDB(trade.imgBeforeId);
      if (url) setImageDropzone('dropzone-before', url);
    }
    if (trade.imgAfterId) {
      const url = await getImageFromDB(trade.imgAfterId);
      if (url) setImageDropzone('dropzone-after', url);
    }

    document.getElementById('modal-trade').classList.remove('hidden');
  }

  function resetImageDropzones() {
    ['before', 'after'].forEach(type => {
      const dropzone = document.getElementById(`dropzone-${type}`);
      const preview = document.getElementById(`preview-${type}`);
      const hiddenInput = document.getElementById(`data-img-${type}`);
      const btnRemove = document.getElementById(`btn-remove-${type}`);

      if (hiddenInput) hiddenInput.value = '';
      if (preview) preview.innerHTML = '<span class="dropzone-placeholder">คลิกเพื่อเลือกไฟล์ หรือกด <strong>Ctrl+V</strong> วางรูปจากหน้าจอ</span>';
      if (btnRemove) btnRemove.classList.add('hidden');
    });
  }

  function setImageDropzone(dropzoneId, base64Url) {
    const isBefore = dropzoneId.includes('before');
    const type = isBefore ? 'before' : 'after';
    const preview = document.getElementById(`preview-${type}`);
    const hiddenInput = document.getElementById(`data-img-${type}`);
    const btnRemove = document.getElementById(`btn-remove-${type}`);

    if (hiddenInput) hiddenInput.value = base64Url;
    if (preview) preview.innerHTML = `<img src="${base64Url}" alt="Preview">`;
    if (btnRemove) btnRemove.classList.remove('hidden');
  }

  async function handleSaveTrade(e) {
    e.preventDefault();

    const id = document.getElementById('trade-id').value || ('trade_' + Date.now());
    const portfolioId = document.getElementById('trade-portfolio').value;
    const symbol = document.getElementById('trade-symbol').value.trim().toUpperCase();
    const position = document.querySelector('input[name="trade-position"]:checked').value;
    const existingTrade = state.trades.find(t => t.id === id);
    const lot = Number(document.getElementById('trade-lot').value) || 0.01;
    const entryPrice = Number(document.getElementById('trade-entry-price').value) || 0;
    const slPips = document.getElementById('trade-sl-pips')?.value ? Number(document.getElementById('trade-sl-pips').value) : null;
    const exitPrice = document.getElementById('trade-exit-price') ? (document.getElementById('trade-exit-price').value ? Number(document.getElementById('trade-exit-price').value) : null) : (existingTrade?.exitPrice || null);
    const sl = document.getElementById('trade-sl') ? (document.getElementById('trade-sl').value ? Number(document.getElementById('trade-sl').value) : null) : (existingTrade?.sl || null);
    const tp = document.getElementById('trade-tp') ? (document.getElementById('trade-tp').value ? Number(document.getElementById('trade-tp').value) : null) : (existingTrade?.tp || null);
    const rr = document.getElementById('trade-rr') ? (document.getElementById('trade-rr').value ? Number(document.getElementById('trade-rr').value) : null) : (existingTrade?.rr || null);
    let pnl = document.getElementById('trade-pnl') ? (Number(document.getElementById('trade-pnl').value) || 0) : (existingTrade?.pnl || 0);
    const status = document.getElementById('trade-status').value;
    if (!pnl) {
      pnl = getTradePnL({
        portfolioId,
        status,
        rr
      });
    }
    const entryTime = document.getElementById('trade-entry-time').value;
    const exitTime = document.getElementById('trade-exit-time').value;
    const strategy = document.getElementById('trade-strategy').value.trim();
    const emotionBefore = document.getElementById('trade-emotion-before').value;
    const emotionAfter = document.getElementById('trade-emotion-after').value;
    const lessons = document.getElementById('trade-lessons') ? document.getElementById('trade-lessons').value.trim() : (existingTrade?.lessons || '');
    const nextPlan = document.getElementById('trade-next-plan') ? document.getElementById('trade-next-plan').value.trim() : (existingTrade?.nextPlan || '');
    const tvBefore = document.getElementById('trade-tv-before') ? document.getElementById('trade-tv-before').value.trim() : (existingTrade?.tvBefore || '');
    const tvAfter = document.getElementById('trade-tv-after') ? document.getElementById('trade-tv-after').value.trim() : (existingTrade?.tvAfter || '');

    // Handle images in IndexedDB
    const rawImgBefore = document.getElementById('data-img-before')?.value || '';
    const rawImgAfter = document.getElementById('data-img-after')?.value || '';

    let imgBeforeId = existingTrade?.imgBeforeId || null;
    let imgAfterId = existingTrade?.imgAfterId || null;

    if (rawImgBefore) {
      imgBeforeId = await saveImageToDB(rawImgBefore);
    }
    if (rawImgAfter) {
      imgAfterId = await saveImageToDB(rawImgAfter);
    }

    const tradeObj = {
      id,
      portfolioId,
      symbol,
      position,
      lot,
      entryPrice,
      slPips,
      exitPrice,
      sl,
      tp,
      rr,
      pnl,
      status,
      entryTime,
      exitTime,
      strategy,
      emotionBefore,
      emotionAfter,
      lessons,
      nextPlan,
      tvBefore,
      tvAfter,
      imgBeforeId,
      imgAfterId
    };

    const existingIndex = state.trades.findIndex(t => t.id === id);
    if (existingIndex >= 0) {
      state.trades[existingIndex] = tradeObj;
      showToast(`อัปเดตไม้เทรด ${symbol} สำเร็จ`, 'success');
    } else {
      state.trades.unshift(tradeObj);
      showToast(`บันทึกไม้เทรด ${symbol} สำเร็จ`, 'success');
    }

    saveTradesToStorage();
    document.getElementById('modal-trade').classList.add('hidden');
    renderAll();
  }

  let tradePendingDeleteId = null;

  function openDeleteTradeModal(tradeId) {
    const trade = state.trades.find(t => t.id === tradeId);
    if (!trade) return;

    tradePendingDeleteId = tradeId;
    const modal = document.getElementById('modal-confirm-delete-trade');
    const msgEl = document.getElementById('delete-trade-confirm-message');
    if (msgEl) {
      msgEl.innerHTML = `ต้องการที่จะลบหรือไม่`;
    }
    if (modal) modal.classList.remove('hidden');
  }

  function closeDeleteTradeModal() {
    tradePendingDeleteId = null;
    const modal = document.getElementById('modal-confirm-delete-trade');
    if (modal) modal.classList.add('hidden');
  }

  function confirmDeleteTrade() {
    if (!tradePendingDeleteId) return;
    const tradeId = tradePendingDeleteId;
    const trade = state.trades.find(t => t.id === tradeId);
    closeDeleteTradeModal();

    if (!trade) return;

    state.trades = state.trades.filter(t => t.id !== tradeId);
    saveTradesToStorage();
    renderAll();
    showToast('ลบรายการเทรดเรียบร้อย (กดปุ่ม Upload เพื่ออัปเดต Google Sheets)', 'info');
  }

  function deleteTrade(tradeId) {
    openDeleteTradeModal(tradeId);
  }

  // ================= AUTO RISK:REWARD CALCULATION =================
  function setupAutoCalculations() {
    const entryEl = document.getElementById('trade-entry-price');
    const exitEl = document.getElementById('trade-exit-price');
    const slEl = document.getElementById('trade-sl');
    const tpEl = document.getElementById('trade-tp');
    const rrEl = document.getElementById('trade-rr');
    const pnlEl = document.getElementById('trade-pnl');
    const lotEl = document.getElementById('trade-lot');

    function calculateRR() {
      if (!entryEl || !slEl || !tpEl || !rrEl) return;
      const entry = parseFloat(entryEl.value);
      const sl = parseFloat(slEl.value);
      const tp = parseFloat(tpEl.value);

      if (!isNaN(entry) && !isNaN(sl) && !isNaN(tp)) {
        const risk = Math.abs(entry - sl);
        const reward = Math.abs(tp - entry);
        if (risk > 0) {
          rrEl.value = (reward / risk).toFixed(2);
        }
      }
    }

    // Auto PnL estimate if exit price & lot are filled
    function estimatePnL() {
      if (!pnlEl || !entryEl || !exitEl || !lotEl) return;
      if (pnlEl.value && pnlEl.value !== '0') return; // Do not overwrite user input
      const entry = parseFloat(entryEl.value);
      const exit = parseFloat(exitEl.value);
      const lot = parseFloat(lotEl.value);
      const posRadio = document.querySelector('input[name="trade-position"]:checked');
      const isBuy = posRadio ? posRadio.value === 'BUY' : true;

      if (!isNaN(entry) && !isNaN(exit) && !isNaN(lot)) {
        const diff = isBuy ? (exit - entry) : (entry - exit);
        const estPnL = diff * lot * 100;
        pnlEl.value = estPnL.toFixed(2);
      }
    }

    [entryEl, slEl, tpEl].filter(Boolean).forEach(el => el.addEventListener('input', calculateRR));
    [entryEl, exitEl, lotEl].filter(Boolean).forEach(el => el.addEventListener('input', estimatePnL));
  }

  // ================= CTRL+V CLIPBOARD PASTE FOR SCREENSHOTS =================
  function setupImageUploadHandlers() {
    ['before', 'after'].forEach(type => {
      const dropzone = document.getElementById(`dropzone-${type}`);
      const fileInput = document.getElementById(`file-${type}`);
      const btnRemove = document.getElementById(`btn-remove-${type}`);
      if (!dropzone || !fileInput || !btnRemove) return;

      // Click to choose file
      dropzone.addEventListener('click', (e) => {
        if (e.target !== btnRemove) {
          state.focusedDropzone = type;
          fileInput.click();
        }
      });

      // Track focus for clipboard paste
      dropzone.addEventListener('mouseenter', () => {
        state.focusedDropzone = type;
      });

      // File input change
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          processImageFile(file, type);
        }
      });

      // Drag and drop
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processImageFile(e.dataTransfer.files[0], type);
        }
      });

      // Remove button
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        const preview = document.getElementById(`preview-${type}`);
        const hiddenInput = document.getElementById(`data-img-${type}`);
        hiddenInput.value = '';
        preview.innerHTML = '<span class="dropzone-placeholder">คลิกเพื่อเลือกไฟล์ หรือกด <strong>Ctrl+V</strong> วางรูปจากหน้าจอ</span>';
        btnRemove.classList.add('hidden');
      });
    });

    // Global Paste Listener (Ctrl+V)
    window.addEventListener('paste', (e) => {
      const modalTrade = document.getElementById('modal-trade');
      if (modalTrade && modalTrade.classList.contains('hidden')) return;

      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      let imageFile = null;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          imageFile = items[i].getAsFile();
          break;
        }
      }

      if (imageFile) {
        e.preventDefault();
        const targetType = state.focusedDropzone || 'before';
        processImageFile(imageFile, targetType);
        showToast(`วางภาพลงในช่อง ${targetType === 'before' ? 'ก่อนเข้าเทรด' : 'หลังปิดออเดอร์'} แล้ว`, 'success');
      }
    });
  }

  function processImageFile(file, type) {
    if (!file.type.startsWith('image/')) {
      showToast('กรุณาเลือกไฟล์รูปภาพเท่านั้น', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      // Compress if too huge (> 1.5MB) to keep smooth rendering
      compressImage(e.target.result, 1400, 0.85, (compressedBase64) => {
        setImageDropzone(`dropzone-${type}`, compressedBase64);
      });
    };
    reader.readAsDataURL(file);
  }

  function compressImage(base64Str, maxWidth, quality, callback) {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => callback(base64Str);
  }

  // ================= GALLERY STATE & CONTROLLER =================
  const galleryState = {
    items: [],
    currentIndex: 0,
    isOpen: false
  };

  async function openGalleryForTrade(tradeId, initialType = 'before') {
    const trades = getFilteredTrades().sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));
    const items = [];

    for (const t of trades) {
      // 1. Resolve Before image
      let beforeSrc = '';
      let beforeLink = t.tvBefore || null;
      if (t.imgBeforeId) {
        beforeSrc = await getImageFromDB(t.imgBeforeId);
      } else if (t.tvBefore) {
        beforeSrc = getTradingViewThumbnail(t.tvBefore);
      }

      if (beforeSrc) {
        items.push({
          tradeId: t.id,
          trade: t,
          type: 'before',
          typeLabel: '📸 ก่อนเข้า (Before)',
          title: `${t.symbol} (${t.position}) - ก่อนเข้าเทรด`,
          src: beforeSrc,
          link: beforeLink,
          setup: t.strategy || t.setup || ''
        });
      }

      // 2. Resolve After image
      let afterSrc = '';
      let afterLink = t.tvAfter || null;
      if (t.imgAfterId) {
        afterSrc = await getImageFromDB(t.imgAfterId);
      } else if (t.tvAfter) {
        afterSrc = getTradingViewThumbnail(t.tvAfter);
      }

      if (afterSrc) {
        items.push({
          tradeId: t.id,
          trade: t,
          type: 'after',
          typeLabel: '🎯 หลังปิด (After)',
          title: `${t.symbol} (${t.position}) - หลังปิดออเดอร์`,
          src: afterSrc,
          link: afterLink,
          setup: t.strategy || t.setup || ''
        });
      }
    }

    if (items.length === 0) {
      showToast('ไม่พบรูปภาพสำหรับการแสดงผล', 'info');
      return;
    }

    // Find requested item index
    let targetIndex = items.findIndex(it => it.tradeId === tradeId && it.type === initialType);
    if (targetIndex === -1) {
      targetIndex = items.findIndex(it => it.tradeId === tradeId);
    }
    if (targetIndex === -1) targetIndex = 0;

    galleryState.items = items;
    galleryState.currentIndex = targetIndex;
    showGalleryView();
  }

  function showGalleryView() {
    const modal = document.getElementById('modal-lightbox');
    if (!modal) return;

    galleryState.isOpen = true;
    modal.classList.remove('hidden');
    renderGalleryCurrentItem();
  }

  function closeGallery() {
    const modal = document.getElementById('modal-lightbox');
    if (modal) modal.classList.add('hidden');
    galleryState.isOpen = false;
  }

  function renderGalleryCurrentItem() {
    if (!galleryState.items || galleryState.items.length === 0) return;
    const cur = galleryState.items[galleryState.currentIndex];
    if (!cur) return;

    const symEl = document.getElementById('gallery-symbol');
    const posEl = document.getElementById('gallery-position');
    const timeEl = document.getElementById('gallery-time');
    const statEl = document.getElementById('gallery-status');
    const counterEl = document.getElementById('gallery-counter');
    const linkEl = document.getElementById('gallery-external-link');
    const imgEl = document.getElementById('lightbox-img');
    const capEl = document.getElementById('lightbox-caption');
    const fallbackBox = document.getElementById('gallery-fallback-box');
    const fallbackLink = document.getElementById('gallery-fallback-link');
    const btnPrev = document.getElementById('gallery-btn-prev');
    const btnNext = document.getElementById('gallery-btn-next');
    const tabBefore = document.getElementById('gallery-tab-before');
    const tabAfter = document.getElementById('gallery-tab-after');
    const stripEl = document.getElementById('gallery-thumbnails-strip');

    // 1. Header Meta
    if (symEl) symEl.textContent = cur.trade.symbol || '-';
    if (posEl) {
      posEl.textContent = cur.trade.position || 'BUY';
      posEl.className = `pos-pill ${cur.trade.position === 'SELL' ? 'pos-sell' : 'pos-buy'}`;
    }
    if (timeEl) {
      timeEl.textContent = formatCompactDateTime(cur.trade.entryTime);
    }
    if (statEl) {
      const pnl = getTradePnL(cur.trade);
      const isWin = pnl > 0;
      const isLoss = pnl < 0;
      statEl.textContent = cur.trade.status || '-';
      statEl.className = `badge ${isWin ? 'badge-win' : (isLoss ? 'badge-loss' : 'badge-be')}`;
    }
    if (counterEl) {
      counterEl.textContent = `${galleryState.currentIndex + 1} / ${galleryState.items.length}`;
    }

    // 2. Before / After quick tabs for current trade
    const beforeIdx = galleryState.items.findIndex(it => it.tradeId === cur.tradeId && it.type === 'before');
    const afterIdx = galleryState.items.findIndex(it => it.tradeId === cur.tradeId && it.type === 'after');

    if (tabBefore) {
      tabBefore.classList.toggle('active', cur.type === 'before');
      tabBefore.disabled = beforeIdx === -1;
      tabBefore.classList.toggle('disabled', beforeIdx === -1);
      tabBefore.onclick = () => {
        if (beforeIdx !== -1) {
          galleryState.currentIndex = beforeIdx;
          renderGalleryCurrentItem();
        }
      };
    }

    if (tabAfter) {
      tabAfter.classList.toggle('active', cur.type === 'after');
      tabAfter.disabled = afterIdx === -1;
      tabAfter.classList.toggle('disabled', afterIdx === -1);
      tabAfter.onclick = () => {
        if (afterIdx !== -1) {
          galleryState.currentIndex = afterIdx;
          renderGalleryCurrentItem();
        }
      };
    }

    // 3. External link button
    if (linkEl) {
      if (cur.link) {
        linkEl.href = cur.link;
        linkEl.classList.remove('hidden');
      } else {
        linkEl.classList.add('hidden');
      }
    }

    // 4. Main Image
    if (imgEl) {
      imgEl.style.display = 'block';
      if (fallbackBox) fallbackBox.classList.add('hidden');

      imgEl.onerror = () => {
        imgEl.style.display = 'none';
        if (fallbackBox) {
          fallbackBox.classList.remove('hidden');
          if (fallbackLink) {
            if (cur.link) {
              fallbackLink.href = cur.link;
              fallbackLink.style.display = 'inline-flex';
            } else {
              fallbackLink.style.display = 'none';
            }
          }
        }
      };

      imgEl.src = cur.src;
    }

    // 5. Caption
    if (capEl) {
      let capHtml = `<strong>${escapeHtml(cur.title)}</strong>`;
      if (cur.setup) {
        capHtml += ` <span style="color: var(--teal-hover); margin-left: 8px;">[ กลยุทธ์: ${escapeHtml(cur.setup)} ]</span>`;
      }
      capEl.innerHTML = capHtml;
    }

    // 6. Navigation Buttons
    if (btnPrev) {
      btnPrev.disabled = galleryState.currentIndex <= 0;
      btnPrev.classList.toggle('disabled', galleryState.currentIndex <= 0);
    }
    if (btnNext) {
      btnNext.disabled = galleryState.currentIndex >= galleryState.items.length - 1;
      btnNext.classList.toggle('disabled', galleryState.currentIndex >= galleryState.items.length - 1);
    }

    // 7. Thumbnail Strip
    if (stripEl) {
      stripEl.innerHTML = '';
      galleryState.items.forEach((item, idx) => {
        const thumbDiv = document.createElement('div');
        thumbDiv.className = `gallery-thumb-item ${idx === galleryState.currentIndex ? 'active' : ''}`;
        thumbDiv.title = `${item.title} (${idx + 1}/${galleryState.items.length})`;
        thumbDiv.innerHTML = `
          <img src="${escapeHtml(item.src)}" alt="thumb" onerror="this.src=''; this.alt='📊';">
          <span class="gallery-thumb-tag ${item.type === 'after' ? 'gallery-thumb-tag-after' : ''}">${item.type === 'after' ? 'A' : 'B'}</span>
        `;
        thumbDiv.onclick = () => {
          galleryState.currentIndex = idx;
          renderGalleryCurrentItem();
        };
        stripEl.appendChild(thumbDiv);

        if (idx === galleryState.currentIndex) {
          setTimeout(() => {
            thumbDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }, 50);
        }
      });
    }
  }

  function galleryPrev() {
    if (galleryState.currentIndex > 0) {
      galleryState.currentIndex--;
      renderGalleryCurrentItem();
    }
  }

  function galleryNext() {
    if (galleryState.currentIndex < galleryState.items.length - 1) {
      galleryState.currentIndex++;
      renderGalleryCurrentItem();
    }
  }

  // Fallback single-image openLightbox
  function openLightbox(imgSrc, captionText, linkUrl) {
    if (!imgSrc) return;
    galleryState.items = [{
      tradeId: 'single',
      trade: { symbol: 'กราฟ', position: 'BUY', status: '-', entryTime: '' },
      type: 'before',
      typeLabel: 'รูปภาพ',
      title: captionText || 'ภาพขยายกราฟ',
      src: imgSrc,
      link: linkUrl || null,
      setup: ''
    }];
    galleryState.currentIndex = 0;
    showGalleryView();
  }

  function initLightbox() {
    const modal = document.getElementById('modal-lightbox');
    const btnClose = document.getElementById('btn-close-lightbox');
    const btnPrev = document.getElementById('gallery-btn-prev');
    const btnNext = document.getElementById('gallery-btn-next');

    if (btnClose) btnClose.onclick = closeGallery;
    if (btnPrev) btnPrev.onclick = galleryPrev;
    if (btnNext) btnNext.onclick = galleryNext;

    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) closeGallery();
      };
    }

    // Keyboard support (Escape to close, Left/Right arrows to navigate)
    window.addEventListener('keydown', (e) => {
      if (!galleryState.isOpen) return;
      if (e.key === 'Escape') {
        closeGallery();
      } else if (e.key === 'ArrowLeft') {
        galleryPrev();
      } else if (e.key === 'ArrowRight') {
        galleryNext();
      }
    });
  }

  // ================= GOOGLE SHEETS & APPS SCRIPT SYNC =================
  const APPS_SCRIPT_CODE_TEMPLATE = `/**
 * Google Apps Script Web App for Daily Journal
 * Google Sheet ID: \${GOOGLE_SHEET_ID}
 *
 * Provides Secure Authentication, Upload & Download for Trades & Portfolios!
 * ข้อมูลคอลัมน์ใน Google Sheets (ตรงตามหน้าเว็บ 100%):
 * 1. วันเวลาเข้าเทรด
 * 2. วันเวลาปิดออเดอร์
 * 3. สินทรัพย์ / คู่เทรด
 * 4. ฝั่ง (Buy/Sell)
 * 5. ขนาด Lot
 * 6. ราคาเข้า (Entry)
 * 7. ระยะ SL (Pips)
 * 8. สถานะออเดอร์
 * 9. กลยุทธ์ (Setup / Strategy)
 * 10. อารมณ์ก่อนเทรด
 * 11. อารมณ์หลังปิดออเดอร์
 * 12. ลิงก์ TradingView (Before)
 * 13. ลิงก์ TradingView (After)
 */

var SHEET_ID = "\${GOOGLE_SHEET_ID}";
var AUTH_USER = "run";
var AUTH_PASS = "88888888";

function doGet(e) {
  try {
    if (e && e.parameter && (e.parameter.action === "DOWNLOAD_ALL" || e.parameter.action === "GET_ALL" || e.parameter.action === "DOWNLOAD")) {
      var ss = SpreadsheetApp.openById(SHEET_ID);
      return handleDownloadAll(ss);
    }
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    message: 'Daily Journal Web App API is active!'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var payload = JSON.parse(rawData);
    var action = payload.action;

    // ACTION: LOGIN (ตรวจสอบสิทธิ์เข้าสู่ระบบ)
    if (action === "LOGIN") {
      var username = (payload.username || "").trim();
      var password = (payload.password || "").trim();
      if (username === AUTH_USER && password === AUTH_PASS) {
        var token = Utilities.base64Encode(username + ":" + new Date().getTime());
        return jsonResponse({
          status: "success",
          message: "เข้าสู่ระบบสำเร็จ",
          token: token,
          username: AUTH_USER
        });
      } else {
        return jsonResponse({
          status: "error",
          message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
        });
      }
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);

    // ACTION: CREATE_SHEET (เมื่อผู้ใช้สร้างพอร์ตใหม่ในเว็บ)
    if (action === "CREATE_SHEET") {
      var sheetName = (payload.sheetName || "").trim();
      if (!sheetName) {
        return jsonResponse({ status: "error", message: "Missing sheetName" });
      }
      var targetSheet = ss.getSheetByName(sheetName);
      if (!targetSheet) {
        targetSheet = ss.insertSheet(sheetName);
      }
      setupSheetHeaders(targetSheet);

      var sheets = ss.getSheets();
      if (sheets.length > 1) {
        var blankSheet = ss.getSheetByName("Sheet1") || ss.getSheetByName("แผ่นงาน1");
        if (blankSheet && blankSheet.getName() !== sheetName && blankSheet.getLastRow() <= 1) {
          try { ss.deleteSheet(blankSheet); } catch(e) {}
        }
      }
      return jsonResponse({ status: "success", message: "Sheet created: " + sheetName });
    }

    // ACTION: DELETE_SHEET (เมื่อผู้ใช้ลบพอร์ตในเว็บ)
    if (action === "DELETE_SHEET") {
      var delName = (payload.sheetName || "").trim().toLowerCase();
      var allSheets = ss.getSheets();
      var target = null;
      for (var i = 0; i < allSheets.length; i++) {
        if (allSheets[i].getName().trim().toLowerCase() === delName) {
          target = allSheets[i];
          break;
        }
      }

      if (target) {
        if (allSheets.length > 1) {
          ss.deleteSheet(target);
          return jsonResponse({ status: "success", message: "Sheet deleted: " + payload.sheetName });
        } else {
          var defSheet = ss.insertSheet("Sheet1");
          setupSheetHeaders(defSheet);
          ss.deleteSheet(target);
          return jsonResponse({ status: "success", message: "Sheet deleted and reset: " + payload.sheetName });
        }
      }
      return jsonResponse({ status: "ignored", message: "Sheet not found: " + payload.sheetName });
    }

    // ACTION: RENAME_SHEET (เมื่อผู้ใช้แก้ไขชื่อพอร์ตในเว็บ)
    if (action === "RENAME_SHEET") {
      var oldName = (payload.oldName || "").trim().toLowerCase();
      var newName = (payload.newName || "").trim();
      if (!newName) {
        return jsonResponse({ status: "error", message: "Missing newName" });
      }
      var allSheets = ss.getSheets();
      var target = null;
      for (var i = 0; i < allSheets.length; i++) {
        if (allSheets[i].getName().trim().toLowerCase() === oldName) {
          target = allSheets[i];
          break;
        }
      }
      if (target) {
        target.setName(newName);
        return jsonResponse({ status: "success", message: "Sheet renamed to " + newName });
      } else {
        var newSheet = ss.getSheetByName(newName) || ss.insertSheet(newName);
        setupSheetHeaders(newSheet);
        return jsonResponse({ status: "success", message: "Sheet created: " + newName });
      }
    }

    // ACTION: SYNC_ALL / UPLOAD_ALL (อัปโหลดข้อมูลทั้งหมด)
    if (action === "SYNC_ALL" || action === "UPLOAD_ALL") {
      var trades = payload.trades || [];
      var portfolios = payload.portfolios || [];

      // 1. สร้างหรืออัปเดต Tab Sheet ของแต่ละพอร์ต
      portfolios.forEach(function(port) {
        var sheet = ss.getSheetByName(port.name);
        if (!sheet) {
          sheet = ss.insertSheet(port.name);
        }

        // ล้างข้อมูลเดิมและตั้ง Header ให้ตรงกับหน้าเว็บปัจจุบัน
        sheet.clearContents();
        setupSheetHeaders(sheet);

        var portTrades = trades.filter(function(t) { return t.portfolioId === port.id; });
        var rows = portTrades.map(function(t) {
          return [
            t.entryTime || "",
            t.exitTime || "",
            t.symbol || "",
            t.position || "",
            (t.lot !== undefined && t.lot !== null) ? t.lot : "",
            (t.entryPrice !== undefined && t.entryPrice !== null) ? t.entryPrice : "",
            (t.slPips !== undefined && t.slPips !== null) ? t.slPips : "",
            t.status || "",
            t.strategy || "",
            t.emotionBefore || "",
            t.emotionAfter || "",
            t.tvBefore || "",
            t.tvAfter || ""
          ];
        });

        if (rows.length > 0) {
          sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
        }
      });

      // 2. ลบ Tab Sheet ที่ไม่อยู่ในรายการพอร์ตแล้ว (รวมถึง Sheet1 ว่างๆ)
      var validPortNames = portfolios.map(function(p) { return (p.name || "").trim().toLowerCase(); });
      var currentSheets = ss.getSheets();
      currentSheets.forEach(function(sheetObj) {
        var sName = sheetObj.getName();
        if (validPortNames.indexOf(sName.trim().toLowerCase()) === -1) {
          if (ss.getSheets().length > 1) {
            try {
              var targetToDelete = ss.getSheetByName(sName);
              if (targetToDelete) {
                ss.deleteSheet(targetToDelete);
              }
            } catch(e) {}
          }
        }
      });

      return jsonResponse({ status: "success", message: "Synced " + trades.length + " trades across sheets!" });
    }

    // ACTION: DOWNLOAD_ALL / LOAD_ALL (ดาวน์โหลดข้อมูลทั้งหมดจาก Google Sheet)
    if (action === "DOWNLOAD_ALL" || action === "LOAD_ALL" || action === "GET_ALL" || action === "DOWNLOAD") {
      return handleDownloadAll(ss);
    }

    return jsonResponse({ status: "error", message: "Unknown action" });

  } catch (error) {
    return jsonResponse({ status: "error", message: error.toString() });
  }
}

function handleDownloadAll(ss) {
  var sheets = ss.getSheets();
  var portfolios = [];
  var trades = [];

  sheets.forEach(function (sheet, sIdx) {
    var sheetName = sheet.getName();
    var portId = "port_" + sheetName.toLowerCase().replace(/[^a-z0-9]/g, "_");

    portfolios.push({
      id: portId,
      name: sheetName,
      capital: 1000,
      riskPerTrade: 1,
      desc: "พอร์ต " + sheetName
    });

    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var numCols = Math.max(13, sheet.getLastColumn());
      var rows = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

      rows.forEach(function (row, rIdx) {
        var hasData = row.some(function(val) {
          return val !== "" && val !== null && val !== undefined;
        });
        if (!hasData) return;

        var entryTime = formatDateTime(row[0]);
        var exitTime = formatDateTime(row[1]);
        var symbol = String(row[2] || "").trim().toUpperCase();
        var pos = String(row[3] || "BUY").trim().toUpperCase();
        if (pos.indexOf("SELL") !== -1 || pos.indexOf("SHORT") !== -1) {
          pos = "SELL";
        } else {
          pos = "BUY";
        }

        var lot = parseFloat(row[4]) || 0.01;
        var entryPrice = parseFloat(row[5]) || 0;
        var slPips = (row[6] !== "" && row[6] !== null && row[6] !== undefined) ? parseFloat(row[6]) : null;
        var status = String(row[7] || "รอ").trim();
        var strategy = String(row[8] || "").trim();
        var emotionBefore = String(row[9] || "").trim();
        var emotionAfter = String(row[10] || "").trim();
        var tvBefore = String(row[11] || "").trim();
        var tvAfter = String(row[12] || "").trim();

        trades.push({
          id: "trade_gs_" + sIdx + "_" + rIdx + "_" + (Date.now() - rIdx * 1000),
          portfolioId: portId,
          portfolioName: sheetName,
          entryTime: entryTime,
          exitTime: exitTime,
          symbol: symbol,
          position: pos,
          lot: lot,
          entryPrice: entryPrice,
          slPips: slPips,
          status: status,
          strategy: strategy,
          emotionBefore: emotionBefore,
          emotionAfter: emotionAfter,
          tvBefore: tvBefore,
          tvAfter: tvAfter,
          imgBeforeId: null,
          imgAfterId: null
        });
      });
    }
  });

  return jsonResponse({
    status: "success",
    message: "ดาวน์โหลดข้อมูลสำเร็จ",
    portfolios: portfolios,
    trades: trades
  });
}

function formatDateTime(val) {
  if (!val) return "";
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = String(val.getMonth() + 1).padStart(2, '0');
    var d = String(val.getDate()).padStart(2, '0');
    var hh = String(val.getHours()).padStart(2, '0');
    var mm = String(val.getMinutes()).padStart(2, '0');
    return y + "-" + m + "-" + d + "T" + hh + ":" + mm;
  }
  return String(val);
}

function setupSheetHeaders(sheet) {
  var headers = [
    "วันเวลาเข้าเทรด",
    "วันเวลาปิดออเดอร์",
    "สินทรัพย์ / คู่เทรด",
    "ฝั่ง (Buy/Sell)",
    "ขนาด Lot",
    "ราคาเข้า (Entry)",
    "ระยะ SL (Pips)",
    "สถานะออเดอร์",
    "กลยุทธ์ (Setup / Strategy)",
    "อารมณ์ก่อนเทรด",
    "อารมณ์หลังปิดออเดอร์",
    "ลิงก์ TradingView (Before)",
    "ลิงก์ TradingView (After)"
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#008080").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;

  async function callAppsScriptWebhook(action, extraPayload = {}) {
    if (!state.syncUrl) {
      throw new Error('ยังไม่ได้ระบุ Web App URL ของ Google Apps Script');
    }

    const payload = {
      action,
      ...extraPayload
    };

    const response = await fetch(state.syncUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });

    return response;
  }

  // ================= UPLOAD TO GOOGLE SHEETS =================
  async function uploadAllToSheets(showToasts = true) {
    if (!state.syncUrl) {
      if (showToasts) showToast('กรุณาระบุ Web App URL ในเมนูตั้งค่าก่อนอัปโหลด', 'error');
      return;
    }

    const btnUpload = document.getElementById('btn-upload-sheet');
    const syncDot = document.getElementById('sync-dot');
    const syncText = document.getElementById('sync-text');
    const syncLastTime = document.getElementById('sync-last-time');

    let originalBtnHtml = '';
    if (btnUpload) {
      originalBtnHtml = btnUpload.innerHTML;
      btnUpload.disabled = true;
      btnUpload.innerHTML = '<span class="spinner-sm"></span> <span>กำลังอัปโหลด...</span>';
    }

    if (syncDot) syncDot.className = 'sync-dot dot-syncing';
    if (syncText) syncText.textContent = 'Google Sheets: กำลังอัปโหลดข้อมูลขึ้น Cloud...';

    try {
      const response = await callAppsScriptWebhook('SYNC_ALL', {
        portfolios: state.portfolios,
        trades: state.trades
      });

      const data = await response.json();

      if (data && data.status === 'success') {
        const now = new Date();
        const timeStr = now.toLocaleDateString('th-TH', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        localStorage.setItem(STORAGE_KEYS.LAST_SYNC, timeStr);

        if (syncDot) syncDot.className = 'sync-dot dot-connected';
        if (syncText) syncText.textContent = 'Google Sheets: Cloud เชื่อมต่อแล้ว';
        if (syncLastTime) syncLastTime.innerHTML = `<span>🕒 อัปโหลดล่าสุด: ${timeStr}</span>`;

        if (showToasts) {
          showToast(`✅ อัปโหลดขึ้น Google Sheet สำเร็จ! (${state.trades.length} ออเดอร์, ${state.portfolios.length} พอร์ต)`, 'success');
        }
      } else {
        throw new Error(data.message || 'การอัปโหลดล้มเหลว');
      }
    } catch (err) {
      console.warn('Upload to Google Sheets error:', err);
      if (syncDot) syncDot.className = 'sync-dot dot-error';
      if (syncText) syncText.textContent = 'Google Sheets: อัปโหลดผิดพลาด (โปรดตรวจ Web App URL)';
      if (showToasts) {
        showToast('การอัปโหลดขึ้น Google Sheet ไม่สำเร็จ: ' + (err.message || 'ข้อผิดพลาดเครือข่าย'), 'error');
      }
    } finally {
      if (btnUpload) {
        btnUpload.disabled = false;
        btnUpload.innerHTML = originalBtnHtml;
      }
    }
  }

  // ================= DOWNLOAD FROM GOOGLE SHEETS =================
  async function downloadAllFromSheets(showToasts = true) {
    if (!state.syncUrl) {
      if (showToasts) showToast('กรุณาระบุ Web App URL ในเมนูตั้งค่าก่อนดาวน์โหลด', 'error');
      return;
    }

    const btnDownload = document.getElementById('btn-download-sheet');
    const syncDot = document.getElementById('sync-dot');
    const syncText = document.getElementById('sync-text');
    const syncLastTime = document.getElementById('sync-last-time');

    let originalBtnHtml = '';
    if (btnDownload) {
      originalBtnHtml = btnDownload.innerHTML;
      btnDownload.disabled = true;
      btnDownload.innerHTML = '<span class="spinner-sm"></span> <span>กำลังดาวน์โหลด...</span>';
    }

    if (syncDot) syncDot.className = 'sync-dot dot-syncing';
    if (syncText) syncText.textContent = 'Google Sheets: กำลังดาวน์โหลดข้อมูลจาก Cloud...';

    try {
      const response = await callAppsScriptWebhook('DOWNLOAD_ALL');
      const data = await response.json();

      if (data && data.status === 'success') {
        const remotePortfolios = Array.isArray(data.portfolios) ? data.portfolios : [];
        const remoteTrades = Array.isArray(data.trades) ? data.trades : [];

        const norm = (str) => (str || '').toString().trim().toLowerCase();
        const portIdMap = new Map();

        // 1. Update portfolios: preserve local capital & desc if existing
        if (remotePortfolios.length > 0) {
          const mergedPortfolios = remotePortfolios.map(rPort => {
            const rNameNorm = norm(rPort.name);
            const local = state.portfolios.find(lp => norm(lp.name) === rNameNorm || lp.id === rPort.id);
            const finalId = local ? local.id : rPort.id;

            if (rPort.id) portIdMap.set(rPort.id, finalId);
            if (rNameNorm) portIdMap.set(rNameNorm, finalId);
            if (local && local.id) portIdMap.set(local.id, finalId);

            return {
              id: finalId,
              name: rPort.name,
              capital: local && local.capital ? local.capital : (rPort.capital || 1000),
              riskPerTrade: local && local.riskPerTrade !== undefined ? local.riskPerTrade : (rPort.riskPerTrade || 1),
              desc: local && local.desc ? local.desc : (rPort.desc || `พอร์ต ${rPort.name}`)
            };
          });
          state.portfolios = mergedPortfolios;
          savePortfoliosToStorage();
        }

        // 2. Update trades: correctly map each trade's portfolioId to state.portfolios
        const updatedTrades = remoteTrades.map(rTrade => {
          const rPort = remotePortfolios.find(rp => rp.id === rTrade.portfolioId);
          const portNameNorm = norm(rTrade.portfolioName || (rPort ? rPort.name : ''));

          let finalPortId = portIdMap.get(rTrade.portfolioId) ||
            (portNameNorm ? portIdMap.get(portNameNorm) : null);

          if (!finalPortId && portNameNorm) {
            const matchedPort = state.portfolios.find(p => norm(p.name) === portNameNorm);
            if (matchedPort) finalPortId = matchedPort.id;
          }

          if (!finalPortId) {
            finalPortId = (state.portfolios[0] ? state.portfolios[0].id : rTrade.portfolioId);
          }

          const matchedPortObj = state.portfolios.find(p => p.id === finalPortId);

          const localTrade = state.trades.find(lt =>
            lt.id === rTrade.id ||
            (lt.entryTime === rTrade.entryTime && lt.symbol === rTrade.symbol && lt.lot === rTrade.lot)
          );

          return {
            ...rTrade,
            portfolioId: finalPortId,
            portfolioName: matchedPortObj ? matchedPortObj.name : (rTrade.portfolioName || ''),
            slPips: localTrade ? localTrade.slPips : (rTrade.slPips ?? null),
            tvBefore: localTrade ? localTrade.tvBefore : (rTrade.tvBefore || ''),
            tvAfter: localTrade ? localTrade.tvAfter : (rTrade.tvAfter || ''),
            imgBeforeId: localTrade ? localTrade.imgBeforeId : null,
            imgAfterId: localTrade ? localTrade.imgAfterId : null
          };
        });

        state.trades = updatedTrades;
        saveTradesToStorage();

        // Make sure active portfolio is valid
        if (state.activePortfolioId !== 'ALL') {
          const activeExists = state.portfolios.some(p => p.id === state.activePortfolioId);
          if (!activeExists && state.portfolios.length > 0) {
            state.activePortfolioId = state.portfolios[0].id;
            saveActivePortfolioToStorage();
          }
        }

        // Refresh UI
        renderAll();
        renderPortfolioModalList();
        renderPortfolioSelector();

        // Switch to Trades tab to immediately display the downloaded trades
        if (typeof switchTab === 'function') {
          switchTab('trades');
        }

        const now = new Date();
        const timeStr = now.toLocaleDateString('th-TH', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        localStorage.setItem(STORAGE_KEYS.LAST_SYNC, timeStr);

        if (syncDot) syncDot.className = 'sync-dot dot-connected';
        if (syncText) syncText.textContent = 'Google Sheets: Cloud เชื่อมต่อแล้ว';
        if (syncLastTime) syncLastTime.innerHTML = `<span>🕒 ดาวน์โหลดล่าสุด: ${timeStr}</span>`;

        if (showToasts) {
          showToast(`✅ ดาวน์โหลดข้อมูลสำเร็จ! แสดงรายการเทรดทั้งหมด ${updatedTrades.length} ไม้ (${state.portfolios.length} พอร์ต)`, 'success');
        }
      } else if (data && data.status === 'error' && (String(data.message).includes('Invalid action') || String(data.message).includes('Unknown action'))) {
        const gasModal = document.getElementById('modal-gas-update');
        if (gasModal) {
          gasModal.classList.remove('hidden');
        }
        if (showToasts) {
          showToast('⚠️ Google Apps Script บนชีตยังไม่มีคำสั่ง Download โปรดดูคำแนะนำในการอัปเดต Code.gs', 'warning');
        }
      } else {
        throw new Error(data ? data.message : 'ดาวน์โหลดไม่สำเร็จ');
      }
    } catch (err) {
      console.warn('Download from Google Sheets error:', err);
      if (syncDot) syncDot.className = 'sync-dot dot-error';
      if (syncText) syncText.textContent = 'Google Sheets: ดาวน์โหลดผิดพลาด (โปรดตรวจ Web App URL)';
      if (showToasts) {
        showToast('การดาวน์โหลดข้อมูลไม่สำเร็จ: ' + (err.message || 'ข้อผิดพลาดเครือข่าย'), 'error');
      }
    } finally {
      if (btnDownload) {
        btnDownload.disabled = false;
        btnDownload.innerHTML = originalBtnHtml;
      }
    }
  }

  async function syncAllToCloud(showToasts = true) {
    return uploadAllToSheets(showToasts);
  }

  function initSyncModal() {
    const modal = document.getElementById('modal-sync');
    const btnOpenBadge = document.getElementById('sync-status-badge');
    const btnOpenTrades = document.getElementById('btn-open-sync');
    const btnClose = document.getElementById('btn-close-sync-modal');
    const btnCloseBottom = document.getElementById('btn-close-sync');
    const btnSave = document.getElementById('btn-save-sync-config');
    const btnTest = document.getElementById('btn-test-sync');
    const btnQuickSync = document.getElementById('btn-quick-sync');
    const inputUrl = document.getElementById('apps-script-url');
    const btnViewCode = document.getElementById('btn-view-script-code');
    const codePreview = document.getElementById('gas-code-preview');
    const btnCopyCode = document.getElementById('btn-copy-code');
    const instructions = document.getElementById('script-instructions');

    if (codePreview) codePreview.textContent = APPS_SCRIPT_CODE_TEMPLATE;

    const openModal = () => {
      if (inputUrl) inputUrl.value = state.syncUrl || DEFAULT_SYNC_URL;
      if (modal) modal.classList.remove('hidden');
    };

    if (btnOpenBadge) btnOpenBadge.onclick = openModal;
    if (btnOpenTrades) btnOpenTrades.onclick = openModal;
    if (btnClose) btnClose.onclick = () => modal.classList.add('hidden');
    if (btnCloseBottom) btnCloseBottom.onclick = () => modal.classList.add('hidden');

    if (btnQuickSync) {
      btnQuickSync.onclick = () => {
        uploadAllToSheets(true);
      };
    }

    if (btnViewCode && instructions) {
      btnViewCode.onclick = () => {
        instructions.classList.toggle('hidden');
      };
    }

    if (btnCopyCode) {
      btnCopyCode.onclick = () => {
        navigator.clipboard.writeText(APPS_SCRIPT_CODE_TEMPLATE).then(() => {
          showToast('คัดลอกโค้ด Google Apps Script ลง Clipboard แล้ว', 'success');
        });
      };
    }

    if (btnSave) {
      btnSave.onclick = () => {
        const url = (inputUrl ? inputUrl.value.trim() : '') || state.syncUrl || DEFAULT_SYNC_URL;
        saveSyncUrlToStorage(url);
        showToast('บันทึก Web App URL แล้ว', 'success');
        if (modal) modal.classList.add('hidden');
        if (url) {
          uploadAllToSheets(true);
        }
      };
    }

    if (btnTest) {
      btnTest.onclick = () => {
        const url = (inputUrl ? inputUrl.value.trim() : '') || state.syncUrl || DEFAULT_SYNC_URL;
        saveSyncUrlToStorage(url);
        uploadAllToSheets(true);
      };
    }
  }

  // ================= GOOGLE SHEETS ACTIONS (SETTINGS VIEW) =================
  function initSheetsActions() {
    const btnUpload = document.getElementById('btn-upload-sheet');
    const btnDownload = document.getElementById('btn-download-sheet');
    const btnQuickSync = document.getElementById('btn-quick-sync');
    const syncLastTime = document.getElementById('sync-last-time');

    // Download confirmation modal elements
    const modalDownload = document.getElementById('modal-confirm-download');
    const btnConfirmDownload = document.getElementById('btn-confirm-download');
    const btnCancelDownload = document.getElementById('btn-cancel-download');
    const btnCloseDownloadModal = document.getElementById('btn-close-download-modal');

    // GAS config and code modal elements
    const btnToggleGas = document.getElementById('btn-toggle-gas-config');
    const gasConfigPanel = document.getElementById('gas-config-panel');
    const settingsSyncUrl = document.getElementById('settings-sync-url');
    const btnSaveSettingsUrl = document.getElementById('btn-save-settings-url');
    const btnCopyGasCode = document.getElementById('btn-copy-gas-code');

    const modalGasUpdate = document.getElementById('modal-gas-update');
    const btnCloseGasModal = document.getElementById('btn-close-gas-modal');
    const btnCloseGasModalBtn = document.getElementById('btn-close-gas-modal-btn');
    const btnCopyGasCodeModal = document.getElementById('btn-copy-gas-code-modal');

    // Load saved last sync time
    const lastSync = localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
    if (syncLastTime && lastSync) {
      syncLastTime.innerHTML = `<span>🕒 อัปเดตล่าสุด: ${lastSync}</span>`;
    }

    if (settingsSyncUrl) {
      settingsSyncUrl.value = state.syncUrl || DEFAULT_SYNC_URL;
    }

    // Toggle GAS config panel
    if (btnToggleGas && gasConfigPanel) {
      btnToggleGas.onclick = () => {
        gasConfigPanel.classList.toggle('hidden');
      };
    }

    // Save Settings Sync URL
    if (btnSaveSettingsUrl && settingsSyncUrl) {
      btnSaveSettingsUrl.onclick = () => {
        const val = settingsSyncUrl.value.trim() || DEFAULT_SYNC_URL;
        saveSyncUrlToStorage(val);
        showToast('บันทึก Web App URL สำเร็จเรียบร้อย', 'success');
      };
    }

    // Copy Code.gs
    const copyGasCode = () => {
      navigator.clipboard.writeText(APPS_SCRIPT_CODE_TEMPLATE).then(() => {
        showToast('คัดลอกโค้ด Code.gs ใหม่ล่าสุดเรียบร้อยแล้ว', 'success');
      }).catch(() => {
        showToast('ไม่สามารถคัดลอกโค้ดได้ กรุณาคัดลอกจากไฟล์ Code.gs', 'error');
      });
    };

    if (btnCopyGasCode) btnCopyGasCode.onclick = copyGasCode;
    if (btnCopyGasCodeModal) btnCopyGasCodeModal.onclick = copyGasCode;

    // Close GAS modal
    const closeGasModal = () => {
      if (modalGasUpdate) modalGasUpdate.classList.add('hidden');
    };
    if (btnCloseGasModal) btnCloseGasModal.onclick = closeGasModal;
    if (btnCloseGasModalBtn) btnCloseGasModalBtn.onclick = closeGasModal;

    // Upload action
    if (btnUpload) {
      btnUpload.onclick = () => {
        uploadAllToSheets(true);
      };
    }

    // Quick sync button also uploads
    if (btnQuickSync) {
      btnQuickSync.onclick = () => {
        uploadAllToSheets(true);
      };
    }

    // Download confirmation modal handlers
    if (btnDownload && modalDownload) {
      btnDownload.onclick = () => {
        modalDownload.classList.remove('hidden');
      };
    }

    const closeDownloadModal = () => {
      if (modalDownload) modalDownload.classList.add('hidden');
    };

    if (btnCancelDownload) btnCancelDownload.onclick = closeDownloadModal;
    if (btnCloseDownloadModal) btnCloseDownloadModal.onclick = closeDownloadModal;

    if (btnConfirmDownload) {
      btnConfirmDownload.onclick = () => {
        closeDownloadModal();
        downloadAllFromSheets(true);
      };
    }
  }

  // ================= CSV / EXCEL EXPORT =================
  function exportTradesToCSV() {
    const trades = getFilteredTrades();
    if (trades.length === 0) {
      showToast('ไม่มีข้อมูลการเทรดสำหรับส่งออก', 'error');
      return;
    }

    const headers = [
      'ID', 'พอร์ต', 'วันเวลาเข้าเทรด', 'วันเวลาปิดออเดอร์', 'Symbol', 'Position', 'Lot',
      'Entry Price', 'SL Pips', 'Status',
      'Strategy', 'Emotion Before', 'Emotion After',
      'TradingView Before', 'TradingView After'
    ];

    const rows = trades.map(t => [
      t.id,
      getPortfolioName(t.portfolioId),
      t.entryTime || '',
      t.exitTime || '',
      t.symbol,
      t.position,
      t.lot,
      t.entryPrice,
      t.slPips ?? '',
      t.status,
      `"${(t.strategy || '').replace(/"/g, '""')}"`,
      `"${(t.emotionBefore || '').replace(/"/g, '""')}"`,
      `"${(t.emotionAfter || '').replace(/"/g, '""')}"`,
      `"${(t.tvBefore || '').replace(/"/g, '""')}"`,
      `"${(t.tvAfter || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `DailyJournal_Trades_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('ดาวน์โหลดไฟล์ CSV เรียบร้อยแล้ว', 'success');
  }

  // ================= GENERAL UI & EVENT LISTENERS =================
  function setupGeneralEventListeners() {
    // Add Trade Buttons
    const btnAddTrade = document.getElementById('btn-add-trade');
    if (btnAddTrade) btnAddTrade.onclick = openAddTradeModal;
    const btnEmptyAdd = document.getElementById('btn-empty-add-trade');
    if (btnEmptyAdd) btnEmptyAdd.onclick = openAddTradeModal;
    const btnFab = document.getElementById('btn-fab-add-trade');
    if (btnFab) btnFab.onclick = openAddTradeModal;
    const floatingFab = document.getElementById('floating-btn-add-trade');
    if (floatingFab) floatingFab.onclick = openAddTradeModal;
    const btnCloseModal = document.getElementById('btn-close-trade-modal');
    if (btnCloseModal) btnCloseModal.onclick = () => document.getElementById('modal-trade').classList.add('hidden');
    const btnCancelTrade = document.getElementById('btn-cancel-trade');
    if (btnCancelTrade) btnCancelTrade.onclick = () => document.getElementById('modal-trade').classList.add('hidden');
    const formTrade = document.getElementById('form-trade');
    if (formTrade) formTrade.onsubmit = handleSaveTrade;

    // Portfolio Manager
    const portModal = document.getElementById('modal-portfolio');
    const btnOpenPort = document.getElementById('btn-open-portfolio-manager');
    if (btnOpenPort) {
      btnOpenPort.onclick = () => {
        renderPortfolioModalList();
        portModal.classList.remove('hidden');
      };
    }
    const btnClosePort = document.getElementById('btn-close-portfolio-modal');
    if (btnClosePort) btnClosePort.onclick = () => portModal.classList.add('hidden');
    const btnDonePort = document.getElementById('btn-done-portfolio');
    if (btnDonePort) btnDonePort.onclick = () => portModal.classList.add('hidden');

    // Confirm Delete Portfolio Modal
    const modalDeletePort = document.getElementById('modal-confirm-delete-port');
    const btnCancelDeletePort = document.getElementById('btn-cancel-delete-port');
    const btnCloseDeletePort = document.getElementById('btn-close-delete-port-modal');
    const btnConfirmDeletePort = document.getElementById('btn-confirm-delete-port');

    if (btnCancelDeletePort) btnCancelDeletePort.onclick = closeDeletePortfolioModal;
    if (btnCloseDeletePort) btnCloseDeletePort.onclick = closeDeletePortfolioModal;
    if (btnConfirmDeletePort) btnConfirmDeletePort.onclick = confirmDeletePortfolio;
    if (modalDeletePort) {
      modalDeletePort.onclick = (e) => {
        if (e.target === modalDeletePort) closeDeletePortfolioModal();
      };
    }

    // Confirm Delete Trade Modal
    const modalDeleteTrade = document.getElementById('modal-confirm-delete-trade');
    const btnCancelDeleteTrade = document.getElementById('btn-cancel-delete-trade');
    const btnCloseDeleteTrade = document.getElementById('btn-close-delete-trade-modal');
    const btnConfirmDeleteTrade = document.getElementById('btn-confirm-delete-trade');

    if (btnCancelDeleteTrade) btnCancelDeleteTrade.onclick = closeDeleteTradeModal;
    if (btnCloseDeleteTrade) btnCloseDeleteTrade.onclick = closeDeleteTradeModal;
    if (btnConfirmDeleteTrade) btnConfirmDeleteTrade.onclick = confirmDeleteTrade;
    if (modalDeleteTrade) {
      modalDeleteTrade.onclick = (e) => {
        if (e.target === modalDeleteTrade) closeDeleteTradeModal();
      };
    }

    // Portfolio Manager Form Toggle & Submit
    const btnToggleCreatePort = document.getElementById('btn-toggle-create-port');
    const formCreatePort = document.getElementById('form-create-portfolio');
    const btnCloseCreatePort = document.getElementById('btn-close-create-port');
    const btnCancelCreatePort = document.getElementById('btn-cancel-create-port');

    function togglePortfolioForm(show) {
      if (!formCreatePort) return;
      const isCurrentlyHidden = formCreatePort.classList.contains('hidden');
      const shouldShow = typeof show === 'boolean' ? show : isCurrentlyHidden;

      if (shouldShow) {
        resetPortfolioForm();
        formCreatePort.classList.remove('hidden');
        if (btnToggleCreatePort) {
          btnToggleCreatePort.innerHTML = '✕ ปิด';
          btnToggleCreatePort.className = 'btn btn-ghost btn-sm';
        }
        const nameInput = document.getElementById('new-port-name');
        if (nameInput) setTimeout(() => nameInput.focus(), 60);
      } else {
        formCreatePort.classList.add('hidden');
        resetPortfolioForm();
        if (btnToggleCreatePort) {
          btnToggleCreatePort.innerHTML = '➕ เพิ่มพอร์ต';
          btnToggleCreatePort.className = 'btn btn-teal btn-sm';
        }
      }
    }

    if (btnToggleCreatePort) {
      btnToggleCreatePort.onclick = () => togglePortfolioForm();
    }
    if (btnCloseCreatePort) {
      btnCloseCreatePort.onclick = () => togglePortfolioForm(false);
    }
    if (btnCancelCreatePort) {
      btnCancelCreatePort.onclick = () => togglePortfolioForm(false);
    }

    if (formCreatePort) {
      formCreatePort.onsubmit = async (e) => {
        e.preventDefault();
        const editId = document.getElementById('edit-port-id')?.value;
        const name = document.getElementById('new-port-name').value;
        const capital = document.getElementById('new-port-capital').value;
        const desc = document.getElementById('new-port-desc').value;
        const risk = document.getElementById('new-port-risk')?.value;
        if (!name || !name.trim()) return;

        if (editId) {
          await updatePortfolio(editId, name, capital, desc, risk);
        } else {
          await createPortfolio(name, capital, desc, risk);
        }
        formCreatePort.reset();
        togglePortfolioForm(false);
      };
    }

    const portCapInput = document.getElementById('new-port-capital');
    const portRiskInput = document.getElementById('new-port-risk');
    if (portCapInput) portCapInput.addEventListener('input', updatePortRiskHint);
    if (portRiskInput) portRiskInput.addEventListener('input', updatePortRiskHint);

    const tradePortSelect = document.getElementById('trade-portfolio');
    if (tradePortSelect) tradePortSelect.addEventListener('change', updateTradePortfolioRiskHint);

    // Calendar navigation
    const btnCalPrev = document.getElementById('btn-cal-prev');
    if (btnCalPrev) {
      btnCalPrev.onclick = () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
        renderCalendar();
      };
    }
    const btnCalNext = document.getElementById('btn-cal-next');
    if (btnCalNext) {
      btnCalNext.onclick = () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
        renderCalendar();
      };
    }

    // Filters
    const filterSearch = document.getElementById('filter-search');
    if (filterSearch) {
      filterSearch.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        renderAllTradesAndMetrics();
      });
    }

    const filterOutcome = document.getElementById('filter-outcome');
    if (filterOutcome) {
      filterOutcome.addEventListener('change', (e) => {
        state.filters.outcome = e.target.value;
        renderAllTradesAndMetrics();
      });
    }

    const filterSymbol = document.getElementById('filter-symbol');
    if (filterSymbol) {
      filterSymbol.addEventListener('change', (e) => {
        state.filters.symbol = e.target.value;
        renderAllTradesAndMetrics();
      });
    }

    // Export CSV
    const btnExport = document.getElementById('btn-export-csv');
    if (btnExport) btnExport.onclick = exportTradesToCSV;

    // Delegated click handlers for portfolio actions (Edit & Delete)
    document.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.btn-delete-portfolio');
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const portId = deleteBtn.getAttribute('data-port-id');
        if (portId) deletePortfolio(portId);
        return;
      }

      const editBtn = e.target.closest('.btn-edit-portfolio');
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        const portId = editBtn.getAttribute('data-port-id');
        if (portId) openEditPortfolio(portId);
        return;
      }
    });
  }

  function renderAllTradesAndMetrics() {
    renderMetrics();
    renderTradesTable();
    renderEquityChart();
    renderCalendar();
  }

  function renderAll() {
    renderPortfolioSelector();
    renderPortfolioModalList();
    updateSymbolFilterOptions();
    renderMetrics();
    renderEquityChart();
    renderCalendar();
    renderTradesTable();
  }

  // ================= UTILITIES =================
  function formatMoney(num) {
    return Math.abs(Number(num) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ================= TAB NAVIGATION =================
  function switchTab(tab) {
    const navItems = document.querySelectorAll('.bottom-nav-item');
    const appMain = document.getElementById('app-main');

    // Switch Active Tab on Navigation Bar
    navItems.forEach(btn => {
      if (btn.getAttribute('data-tab') === tab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Switch In-Page View
    if (appMain) {
      appMain.setAttribute('data-tab', tab);
      appMain.setAttribute('data-mobile-tab', tab);
    }

    // Specific actions per tab
    if (tab === 'portfolios') {
      renderPortfolioModalList();
    }
    if (tab === 'trades') {
      renderTradesTable();
    }
    if (tab === 'home') {
      renderMetrics();
      setTimeout(() => {
        renderEquityChart();
        renderCalendar();
      }, 60);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ================= MOBILE BOTTOM NAVIGATION =================
  function initMobileBottomNav() {
    const navItems = document.querySelectorAll('.bottom-nav-item');
    const fabBtn = document.getElementById('bottom-nav-fab');
    const floatingFab = document.getElementById('floating-btn-add-trade');

    // 3. Floating Action (+) Button: Record Trade
    if (floatingFab) {
      floatingFab.onclick = () => {
        openAddTradeModal();
      };
    }
    if (fabBtn) {
      fabBtn.onclick = () => {
        openAddTradeModal();
      };
    }

    navItems.forEach(item => {
      item.onclick = () => {
        const tab = item.getAttribute('data-tab');
        switchTab(tab);
      };
    });
  }

  // ================= INITIALIZATION =================
  window.addEventListener('DOMContentLoaded', () => {
    loadStateFromStorage();
    initAuth();
    setupGeneralEventListeners();
    setupAutoCalculations();
    setupImageUploadHandlers();
    initLightbox();
    initSyncModal();
    initSheetsActions();
    initMobileBottomNav();

    if (state.isAuthenticated) {
      renderAll();
      if (state.syncUrl) {
        const syncDot = document.getElementById('sync-dot');
        const syncText = document.getElementById('sync-text');
        if (syncDot) syncDot.className = 'sync-dot dot-connected';
        if (syncText) syncText.textContent = 'Google Sheets: Cloud เชื่อมต่อแล้ว';
      }
    }
  });

})();
