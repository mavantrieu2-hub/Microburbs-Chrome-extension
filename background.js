// background.js - GỌI API THẬT 100% (GỌN GÀNG: SUMMARY + SCHOOLS)
const API_BASE = "https://api-ht.microburbs.com.au/v1";
const API_KEY = "ht26_NtKrD0IoIZ5BhRXyGounbvHp";

// ==========================================
// 1. BỘ ROUTER NHẬN TÍN HIỆU (ĐÃ THÊM .CATCH CHỐNG SẬP)
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("📩 [background.js] Nhận yêu cầu Action:", request.action);

  // Nhận 1 hàm (không phải promise) để lỗi đồng bộ cũng bị bắt, luôn có phản hồi về content.js
  const safeSend = (fn) => {
    Promise.resolve()
      .then(fn)
      .then(sendResponse)
      .catch((err) => {
        console.error("💥 Lỗi Uncaught trong Background Router:", err);
        sendResponse({
          error: true,
          step: "BACKGROUND_CRASH",
          message: err.message || "Unknown error in the background service"
        });
      });
  };

  if (request.action === "FETCH_PROPERTY_SUMMARY") {
    safeSend(() => handleFetchPropertySummary(request.address));
    return true; 
  }

  if (request.action === "FETCH_PROPERTY_BY_GNAF") {
    safeSend(() => handleFetchByGnafDirectly(request.gnafId));
    return true;
  }

  if (request.action === "FETCH_NEARBY") {
    safeSend(() => handleFetchNearby(request.gnafId));
    return true;
  }

  if (request.action === "FETCH_NEGATIVE_GEARING") {
    safeSend(() => handleFetchNegativeGearing(request.gnafId));
    return true;
  }

  if (request.action === "FETCH_CMA") {
    safeSend(() => handleFetchCma(request.gnafId));
    return true;
  }

  if (request.action === "FETCH_RENT_LATEST") {
    safeSend(() => handleFetchRentLatest(request.gnafId));
    return true;
  }

  if (request.action === "FETCH_RISKS") {
    safeSend(() => handleFetchRisks(request.gnafId));
    return true;
  }
});

