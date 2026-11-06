// background.js - GỌI API THẬT 100% (GỌN GÀNG: SUMMARY + SCHOOLS)

const API_BASE = "https://api.microburbs.com.au/v1";
const API_KEY = "test"; // Thay API Key thật của BTC tại đây

// ==========================================
// 1. BỘ ROUTER NHẬN TÍN HIỆU
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("📩 [background.js] Nhận yêu cầu Action:", request.action);

  if (request.action === "FETCH_PROPERTY_SUMMARY") {
    handleFetchPropertySummary(request.address).then(sendResponse);
    return true; 
  }

  if (request.action === "FETCH_PROPERTY_BY_GNAF") {
    handleFetchByGnafDirectly(request.gnafId).then(sendResponse);
    return true;
  }

    if (request.action === "FETCH_NEARBY") {
    handleFetchNearby(request.gnafId).then(sendResponse);
    return true;
  }

  if (request.action === "FETCH_NEGATIVE_GEARING") {
    handleFetchNegativeGearing(request.gnafId).then(sendResponse);
    return true;
  }

  if (request.action === "FETCH_CMA") {
    handleFetchCma(request.gnafId).then(sendResponse);
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
        message: `Geocode error (${geoRes.status}): ${errText || 'Invalid or expired API key'}`
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
        message: `The geocode API found no match for: "${rawAddress}"`
      };
    }

    const matched = properties[0];
    gnafId = matched.id || matched.gnaf_id;
    matchedAddress = matched.display_name || matched.name || matched.abbr;

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

    if (!avmRes.ok) {
      const errText = await avmRes.text();
      console.error("❌ BƯỚC 2A LỖI HTTP AVM:", avmRes.status, errText);
      console.groupEnd();
      return {
        error: true,
        step: "AVM_API_FAIL",
        status: avmRes.status,
        message: `AVM API error (${avmRes.status}): ${errText || 'Could not retrieve a valuation'}`
      };
    }

    const avmData = await avmRes.json();
    console.log("📦 BƯỚC 2A Response AVM Payload:", avmData);

    resAvm = avmData.data || avmData;

    if (!resAvm || !resAvm.predicted_price) {
      console.warn("⚠️ BƯỚC 2A: API trả 200 OK nhưng nhà này chưa có dữ liệu định giá!");
      console.groupEnd();
      return {
        error: true,
        step: "AVM_NO_PRICE",
        message: "No valuation is available for this property."
      };
    }
  } catch (err) {
    console.error("💥 BƯỚC 2A LỖI MẠNG / SCRIPT AVM:", err);
    console.groupEnd();
    return { error: true, step: "AVM_NETWORK_ERROR", message: `AVM connection error: ${err.message}` };
  }

  // BƯỚC 2B: GỌI API THÔNG TIN CƠ BẢN (BASICS)
  let resBasics = {};
  try {
    const basicsUrl = `${API_BASE}/properties/${gnafId}/basics/all`;
    console.log("🌐 BƯỚC 2B: Đang gọi API Basics ->", basicsUrl);

    const basicsRes = await fetch(basicsUrl, { headers });
    console.log("📡 BƯỚC 2B Status Code Basics:", basicsRes.status);

    if (!basicsRes.ok) {
      const errText = await basicsRes.text();
      console.error("❌ BƯỚC 2B LỖI HTTP BASICS:", basicsRes.status, errText);
      console.groupEnd();
      return {
        error: true,
        step: "BASICS_API_FAIL",
        status: basicsRes.status,
        message: `Basics API error (${basicsRes.status}): ${errText || 'Could not retrieve basic property details'}`
      };
    }

    const basicsData = await basicsRes.json();
    console.log("📦 BƯỚC 2B Response Basics Payload:", basicsData);

    resBasics = basicsData.data || basicsData;

  } catch (err) {
    console.error("💥 BƯỚC 2B LỖI MẠNG BASICS:", err);
    console.groupEnd();
    return { error: true, step: "BASICS_NETWORK_ERROR", message: `Basics connection error: ${err.message}` };
  }

  // BƯỚC 3: ĐÓNG GÓI DỮ LIỆU THÀNH CÔNG TRẢ VỀ CONTENT.JS
  const predicted = resAvm.predicted_price;
  const predictedLow = resAvm.predicted_price_low;
  const predictedHigh = resAvm.predicted_price_high;
  const confidenceScore = resAvm.confidence_score;
  const predictedEstDate = resAvm.prediction_date;

  const bedCount = resBasics.bed_count;
  const bathCount = resBasics.bath_count;
  const parkingCount = resBasics.parking_count;
  const dwellingType = resBasics.dwelling_type;
  const landAreaSqm = resBasics.land_area_sqm;

  console.log("✅ BƯỚC 3 HOÀN TẤT THÀNH CÔNG! Định giá AVM:", predicted);
  console.groupEnd();

  return {
    error: false,
    rawAddress: rawAddress,
    gnafId: gnafId,
    matchedAddress: matchedAddress,

    avmEstimate: Math.round(predicted),
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
// 3. HÀM MỚI BỔ SUNG: GỌI TRỰC TIẾP BẰNG GNAF ID (BỎ QUA GEOCODE)
// ==========================================
async function handleFetchByGnafDirectly(gnafId) {
  console.group("🚀 [Microburbs Direct GNAF Debug]");
  console.log("📌 Gọi trực tiếp dữ liệu cho GNAF ID:", gnafId);

  const headers = { "Authorization": `Bearer ${API_KEY}` };

  // 1. Gọi AVM
  let resAvm = {};
  try {
    const avmUrl = `${API_BASE}/properties/${gnafId}/valuation/avm`;
    const avmRes = await fetch(avmUrl, { headers });
    if (avmRes.ok) {
      const avmData = await avmRes.json();
      resAvm = avmData.data || avmData;
    } else {
      const errText = await avmRes.text();
      console.error("❌ Lỗi AVM Direct:", avmRes.status, errText);
    }
  } catch (err) {
    console.error("💥 Lỗi Mạng AVM Direct:", err);
  }

  // 2. Gọi Basics
  let resBasics = {};
  try {
    const basicsUrl = `${API_BASE}/properties/${gnafId}/basics/all`;
    const basicsRes = await fetch(basicsUrl, { headers });
    if (basicsRes.ok) {
      const basicsData = await basicsRes.json();
      resBasics = basicsData.data || basicsData;
    } else {
      const errText = await basicsRes.text();
      console.error("❌ Lỗi Basics Direct:", basicsRes.status, errText);
    }
  } catch (err) {
    console.error("💥 Lỗi Mạng Basics Direct:", err);
  }

  console.groupEnd();

  // Đóng gói trả về cho content.js
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
// 3. TRIGGER TAB TRƯỜNG HỌC
// ==========================================
async function fetchJson(url) {
  console.log("🌐 Đang gọi ->", url);
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${API_KEY}` } });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  const json = await res.json();
  return json.data || json;
}

const NEARBY_RADIUS_M = 2000; // 100 - 5000, mặc định API là 1000

async function handleFetchNearby(gnafId) {
  const [schoolRes, amenRes, transRes] = await Promise.allSettled([
    fetchJson(`${API_BASE}/properties/${gnafId}/schools/all`),
    fetchJson(`${API_BASE}/properties/${gnafId}/amenities/nearby?radius_m=${NEARBY_RADIUS_M}`),
    fetchJson(`${API_BASE}/properties/${gnafId}/transport/nearby?radius_m=${NEARBY_RADIUS_M}`)
  ]);

  const log = (name, r) =>
    r.status === "fulfilled"
      ? console.log(`📦 ${name} payload:`, r.value)
      : console.error(`❌ ${name} lỗi:`, r.reason);
  log("Schools", schoolRes);
  log("Amenities", amenRes);
  log("Transport", transRes);

  if ([schoolRes, amenRes, transRes].every(r => r.status === "rejected")) {
    return {
      error: true,
      step: "NEARBY_API_FAIL",
      message: `API error: ${schoolRes.reason.message}`
    };
  }

  // --- Trường học: ranking có đủ thông tin, nearby bổ sung những trường chưa có xếp hạng ---
  let schools = [];
  if (schoolRes.status === "fulfilled") {
    const ranking = schoolRes.value.ranking || [];
    const nearby = schoolRes.value.nearby || [];
    const seen = new Set(ranking.map(s => s.name));
    schools = [...ranking, ...nearby.filter(s => !seen.has(s.name))]
      .sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
  }

  // --- Tiện ích ---
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
// 4. NEGATIVE GEARING (tính phí 20c/lần gọi -> chỉ gọi khi người dùng mở tab Investment)
// ==========================================
async function handleFetchNegativeGearing(gnafId) {
  try {
    const data = await fetchJson(`${API_BASE}/properties/${gnafId}/valuation/negative-gearing`);
    console.log("📦 Negative gearing payload:", data);
    return { error: false, gnafId, data };
  } catch (err) {
    console.error("❌ Lỗi Negative gearing:", err);
    return {
      error: true,
      step: "NEGATIVE_GEARING_FAIL",
      message: `Negative gearing API error: ${err.message}`
    };
  }
}


// ==========================================
// 5. CMA COMPARABLE SET (tính phí 60c/lần gọi -> chỉ gọi khi người dùng mở tab Comparables)
// ==========================================
async function handleFetchCma(gnafId) {
  try {
    const data = await fetchJson(`${API_BASE}/properties/${gnafId}/comparables/cma-comp-set`);
    console.log("📦 CMA comp set payload:", data);
    return { error: false, gnafId, data };
  } catch (err) {
    console.error("❌ Lỗi CMA:", err);
    return {
      error: true,
      step: "CMA_FAIL",
      message: `Comparable sales API error: ${err.message}`
    };
  }
}
