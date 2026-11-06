// content.js - TỰ ĐỘNG LỌC ĐỊA CHỈ & HỖ TRỢ CHUYỂN TRANG ĐỘNG (SPA) + LẮNG NGHE POPUP

(function () {
  'use strict';

  // Biến toàn cục lưu trạng thái để tránh gọi API trùng lặp
  let currentGnafId = null;       // Lưu mã ID căn nhà từ API Microburbs
  let lastProcessedUrl = "";     // Lưu URL vừa kiểm tra gần nhất
  let lastFetchedAddress = "";   // Lưu địa chỉ vừa gọi API gần nhất

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
  function extractAddress() {
    const addressRegex = /\b(\d+[\w\/\-]*\s+[\s\S]*?\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b(?:\s*\d{4})?)\b/i;
    let rawAddress = null;

    if (document.title) {
      const matchTitle = document.title.match(addressRegex);
      if (matchTitle && matchTitle[1]) {
        rawAddress = matchTitle[1].trim();
      }
    }

    if (!rawAddress) {
      const h1El = document.querySelector('h1');
      if (h1El && h1El.innerText.trim()) {
        const matchH1 = h1El.innerText.trim().match(addressRegex);
        if (matchH1 && matchH1[1]) {
          rawAddress = matchH1[1].trim();
        }
      }
    }

    if (rawAddress) {
      return rawAddress
        .replace(/\s*,?\s*\d{4}$/, '')                         // 1. Cắt 4 số Postcode ở cuối
        .replace(/,\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i, ' $1') // 2. Xóa dấu phẩy trước Bang
        .replace(/,\s*$/, '')                                  // 3. Xóa phẩy dư thừa ở tận cùng
        .replace(/\s+/g, ' ')                                  // 4. Gom nhiều khoảng trắng thành 1
        .trim();
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
        <span class="mb-logo">📊 Microburbs Insights</span>
        <button id="mb-close-btn">&times;</button>
      </div>
      
      <div class="mb-tabs">
        <button id="mb-tab-summary" class="mb-tab-btn active">Tổng quan</button>
        <button id="mb-tab-schools" class="mb-tab-btn">Trường học</button>
      </div>

      <div id="mb-content-body" class="mb-body">
        <div class="mb-spinner">🔍 Đang kết nối Microburbs API...</div>
      </div>
    `;
    document.body.appendChild(sidebar);

    document.getElementById('mb-close-btn').onclick = () => {
      sidebar.style.display = 'none';
    };

    document.getElementById('mb-tab-summary').onclick = () => switchTab('summary');
    document.getElementById('mb-tab-schools').onclick = () => switchTab('schools');

    return sidebar;
  }

  // =========================================================================
  // BƯỚC 4: RENDER DỮ LIỆU ĐỊNH GIÁ & BASICS VÀO TAB TỔNG QUAN
  // =========================================================================
  function renderSummaryData(data) {
    const body = document.getElementById('mb-content-body');

    if (!data || data.error) {
      body.innerHTML = `
        <div class="mb-error-box">
          <strong>🚨 LỖI API MICROBURBS</strong><br/>
          <strong>Bước lỗi:</strong> ${data?.step || 'UNKNOWN'}<br/>
          <strong>Chi tiết:</strong> ${data?.message || 'Không có phản hồi từ Background'}<br/>
        </div>
      `;
      return;
    }

    currentGnafId = data.gnafId;
    const formatCurrency = (val) => val ? `$${val.toLocaleString()} AUD` : 'Chưa có thông tin';

    body.innerHTML = `
      <div class="mb-section">
        <div class="mb-info-line">📍 Địa chỉ API: <strong>${data.matchedAddress}</strong></div>
        <div class="mb-info-line">🆔 GNAF ID: <code>${data.gnafId}</code></div>
      </div>

      <div class="mb-section mb-card">
        <div class="mb-title">ĐỊNH GIÁ THUẬT TOÁN (AVM)</div>
        <div class="mb-val">${formatCurrency(data.avmEstimate)}</div>
        <div class="mb-sub">Khoảng giá: ${formatCurrency(data.avmLow)} - ${formatCurrency(data.avmHigh)}</div>
        ${data.confidenceScore ? `<div class="mb-sub">Độ tin cậy: ${data.confidenceScore}%</div>` : ''}
      </div>

      <div class="mb-section mb-card">
        <div class="mb-title">THÔNG TIN CƠ BẢN (MICROBURBS API)</div>
        <div class="mb-grid">
          <div>🛏️ Số phòng ngủ: <strong>${data.bedCount ?? 'N/A'}</strong></div>
          <div>🚿 Số phòng tắm: <strong>${data.bathCount ?? 'N/A'}</strong></div>
          <div>🚗 Chỗ đậu xe: <strong>${data.parkingCount ?? 'N/A'}</strong></div>
          <div>🏠 Loại hình: <strong>${data.dwellingType || 'N/A'}</strong></div>
          ${data.landAreaSqm ? `<div>📐 Diện tích đất: <strong>${data.landAreaSqm} m²</strong></div>` : ''}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // BƯỚC 5: RENDER DỮ LIỆU DANH SÁCH TRƯỜNG HỌC LÂN CẬN
  // =========================================================================
  function switchTab(tabName) {
    const tabSummaryBtn = document.getElementById('mb-tab-summary');
    const tabSchoolsBtn = document.getElementById('mb-tab-schools');
    const body = document.getElementById('mb-content-body');

    if (tabName === 'summary') {
      tabSummaryBtn.classList.add('active');
      tabSchoolsBtn.classList.remove('active');
      if (window.cachedSummaryData) {
        renderSummaryData(window.cachedSummaryData);
      }
    } else if (tabName === 'schools') {
      tabSchoolsBtn.classList.add('active');
      tabSummaryBtn.classList.remove('active');

      if (!currentGnafId) {
        body.innerHTML = `<div class="mb-error-box">⚠️ Không có mã GNAF ID để tra cứu trường học.</div>`;
        return;
      }

      body.innerHTML = `<div class="mb-spinner">🏫 Đang tải danh sách trường học...</div>`;

      chrome.runtime.sendMessage(
        { action: "FETCH_SCHOOLS", gnafId: currentGnafId },
        (response) => {
          renderSchoolsData(response);
        }
      );
    }
  }

  function renderSchoolsData(data) {
    const body = document.getElementById('mb-content-body');

    if (!data || data.error) {
      body.innerHTML = `<div class="mb-error-box">❌ ${data?.message || 'Lỗi khi tải dữ liệu trường học'}</div>`;
      return;
    }

    const schoolList = data.schools || [];

    if (schoolList.length === 0) {
      body.innerHTML = `<div class="mb-info-line">Không tìm thấy trường học nào lân cận.</div>`;
      return;
    }

    const schoolsHtml = schoolList.map(s => `
      <div class="mb-school-card">
        <div class="mb-school-name">${s.name}</div>
        <div class="mb-school-sub">📍 Cách: ${(s.distance_m / 1000).toFixed(1)} km | 🏫 ${s.sector || 'Public'} (${s.school_level_type || 'N/A'})</div>
        ${s.naplan_label ? `<div class="mb-badge good">🏆 NAPLAN: ${s.naplan_label}</div>` : ''}
        ${s.socioeconomic_label ? `<div class="mb-badge info">📊 Thu nhập khu vực: ${s.socioeconomic_label}</div>` : ''}
        ${s.attendance_rate ? `<div class="mb-school-sub">📈 Tỷ lệ đi học: ${(s.attendance_rate * 100).toFixed(0)}%</div>` : ''}
      </div>
    `).join('');

    body.innerHTML = `<div class="mb-school-container">${schoolsHtml}</div>`;
  }

  // =========================================================================
  // BƯỚC 6: ĐIỀU HƯỚNG SPA (XỬ LÝ CHUYỂN TRANG ĐỘNG)
  // =========================================================================
  function handlePageExecution() {
    if (!isPropertyDetailPage()) {
      const sidebar = document.getElementById('microburbs-sidebar-root');
      if (sidebar) sidebar.style.display = 'none';
      return;
    }

    const address = extractAddress();
    if (!address) return;

    if (address === lastFetchedAddress) {
      const sidebar = document.getElementById('microburbs-sidebar-root');
      if (sidebar) sidebar.style.display = 'block';
      return;
    }

    lastFetchedAddress = address;
    const sidebar = createSidebarContainer();
    sidebar.style.display = 'block';

    document.getElementById('mb-content-body').innerHTML = `
      <div class="mb-spinner">🌐 Đang tra cứu API Microburbs cho:<br/><strong>"${address}"</strong>...</div>
    `;
    
    chrome.runtime.sendMessage(
      { action: "FETCH_PROPERTY_SUMMARY", address: address },
      (response) => {
        window.cachedSummaryData = response;
        renderSummaryData(response);
      }
    );
  }

  setInterval(() => {
    if (window.location.href !== lastProcessedUrl) {
      lastProcessedUrl = window.location.href;
      setTimeout(handlePageExecution, 500);
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
        <div class="mb-spinner">🌐 Đang tra cứu cho:<br/><strong>"${query}"</strong>...</div>
      `;

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

})(); // <--- ĐẶT NGAY TRƯỚC DÒNG ĐÓNG KHỐI IIFE NÀY