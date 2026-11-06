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

  function render(payload) {
    const { center, radius, points } = payload;
    if (map) { map.remove(); map = null; }
    if (ro) { ro.disconnect(); ro = null; }
    routeLayer = null;   // reset lộ trình cũ
    activeEl = null;     // reset icon đang chọn

    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

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

    ro = new ResizeObserver(() => {
      if (!map) return;
      map.invalidateSize();
      if (!routeLayer) map.fitBounds(bounds); // đừng reset nếu đang xem lộ trình
    });
    ro.observe(document.getElementById('map'));
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'MB_MAP_DATA') render(e.data.payload);
  });

  window.parent.postMessage({ type: 'MB_MAP_READY' }, '*');
})();