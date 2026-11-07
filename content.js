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
  let rentCache = { gnafId: null, promise: null };    // Cache rent-history-latest
  let riskCache = { gnafId: null, promise: null };    // Cache risks/all
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
        <button id="mb-tab-risks" class="mb-tab-btn">Risks</button>
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
    document.getElementById('mb-tab-risks').onclick = () => switchTab('risks');

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
    ['summary', 'nearby', 'invest', 'comps', 'risks'].forEach(t => {
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
      Promise.all([loadGearing(gearingId), loadRent(gearingId)]).then(([response, rentRes]) => {
        if (gearingId !== currentGnafId || activeTab !== 'invest') return; // đã đổi nhà / đổi tab
        renderInvestmentData(response, rentRes);
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

    if (tabName === 'risks') {
      body.innerHTML = `<div class="mb-spinner">🛡️ Loading risk overlays…</div>`;
      const riskId = currentGnafId;
      loadRisks(riskId).then((response) => {
        if (riskId !== currentGnafId || activeTab !== 'risks') return; // đã đổi nhà / đổi tab
        renderRisksData(response);
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
    const badValues = ['nan', 'none', 'null', 'undefined', ''];
    if (data.dwellingType && !badValues.includes(String(data.dwellingType).trim().toLowerCase())) {
      rows.push(factRow('Dwelling type', esc(data.dwellingType)));
    }
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

  function loadRent(gnafId) {
    if (rentCache.gnafId === gnafId && rentCache.promise) return rentCache.promise;

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "FETCH_RENT_LATEST", gnafId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: true, message: chrome.runtime.lastError.message });
        } else {
          resolve(response || { error: true, message: 'No response from the background service.' });
        }
      });
    });

    rentCache = { gnafId, promise };
    promise.then(r => {
      if (r && r.error && rentCache.promise === promise) rentCache = { gnafId: null, promise: null };
    });
    return promise;
  }

  // Schema rent-history-latest chưa rõ -> dò các tên trường phổ biến, không có thì hiện các trường đơn giản
  const RENT_KEYS = ['rent_pw', 'weekly_rent', 'rent_per_week', 'rent_weekly', 'rent', 'price', 'amount'];
  const RENT_DATE_KEYS = ['date', 'date_listed', 'listing_date', 'observed_date', 'rent_date', 'date_observed', 'last_seen_date', 'last_seen'];

  function parseRent(rentRes) {
    if (!rentRes || rentRes.error || !rentRes.data) return null;
    let d = rentRes.data;
    if (Array.isArray(d)) d = d[0];
    if (!d || typeof d !== 'object') return null;
    const num = (v) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
      return isFinite(n) && n > 0 ? n : null;
    };
    const key = RENT_KEYS.find(k => num(d[k]) != null);
    const dkey = RENT_DATE_KEYS.find(k => d[k]);
    return { raw: d, weekly: key ? num(d[key]) : null, date: dkey ? d[dkey] : null };
  }

  function renderInvestmentData(res, rentRes) {
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

    // Tiền thuê ghi nhận gần nhất + tỷ suất trên giá ước tính
    const rent = parseRent(rentRes);
    const avmV = window.cachedSummaryData?.avmEstimate;
    if (rent && rent.weekly) {
      summaryRows.push(factRow('Latest rent seen', `$${Math.round(rent.weekly).toLocaleString('en-AU')}/wk`,
        rent.date ? `Observed ${esc(fmtDate(rent.date))}` : 'Most recent rent observation'));
      if (avmV) {
        summaryRows.push(factRow('Yield on estimate', `${(rent.weekly * 52 / avmV * 100).toFixed(2)}%`,
          'Annual rent ÷ estimated value (assumes the rent is per week)'));
      }
    } else if (rent) {
      Object.entries(rent.raw)
        .filter(([k, v]) => v != null && v !== '' && typeof v !== 'object' && !/(^|_)p?id$/i.test(k))
        .slice(0, 4)
        .forEach(([k, v]) => summaryRows.push(factRow(esc(prettyCat(k)), esc(v))));
    } else {
      summaryRows.push(factRow('Latest rent seen', 'Not available',
        esc(String(rentRes?.message || 'No rent observation for this property').slice(0, 120))));
    }

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

  const titleCase = (t) => String(t ?? '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

  // Các trường đã hiển thị riêng; phần còn lại của bản ghi CMA nằm trong mục "More fields" (thu gọn)
  const COMP_KNOWN_KEYS = new Set([
    'street', 'sal', 'price', 'date_sold', 'bedrooms', 'bathrooms',
    'garage_spaces', 'property_type', 'latitude', 'longitude'
  ]);

  let compsMsgHandler = null; // listener nhận tin nhắn từ iframe bản đồ (chỉ giữ 1 cái)

  // $1.25M / $850k — gọn để làm nhãn trên bản đồ
  const shortMoney = (v) => {
    if (!(typeof v === 'number' && isFinite(v) && v > 0)) return 'N/A';
    return v >= 1e6 ? `$${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M` : `$${Math.round(v / 1000)}k`;
  };

  const fmtShortDate = (v) => {
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // "25 days ago" / "8 mo ago" / "2 yr ago"
  const agoText = (ts) => {
    if (isNaN(ts)) return '';
    const days = Math.max(0, Math.round((Date.now() - ts) / 86400000));
    if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`;
    if (days < 730) return `${Math.round(days / 30)} mo ago`;
    return `${Math.round(days / 365)} yr ago`;
  };

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
    const subj = window.cachedSummaryData || {};
    const avm = subj.avmEstimate;
    const money = (v) => (typeof v === 'number' && isFinite(v) && v > 0)
      ? `$${Math.round(v).toLocaleString('en-AU')}` : 'Not available';

    // id = vị trí trong danh sách gốc, dùng để nối marker <-> dòng danh sách <-> thẻ chi tiết
    const sales = list.map((c, i) => {
      const lat = c.latitude != null ? Number(c.latitude) : NaN;
      const lng = c.longitude != null ? Number(c.longitude) : NaN;
      const onMap = isFinite(lat) && isFinite(lng);
      return {
        id: i, raw: c,
        street: c.street, suburb: c.sal,
        price: c.price != null ? Number(c.price) : NaN,
        date: c.date_sold, ts: Date.parse(c.date_sold),
        beds: c.bedrooms, baths: c.bathrooms, cars: c.garage_spaces, type: c.property_type,
        lat, lng, onMap,
        dist: (center && onMap)
          ? Math.round(getStraightDistanceMeters(center.lat, center.lng, lat, lng)) : null
      };
    });
    const byId = new Map(sales.map(x => [x.id, x]));
    sales.sort((a, b) => (isNaN(b.ts) ? -Infinity : b.ts) - (isNaN(a.ts) ? -Infinity : a.ts)); // mới nhất trước

    const prices = sales.map(x => x.price).filter(p => isFinite(p) && p > 0).sort((a, b) => a - b);
    const n = prices.length;
    const median = n ? (n % 2 ? prices[(n - 1) / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2) : null;
    const latest = sales.find(x => !isNaN(x.ts));

    // ----- Tổng hợp: chỉ 4 dòng -----
    const summaryRows = [
      factRow('Sales found', String(sales.length), n ? `${money(prices[0])} – ${money(prices[n - 1])}` : ''),
      factRow('Median price', money(median), 'Middle sale price of the set')
    ];
    if (median && avm) {
      const pct = Math.round((avm / median - 1) * 100);
      summaryRows.push(factRow('Estimate vs median', `${pct > 0 ? '+' : ''}${pct}%`, 'This home’s estimate vs the median sale'));
    }
    if (latest) summaryRows.push(factRow('Latest sale', esc(fmtShortDate(latest.date)), esc(titleCase(latest.street))));

    // ----- So sánh bố cục với căn đang xem -----
    const layoutVs = (x) => {
      const diffs = [];
      let compared = 0;
      [['bed', x.beds, subj.bedCount], ['bath', x.baths, subj.bathCount], ['car', x.cars, subj.parkingCount]]
        .forEach(([k, a, b]) => {
          if (a == null || b == null) return;
          compared++;
          const d = Number(a) - Number(b);
          if (d !== 0) diffs.push(`${d > 0 ? '+' : '−'}${Math.abs(d)} ${k}`);
        });
      if (!compared) return null;
      return diffs.length ? diffs.join(', ') : 'Same';
    };

    // ----- Thẻ chi tiết gọn (cột trái, dưới bản đồ) -----
    const chipsOf = (x) => [
      x.beds != null ? `🛏️ ${x.beds}` : null,
      x.baths != null ? `🚿 ${x.baths}` : null,
      x.cars != null ? `🚗 ${x.cars}` : null,
      x.type ? esc(titleCase(x.type)) : null
    ].filter(Boolean).map(t => `<span class="mb-chip">${t}</span>`).join('');

    const detailHtml = (x) => {
      const diff = (avm && isFinite(x.price) && x.price > 0) ? Math.round((x.price / avm - 1) * 100) : null;
      const layout = layoutVs(x);
      const stat = (label, value) => `<div class="mb-sel-stat"><div class="mb-sel-stat-label">${label}</div><div class="mb-sel-stat-val">${value}</div></div>`;
      const stats = [
        diff != null ? stat('Vs estimate', `${diff > 0 ? '+' : ''}${diff}%`) : '',
        x.dist != null ? stat('Distance', fmtDist(x.dist)) : '',
        layout ? stat('Vs this home', esc(layout)) : ''
      ].join('');

      // Các trường còn lại (schema có thể đổi) — thu gọn, bỏ các trường id
      const extras = Object.entries(x.raw)
        .filter(([k, v]) => !COMP_KNOWN_KEYS.has(k) && !/(^|_)p?id$/i.test(k)
          && v != null && v !== '' && typeof v !== 'object')
        .map(([k, v]) => `<div class="mb-sel-extra"><span>${esc(prettyCat(k))}</span><strong>${esc(typeof v === 'number' ? v.toLocaleString('en-AU') : v)}</strong></div>`)
        .join('');

      return `
        <div class="mb-sel">
          <div class="mb-sel-top">
            <div class="mb-sel-main">
              <div class="mb-sel-addr">${esc(titleCase(x.street))}${x.suburb ? `, ${esc(x.suburb)}` : ''}</div>
              <div class="mb-sel-sub">${x.date ? `Sold ${esc(fmtShortDate(x.date))}${agoText(x.ts) ? ` · ${agoText(x.ts)}` : ''}` : 'Sale date not available'}</div>
            </div>
            <div class="mb-sel-price">${money(x.price)}</div>
          </div>
          <div class="mb-chips">${chipsOf(x)}</div>
          ${stats ? `<div class="mb-sel-stats">${stats}</div>` : ''}
          ${extras ? `<details class="mb-more"><summary>More fields</summary>${extras}</details>` : ''}
        </div>`;
    };

    const detailHint = `<div class="mb-sel mb-sel-empty">👆 Click a price tag on the map, or a sale in the list, for details.</div>`;

    // ----- Danh sách gọn (cột phải, có thanh cuộn) -----
    const saleRow = (x) => {
      const note = [
        x.date ? esc(fmtShortDate(x.date)) : null,
        [x.beds != null ? `${x.beds}b` : null, x.baths != null ? `${x.baths}ba` : null, x.cars != null ? `${x.cars}c` : null].filter(Boolean).join(' ') || null,
        x.dist != null ? fmtDist(x.dist) : null,
        !x.onMap ? 'No map pin' : null
      ].filter(Boolean).join(' · ');
      const label = `${esc(titleCase(x.street))}`;
      return `<div class="mb-comp-row" data-comp-id="${x.id}" role="button" tabindex="0">${factRow(label, money(x.price), note)}</div>`;
    };
    const salesHtml = `<div class="mb-comps-scroll">${sales.map(saleRow).join('')}</div>`;

    // ----- Bản đồ: chỉ có nhà này + các căn CMA (không có tiện ích) -----
    const points = sales.filter(x => x.onMap).map(x => ({
      id: x.id, lat: x.lat, lng: x.lng,
      label: shortMoney(x.price),
      title: `${titleCase(x.street)}${x.suburb ? `, ${x.suburb}` : ''}`,
      subtitle: [money(x.price) !== 'Not available' ? money(x.price) : null,
                 x.date ? `sold ${fmtShortDate(x.date)}` : null].filter(Boolean).join(' · ')
    }));

    const mapHtml = points.length
      ? `<iframe id="mb-comps-frame" class="mb-map-frame" src="${chrome.runtime.getURL('map.html')}"></iframe>
         <div class="mb-pills"><span class="mb-pill">📍 ${points.length} of ${sales.length} on map</span></div>`
      : `<div class="mb-map-empty">🗺️ These sales have no map coordinates.</div>`;

    body.innerHTML = `
      <div class="mb-overview">
        <div class="mb-overview-left">
          <div class="mb-map-card">${mapHtml}</div>
          <div id="mb-comp-detail">${detailHint}</div>
        </div>
        <div class="mb-overview-right">
          ${factBlock('SALES SUMMARY', summaryRows.join(''))}
          <div id="mb-comps-list" class="mb-compact">${factBlock(`SALES (${sales.length})`, salesHtml)}</div>
        </div>
      </div>
      <div class="mb-footer-pill">Comparable sales are a guide only. They are not a formal valuation.</div>`;

    // ----- Tương tác -----
    const frame = document.getElementById('mb-comps-frame');

    const selectComp = (id, fromMap = false) => {
      const x = byId.get(id);
      if (!x) return;

      document.querySelectorAll('#mb-comps-list .mb-comp-row').forEach(r =>
        r.classList.toggle('selected', Number(r.dataset.compId) === id));

      const box = document.getElementById('mb-comp-detail');
      if (box) box.innerHTML = detailHtml(x);

      if (fromMap) {
        const row = document.querySelector(`#mb-comps-list .mb-comp-row[data-comp-id="${id}"]`);
        if (row) row.scrollIntoView({ block: 'nearest' });
      } else if (frame && frame.dataset.ready === '1' && x.onMap) {
        frame.contentWindow.postMessage({ type: 'MB_MAP_SELECT', id }, '*');
      }
    };

    const listEl = document.getElementById('mb-comps-list');
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.mb-comp-row');
      if (row) selectComp(Number(row.dataset.compId));
    });
    listEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.mb-comp-row');
      if (row) { e.preventDefault(); selectComp(Number(row.dataset.compId)); }
    });

    if (compsMsgHandler) window.removeEventListener('message', compsMsgHandler);
    compsMsgHandler = null;

    if (frame) {
      compsMsgHandler = (e) => {
        if (e.source !== frame.contentWindow || !e.data) return;
        if (e.data.type === 'MB_MAP_READY') {
          frame.dataset.ready = '1';
          frame.contentWindow.postMessage(
            { type: 'MB_MAP_DATA', payload: { mode: 'comps', center, points } }, '*');
        } else if (e.data.type === 'MB_COMP_SELECT') {
          selectComp(e.data.id, true);
        }
      };
      window.addEventListener('message', compsMsgHandler);
    }
  }

  // =========================================================================
  // TAB RISKS: lớp rủi ro / quy hoạch quanh căn nhà (risks/all)
  // =========================================================================
  function loadRisks(gnafId) {
    if (riskCache.gnafId === gnafId && riskCache.promise) return riskCache.promise;

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "FETCH_RISKS", gnafId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: true, message: chrome.runtime.lastError.message });
        } else {
          resolve(response || { error: true, message: 'No response from the background service.' });
        }
      });
    });

    riskCache = { gnafId, promise };
    promise.then(r => {
      if (r && r.error && riskCache.promise === promise) riskCache = { gnafId: null, promise: null };
    });
    return promise;
  }

  // weight: high = ảnh hưởng bảo hiểm/an toàn, med = đáng lưu ý, info = chỉ để biết
  const RISK_META = {
    bushfire:          { icon: '🔥', label: 'Bushfire',          group: 'hazard', weight: 'high', hint: 'May affect insurance cost and building requirements.' },
    flood:             { icon: '🌊', label: 'Flood',             group: 'hazard', weight: 'high', hint: 'Check flood insurance cover and ask the council for flood information.' },
    landslide:         { icon: '⛰️', label: 'Landslide',         group: 'hazard', weight: 'high', hint: 'A geotechnical report may be worth considering.' },
    historical_flood:  { icon: '🌧️', label: 'Historical flood',  group: 'hazard', weight: 'med',  hint: 'The area has flooded before. Ask about the flood history.' },
    erosion:           { icon: '🪨', label: 'Erosion',           group: 'hazard', weight: 'med',  hint: 'Ask about ground stability and any building restrictions.' },
    environment:       { icon: '🌿', label: 'Environmental',     group: 'hazard', weight: 'med',  hint: 'May limit clearing, building or renovation.' },
    hv_power_line:     { icon: '⚡', label: 'HV power line',     group: 'area',   weight: 'med',  hint: 'High-voltage lines can affect noise, views and some buyers.' },
    heritage:          { icon: '🏛️', label: 'Heritage',          group: 'area',   weight: 'info', hint: 'Renovation or demolition may need council approval.' },
    mobile_black_spot: { icon: '📵', label: 'Mobile black spot', group: 'area',   weight: 'info', hint: 'Mobile coverage may be patchy. Check with your carrier.' },
    public_housing:    { icon: '🏘️', label: 'Public housing',    group: 'area',   weight: 'info', hint: '' }
  };
  const fmtRadius = (m) => (m % 1000 === 0 ? `${m / 1000} km` : fmtDist(m));  // 1000 -> "1 km"
  const RISK_NEAR_M = 250;                       // gần hơn mức này (không nằm trên nhà) vẫn được đánh dấu "near"
  const RISK_ORDER = { alert: 0, warn: 1, near: 2, info: 3, ok: 4 };

  // alert = trên nhà & nghiêm trọng | warn = trên nhà & đáng lưu ý | near = sát nhà | info = chỉ để biết | ok = không đáng ngại
  function riskStatus(meta, e) {
    if (e.on_property) return meta.weight === 'high' ? 'alert' : meta.weight === 'med' ? 'warn' : 'info';
    const d = Number(e.nearest_distance_m);
    if (meta.weight !== 'info' && isFinite(d) && d <= RISK_NEAR_M) return 'near';
    return 'ok';
  }

  // Mỗi nhóm có thể có nhiều dòng: ưu tiên dòng "on property", không thì dòng gần nhất
  function pickRiskEntry(arr) {
    return arr.find(x => x.on_property) ||
      [...arr].sort((a, b) => (a.nearest_distance_m ?? 1e9) - (b.nearest_distance_m ?? 1e9))[0];
  }

  function renderRisksData(res) {
    const body = document.getElementById('mb-content-body');

    if (!res || res.error) {
      body.innerHTML = `<div class="mb-error-box">❌ ${esc(res?.message || 'Could not load risk data')}</div>`;
      return;
    }

    const data = res.data && typeof res.data === 'object' ? res.data : {};
    const items = [];
    Object.entries(data).forEach(([key, arr]) => {
      if (!Array.isArray(arr) || !arr.length) return;
      const meta = RISK_META[key] || { icon: '📌', label: prettyCat(key), group: 'area', weight: 'info', hint: '' };
      const e = key === 'public_housing' ? (arr.find(x => x.on_property) || arr[0]) : pickRiskEntry(arr);
      items.push({ key, meta, e, arr, st: riskStatus(meta, e) });
    });

    if (!items.length) {
      body.innerHTML = `<div class="mb-fact-empty">No risk layers were returned for this property.</div>`;
      return;
    }

    const byStatus = (s) => items.filter(i => i.st === s);
    const onProp = items.filter(i => i.st === 'alert' || i.st === 'warn');
    const near = byStatus('near');
    const info = byStatus('info');
    const clear = byStatus('ok');
    const names = (list) => list.map(i => esc(i.meta.label)).join(', ');

    // ----- Banner tổng hợp -----
    const level = byStatus('alert').length ? 'high' : (onProp.length || near.length) ? 'mid' : 'low';
    const title = {
      high: '⚠️ Check these before buying',
      mid: '🟠 A few flags to check',
      low: '✅ No mapped hazards on or near this property'
    }[level];
    const subParts = [];
    if (onProp.length) subParts.push(`<strong>On property:</strong> ${names(onProp)}`);
    if (near.length) subParts.push(`<strong>Within ${RISK_NEAR_M} m:</strong> ${names(near)}`);
    if (info.length) subParts.push(`<strong>Also noted:</strong> ${names(info)}`);

    const banner = `
      <div class="mb-risk-banner ${level}">
        <div class="mb-risk-banner-title">${title}</div>
        ${subParts.length ? `<div class="mb-risk-banner-sub">${subParts.join('<br/>')}</div>` : ''}
        <div class="mb-chips">
          <span class="mb-chip">On property: ${onProp.length + info.filter(i => i.e.on_property).length}</span>
          <span class="mb-chip">Within ${RISK_NEAR_M} m: ${near.length}</span>
          <span class="mb-chip">Clear: ${clear.length}</span>
        </div>
      </div>`;

    // ----- Dòng "thang khoảng cách": thanh dài = nguồn rủi ro càng xa -----
    const ladderRow = (i) => {
      const e = i.e;
      const radius = Number(e.search_radius_m) || 1000;
      const d = Number(e.nearest_distance_m);
      const none = !e.on_property && (e.features_within_radius === 0 || !isFinite(d));
      const pos = e.on_property ? 0 : (none ? 100 : Math.min(100, Math.max(0, d / radius * 100)));
      const valueText = e.on_property ? 'On property' : (none ? `None in ${fmtRadius(radius)}` : fmtDist(d));
      const count = e.features_within_radius;
      const note = count != null && count > 0
        ? `${plural(count, 'mapped area')} within ${fmtRadius(radius)}` : '';
      return `
        <div class="mb-risk-row mb-risk-${i.st}">
          <div class="mb-risk-name">${i.meta.icon} ${esc(i.meta.label)}</div>
          <div class="mb-risk-track"><span class="mb-risk-fill" style="width:${pos}%"></span><span class="mb-risk-dot" style="left:${pos}%"></span></div>
          <div class="mb-risk-val">${esc(valueText)}</div>
          ${note ? `<div class="mb-risk-note">${esc(note)}</div>` : ''}
        </div>`;
    };
    const sortItems = (list) => [...list].sort((a, b) =>
      (RISK_ORDER[a.st] - RISK_ORDER[b.st]) ||
      ((a.e.nearest_distance_m ?? 1e9) - (b.e.nearest_distance_m ?? 1e9)));

    const hazards = sortItems(items.filter(i => i.meta.group === 'hazard'));
    const area = sortItems(items.filter(i => i.meta.group === 'area' && i.key !== 'public_housing'));
    const caption = '<div class="mb-risk-caption">Bar length = distance to the nearest mapped area.</div>';

    // ----- Public housing: tỷ lệ % chứ không phải khoảng cách -----
    const phItem = items.find(i => i.key === 'public_housing');
    let phRow = '';
    if (phItem) {
      const here = phItem.arr.find(x => x.on_property);
      const other = phItem.arr.find(x => !x.on_property);
      if (here || other) {
        const main = here || other;
        const noteBits = [
          here ? 'Share of properties in this area' : `Nearest area, ${fmtDist(other.nearest_distance_m)} away`,
          here && other ? `${esc(other.value)} in the nearest other area (${fmtDist(other.nearest_distance_m)})` : null
        ].filter(Boolean).join(' · ');
        phRow = factRow('🏘️ Public housing', esc(main.value ?? 'Not available'), noteBits);
      }
    }

    // ----- Gợi ý cần kiểm tra (chỉ với lớp nằm trên nhà) -----
    const todo = onProp.filter(i => i.meta.hint).map(i => `
      <div class="mb-risk-todo"><span>${i.meta.icon}</span><div><strong>${esc(i.meta.label)}.</strong> ${esc(i.meta.hint)}</div></div>`).join('');

    body.innerHTML = `
      ${banner}
      <div class="mb-details-grid">
        <div>
          ${factBlock('NATURAL HAZARDS', caption + (hazards.map(ladderRow).join('') || emptyLine('No hazard layers.')))}
        </div>
        <div>
          ${factBlock('NEIGHBOURHOOD FACTORS', caption + ((area.map(ladderRow).join('') + phRow) || emptyLine('No data for this group.')))}
        </div>
      </div>
      ${todo ? `<div class="mb-facts">${`<div class="mb-facts-title">WORTH CHECKING</div>`}${todo}</div>` : ''}
      <div class="mb-footer-pill">Mapped overlays within ${fmtRadius(Number(items[0].e.search_radius_m) || 1000)}. Not a site inspection, insurance quote or legal advice.</div>`;
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

    rentCache = { gnafId: null, promise: null };

    riskCache = { gnafId: null, promise: null };

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

      rentCache = { gnafId: null, promise: null };

      riskCache = { gnafId: null, promise: null };

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
