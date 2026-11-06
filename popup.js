// popup.js - GỬI TÍN HIỆU CHUẨN XÁC SANG CONTENT.JS

document.addEventListener('DOMContentLoaded', () => {
  const searchBtn = document.getElementById('search-btn');
  const inputEl = document.getElementById('manual-address');

  if (!searchBtn || !inputEl) return;

  searchBtn.addEventListener('click', () => {
    const query = inputEl.value.trim();
    if (!query) {
      alert("Vui lòng nhập địa chỉ hoặc mã GNAF ID!");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;

      // Gửi tin nhắn và ĐỜI CALLBACK XÁC NHẬN xong mới đóng cửa sổ Popup
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "POPUP_MANUAL_SEARCH", query: query },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("⚠️ Chưa thể kết nối với content.js:", chrome.runtime.lastError.message);
          }
          window.close(); // Đóng popup an toàn
        }
      );
    });
  });
});