// ==========================================
// 2. HÀM XỬ LÝ LUỒNG CHÍNH: GEOCODE -> AVM -> BASICS
// ==========================================
async function handleFetchPropertySummary(rawAddress) {
  console.group("🚀 [Microburbs Real-API Debug]");
  console.log("📌 BƯỚC 1: Địa chỉ thô nhận từ Web:", rawAddress);

  const headers = { "Authorization": `Bearer ${API_KEY}` };
  let gnafId = null;
  let matchedAddress = "";
  
  // BƯỚC 1: GEOCODE LẤY GNAF ID
  try {
    const geoUrl = `${API_BASE}/geocode/address?address=${encodeURIComponent(rawAddress)}`;
    console.log("🌐 BƯỚC 1: Đang gửi Request Geocode ->", geoUrl);

    const geoRes = await fetch(geoUrl, { headers });
    console.log("📡 BƯỚC 1 Status Code:", geoRes.status, geoRes.statusText);

    if (!geoRes.ok) {
      const errText = await geoRes.text();
      console.error("❌ BƯỚC 1 LỖI HTTP:", geoRes.status, errText);
      console.groupEnd();
      return {
        error: true,
        step: "GEOCODE_API_FAIL",
        status: geoRes.status,
        message: `Geocode error (${geoRes.status}): ${errText || 'Invalid API key'}`
      };
    }

    const geoData = await geoRes.json();
    console.log("📦 BƯỚC 1 Response Payload:", geoData);

    const properties = geoData.data || (Array.isArray(geoData) ? geoData : []);

    if (!properties || properties.length === 0) {
      console.warn("⚠️ BƯỚC 1: API Geocode không tìm thấy địa chỉ khớp!");
      console.groupEnd();
      return {
        error: true,
        step: "GEOCODE_NO_MATCH",
        message: `No matching address found for: "${rawAddress}"`
      };
    }

    const matched = properties[0];
    gnafId = matched.id || matched.gnaf_id;
    matchedAddress = matched.display_name || matched.name || matched.abbr || rawAddress;

    if (!gnafId) {
      console.warn("⚠️ BƯỚC 1: Tìm thấy địa chỉ nhưng không trích xuất được GNAF ID!");
      console.groupEnd();
      return {
        error: true,
        step: "GEOCODE_NO_ID",
        message: `The address "${matchedAddress}" has no valid GNAF ID.`
      };
    }

    console.log("✅ BƯỚC 1 THÀNH CÔNG -> GNAF ID:", gnafId);

  } catch (err) {
    console.error("💥 BƯỚC 1 LỖI MẠNG / SCRIPT:", err);
    console.groupEnd();
    return { error: true, step: "GEOCODE_NETWORK_ERROR", message: `Geocode connection error: ${err.message}` };
  }

  // BƯỚC 2A: GỌI API ĐỊNH GIÁ AVM
  let resAvm = {};
  try {
    const avmUrl = `${API_BASE}/properties/${gnafId}/valuation/avm`;
    console.log("🌐 BƯỚC 2A: Đang gọi API AVM ->", avmUrl);

    const avmRes = await fetch(avmUrl, { headers });
    console.log("📡 BƯỚC 2A Status Code:", avmRes.status, avmRes.statusText);

    if (avmRes.ok) {
      const avmData = await avmRes.json();
      resAvm = avmData.data || avmData || {};
    } else {
      const errText = await avmRes.text();
      console.warn("⚠️ BƯỚC 2A AVM không có dữ liệu:", avmRes.status, errText);
    }
  } catch (err) {
    console.error("💥 BƯỚC 2A LỖI MẠNG AVM:", err);
  }

  // BƯỚC 2B: GỌI API THÔNG TIN CƠ BẢN (BASICS)
  let resBasics = {};
  try {
    const basicsUrl = `${API_BASE}/properties/${gnafId}/basics/all`;
    console.log("🌐 BƯỚC 2B: Đang gọi API Basics ->", basicsUrl);

    const basicsRes = await fetch(basicsUrl, { headers });
    console.log("📡 BƯỚC 2B Status Code Basics:", basicsRes.status);

    if (basicsRes.ok) {
      const basicsData = await basicsRes.json();
      resBasics = basicsData.data || basicsData || {};
    } else {
      const errText = await basicsRes.text();
      console.warn("⚠️ BƯỚC 2B Basics không có dữ liệu:", basicsRes.status, errText);
    }
  } catch (err) {
    console.error("💥 BƯỚC 2B LỖI MẠNG BASICS:", err);
  }

  // BƯỚC 3: ĐÓNG GÓI DỮ LIỆU
  const predicted = resAvm.predicted_price;
  const predictedLow = resAvm.predicted_price_low;
  const predictedHigh = resAvm.predicted_price_high;
  const predictedEstDate = resAvm.prediction_date;
  const confidenceScore = resAvm.confidence_score; // 👈 THÊM DÒNG NÀY ĐỂ KHÔNG BỊ LỖI DEFINED

  const bedCount = resBasics.bed_count;
  const bathCount = resBasics.bath_count;
  const parkingCount = resBasics.parking_count;
  const dwellingType = resBasics.dwelling_type;
  const landAreaSqm = resBasics.land_area_sqm;

  console.log("✅ BƯỚC 3 HOÀN TẤT THÀNH CÔNG!");
  console.groupEnd();

  return {
    error: false,
    rawAddress: rawAddress,
    gnafId: gnafId,
    matchedAddress: matchedAddress,

    avmEstimate: predicted ? Math.round(predicted) : null,
    avmLow: predictedLow ? Math.round(predictedLow) : null,
    avmHigh: predictedHigh ? Math.round(predictedHigh) : null,
    confidenceScore: confidenceScore || null,
    avmEstDate: predictedEstDate || null,

    bedCount: bedCount ?? null,
    bathCount: bathCount ?? null,
    parkingCount: parkingCount ?? null,
    dwellingType: dwellingType || null,
    landAreaSqm: landAreaSqm || null
  };
}

