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

  if (request.action === "FETCH_SCHOOLS") {
    handleFetchSchools(request.gnafId).then(sendResponse);
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
        message: `Lỗi Geocode (${geoRes.status}): ${errText || 'Key sai hoặc hết hạn authorization'}`
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
        message: `API Geocode không tìm thấy dữ liệu cho: "${rawAddress}"`
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
        message: `Địa chỉ "${matchedAddress}" không có mã GNAF ID hợp lệ.`
      };
    }

    console.log("✅ BƯỚC 1 THÀNH CÔNG -> GNAF ID:", gnafId);

  } catch (err) {
    console.error("💥 BƯỚC 1 LỖI MẠNG / SCRIPT:", err);
    console.groupEnd();
    return { error: true, step: "GEOCODE_NETWORK_ERROR", message: `Lỗi kết nối Geocode: ${err.message}` };
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
        message: `Lỗi API AVM (${avmRes.status}): ${errText || 'Không lấy được định giá'}`
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
        message: "Không tìm thấy dữ liệu giá định giá cho tài sản này."
      };
    }
  } catch (err) {
    console.error("💥 BƯỚC 2A LỖI MẠNG / SCRIPT AVM:", err);
    console.groupEnd();
    return { error: true, step: "AVM_NETWORK_ERROR", message: `Lỗi kết nối AVM: ${err.message}` };
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
        message: `Lỗi API Basics (${basicsRes.status}): ${errText || 'Không lấy được thông tin cơ bản'}`
      };
    }

    const basicsData = await basicsRes.json();
    console.log("📦 BƯỚC 2B Response Basics Payload:", basicsData);

    resBasics = basicsData.data || basicsData;

  } catch (err) {
    console.error("💥 BƯỚC 2B LỖI MẠNG BASICS:", err);
    console.groupEnd();
    return { error: true, step: "BASICS_NETWORK_ERROR", message: `Lỗi kết nối Basics: ${err.message}` };
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
    matchedAddress: `Mã GNAF: ${gnafId}`,

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
    matchedAddress: `Mã GNAF: ${gnafId}`,

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
async function handleFetchSchools(gnafId) {
  try {
    const schoolUrl = `${API_BASE}/properties/${gnafId}/schools/all`;
    console.log("🌐 Đang gọi API School ->", schoolUrl);

    const schoolRes = await fetch(schoolUrl, { headers: { "Authorization": `Bearer ${API_KEY}` } });
    console.log("📡 Status Code School:", schoolRes.status);

    if (!schoolRes.ok) {
      const errText = await schoolRes.text();
      console.error("❌ LỖI HTTP SCHOOLS:", schoolRes.status, errText);
      return {
        error: true,
        step: "SCHOOLS_API_FAIL",
        status: schoolRes.status,
        message: `Lỗi API Trường học (${schoolRes.status}): ${errText}`
      };
    }

    const schoolData = await schoolRes.json();
    console.log("📦 Response Payload Trường học:", schoolData);

    const resSchools = schoolData.data || schoolData;

    if (!resSchools.ranking && !resSchools.nearby) {
      console.warn("⚠️ Không tìm thấy trường học nào xung quanh!");
      return {
        error: true,
        step: "SCHOOLS_EMPTY",
        message: "Không có dữ liệu trường học xung quanh địa chỉ này."
      };
    }

    console.log("✅ BƯỚC SCHOOLS THÀNH CÔNG!");

    return {
      error: false,
      gnafId: gnafId,
      ranking: resSchools.ranking || [],
      nearby: resSchools.nearby || [],
      schools: resSchools.ranking || resSchools.nearby || []
    };

  } catch (err) {
    console.error("💥 LỖI MẠNG SCHOOLS:", err);
    return { 
      error: true, 
      step: "SCHOOLS_NETWORK_ERROR", 
      message: `Lỗi kết nối API Trường học: ${err.message}` 
    };
  }
}