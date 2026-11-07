(function () {
  'use strict';

  const WALK_M_PER_MIN = 80; // ~4.8 km/h
  const ICONS = {
    supermarket: '🛒', restaurant: '🍽️', cafe: '☕', green_spaces: '🌳', park: '🌳',
    bus: '🚌', train: '🚆', tram: '🚊', ferry: '⛴️'
  };

  let map = null;
  let routeLayer = null;
  let activeEl = null;
  const routeCache = new Map();
  const info = document.getElementById('info');

  // Chế độ "comps": các căn đã bán (CMA)
  let compMarkers = new Map();   // id -> { marker, point }
  let activeCompId = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (c) => String(c || '').toLowerCase().replace(/\s+/g, '_');
  const iconFor = (c) => ICONS[norm(c)] || '📌';

  function pin(emoji, extraClass = '') {
    return L.divIcon({
      className: '',
      html: `<div class="pin ${extraClass}">${emoji}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  // Nhãn giá cho căn đã bán
  function priceIcon(label) {
    return L.divIcon({
      className: '',
      html: `<div class="pin-price">${esc(label)}</div>`,
      iconSize: [64, 24],
      iconAnchor: [32, 12]
    });
  }

  async function getRoute(from, to) {
    const key = `${to.lat},${to.lng}`;
    if (routeCache.has(key)) return routeCache.get(key);

    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    let result = null;
    try {
      const res = await fetch(url);
      const json = await res.json();
      const r = json.routes && json.routes[0];
      if (r) {
        result = {
          coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distance: r.distance
        };
      }
    } catch (e) {
      console.warn('Routing lỗi:', e);
    }
    routeCache.set(key, result);
    return result;
  }

  async function showRoute(center, p, el) {
    if (activeEl) activeEl.classList.remove('active');
    activeEl = el; el.classList.add('active');
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }

    info.innerHTML = `⏳ Finding a route to <strong>${esc(p.name)}</strong>…`;
    const route = await getRoute(center, p);

    if (route) {
      routeLayer = L.polyline(route.coords, { color: '#dc2626', weight: 4, opacity: 0.85 }).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
      const mins = Math.max(1, Math.round(route.distance / WALK_M_PER_MIN));
      info.innerHTML = `${iconFor(p.category)} <strong>${esc(p.name)}</strong> — ${Math.round(route.distance)} m walk (~${mins} min)`;
    } else {
      // Không lấy được đường: vẽ đường thẳng nét đứt
      routeLayer = L.polyline([[center.lat, center.lng], [p.lat, p.lng]],
        { color: '#dc2626', weight: 3, dashArray: '6 6' }).addTo(map);
      info.innerHTML = `${iconFor(p.category)} <strong>${esc(p.name)}</strong> — about ${Math.round(p.distance_m)} m away (straight line, walking route unavailable)`;
    }
  }

  let bounds = null;
  let ro = null;

  // Khởi tạo map + tile, dùng chung cho cả 2 chế độ
  function resetMap() {
    if (map) { map.remove(); map = null; }
    if (ro) { ro.disconnect(); ro = null; }
    routeLayer = null;   // reset lộ trình cũ
    activeEl = null;     // reset icon đang chọn
    compMarkers = new Map();
    activeCompId = null;
    bounds = null;

    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);
  }

  function watchResize() {
    ro = new ResizeObserver(() => {
      if (!map) return;
      map.invalidateSize();
      if (!routeLayer && bounds) map.fitBounds(bounds); // đừng reset nếu đang xem lộ trình
    });
    ro.observe(document.getElementById('map'));
  }

  // ---------- Chế độ tiện ích (như cũ) ----------
  function renderAmenities(payload) {
    const { center, radius, points } = payload;
    resetMap();

    const c = [center.lat, center.lng];
    bounds = L.latLng(c).toBounds(radius * 2);
    map.fitBounds(bounds);
    L.circle(c, { radius, color: '#17497a', weight: 1, fillOpacity: 0.06 }).addTo(map);

    L.marker(c, { icon: pin('🏠', 'house'), zIndexOffset: 1000 }).addTo(map).bindTooltip('This property');

    points.forEach(p => {
      const m = L.marker([p.lat, p.lng], { icon: pin(iconFor(p.category)) }).addTo(map);
      m.bindTooltip(`${p.name} (${Math.round(p.distance_m)} m)`);
      m.on('click', () => showRoute(center, p, m.getElement().firstChild));
    });

    info.textContent = points.length
      ? `${points.length} place${points.length === 1 ? '' : 's'} within ${radius} m. Tap an icon to see the walking route.`
      : `No amenities within ${radius} m.`;

    watchResize();
  }

  // ---------- Chế độ comps: căn đã bán (CMA) ----------
  function selectComp(id) {
    const entry = compMarkers.get(id);
    if (!entry) return;

    if (activeCompId != null) {
      const prev = compMarkers.get(activeCompId);
      if (prev) {
        const el = prev.marker.getElement();
        if (el && el.firstChild) el.firstChild.classList.remove('active');
        prev.marker.setZIndexOffset(0);
      }
    }
    activeCompId = id;

    const el = entry.marker.getElement();
    if (el && el.firstChild) el.firstChild.classList.add('active');
    entry.marker.setZIndexOffset(500);
    map.panTo(entry.marker.getLatLng());

    const p = entry.point;
    info.innerHTML = `🏠 <strong>${esc(p.title)}</strong>${p.subtitle ? ` — ${esc(p.subtitle)}` : ''}`;
  }

  function renderComps(payload) {
    const { center, points } = payload;
    resetMap();

    const all = [];

    if (center) {
      const c = [center.lat, center.lng];
      L.marker(c, { icon: pin('🏠', 'house'), zIndexOffset: 1000 }).addTo(map).bindTooltip('This property');
      all.push(c);
    }

    points.forEach(p => {
      const m = L.marker([p.lat, p.lng], { icon: priceIcon(p.label) }).addTo(map);
      m.bindTooltip(p.title);
      m.on('click', () => {
        selectComp(p.id);
        window.parent.postMessage({ type: 'MB_COMP_SELECT', id: p.id }, '*');
      });
      compMarkers.set(p.id, { marker: m, point: p });
      all.push([p.lat, p.lng]);
    });

    if (all.length > 1) {
      bounds = L.latLngBounds(all).pad(0.15);
      map.fitBounds(bounds);
    } else if (all.length === 1) {
      map.setView(all[0], 16);
    } else {
      map.setView([-33.8688, 151.2093], 12); // Sydney, chỉ để bản đồ không trống
    }

    info.textContent = points.length
      ? `${points.length} sold nearby. Click a price tag for details.`
      : 'No map locations are available for these sales.';

    watchResize();
  }

  function render(payload) {
    if (payload.mode === 'comps') renderComps(payload);
    else renderAmenities(payload);
  }

  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'MB_MAP_DATA') render(e.data.payload);
    // Cha yêu cầu chọn 1 căn (khi bấm vào danh sách bên ngoài)
    if (e.data.type === 'MB_MAP_SELECT' && map) selectComp(e.data.id);
  });

  window.parent.postMessage({ type: 'MB_MAP_READY' }, '*');
})();