// ==========================================
// 3. HÀM GỌI TRỰC TIẾP BẰNG GNAF ID (ĐÃ MỞ KHÓA REMOVE COMMENT)
// ==========================================
async function handleFetchByGnafDirectly(gnafId) {
  console.group("🚀 [Microburbs Direct GNAF Debug]");
  console.log("📌 Gọi trực tiếp dữ liệu cho GNAF ID:", gnafId);

  const headers = { "Authorization": `Bearer ${API_KEY}` };

  let resAvm = {};
  try {
    const avmUrl = `${API_BASE}/properties/${gnafId}/valuation/avm`;
    const avmRes = await fetch(avmUrl, { headers });
    if (avmRes.ok) {
      const avmData = await avmRes.json();
      resAvm = avmData.data || avmData || {};
    }
  } catch (err) {
    console.error("💥 Lỗi Mạng AVM Direct:", err);
  }

  let resBasics = {};
  try {
    const basicsUrl = `${API_BASE}/properties/${gnafId}/basics/all`;
    const basicsRes = await fetch(basicsUrl, { headers });
    if (basicsRes.ok) {
      const basicsData = await basicsRes.json();
      resBasics = basicsData.data || basicsData || {};
    }
  } catch (err) {
    console.error("💥 Lỗi Mạng Basics Direct:", err);
  }

  console.groupEnd();

  return {
    error: false,
    gnafId: gnafId,
    matchedAddress: `GNAF ID ${gnafId}`,

    avmEstimate: resAvm.predicted_price ? Math.round(resAvm.predicted_price) : null,
    avmLow: resAvm.predicted_price_low ? Math.round(resAvm.predicted_price_low) : null,
    avmHigh: resAvm.predicted_price_high ? Math.round(resAvm.predicted_price_high) : null,
    confidenceScore: resAvm.confidence_score || null,

    bedCount: resBasics.bed_count ?? null,
    bathCount: resBasics.bath_count ?? null,
    parkingCount: resBasics.parking_count ?? null,
    dwellingType: resBasics.dwelling_type || null,
    landAreaSqm: resBasics.land_area_sqm || null
  };
}
// ==========================================
// 4. TRIGGER TAB TRƯỜNG HỌC & TIỆN ÍCH
// ==========================================
async function fetchJson(url) {
  console.log("🌐 Đang gọi ->", url);
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${API_KEY}` } });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  const json = await res.json();
  if (json && json.data === null) {
    throw new Error(json.message || json.reason || "No data available");
  }
  return json.data || json;
}

const NEARBY_RADIUS_M = 2000;

async function handleFetchNearby(gnafId) {
  const [schoolRes, amenRes, transRes] = await Promise.allSettled([
    fetchJson(`${API_BASE}/properties/${gnafId}/schools/all`),
    fetchJson(`${API_BASE}/properties/${gnafId}/amenities/nearby?radius_m=${NEARBY_RADIUS_M}`),
    fetchJson(`${API_BASE}/properties/${gnafId}/transport/nearby?radius_m=${NEARBY_RADIUS_M}`)
  ]);

  if ([schoolRes, amenRes, transRes].every(r => r.status === "rejected")) {
    return {
      error: true,
      step: "NEARBY_API_FAIL",
      message: `API error: ${schoolRes.reason?.message || 'No nearby data available'}`
    };
  }

  let schools = [];
  if (schoolRes.status === "fulfilled") {
    const ranking = schoolRes.value.ranking || [];
    const nearby = schoolRes.value.nearby || [];
    const seen = new Set(ranking.map(s => s.name));
    schools = [...ranking, ...nearby.filter(s => !seen.has(s.name))]
      .sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
  }

  const amen = amenRes.status === "fulfilled" ? amenRes.value : null;
  const transport = transRes.status === "fulfilled" ? transRes.value : null;

  const center = amen && amen.center_lat != null
    ? { lat: amen.center_lat, lng: amen.center_lng }
    : (transport && transport.center_lat != null
        ? { lat: transport.center_lat, lng: transport.center_lng }
        : null);

  return {
    error: false,
    gnafId,
    center,
    schools,
    amenities: amen && {
      radius: amen.radius_m,
      counts: amen.counts || {},
      results: amen.results || []
    },
    transport: transport && {
      radius: transport.radius_m,
      counts: transport.counts || {},
      nearest: transport.nearest || {}
    }
  };
}

// ==========================================
// 5. CÁC API PHỤ THUỘC TAB (GEARING / CMA / RENT / RISKS)
// ==========================================
async function handleFetchNegativeGearing(gnafId) {
  try {
    const data = await fetchJson(`${API_BASE}/properties/${gnafId}/valuation/negative-gearing`);
    return { error: false, gnafId, data };
  } catch (err) {
    return { error: true, step: "NEGATIVE_GEARING_FAIL", message: err.message };
  }
}

async function handleFetchCma(gnafId) {
  try {
    const data = await fetchJson(`${API_BASE}/properties/${gnafId}/comparables/cma-comp-set`);
    return { error: false, gnafId, data };
  } catch (err) {
    return { error: true, step: "CMA_FAIL", message: err.message };
  }
}

async function handleFetchRentLatest(gnafId) {
  try {
    const data = await fetchJson(`${API_BASE}/properties/${gnafId}/rent-history-latest`);
    return { error: false, gnafId, data };
  } catch (err) {
    return { error: true, step: "RENT_LATEST_FAIL", message: err.message };
  }
}

async function handleFetchRisks(gnafId) {
  try {
    const data = await fetchJson(`${API_BASE}/properties/${gnafId}/risks/all`);
    return { error: false, gnafId, data };
  } catch (err) {
    return { error: true, step: "RISKS_FAIL", message: err.message };
  }
}
