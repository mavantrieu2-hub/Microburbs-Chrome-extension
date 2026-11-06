// content.js - TỰ ĐỘNG LỌC ĐỊA CHỈ & HỖ TRỢ CHUYỂN TRANG ĐỘNG (SPA) + LẮNG NGHE POPUP

(function () {
  'use strict';

  // Biến toàn cục lưu trạng thái để tránh gọi API trùng lặp
  let currentGnafId = null;       // Lưu mã ID căn nhà từ API Microburbs
  let lastProcessedUrl = "";     // Lưu URL vừa kiểm tra gần nhất
  let lastFetchedAddress = "";   // Lưu địa chỉ vừa gọi API gần nhất
  let nearbyCache = { gnafId: null, promise: null }; // Cache dữ liệu tiện ích (dùng chung cho 2 tab)
  let gearingCache = { gnafId: null, promise: null }; // Cache negative gearing (API tính phí 20c/lần)
  let compsCache = { gnafId: null, promise: null };   // Cache CMA comparables (API tính phí 60c/lần)
  let activeTab = 'summary';   // Tab đang mở: summary | nearby

  // =========================================================================
  // BƯỚC 1: KIỂM TRA XEM CÓ ĐÚNG TRANG CHI TIẾT CĂN NHÀ KHÔNG (BỎ TRANG DANH SÁCH)
  // =========================================================================
  function isPropertyDetailPage() {
    const path = window.location.pathname; // Lấy đường dẫn URL (Ví dụ: /sold-listings/...)
    const fullUrl = window.location.href;  // Lấy toàn bộ URL kể cả parameters

    if (
      path === '/' || path === '' ||
      path.includes('/search') ||
      path.includes('/buy/in-') ||
      path.includes('/rent/in-') ||
      path.includes('/sold/in-') ||
      path.includes('-listings') ||   // Lọc Domain list
      fullUrl.includes('list-')       // Lọc Realestate list
    ) {
      return false;
    }

    if (window.location.hostname.includes('realestate.com.au')) {
      return /\/property(-|\/)/i.test(path);
    }

    if (window.location.hostname.includes('domain.com.au')) {
      return /-\d{6,}$/i.test(path);
    }

    return false;
  }

  // =========================================================================
  // BƯỚC 2: TRÍCH XUẤT ĐỊA CHỈ SẠCH DÙNG REGEX (GỌT RỬA TỰ ĐỘNG)
  // =========================================================================
  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function extractAddress() {
    const addressRegex = /\b(\d+[\w\/\-]*\s+[\s\S]*?\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b(?:\s*\d{4})?)\b/i;
    const seoNoise = /Property Sold|Auction Results|Properties for Sale|Properties for Rent/i;

    const candidates = [
      document.querySelector('[data-testid="listing-details__summary-title"]')?.innerText,
      document.querySelector('h1')?.innerText,
      document.title
    ];

    for (const text of candidates) {
      if (!text || seoNoise.test(text)) continue;
      const m = text.trim().match(addressRegex);
      if (!m || !m[1]) continue;

      const address = m[1].trim()
        .replace(/\s*,?\s*\d{4}$/, '')
        .replace(/,\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i, ' $1')
        .replace(/,\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Domain: địa chỉ phải khớp với slug trong URL, nếu không là nội dung cũ chưa kịp cập nhật
      if (location.hostname.includes('domain.com.au')) {
        if (!location.pathname.toLowerCase().includes(slugify(address))) continue;
      }

      return address;
    }

    return null;
  }

  // =========================================================================
  // BƯỚC 3: TẠO VÀ CHÈN KHUNG SIDEBAR VÀO TẬP TIN HTML DOM
  // =========================================================================
  function createSidebarContainer() {
    let sidebar = document.getElementById('microburbs-sidebar-root');
    if (sidebar) return sidebar;

    sidebar = document.createElement('div');
    sidebar.id = 'microburbs-sidebar-root';
    sidebar.innerHTML = `
      <div class="mb-header">
        <div class="mb-header-text">
          <div class="mb-logo">Microburbs</div>
          <div class="mb-tagline">Real facts for this address</div>
        </div>
        <div class="mb-header-btns">
          <button id="mb-min-btn" aria-label="Minimise" title="Minimise">&minus;</button>
          <button id="mb-close-btn" aria-label="Close" title="Close">&times;</button>
        </div>
      </div>
      
      <div class="mb-tabs">
        <button id="mb-tab-summary" class="mb-tab-btn active">Overview</button>
        <button id="mb-tab-nearby" class="mb-tab-btn">Details</button>
        <button id="mb-tab-invest" class="mb-tab-btn">Investment</button>
        <button id="mb-tab-comps" class="mb-tab-btn">Comparables</button>
      </div>

      <div id="mb-content-body" class="mb-body">
        <div class="mb-spinner">🔍 Connecting to the Microburbs API…</div>
      </div>
    `;
    document.body.appendChild(sidebar);

    document.getElementById('mb-min-btn').onclick = () => {
      sidebar.classList.toggle('mb-collapsed');
    };

    document.getElementById('mb-close-btn').onclick = () => {
      sidebar.style.display = 'none';
    };

    document.getElementById('mb-tab-summary').onclick = () => switchTab('summary');
    document.getElementById('mb-tab-nearby').onclick = () => switchTab('nearby');
    document.getElementById('mb-tab-invest').onclick = () => switchTab('invest');
    document.getElementById('mb-tab-comps').onclick = () => switchTab('comps');

    return sidebar;
  }

  // =========================================================================
  // BƯỚC 4: RENDER DỮ LIỆU ĐỊNH GIÁ & BASICS VÀO TAB TỔNG QUAN
  // =========================================================================
  // ---------- Tiện ích dùng chung ----------
  const esc = (str) => String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtDist = (m) => m == null ? ''
    : (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

  const fmtDate = (v) => {
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

  const TRANSPORT_META = {
    train: { icon: '🚆', name: 'Train' },
    tram:  { icon: '🚊', name: 'Tram' },
    bus:   { icon: '🚌', name: 'Bus' },
    ferry: { icon: '⛴️', name: 'Ferry' }
  };

  const AMENITY_ICONS = {
    supermarket: '🛒', restaurant: '🍽️', cafe: '☕', green_spaces: '🌳', 'green space': '🌳', park: '🌳'
  };
  const AMENITY_NAMES = {
    supermarket: 'Supermarket', restaurant: 'Restaurant', cafe: 'Café',
    green_spaces: 'Green space', 'green space': 'Green space', park: 'Park'
  };
  const amenityIcon = (cat) => AMENITY_ICONS[String(cat).toLowerCase()] || '📌';
  const prettyCat = (cat) => {
    const t = String(cat).replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const catIcon = (c) => TRANSPORT_META[c]?.icon || amenityIcon(c);
  const catName = (c) => TRANSPORT_META[c]?.name || AMENITY_NAMES[String(c).toLowerCase()] || prettyCat(c);

  // Mỗi dòng: nhãn bên trái | giá trị đậm + ghi chú nhỏ bên phải
  const factRow = (label, value, note = '') => `
    <div class="mb-fact">
      <div class="mb-fact-label">${label}</div>
      <div class="mb-fact-right">
        <div class="mb-fact-value">${value}</div>
        ${note ? `<div class="mb-fact-note">${note}</div>` : ''}
      </div>
    </div>`;

  const factBlock = (title, inner) => `
    <div class="mb-facts">
      <div class="mb-facts-title">${title}</div>
      ${inner}
    </div>`;

  const emptyLine = (text) => `<div class="mb-fact-empty">${text}</div>`;

  // ---------- Quản lý tab ----------
  function setActiveTab(tabName) {
    activeTab = tabName;
    ['summary', 'nearby', 'invest', 'comps'].forEach(t => {
      const btn = document.getElementById(`mb-tab-${t}`);
      if (btn) btn.classList.toggle('active', t === tabName);
    });
  }

  // Tải dữ liệu tiện ích 1 lần cho mỗi căn nhà; dùng chung cho Overview (bản đồ) và Details
  function loadNearby(gnafId) {
    if (nearbyCache.gnafId === gnafId && nearbyCache.promise) return nearbyCache.promise;

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "FETCH_NEARBY", gnafId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: true, message: chrome.runtime.lastError.message });
        } else {
          resolve(response || { error: true, message: 'No response from the background service.' });
        }
      });
    });

    nearbyCache = { gnafId, promise };
    // Lỗi thì bỏ cache để lần sau thử lại
    promise.then(r => {
      if (r && r.error && nearbyCache.promise === promise) nearbyCache = { gnafId: null, promise: null };
    });
    return promise;
  }

  function switchTab(tabName) {
    const body = document.getElementById('mb-content-body');
    setActiveTab(tabName);

    if (tabName === 'summary') {
      if (window.cachedSummaryData) renderSummaryData(window.cachedSummaryData);
      return;
    }

    if (!currentGnafId) {
      body.innerHTML = `<div class="mb-error-box">⚠️ No GNAF ID available to look up.</div>`;
      return;
    }

    if (tabName === 'invest') {
      body.innerHTML = `<div class="mb-spinner">💰 Loading investment figures…</div>`;
      const gearingId = currentGnafId;
      loadGearing(gearingId).then((response) => {
        if (gearingId !== currentGnafId || activeTab !== 'invest') return; // đã đổi nhà / đổi tab
        renderInvestmentData(response);
      });
      return;
    }

    if (tabName === 'comps') {
      body.innerHTML = `<div class="mb-spinner">🏘️ Loading comparable sales…</div>`;
      const compsId = currentGnafId;
      // Dữ liệu tiện ích đã được tải cho bản đồ -> dùng lại để tính khoảng cách tới từng căn
      Promise.all([loadComps(compsId), loadNearby(compsId)]).then(([res, nearby]) => {
        if (compsId !== currentGnafId || activeTab !== 'comps') return; // đã đổi nhà / đổi tab
        renderCompsData(res, nearby);
      });
      return;
    }

    body.innerHTML = `<div class="mb-spinner">🏫 Loading transport, amenities and schools…</div>`;
    const requestedId = currentGnafId;
    loadNearby(requestedId).then((response) => {
      if (requestedId !== currentGnafId || activeTab !== 'nearby') return; // đã đổi nhà / đổi tab
      renderDetailsData(response);
    });
  }

  // =========================================================================
  // TAB OVERVIEW: bản đồ + giá ước tính + thông tin cơ bản
  // =========================================================================
  function renderSummaryData(data) {
    const body = document.getElementById('mb-content-body');
    setActiveTab('summary');

    if (!data || data.error) {
      body.innerHTML = `
        <div class="mb-error-box">
          <strong>🚨 MICROBURBS API ERROR</strong><br/>
          <strong>Failed step:</strong> ${esc(data?.step || 'UNKNOWN')}<br/>
          <strong>Details:</strong> ${esc(data?.message || 'No response from the background service')}<br/>
        </div>`;
      return;
    }

    currentGnafId = data.gnafId;
    const money = (v) => v ? `$${Number(v).toLocaleString('en-AU')}` : 'Not available';

    const rows = [];

    // Hàng giá ước tính nổi bật
    rows.push(`
      <div class="mb-fact mb-fact-hero">
        <div class="mb-fact-label mb-fact-label-caps">Estimated value</div>
        <div class="mb-fact-right">
          <div class="mb-fact-value">${money(data.avmEstimate)}</div>
          <div class="mb-fact-note">Estimate, not an asking price${data.avmEstDate ? ` · ${esc(fmtDate(data.avmEstDate))}` : ''}</div>
        </div>
      </div>`);

    rows.push(factRow('Price range',
      (data.avmLow && data.avmHigh) ? `${money(data.avmLow)} – ${money(data.avmHigh)}` : 'Not available',
      'Lower and upper bounds of the estimate'));

    if (data.confidenceScore) {
      rows.push(factRow('Confidence', `${esc(data.confidenceScore)}%`, 'Model confidence in the estimate'));
    }
    if (data.dwellingType) rows.push(factRow('Dwelling type', esc(data.dwellingType)));
    if (data.landAreaSqm) rows.push(factRow('Land area', `${esc(data.landAreaSqm)} m²`));

    const parking = data.parkingCount;
    const pills = [
      data.bedCount != null ? `🛏️ ${plural(data.bedCount, 'bedroom')}` : null,
      data.bathCount != null ? `🚿 ${plural(data.bathCount, 'bathroom')}` : null,
      parking != null ? (parking > 0 ? `🚗 ${plural(parking, 'car space')}` : '🚗 No car space') : null
    ].filter(Boolean).map(t => `<span class="mb-pill">${t}</span>`).join('');

    body.innerHTML = `
      <div class="mb-overview">
        <div class="mb-overview-left">
          <div class="mb-map-card" id="mb-map-card">
            <div class="mb-map-loading">🗺️ Loading map…</div>
          </div>
        </div>
        <div class="mb-overview-right">
          <div class="mb-facts mb-facts-flat">${rows.join('')}</div>
          ${pills ? `<div class="mb-pills mb-pills-flat">${pills}</div>` : ''}
          <div class="mb-gnaf">GNAF ID: ${esc(data.gnafId)}</div>
          <div class="mb-footer-pill">✓ Address matched${data.matchedAddress ? `: ${esc(data.matchedAddress)}` : ''}. No listing copied.</div>
        </div>
      </div>
    `;

    // Bản đồ tải song song; vẽ vào thẻ khi dữ liệu về (nếu người dùng vẫn ở tab Overview)
    const requestedId = data.gnafId;
    loadNearby(requestedId).then((nearby) => {
      if (requestedId !== currentGnafId || activeTab !== 'summary') return;
      renderMapCard(nearby);
    });
  }

  // ---------- Thẻ bản đồ ----------
  const MIN_RADIUS_M = 100;
  const MAX_RADIUS_M = 2000;   // không vượt NEARBY_RADIUS_M trong background.js
  const RADIUS_STEP_M = 100;
  let MAP_RADIUS_M = 400;

  function renderMapCard(nearby) {
    const card = document.getElementById('mb-map-card');
    if (!card) return;

    if (!nearby || nearby.error || !nearby.center) {
      card.innerHTML = `<div class="mb-map-empty">🗺️ Map unavailable${
        nearby && nearby.error ? `: ${esc(nearby.message || 'unknown error')}` : ' (no coordinates for this property)'}.</div>`;
      return;
    }

    card.innerHTML = `
      <iframe id="mb-map-frame" class="mb-map-frame" src="${chrome.runtime.getURL('map.html')}"></iframe>
      <div class="mb-map-toolbar">
        <span class="mb-map-toolbar-label">Search radius</span>
        <div class="mb-stepper">
          <button id="mb-btn-radius-down" type="button" aria-label="Decrease radius">−</button>
          <strong id="mb-radius-val"></strong>
          <button id="mb-btn-radius-up" type="button" aria-label="Increase radius">+</button>
        </div>
      </div>
      <div id="mb-map-pills" class="mb-pills"></div>`;

    document.getElementById('mb-btn-radius-down').onclick = () => changeRadius(-RADIUS_STEP_M, nearby);
    document.getElementById('mb-btn-radius-up').onclick = () => changeRadius(RADIUS_STEP_M, nearby);

    refreshMapMeta(nearby);
    mountMap(nearby);
  }

  function changeRadius(delta, data) {
    const next = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, MAP_RADIUS_M + delta));
    if (next === MAP_RADIUS_M) return;
    MAP_RADIUS_M = next;
    refreshMapMeta(data);
    mountMap(data);
  }

  // Cập nhật số bán kính, trạng thái nút và các pill thống kê dưới bản đồ
  function refreshMapMeta(data) {
    const label = document.getElementById('mb-radius-val');
    const pills = document.getElementById('mb-map-pills');
    const down = document.getElementById('mb-btn-radius-down');
    const up = document.getElementById('mb-btn-radius-up');

    if (label) label.textContent = fmtDist(MAP_RADIUS_M);
    if (down) down.disabled = MAP_RADIUS_M <= MIN_RADIUS_M;
    if (up) up.disabled = MAP_RADIUS_M >= MAX_RADIUS_M;

    if (pills) {
      const counts = {};
      getPointsInRadius(data).forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
      const entries = Object.entries(counts);
      pills.innerHTML = entries.length
        ? entries.map(([k, v]) => `<span class="mb-pill">${catIcon(k)} ${esc(catName(k))}: ${v}</span>`).join('')
        : `<span class="mb-pill mb-pill-muted">No amenities within ${fmtDist(MAP_RADIUS_M)}</span>`;
    }
  }

  // Khoảng cách chim bay (mét) giữa 2 toạ độ
  function getStraightDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Tất cả điểm nằm trong bán kính (theo chim bay từ lat/lng), gần nhất trước
  function getPointsInRadius(data) {
    if (!data.center) return [];
    const dist = (lat, lng) => getStraightDistanceMeters(data.center.lat, data.center.lng, lat, lng);
    const out = [];

    (data.amenities?.results || []).forEach(r => {
      if (r.lat == null || r.lng == null) return;
      const d = dist(r.lat, r.lng);
      if (d <= MAP_RADIUS_M) {
        out.push({ category: r.category || 'other', name: r.name, lat: r.lat, lng: r.lng,
                   distance_m: Math.round(d), isTransport: false });
      }
    });

    Object.entries(data.transport?.nearest || {}).forEach(([mode, n]) => {
      if (!n || n.lat == null || n.lng == null) return;
      const d = dist(n.lat, n.lng);
      if (d <= MAP_RADIUS_M) {
        out.push({ category: mode, name: n.label || mode, lat: n.lat, lng: n.lng,
                   distance_m: Math.round(d), isTransport: true });
      }
    });

    return out.sort((a, b) => a.distance_m - b.distance_m);
  }

  // Đóng gói dữ liệu vẽ bản đồ: giới hạn số icon mỗi loại, tăng dần theo bán kính
  function buildMapPayload(data) {
    if (!data.center) return null;

    const perCategoryLimit = Math.ceil(MAP_RADIUS_M / 400) * 3; // 400m→3, 800m→6, 1200m→9...
    const seen = {};
    const points = getPointsInRadius(data).filter(p => {
      if (p.isTransport) return true;
      seen[p.category] = (seen[p.category] || 0) + 1;
      return seen[p.category] <= perCategoryLimit;
    });

    return { center: data.center, radius: MAP_RADIUS_M, points };
  }

  // Gửi dữ liệu vào iframe; gửi lại được nhiều lần khi đổi bán kính
  function mountMap(data) {
    const frame = document.getElementById('mb-map-frame');
    if (!frame) return;

    const send = () => {
      const payload = buildMapPayload(data); // luôn lấy bán kính mới nhất
      if (payload) frame.contentWindow.postMessage({ type: 'MB_MAP_DATA', payload }, '*');
    };

    if (frame.dataset.ready === '1') return send();      // iframe đã sẵn sàng
    if (frame.dataset.listening === '1') return;          // đang chờ READY, sẽ gửi bản mới nhất

    frame.dataset.listening = '1';
    const onMessage = (e) => {
      if (e.source === frame.contentWindow && e.data && e.data.type === 'MB_MAP_READY') {
        frame.dataset.ready = '1';
        window.removeEventListener('message', onMessage);
        send();
      }
    };
    window.addEventListener('message', onMessage);
  }

  // =========================================================================
  // TAB DETAILS: giao thông, tiện ích, trường học
  // =========================================================================
  function renderTransportSection(t) {
    if (!t) return emptyLine('No transport data.');
    return Object.entries(TRANSPORT_META).map(([mode, meta]) => {
      const near = (t.nearest || {})[mode];
      const count = (t.counts || {})[mode] ?? 0;
      return near
        ? factRow(`${meta.icon} Nearest ${meta.name.toLowerCase()}`, fmtDist(near.distance_m),
            `${esc(near.label || meta.name)} · ${count} within ${fmtDist(t.radius)}`)
        : factRow(`${meta.icon} ${meta.name}`, 'None', `Within ${fmtDist(t.radius)}`);
    }).join('');
  }

  function renderAmenitiesSection(a) {
    if (!a) return emptyLine('No amenity data.');

    const groups = {};
    (a.results || []).forEach(r => {
      const key = r.category || 'other';
      (groups[key] = groups[key] || []).push(r);
    });
    Object.values(groups).forEach(list => list.sort((x, y) => x.distance_m - y.distance_m));

    const rows = Object.entries(groups).map(([cat, list]) => {
      const nearest = list[0];
      const total = (a.counts || {})[cat] ?? list.length;
      return factRow(`${catIcon(cat)} ${esc(catName(cat))}`, fmtDist(nearest.distance_m),
        `${esc(nearest.name)} · ${total} within ${fmtDist(a.radius)}`);
    });
    return rows.join('') || emptyLine('No amenities found.');
  }

  function renderSchoolRow(s) {
    const meta = [s.sector, s.school_level_type].filter(Boolean).map(esc).join(' · ');
    const extra = [];
    if (s.naplan_label) extra.push(`🏆 NAPLAN: ${esc(s.naplan_label)}`);
    if (s.socioeconomic_label) extra.push(`📊 ${esc(s.socioeconomic_label)}`);
    if (s.attendance_rate != null) extra.push(`📈 Attendance ${(s.attendance_rate * 100).toFixed(0)}%`);
    return factRow(`🏫 ${esc(s.name)}`, fmtDist(s.distance_m), [meta, ...extra].filter(Boolean).join(' · '));
  }

  const SCHOOLS_PREVIEW = 5;
  function renderSchoolsSection(schools) {
    if (!schools.length) return emptyLine('No school data.');
    const head = schools.slice(0, SCHOOLS_PREVIEW).map(renderSchoolRow).join('');
    const rest = schools.slice(SCHOOLS_PREVIEW);
    return head + (rest.length
      ? `<details class="mb-more"><summary>Show ${rest.length} more school${rest.length === 1 ? '' : 's'}</summary>${rest.map(renderSchoolRow).join('')}</details>`
      : '');
  }

  function renderDetailsData(data) {
    const body = document.getElementById('mb-content-body');

    if (!data || data.error) {
      body.innerHTML = `<div class="mb-error-box">❌ ${esc(data?.message || 'Could not load nearby data')}</div>`;
      return;
    }

    const schools = data.schools || [];
    body.innerHTML = `
      <div class="mb-details-grid">
        <div>
          ${factBlock('NEAREST TRANSPORT', renderTransportSection(data.transport))}
          ${factBlock('NEARBY AMENITIES', renderAmenitiesSection(data.amenities))}
        </div>
        <div>
          ${factBlock(`SCHOOLS (${schools.length})`, renderSchoolsSection(schools))}
        </div>
      </div>`;
  }

  // =========================================================================
  // TAB INVESTMENT: negative gearing
  // =========================================================================
  function loadGearing(gnafId) {
    if (gearingCache.gnafId === gnafId && gearingCache.promise) return gearingCache.promise;

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "FETCH_NEGATIVE_GEARING", gnafId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: true, message: chrome.runtime.lastError.message });
        } else {
          resolve(response || { error: true, message: 'No response from the background service.' });
        }
      });
    });

    gearingCache = { gnafId, promise };
    promise.then(r => {
      if (r && r.error && gearingCache.promise === promise) gearingCache = { gnafId: null, promise: null };
    });
    return promise;
  }

  function renderInvestmentData(res) {
    const body = document.getElementById('mb-content-body');

    if (!res || res.error) {
      body.innerHTML = `<div class="mb-error-box">❌ ${esc(res?.message || 'Could not load investment data')}</div>`;
      return;
    }

    const g = res.data || {};
    const isNum = (v) => typeof v === 'number' && isFinite(v);
    const money = (v) => isNum(v) ? `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-AU')}` : 'Not available';
    const tone = (v) => isNum(v) ? (v < 0 ? 'mb-neg' : 'mb-pos') : '';
    const signed = (v) => `<span class="${tone(v)}">${money(v)}</span>`;

    const status = g.is_negatively_geared === true
      ? '<span class="mb-neg">Negatively geared</span>'
      : g.is_negatively_geared === false
        ? '<span class="mb-pos">Not negatively geared</span>'
        : 'Not available';

    const weekly = isNum(g.net_cashflow_80lvr_wk)
      ? `About ${money(g.net_cashflow_80lvr_wk)} per week`
      : 'Per year';

    const summaryRows = [
      factRow('Gearing status', status, 'Based on the estimated rent and loan costs'),
      factRow('Gross yield', isNum(g.gross_yield_pct) ? `${g.gross_yield_pct.toFixed(2)}%` : 'Not available',
        'Annual rent as a share of property value'),
      factRow('Default LVR', isNum(g.lvr_default) ? `${Math.round(g.lvr_default * 100)}%` : 'Not available',
        'Loan-to-value ratio used in the main scenario')
    ];
    if (g.level) summaryRows.push(factRow('Calculated at', esc(String(g.level).replace(/_/g, ' ')), 'Level of detail used for this result'));

    const cashRows = [
      factRow('At 80% LVR', signed(g.net_cashflow_80lvr), weekly),
      factRow('At 105% LVR', signed(g.net_cashflow_105lvr), 'Loan of 105% of the property value')
    ];

    body.innerHTML = `
      <div class="mb-details-grid">
        <div>${factBlock('GEARING SUMMARY', summaryRows.join(''))}</div>
        <div>${factBlock('NET CASH FLOW PER YEAR', cashRows.join(''))}</div>
      </div>
      ${g.rent_estimate_suspect ? '<div class="mb-warn-box">⚠️ The rent estimate for this property is flagged as suspect, so treat these figures with caution.</div>' : ''}
      <div class="mb-footer-pill">General information only. Not financial advice.</div>`;
  }

  // =========================================================================
  // TAB COMPARABLES: CMA comp set (các căn tương tự đã bán gần đây)
  // =========================================================================
  function loadComps(gnafId) {
    if (compsCache.gnafId === gnafId && compsCache.promise) return compsCache.promise;

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "FETCH_CMA", gnafId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: true, message: chrome.runtime.lastError.message });
        } else {
          resolve(response || { error: true, message: 'No response from the background service.' });
        }
      });
    });

    compsCache = { gnafId, promise };
    promise.then(r => {
      if (r && r.error && compsCache.promise === promise) compsCache = { gnafId: null, promise: null };
    });
    return promise;
  }

  const COMPS_PREVIEW = 6;
  const titleCase = (t) => String(t ?? '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

  function renderCompsData(res, nearby) {
    const body = document.getElementById('mb-content-body');

    if (!res || res.error) {
      body.innerHTML = `<div class="mb-error-box">❌ ${esc(res?.message || 'Could not load comparable sales')}</div>`;
      return;
    }

    const raw = res.data;
    const list = Array.isArray(raw) ? raw : (raw?.results || raw?.comparables || raw?.data || []);
    if (!list.length) {
      body.innerHTML = `<div class="mb-fact-empty">No comparable sales were found for this property.</div>`;
      return;
    }

    const center = nearby && !nearby.error ? nearby.center : null;
    const money = (v) => (typeof v === 'number' && isFinite(v) && v > 0)
      ? `$${Math.round(v).toLocaleString('en-AU')}` : 'Not available';

    const sales = list.map(c => ({
      street: c.street, suburb: c.sal,
      price: c.price != null ? Number(c.price) : NaN,
      date: c.date_sold, ts: Date.parse(c.date_sold),
      beds: c.bedrooms, baths: c.bathrooms, cars: c.garage_spaces, type: c.property_type,
      dist: (center && c.latitude != null && c.longitude != null)
        ? Math.round(getStraightDistanceMeters(center.lat, center.lng, c.latitude, c.longitude)) : null
    }));
    // Bán gần đây nhất lên đầu
    sales.sort((a, b) => (isNaN(b.ts) ? -Infinity : b.ts) - (isNaN(a.ts) ? -Infinity : a.ts));

    const prices = sales.map(x => x.price).filter(p => isFinite(p) && p > 0).sort((a, b) => a - b);
    const n = prices.length;
    const median = n ? (n % 2 ? prices[(n - 1) / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2) : null;
    const latest = sales.find(x => !isNaN(x.ts));
    const avm = window.cachedSummaryData?.avmEstimate;

    const summaryRows = [
      factRow('Comparable sales', String(sales.length), 'Similar properties sold nearby'),
      factRow('Price range', n ? `${money(prices[0])} – ${money(prices[n - 1])}` : 'Not available', 'Lowest to highest sale price'),
      factRow('Median price', money(median), 'Middle sale price of the set')
    ];
    if (latest) summaryRows.push(factRow('Most recent sale', esc(fmtDate(latest.date)), `${esc(titleCase(latest.street))}`));
    if (median && avm) {
      const pct = Math.round((avm / median - 1) * 100);
      summaryRows.push(factRow('Estimate vs median', `${pct > 0 ? '+' : ''}${pct}%`, 'Estimated value compared with the median sale'));
    }

    const TWO_YEARS_MS = 2 * 365 * 24 * 3600 * 1000;
    const saleRow = (x) => {
      const feats = [
        x.beds != null ? `${x.beds} bed` : null,
        x.baths != null ? `${x.baths} bath` : null,
        x.cars != null ? `${x.cars} car` : null
      ].filter(Boolean).join(' · ');
      const note = [
        x.date ? `Sold ${esc(fmtDate(x.date))}` : null,
        feats || null,
        x.type ? esc(titleCase(x.type)) : null,
        x.dist != null ? `${fmtDist(x.dist)} away` : null,
        (!isNaN(x.ts) && Date.now() - x.ts > TWO_YEARS_MS) ? 'Over 2 years ago' : null
      ].filter(Boolean).join(' · ');
      const label = `🏠 ${esc(titleCase(x.street))}${x.suburb ? `, ${esc(x.suburb)}` : ''}`;
      return factRow(label, money(x.price), note);
    };

    const head = sales.slice(0, COMPS_PREVIEW).map(saleRow).join('');
    const rest = sales.slice(COMPS_PREVIEW);
    const salesHtml = head + (rest.length
      ? `<details class="mb-more"><summary>Show ${rest.length} more sale${rest.length === 1 ? '' : 's'}</summary>${rest.map(saleRow).join('')}</details>`
      : '');

    body.innerHTML = `
      <div class="mb-details-grid">
        <div>${factBlock('SALES SUMMARY', summaryRows.join(''))}</div>
        <div>${factBlock(`RECENT SALES (${sales.length})`, salesHtml)}</div>
      </div>
      <div class="mb-footer-pill">Comparable sales are a guide only. They are not a formal valuation.</div>`;
  }

  // =========================================================================
  // BƯỚC 6: ĐIỀU HƯỚNG SPA (XỬ LÝ CHUYỂN TRANG ĐỘNG)
  // =========================================================================
  function handlePageExecution(retry = 0) {
    const urlAtStart = window.location.href;

    if (!isPropertyDetailPage()) {
      const sidebar = document.getElementById('microburbs-sidebar-root');
      if (sidebar) sidebar.style.display = 'none';
      return;
    }

    const address = extractAddress();

    // Chưa có địa chỉ hợp lệ -> thử lại mỗi 500ms, tối đa ~6 giây
    if (!address) {
      if (retry < 12) {
        setTimeout(() => {
          if (window.location.href === urlAtStart) handlePageExecution(retry + 1);
        }, 500);
      }
      return;
    }

    if (address === lastFetchedAddress) {
      const sidebar = document.getElementById('microburbs-sidebar-root');
      if (sidebar) sidebar.style.display = 'block';
      return;
    }

    lastFetchedAddress = address;
    const sidebar = createSidebarContainer();
    sidebar.style.display = 'block';

    document.getElementById('mb-content-body').innerHTML = `
      <div class="mb-spinner">🌐 Looking up the Microburbs API for:<br/><strong>"${esc(address)}"</strong>…</div>
    `;

    nearbyCache = { gnafId: null, promise: null };

    gearingCache = { gnafId: null, promise: null };

    compsCache = { gnafId: null, promise: null };

    chrome.runtime.sendMessage(
      { action: "FETCH_PROPERTY_SUMMARY", address: address },
      (response) => {
        // Người dùng đã chuyển sang trang khác trong lúc chờ API -> bỏ kết quả cũ
        if (window.location.href !== urlAtStart) return;
        window.cachedSummaryData = response;
        renderSummaryData(response);
      }
    );
  }

  setInterval(() => {
    if (window.location.href !== lastProcessedUrl) {
      lastProcessedUrl = window.location.href;
      setTimeout(() => handlePageExecution(0), 500);
    }
  }, 800);

  // =========================================================================
  // 🌟 BƯỚC 7: LẮNG NGHE LỆNH TRA CỨU THỦ CÔNG TỪ POPUP
  // =========================================================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "POPUP_MANUAL_SEARCH") {
      const query = request.query;

      // 1. Tự tạo & Hiển thị Sidebar trên trang
      const sidebar = createSidebarContainer();
      sidebar.style.display = 'block';

      // 2. Hiển thị Spinner
      document.getElementById('mb-content-body').innerHTML = `
        <div class="mb-spinner">🌐 Looking up:<br/><strong>"${esc(query)}"</strong>…</div>
      `;

      nearbyCache = { gnafId: null, promise: null };

      gearingCache = { gnafId: null, promise: null };

      compsCache = { gnafId: null, promise: null };

      // 3. Phân loại: Nếu là GNAF ID thì gọi trực tiếp, nếu là địa chỉ thì qua Geocode
      const isGnafId = /^G[A-Z0-9]+$/i.test(query) || query.length > 12;

      if (isGnafId) {
        chrome.runtime.sendMessage(
          { action: "FETCH_PROPERTY_BY_GNAF", gnafId: query },
          (response) => {
            window.cachedSummaryData = response;
            renderSummaryData(response);
          }
        );
      } else {
        chrome.runtime.sendMessage(
          { action: "FETCH_PROPERTY_SUMMARY", address: query },
          (response) => {
            window.cachedSummaryData = response;
            renderSummaryData(response);
          }
        );
      }
    }
  });

})();
  });

})(); // <--- ĐẶT NGAY TRƯỚC DÒNG ĐÓNG KHỐI IIFE NÀY
