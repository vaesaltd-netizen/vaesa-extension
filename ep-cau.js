// VAESA Extension — cầu nối của Bubble Extended Payment (world ISOLATED, mọi khung https://*.facebook.com/*).
// Thay content-scripts/main.js của SMIT (cs:1-41). SMIT để trang Facebook gửi "background-call" chạy BẤT KỲ hàm chrome.* / fetch
// mà không kiểm (lỗ hổng đã soi 19/11). VAESA chỉ nhận đúng 4 việc Bubble cần, khoá kho cố định "smit_…", giá trị được kiểm:
//   doc        — đọc cài đặt Extended Payment (trang VAESA /smit/extended-payment ghi vào kho)
//   ghi-tien   — ô "Quy đổi tiền tệ" trong Bubble: default / VND / USD
//   ty-gia     — tỷ giá mới (background gọi /api/ads-control/smit/ty-gia của VAESA)
//   ghi-ty-gia — lưu bảng tỷ giá "Tự động" vừa lấy
(() => {
  const KHOA = ['convert_currency', 'usd_rates', 'extended_payment_bubble', 'extended_payment_locale', 'extended_payment_display',
    'extended_payment_orders', 'extended_payment_signature', 'debugger_status']
  const MA = /^[A-Z][A-Z0-9_-]{0,15}$/
  const conSong = () => { try { return !!chrome.runtime?.id } catch (e) { return false } }
  const tyGiaHop = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.date === 'string' && v.auto === true
    && Object.entries(v).every(([k, x]) => k === 'date' || k === 'auto' || (MA.test(k) && typeof x === 'number' && Number.isFinite(x) && x >= 0))
  async function lam(d) {
    if (d.lenh === 'doc') {
      const g = await chrome.storage.local.get(KHOA.map((k) => 'smit_' + k))
      return Object.fromEntries(KHOA.map((k) => [k, g['smit_' + k]]))
    }
    if (d.lenh === 'ghi-tien') {
      if (!['default', 'VND', 'USD'].includes(d.gt)) return null
      await chrome.storage.local.set({ smit_convert_currency: d.gt })
      return true
    }
    if (d.lenh === 'ty-gia') {
      const r = await chrome.runtime.sendMessage({ action: 'VAESA_EP_TY_GIA' })
      return r && r.ok && typeof r.text === 'string' ? r.text : null
    }
    if (d.lenh === 'ghi-ty-gia') {
      if (!tyGiaHop(d.gt)) return null
      await chrome.storage.local.set({ smit_usd_rates: d.gt })
      return true
    }
    return null
  }
  // ep-bubble.js gửi lại cùng id khi chưa thấy trả lời (hai bên cùng nạp lúc document_start) ⇒ mỗi id chỉ làm một lần.
  const daNhan = new Set()
  window.addEventListener('message', (e) => {
    if (e.source !== window) return
    const d = e.data
    if (!d || d.vaesaEp !== 'goi' || typeof d.id !== 'string' || daNhan.has(d.id) || !conSong()) return
    daNhan.add(d.id)
    if (daNhan.size > 500) daNhan.clear()
    lam(d).then((kq) => kq, () => null).then((kq) => window.postMessage({ vaesaEp: 'tra', id: d.id, kq }, '*'))
  })
})()
