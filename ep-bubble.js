// VAESA Extension — Bubble "Extended Payment" trên trang Facebook (world MAIN, mọi khung https://*.facebook.com/*).
// Chép SMIT `content-scripts/hook.js` (gọi tắt hook): Vue SFC → hàm dựng DOM thường, cùng thẻ / lớp / data-v-… nên CSS SMIT
// (trích máy ở ep-tai-nguyen.js) áp y nguyên. Bản trong mã SMIT là Bubble kiểu cũ (V6): nút tròn xanh + bảng 360px. Bản giao
// diện mới (V8) và chế độ "Thanh Action" KHÔNG có trong mã SMIT ⇒ không làm (bản đọc docs/modules/smit/extended-payment.md §10).
// Thành phần: Header (hook:2-79), Footer (129-183), Rename (252-335), Convert (350-431), ListCard (705-873), Body (874-1500),
// App (1619-1674), Bubble (1689-1781), chữ vi/en (1782-1927), khởi động (1999-2201).
// Khác SMIT (đều ghi ở bản đọc, mục VAESA):
// - Không chép: thẻ "SMIT Agency" (quảng cáo SMIT), nút ✕ hộp "Cần xác minh" (handleVerificationPopup — tính năng khác của tiện ích),
//   cảnh báo trùng Ads Check (khối chết, SMIT_adscheck = false), lệnh ping (dò xung đột tiện ích SMIT), đoạn bản bẻ khoá chèn thêm (2202-2213).
// - Id / sự kiện smit-… → vaesa-… và biến toàn cục SMIT_… để trong hàm: chạy song song tiện ích SMIT (máy NV có cài) không giẫm nhau.
// - Cài đặt đọc từ kho VAESA Extension (khoá smit_*, do trang /smit/extended-payment ghi) qua ep-cau.js — không mở cửa "gọi mọi lệnh" như SMIT.
// - Chữ ký: kho VAESA (SMIT: máy chủ SMIT), lọc thẻ như khung xem trước SMIT trước khi chèn. Tỷ giá tự động: /api/ads-control/smit/ty-gia
//   của VAESA qua background (SMIT: gateway.smit.vn). Liên kết "cài đặt" / "?" trỏ trang VAESA tương ứng (SMIT: adscheck.smit.vn).
// ⚠ "Đổi tên TK" (POST tên TKQC) và "Xoá thẻ" (GraphQL 9195168280589012) là thao tác GHI thật lên Facebook như SMIT — chỉ chạy khi người dùng bấm.
(function () {
  'use strict'
  if (window.__VAESA_EP_nap) return
  window.__VAESA_EP_nap = true
  const TN = globalThis.__vaesaEpTaiNguyen
  try { delete globalThis.__vaesaEpTaiNguyen } catch (e) { /* bỏ */ }
  if (!TN) return

  const TRANG_VAESA = 'https://vaesa-livechat.pages.dev'
  const MOC = ' '.repeat(34) + 'SMIT' // dấu tiền đã quy đổi (hook:2078) — bị cắt trước khi hiện
  const SU_KIEN_AN = 'VAESA-hidden-bubble-payment' // SMIT-hidden-bubble-payment
  let slog = false
  const cho = (ms) => new Promise((r) => setTimeout(r, ms))
  const logger = (...a) => { if (slog) console.log('[VAESA EP]', ...a) }

  // ── Cầu nối tới ep-cau.js (thay BroadcastChannel "background-call" hook:2006-2015) ──
  let soGoi = 0
  function goi(lenh, gt) {
    return new Promise((xong) => {
      const id = `ep${Date.now().toString(36)}${(soGoi += 1)}`
      let lan = 0, hen = 0
      const nghe = (e) => {
        if (e.source !== window || !e.data || e.data.vaesaEp !== 'tra' || e.data.id !== id) return
        window.removeEventListener('message', nghe); clearTimeout(hen); xong(e.data.kq)
      }
      window.addEventListener('message', nghe)
      // Hai content script cùng chạy lúc document_start, chưa chắc bên kia đã sẵn ⇒ gửi lại vài lần.
      const gui = () => {
        if (lan >= 8) { window.removeEventListener('message', nghe); xong(null); return }
        lan += 1
        window.postMessage({ vaesaEp: 'goi', id, lenh, gt }, '*')
        hen = setTimeout(gui, lan < 3 ? 400 : 1500)
      }
      gui()
    })
  }

  // ── Chữ (createI18n locale "en", fallback "en" — hook:2016-2023) + cập nhật chữ đã vẽ khi đổi ngôn ngữ (như Vue) ──
  const VI = {
    'btn-save': 'Lưu', 'btn-cancel': 'Hủy', 'btn-convert-currency': 'Quy đổi tiền tệ', 'btn-rename-adaccount': 'Đổi tên TK', 'option-default': 'Mặc định',
    'text-convert-currency': 'Quy đổi tiền tệ', 'text-account-id': 'ID tài khoản', 'text-account-name': 'Tên tài khoản', 'text-account-status': 'Trạng thái tài khoản',
    'text-limited': 'Limit', 'text-limited2': 'Limit ẩn', 'text-threshold': 'Ngưỡng hiện tại', 'text-amount-spend': 'Tổng chi tiêu', 'text-balance': 'Số dư',
    'text-created-at': 'Ngày tạo tài khoản', 'text-billing-at': 'Ngày lập hóa đơn', 'text-admin-hidden': 'Quản trị viên ẩn', 'text-account-type': 'Loại tài khoản',
    'text-timezone': 'Múi giờ', 'text-screen-shot-at': 'Thời gian chụp', 'text-business': 'Tên doanh nghiệp', 'text-payment-card': 'Thẻ thanh toán', 'text-role': 'Quyền tài khoản',
    'label-business': 'Doanh nghiệp', 'label-personal-detached': 'Cá nhân tách', 'label-personal-normal': 'Cá nhân thường', 'label-ADMIN': 'Quản trị viên',
    'label-GENERAL_USER': 'Nhà quảng cáo', 'label-REPORTS_ONLY': 'Nhà phân tích', 'label-Unknown': 'Chưa xác định', 'label-status-ACTIVE': 'Hoạt động',
    'label-status-DISABLED': 'Vô hiệu hóa', 'label-status-UNSETTLED': 'Cần thanh toán', 'label-status-PENDING_RISK_REVIEW': 'Đang xem xét',
    'label-status-PENDING_SETTLEMENT': 'Đang xem xét', 'label-status-IN_GRACE_PERIOD': 'Ân hạn', 'smit-slogan': 'Bộ giải pháp cho nhà quảng cáo',
    original: 'Giá trị gốc', converted: 'Giá trị quy đổi', 'listcard-confirm-delete-title': 'Xác nhận xóa', 'listcard-confirm-question': 'Bạn chắc chắn muốn xóa',
    'listcard-confirm-btn': 'Xác nhận', 'listcard-no-data': 'Không có dữ liệu', 'listcard-delete-card-title': 'Xóa thẻ',
    'status-USABLE': 'Khả dụng', 'status-PENDING_ACTIVATION': 'Chờ kích hoạt', 'status-UNUSABLE': 'Không thể sử dụng', 'status-UNVERIFIED_OR_PENDING_AUTH': 'Chưa xác minh hoặc chờ xác thực',
    'status-PENDING_VERIFICATION': 'Đang chờ xác minh', 'status-UNSUPPORTED_ON_NET_30': 'Không hỗ trợ hạn mức tín dụng (Net 30)', 'status-ADS_PAYMENTS_RESTRICTED': 'Bị hạn chế thanh toán quảng cáo',
    'status-UNVERIFIABLE': 'Không thể xác minh', 'status-LPM_PENDING_VERIFICATION': 'Thanh toán địa phương đang chờ xác minh', 'status-UNSUPPORTED_FOR_BILLING_SAFE_MODE': 'Không hỗ trợ Chế độ An toàn Thanh toán',
    'status-INSUFFICIENT_FUNDS': 'Không đủ số dư', 'status-BILLING_SAFE_MODE_CRED_UNUSABLE_NULL_INTENT': 'Tín dụng không khả dụng trong Chế độ an toàn',
    'status-PAYMENT_METHOD_DECLINED': 'Phương thức thanh toán bị từ chối', 'status-TRUSTLY_DECLINED': 'Trustly bị từ chối',
  }
  const EN = {
    'btn-save': 'Save', 'btn-cancel': 'Cancel', 'btn-convert-currency': 'Currency convert', 'btn-rename-adaccount': 'Rename', 'option-default': 'Default',
    'text-convert-currency': 'Currency convert', 'text-account-id': "Account's ID", 'text-account-name': "Account's Name", 'text-account-status': "Account's status",
    'text-limited': 'Limit', 'text-limited2': 'Hidden Limit', 'text-threshold': 'Threshold', 'text-amount-spend': 'Total spending', 'text-balance': 'Balance',
    'text-created-at': 'Creation time', 'text-billing-at': 'Invoice time', 'text-admin-hidden': 'Hidden Admin', 'text-account-type': 'Account type',
    'text-timezone': 'Timezone', 'text-screen-shot-at': 'Screenshot time', 'text-business': "Business's name", 'text-payment-card': 'Payment card', 'text-role': 'Roles',
    'label-business': 'Business', 'label-personal-detached': 'Business Detached', 'label-personal-normal': 'Personal Account', 'label-ADMIN': 'Admin',
    'label-GENERAL_USER': 'Advertiser', 'label-REPORTS_ONLY': 'Analyst', 'label-Unknown': 'Unknown', 'label-status-ACTIVE': 'Active', 'label-status-DISABLED': 'Disabled',
    'label-status-UNSETTLED': 'Need to pay', 'label-status-PENDING_RISK_REVIEW': 'In consideration', 'label-status-PENDING_SETTLEMENT': 'In consideration',
    'label-status-IN_GRACE_PERIOD': 'Grace', 'smit-slogan': 'Professional Advertising Solutions', original: 'Original Value', converted: 'Converted Value',
    'listcard-confirm-delete-title': 'Confirm delete', 'listcard-confirm-question': 'Are you sure you want to delete', 'listcard-confirm-btn': 'Confirm',
    'listcard-no-data': 'No data', 'listcard-delete-card-title': 'Delete card',
    'status-USABLE': 'Usable', 'status-PENDING_ACTIVATION': 'Pending activation', 'status-UNUSABLE': 'Unusable', 'status-UNVERIFIED_OR_PENDING_AUTH': 'Unverified or pending authentication',
    'status-PENDING_VERIFICATION': 'Pending verification', 'status-UNSUPPORTED_ON_NET_30': 'Unsupported for credit limit (Net 30)', 'status-ADS_PAYMENTS_RESTRICTED': 'Ads payments restricted',
    'status-UNVERIFIABLE': 'Unverifiable', 'status-LPM_PENDING_VERIFICATION': 'Local payment method pending verification', 'status-UNSUPPORTED_FOR_BILLING_SAFE_MODE': 'Unsupported for Billing Safe Mode',
    'status-INSUFFICIENT_FUNDS': 'Insufficient funds', 'status-BILLING_SAFE_MODE_CRED_UNUSABLE_NULL_INTENT': 'Credit unusable in Safe Mode',
    'status-PAYMENT_METHOD_DECLINED': 'Payment method declined', 'status-TRUSTLY_DECLINED': 'Trustly declined',
  }
  let ngonNgu = 'en'
  const t = (k) => ({ vi: VI, en: EN }[ngonNgu]?.[k] ?? EN[k] ?? k)
  const buoc = new Set() // { el, ve } — chữ phụ thuộc ngôn ngữ
  const theoChu = (el, ve) => { ve(); buoc.add({ el, ve }); return el }
  // Nút chữ đổi theo ngôn ngữ: chu(() => ' ' + t('…')).
  const chu = (f) => { const x = document.createTextNode(''); return theoChu(x, () => { x.data = f() }) }
  function datNgonNgu(l) {
    if (l === ngonNgu) return
    ngonNgu = l
    for (const b of buoc) { if (!b.el.isConnected) { buoc.delete(b); continue } b.ve() }
    for (const f of veLai) f()
  }
  const veLai = new Set() // thành phần dựng lại toàn phần khi đổi ngôn ngữ (Body)

  // ── Dựng DOM ──
  function h(tag, p, con, sc) {
    const el = document.createElement(tag)
    for (const s of [].concat(sc || [])) el.setAttribute(s, '')
    for (const [k, v] of Object.entries(p || {})) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'style') Object.assign(el.style, v)
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else el.setAttribute(k, v === true ? '' : String(v))
    }
    for (const c of [].concat(con ?? [])) { if (c == null || c === false) continue; el.append(typeof c === 'string' ? document.createTextNode(c) : c) }
    return el
  }
  // Icon / SVG trích từ hook.js; sc = phạm vi của thành phần cha (gốc thành phần con nhận data-v của cha như Vue).
  function anh(ten, sc) {
    const k = document.createElement('template')
    k.innerHTML = TN.svg[ten]
    const el = k.content.firstElementChild
    for (const s of [].concat(sc || [])) el.setAttribute(s, '')
    return el
  }
  let daChenCss = false
  function chenCss() { // styleInject (rollup-plugin-styles) — một thẻ style mỗi thành phần
    if (daChenCss) return
    daChenCss = true
    const dau = document.head || document.documentElement
    // Đổi đúng 3 tên id/lớp sang vaesa- (Bubble.vue) để không trùng SMIT; số đo giữ nguyên.
    const doiTen = (s) => s.replace(/#smit-bubble-open/g, '#vaesa-bubble-open').replace(/#smit-bubble-icon/g, '#vaesa-bubble-icon').replace(/\.smit-bubble/g, '.vaesa-bubble')
    for (const k of ['header', 'footer', 'rename', 'convert', 'loading', 'listcard', 'body', 'app', 'bubble']) {
      const st = document.createElement('style')
      st.setAttribute('data-vaesa-ep', k)
      st.textContent = doiTen(TN.css[k])
      dau.appendChild(st)
    }
  }
  // Lọc chữ ký như khung xem trước SMIT (DOMPurify 589:1543-1546): chỉ p br strong b em i u s span mark a; thuộc tính style href target rel.
  const THE_DUOC = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SPAN', 'MARK', 'A'])
  const THUOC_DUOC = new Set(['style', 'href', 'target', 'rel'])
  const BO_CA_RUOT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'TEXTAREA', 'SELECT']) // như FORBID_CONTENTS của DOMPurify
  function locChuKy(html) {
    const k = document.createElement('template')
    k.innerHTML = String(html || '')
    const di = (n) => {
      for (const c of [...n.childNodes]) {
        if (c.nodeType === 3) continue
        if (c.nodeType !== 1 || BO_CA_RUOT.has(c.tagName.toUpperCase())) { c.remove(); continue }
        di(c)
        if (!THE_DUOC.has(c.tagName)) { c.replaceWith(...c.childNodes); continue }
        for (const a of [...c.attributes]) {
          if (!THUOC_DUOC.has(a.name) || (a.name === 'href' && !/^(https?:|mailto:|tel:|\/|#)/i.test(a.value.trim()))) c.removeAttribute(a.name)
        }
      }
    }
    di(k.content)
    const d = document.createElement('div')
    d.appendChild(k.content)
    return d.innerHTML.trim()
  }

  // ── Cài đặt (loadStorage hook:2046-2073) ──
  const cd = { tyGia: {}, doiTien: 'default', bat: undefined, ngonNgu: 'auto', hien: undefined, thuTu: [], chuKy: undefined }
  let chuKyHua = null
  async function napCaiDat() {
    const a = new Date()
    const homNay = `${a.getFullYear()}-${(a.getMonth() + 1).toString().padStart(2, 0)}-${a.getDate().toString().padStart(2, 0)}`
    chuKyHua = goi('doc')
    const n = (await chuKyHua) || {}
    if (n.debugger_status) slog = true
    logger(n)
    cd.tyGia = n.usd_rates || {}
    cd.doiTien = n.convert_currency || 'default'
    cd.bat = typeof n.extended_payment_bubble !== 'boolean' || n.extended_payment_bubble
    cd.ngonNgu = n.extended_payment_locale || 'auto'
    cd.hien = n.extended_payment_display
    cd.thuTu = n.extended_payment_orders || []
    cd.chuKy = typeof n.extended_payment_signature === 'string' ? n.extended_payment_signature : null
    ghiDeHam()
    // Tỷ giá "Tự động": chưa có, hoặc ngày tỷ giá + 1 ngày < hôm nay ⇒ lấy mới (SMIT gọi gateway.smit.vn; VAESA gọi máy VAESA qua background).
    if (!n.usd_rates || (n.usd_rates.auto === true && new Date(n.usd_rates.date).getTime() + 864e5 < new Date(homNay).getTime())) {
      goi('ty-gia').then(async (txt) => {
        if (!(txt && txt.includes('success') && txt.includes('date') && txt.includes('rates'))) return
        const j = JSON.parse(txt)
        const moi = { date: j.date, auto: true, ...j.rates }
        await goi('ghi-ty-gia', moi)
        cd.tyGia = moi
      })
    }
  }

  // ── Vá hàm định dạng tiền của Facebook (overWriteHook hook:2074-2131) ──
  const TRANG_QC = [/facebook\.com\/adsmanager\//, /facebook\.com\/ads\/manager\//, /facebook\.com\/billing_hub\//, /facebook\.com\/adsreporting\//]
  // Hàm định dạng ngay dưới lớp vá của VAESA. Máy NV thường cài cả tiện ích SMIT: SMIT vá cùng hàm và nhánh "giữ gốc" của SMIT
  // gọi lớp dưới mà BỎ cờ thứ 3 (hook:2084) ⇒ lớp VAESA nằm dưới tưởng phải quy đổi, viên "Giá trị gốc" ra số đã đổi (đo 20/11).
  // Giá trị gốc trong Bubble gọi thẳng lớp dưới này ⇒ ra số gốc dù SMIT vá trước hay sau; không cài SMIT thì kết quả y như SMIT.
  let dinhDangDuoi = null
  function datTheoTrang(ic) {
    if (cd.ngonNgu === 'auto') datNgonNgu(ic.code === 'vi_VN' ? 'vi' : 'en')
    if (cd.ngonNgu === 'vi') datNgonNgu('vi')
    if (cd.ngonNgu === 'en') datNgonNgu('en')
  }
  function ghiDeHam() {
    if (!window.requireLazy) { requestAnimationFrame(ghiDeHam); return }
    logger('start overWriteHook')
    if (!TRANG_QC.some((r) => r.test(location.href))) { window.requireLazy(['IntlCurrentLocale'], datTheoTrang); return }
    window.requireLazy(['AdsCurrencyFormatter', 'Currency'], (n, a) => {
      const o = n.formatCurrencyAtLeastOneSigFig
      dinhDangDuoi = o
      n.formatCurrencyAtLeastOneSigFig = function (cur, i, s) {
        if (s) return o(cur, i)
        if (cd.doiTien !== 'default' && cur !== cd.doiTien && Object.keys(cd.tyGia).length) {
          const r = a.getOffset(cur), d = a.getOffset(cd.doiTien)
          const so = i / cd.tyGia[cur] * cd.tyGia[cd.doiTien] / r * d
          return o.apply(this, [cd.doiTien, so]) + MOC
        }
        return o.apply(this, arguments)
      }
    })
    window.requireLazy(['UnicodeBidiWrapper', 'react', 'UnicodeBidi', 'UnicodeBidiDirection'], (e, n, a, o) => {
      const goc = e.inline
      e.inline = function (x) {
        if (x.endsWith(MOC)) {
          x = x.replace(MOC, '')
          const huong = a.getDirection(x)
          const s = '_3dfi' + (huong === o.LTR ? ' _3dfj' : '') + (huong === o.RTL ? ' _3dfk' : '')
          return n.jsx('span', { className: s, children: x, style: { color: '#00a46b' } })
        }
        return goc.apply(this, arguments)
      }
    })
    window.requireLazy(['AdsInsightsTextSubtextCell.react', 'react'], (e) => {
      const a = e?.MainText?.prototype?.render
      const o = e?.prototype?.render
      if (a) {
        e.MainText.prototype.render = function () {
          if (this.props.children[1]?.type === 'span') {
            const x = this.props.children[1]?.props?.children?.find?.((y) => y?.props?.children?.endsWith?.(MOC))
            if (x) { x.props.children = x.props.children.replace(MOC, ''); x.props.color = '#00a46b'; x.type = 'font' }
          }
          return a.apply(this, arguments)
        }
      }
      if (o) {
        e.prototype.render = function () {
          const x = this.props?.mainText?.props?.children?.find?.((y) => y?.props?.children?.endsWith?.(MOC))
          if (x) { x.props.children = x.props.children.replace(MOC, ''); x.props.color = '#00a46b'; x.type = 'font' }
          return o.apply(this, arguments)
        }
      }
    })
    window.requireLazy(['IntlCurrentLocale'], datTheoTrang)
  }

  // ── Header.vue (hook:2-79, scope 74d87822) ──
  function Header(laBubble, scCha) {
    const S = 'data-v-74d87822'
    const nut = laBubble
      ? h('a', { class: 'logo settings', onclick: (e) => window.dispatchEvent(new CustomEvent(SU_KIEN_AN, { detail: { clientX: e.clientX, clientY: e.clientY } })) }, [anh('header-close')], S)
      : h('a', { class: 'logo settings', href: `${TRANG_VAESA}/smit/extended-payment`, target: '_blank' }, [anh('header-settings')], S)
    const el = h('div', { class: laBubble ? 'header move' : 'header' }, [
      anh('header-title'),
      h('div', { class: 'right' }, [h('a', { class: 'logo text', href: 'https://smit.vn', target: '_blank' }, [h('div', { class: 'text' }, 'SMIT.VN', S)], S), nut], S),
    ], [S, scCha])
    // mounted: kéo bảng bằng thanh đầu (chỉ Bubble)
    if (laBubble) {
      el.onmousedown = (e) => {
        e.preventDefault()
        const b = document.querySelector('#vaesa-bubble-open')
        if (!b) return
        const x = e.clientX - b.getBoundingClientRect().left, y = e.clientY - b.getBoundingClientRect().top
        document.onmousemove = (m) => { m.preventDefault(); b.style.top = m.pageY - y + 'px'; b.style.left = m.pageX - x + 'px' }
        document.onmouseup = (m) => { m.preventDefault(); document.onmouseup = null; document.onmousemove = null }
      }
    }
    return el
  }

  // ── Footer.vue (hook:129-183, scope 53a61430) ──
  function Footer(scCha) {
    const S = 'data-v-53a61430'
    const trai = h('div', { class: 'left' }, [anh('loading', S)], S)
    const el = h('div', { class: 'footer' }, [trai, h('div', { class: 'right' }, [anh('logo_smit_color', S)], S)], [S, scCha])
    ;(async () => {
      try {
        if (cd.chuKy === undefined) await chuKyHua
        const ck = cd.chuKy ? locChuKy(cd.chuKy) : ''
        if (ck) { trai.innerHTML = ck; return }
        trai.replaceChildren(h('span', { class: 'slogan' }, 'SMIT.VN', S), chu(() => ' - ' + t('smit-slogan')))
      } catch (e) { trai.replaceChildren() }
    })()
    return el
  }

  // ── Rename.vue (hook:252-335, scope 9739e75a) — POST tên TKQC thật ──
  function Rename(huy, scCha) {
    const S = 'data-v-9739e75a'
    let id = null, ten = null, trangThai = false
    const o = h('input', { type: 'text' }, null, S)
    o.addEventListener('input', () => { ten = o.value })
    o.addEventListener('keyup', (e) => { if (e.key === 'Enter') luu() })
    const phai = h('div', { class: 'right' }, null, S)
    const nutHuy = h('button', { onclick: () => huy() }, [chu(() => t('btn-cancel'))], S)
    const nutLuu = h('button', { onclick: () => luu() }, [chu(() => t('btn-save'))], S)
    const ve = () => {
      phai.replaceChildren(...[trangThai ? null : nutLuu, trangThai === 'loading' ? anh('loading', S) : null, trangThai === 'success' ? anh('success', S) : null,
        trangThai === 'error' ? anh('error', S) : null, nutHuy].filter(Boolean))
    }
    async function luu() {
      trangThai = 'loading'; ve()
      try {
        await window.require('AdsGraphAPI').get().adaccount(id).post({ name: ten })
        window.require('AdsAccountStore').getSelectedAccount().value.name = ten
        trangThai = 'success'
      } catch (e) { trangThai = 'error' }
      ve()
      await cho(1000)
      trangThai = false; ve()
    }
    ve()
    window.requireLazy(['AdsAccountStore', 'AdsGraphAPI'], (e) => {
      const a = e?.getSelectedAccount?.()?.value || {}
      if (a.account_id) { id = a.account_id; ten = a.name; o.value = a.name ?? '' }
    })
    const el = h('div', { class: 'rename-box' }, [h('label', { class: 'left' }, [anh('rename-pencil'), o], S), phai], [S, scCha])
    setTimeout(() => o.focus(), 0)
    return el
  }

  // ── Convert.vue (hook:350-431, scope bcb40624) ──
  function Convert(huy, scCha) {
    const S = 'data-v-bcb40624'
    const chon = h('select', null, [
      h('option', { value: 'default' }, [chu(() => t('option-default'))], S),
      h('option', { value: 'VND' }, 'VND', S), h('option', { value: 'USD' }, 'USD', S),
    ], S)
    chon.value = 'default'
    goi('doc').then((e) => { if (e && e.convert_currency) chon.value = e.convert_currency })
    // Đổi ⇒ lưu kho rồi TẢI LẠI TRANG (hook:369-377) để hàm định dạng tiền vá lại theo tiền mới.
    chon.addEventListener('change', async () => { await goi('ghi-tien', chon.value); window.location.reload() })
    const nutHuy = h('button', { onclick: () => huy() }, [chu(() => t('btn-cancel'))], S)
    // "?" bên chữ: SMIT trỏ adscheck.smit.vn (trang chủ web SMIT) ⇒ VAESA trỏ trang cài đặt Extended Payment.
    return h('div', { class: 'convert-box' }, [
      h('div', { class: 'left' }, [anh('convert_currency', S), h('a', { href: `${TRANG_VAESA}/smit/extended-payment`, target: '_blank' }, [chu(() => t('text-convert-currency') + ' '), anh('convert-info')], S)], S),
      h('div', { class: 'right' }, [chon, nutHuy], S),
    ], [S, scCha])
  }

  // ── LoadDefault.vue (hook:688-704, không phạm vi) ──
  const LoadDefault = (sc) => h('div', { class: 'loadingio-spinner-spin-ouv60kquwg' }, [h('div', { class: 'ldio-kei0fx234in' }, Array.from({ length: 9 }, () => h('div', null, [h('div')])))], sc)

  // ── ListCard.vue (hook:705-873, scope afc17aba) — xoá thẻ thanh toán thật (GraphQL 9195168280589012) ──
  function ListCard(onXoa, scCha) {
    const S = 'data-v-afc17aba'
    let ds = [], mo = false, xacNhan = false, dich = null
    const TT = { USABLE: 1, PENDING_ACTIVATION: 1, UNUSABLE: 1, UNVERIFIED_OR_PENDING_AUTH: 1, PENDING_VERIFICATION: 1, UNSUPPORTED_ON_NET_30: 1, ADS_PAYMENTS_RESTRICTED: 1, UNVERIFIABLE: 1,
      LPM_PENDING_VERIFICATION: 1, UNSUPPORTED_FOR_BILLING_SAFE_MODE: 1, INSUFFICIENT_FUNDS: 1, BILLING_SAFE_MODE_CRED_UNUSABLE_NULL_INTENT: 1, PAYMENT_METHOD_DECLINED: 1, TRUSTLY_DECLINED: 1 }
    const chuTT = (s) => (TT[s] ? t('status-' + s) : s)
    const huyXoa = () => { xacNhan = false; dich = null }
    const menu = h('div', { class: 'dropdown-menu', style: { display: 'none' } }, null, S)
    const dung = (f) => (e) => { e.stopPropagation(); f() }
    const ve = () => {
      menu.style.display = mo ? '' : 'none'
      if (xacNhan) {
        menu.replaceChildren(h('div', { class: 'confirm-view' }, [
          h('div', { class: 'confirm-header' }, [h('button', { class: 'back-btn', onclick: dung(() => { huyXoa(); ve() }) }, [anh('listcard-back')], S), h('span', { class: 'confirm-title' }, t('listcard-confirm-delete-title'), S), h('div', { style: { width: '24px' } }, null, S)], S),
          h('div', { class: 'confirm-content' }, [h('p', { class: 'dialog-question' }, [t('listcard-confirm-question') + ' ', h('br', null, null, S), h('span', { class: 'highlight' }, `${dich?.type} - ${dich?.display}`, S), ' ? '], S)], S),
          h('div', { class: 'confirm-actions' }, [
            h('button', { class: 'confirm-btn', onclick: dung(() => { onXoa(dich); xacNhan = false; ve() }) }, t('listcard-confirm-btn'), S),
            h('button', { class: 'cancel-btn', onclick: dung(() => { huyXoa(); ve() }) }, t('btn-cancel'), S),
          ], S),
        ], S))
        return
      }
      if (ds.length === 0) { menu.replaceChildren(h('div', { class: 'dropdown-item empty' }, [h('span', null, t('listcard-no-data'), S)], S)); return }
      menu.replaceChildren(...ds.map((c) => h('div', { class: 'dropdown-item' }, [
        h('div', null, [h('span', { class: 'item-name' }, `${c.type} - ${c.display}`, S), h('div', { class: 'item-status' }, chuTT(c.status), S), c.error ? h('div', { class: 'item-error' }, c.error, S) : null], S),
        c.loading ? LoadDefault(S) : h('button', { class: 'delete-btn', title: t('listcard-delete-card-title'), onclick: dung(() => { dich = c; xacNhan = true; ve() }) }, [anh('listcard-trash')], S),
      ], S)))
    }
    const el = h('div', { class: 'list-card-dropdown' }, [h('button', { class: 'delete-btn', onclick: () => { mo = !mo; if (mo && xacNhan) huyXoa(); ve() } }, [anh('listcard-trash')], S), menu], [S, scCha])
    // v-click-outside (hook:756-771): bấm ngoài ⇒ đóng (trừ khi đang hỏi xác nhận)
    const ngoai = (n) => { if (el !== n.target && !el.contains(n.target)) { if (!xacNhan) { mo = false; ve() } } }
    document.addEventListener('click', ngoai)
    ve()
    return { el, capNhat: (moi) => { ds = moi; ve() }, go: () => document.removeEventListener('click', ngoai) }
  }

  // ── Body.vue (hook:874-1500, scope bee31012) ──
  const MAC_DINH_HIEN = { account_aid: false, account_name: false, account_status: true, limited: true, limited2: false, threshold: true, amount_spend: true, balance: true, created_at: true,
    billing_at: true, admin_hidden: true, account_type: true, timezone: true, screen_shot_at: false, business: false, payment_card: true, role: true }
  const MAC_DINH_THU_TU = ['account_aid', 'account_name', 'account_status', 'limited', 'limited2', 'threshold', 'amount_spend', 'balance', 'created_at', 'billing_at', 'admin_hidden', 'account_type', 'timezone', 'screen_shot_at', 'business', 'payment_card', 'role']
  const DANG = { account_status: 'loading', limited: 'loading', limited2: 'loading', threshold: 'loading', amount_spend: 'loading', balance: 'loading', created_at: 'loading', billing_at: 'loading',
    admin_hidden: 'loading', account_type: 'loading', timezone: 'loading', screen_shot_at: 'loading', business: 'loading', payment_card: 'loading', role: 'loading', currency: 'loading',
    account_id: 'loading', account_aid: 'loading', account_name: 'loading' } // default_value
  const DONG = { // id → [icon, chữ tên]
    account_aid: ['account_id', 'text-account-id'], account_name: ['account_name', 'text-account-name'], account_status: ['account_status', 'text-account-status'],
    limited: ['limited', 'text-limited'], limited2: ['limited2', 'text-limited2'], threshold: ['threshold', 'text-threshold'], amount_spend: ['amount_spend', 'text-amount-spend'],
    balance: ['balance', 'text-balance'], created_at: ['created_at', 'text-created-at'], billing_at: ['billing_at', 'text-billing-at'], admin_hidden: ['admin_hidden', 'text-admin-hidden'],
    account_type: ['account_type', 'text-account-type'], timezone: ['timezone', 'text-timezone'], screen_shot_at: ['screen_shot_at', 'text-screen-shot-at'], business: ['business', 'text-business'],
    payment_card: ['payment_card', 'text-payment-card'], role: ['role', 'text-role'],
  }
  function dinhNgay(e, kieu) { // formatTime hook:1130-1149
    const n = new Date(e)
    const nam = new Intl.DateTimeFormat('en', { year: 'numeric' }).format(n), thang = new Intl.DateTimeFormat('en', { month: '2-digit' }).format(n),
      ngay = new Intl.DateTimeFormat('en', { day: '2-digit' }).format(n), gio = new Intl.DateTimeFormat('en', { hour: '2-digit', hour12: false }).format(n),
      phut = new Intl.DateTimeFormat('en', { minute: '2-digit' }).format(n)
    return kieu === 'DD-MM-YYYY' ? [ngay, thang, nam].join('-') : kieu === 'HH:mm DD-MM-YYYY' ? [gio, phut].join(':') + ' ' + [ngay, thang, nam].join('-') : undefined
  }
  function Body(scCha) {
    const S = 'data-v-bee31012'
    const value = Object.create(DANG)
    value.screen_shot_at = dinhNgay(new Date(), 'HH:mm DD-MM-YYYY')
    const settings = { ...MAC_DINH_HIEN, ...(cd.hien || {}) }
    const orders = cd.thuTu.length ? cd.thuTu : MAC_DINH_THU_TU
    let currency = null, list_card = []
    const goc = h('div', { class: 'insights-box' }, null, [S, scCha])
    let the = null
    const showOriginal = () => currency && currency !== 'default' && currency !== value.currency
    const xoay = () => anh('loading', S)
    const tienHai = (goc2, quyDoi, boQua) => { // ô tiền: viên "gốc" + viên "quy đổi"
      const coGoc = showOriginal() && !boQua
      return [h('div', { 'data-tooltip': t('original'), class: coGoc ? 'original top' : 'top' }, goc2, S), coGoc ? h('div', { 'data-tooltip': t('converted'), class: 'converted top' }, quyDoi, S) : null]
    }
    const loai = (e) => ({ business: t('label-business'), 'personal-detached': t('label-personal-normal'), 'personal-normal': t('label-personal-normal') }[e] || t('label-Unknown'))
    const quyen = (e) => ({ ADMIN: t('label-ADMIN'), GENERAL_USER: t('label-GENERAL_USER'), REPORTS_ONLY: t('label-REPORTS_ONLY') }[e] || t('label-Unknown'))
    const mauTT = (e, cur) => [cur, { 1: t('label-status-ACTIVE'), 2: t('label-status-DISABLED'), 3: t('label-status-UNSETTLED'), 7: t('label-status-PENDING_RISK_REVIEW'),
      8: t('label-status-PENDING_SETTLEMENT'), 9: t('label-status-IN_GRACE_PERIOD'), 100: 'PENDING CLOSURE', 101: 'CLOSED', 201: 'ANY ACTIVE', 202: 'ANY CLOSED' }[e]].join(' | ')
      .fontcolor({ 1: '#1ca64d', 2: '#FF2222', 3: '#FFC736', 7: '#FFC736', 8: '#FFC736', 9: '#1877F2', 100: '#7A7A7A', 101: '#7A7A7A', 201: '#7A7A7A', 202: '#7A7A7A' }[e]).bold()
    function giaTri(id) {
      const v = value[id]
      // Dòng "Quyền": giá trị lồng 2 lớp .value (hook:1495) — vòng xoay cũng nằm trong lớp trong.
      if (id === 'role') return [h('div', { class: 'value' }, v === 'loading' ? [xoay()] : [h('span', null, quyen(value.role), S)], S)]
      if (id !== 'screen_shot_at' && v === 'loading') return [xoay()]
      switch (id) {
        case 'account_aid': case 'account_name': case 'created_at': case 'billing_at': case 'timezone': case 'business': case 'screen_shot_at': return [String(v)]
        case 'account_status': { const s = h('span', null, null, S); s.innerHTML = mauTT(value.account_status, value.currency); return [s] }
        case 'limited': return tienHai(value.orinal_limited, value.limited, value.orinal_limited === 'NO LIMIT')
        case 'limited2': return tienHai(value.original_limited2, value.limited2)
        case 'threshold': return tienHai(value.original_threshold, value.threshold)
        case 'amount_spend': return tienHai(value.original_amount_spend, value.amount_spend)
        case 'balance': return tienHai(value.original_balance, value.balance)
        case 'admin_hidden': return [h('span', { class: value.admin_hidden > 0 ? 'red' : null }, String(value.admin_hidden), S)]
        case 'account_type': return [h('span', { class: 'account_type' }, loai(value.account_type), S)]
        case 'payment_card': {
          if (!the) the = ListCard(xoaThe, S)
          the.capNhat(list_card)
          return [h('div', { style: { display: 'flex', 'align-items': 'center' } }, [h('div', null, String(v), S), the.el], S)]
        }
        default: return []
      }
    }
    // Dòng theo thứ tự đã lưu; ẩn (v-show) khi trường không chọn.
    const ve = () => {
      goc.replaceChildren(...orders.map((id) => {
        const d = DONG[id]
        const dong = h('div', { class: 'item', style: settings[id] ? null : { display: 'none' } }, null, S)
        if (d) dong.append(h('div', { class: 'name' }, [anh(d[0], S), ' ' + t(d[1])], S), h('div', { class: 'value' }, giaTri(id), S))
        return dong
      }))
    }
    veLai.add(ve)
    // ── Lấy dữ liệu (methods hook:954-1129) — đều là công cụ sẵn trong trang Facebook ──
    const AdsGraphAPI = async (e) => {
      const id = value.account_id !== 'loading' ? value.account_id : await getAdAccountID()
      return window.require('AdsGraphAPI').get().adaccount(id).get(e)
    }
    const GraphQL = (e) => new Promise((xong) => {
      const uri = window.require('RelayAPIConfig').graphURI.toString()
      new (window.require('AsyncRequest'))().setURI(uri).setData(e).setOption('suppressEvaluation', 1).setFinallyHandler((r) => {
        try {
          const n = JSON.parse(r.payload.response)
          if (n?.errors?.[0] && !n?.data) return xong({ error: true, errCode: n.errors[0].code, message: n.errors[0].description || n.errors[0].message })
          xong(n)
        } catch (x) { xong(r.payload.response) }
      }).send()
    })
    const isUserID = (e) => e < 22e8 || (e >= 1e14 && e <= 0x5b0a58f100ef)
    const reMapValue = (e) => {
      if (!e.currency) return
      value.currency = e.currency; value.account_id = e.account_id; value.account_aid = e.account_id; value.account_name = e.name; value.account_status = e.account_status
      value.business = e.business?.name || '-'; value.created_at = e.created_time ? dinhNgay(e.created_time, 'DD-MM-YYYY') : '-'
      value.timezone = [(e.timezone_offset_hours_utc > 0 ? '+' : '') + e.timezone_offset_hours_utc, e.timezone_name].join(' | ')
    }
    const getAdAccountID = () => (location.href.includes('/billing_hub/') && location.href.includes('asset_id=') ? location.href.match(/asset_id=(\d+)/)[1]
      : location.href.includes('/billing_hub/') && location.href.includes('payment_account_id=') ? location.href.match(/payment_account_id=(\d+)/)[1]
        : window.require('BusinessUnifiedNavigationContext').adAccountID)
    const getBusinessID = () => { const e = location.href.match(/business_id=(\d+)/); return e ? e[1] : window.require('BusinessUnifiedNavigationContext').businessID }
    const formatMoney = (e, laNho = true, goc2) => {
      e = e - 0 || 0
      if (laNho === false && window.require('Currency').getOffset(value.currency) === 100) e *= 100
      // Giá trị gốc: gọi lớp dưới đúng như nhánh "giữ gốc" của lớp vá (2 tham số, hook:2084) — xem dinhDangDuoi.
      if (goc2 && dinhDangDuoi) return dinhDangDuoi(value.currency, e).replace('SMIT', '')
      return window.require('AdsCurrencyFormatter').formatCurrencyAtLeastOneSigFig(value.currency, e, goc2).replace('SMIT', '')
    }
    const chiSo = (s) => s.replace(/[^0-9.,]/g, '')
    async function loadInsightAdaccount() {
      const f = ['adtrust_dsl', 'adspaymentcycle{threshold_amount}', 'insights.date_preset(lifetime){spend}', 'balance', 'next_bill_date', 'owner', 'owner_business', `userpermissions.user(${window.require('CurrentUserInitialData').USER_ID}).as(user_roles)`]
      if (value.currency === 'loading') f.push('currency', 'account_id', 'name', 'account_status', 'business', 'created_time', 'timezone_offset_hours_utc', 'timezone_name')
      let r = null
      try { r = await AdsGraphAPI({ fields: f, locale: 'en_US' }) } catch (e) { r = null; logger('[fallback] AdsGraphAPI threw (no token?):', e?.message || e) }
      if (!r || !r.id) { logger('[fallback] AdsGraphAPI returned no id → switching to token-free fallback'); return loadInsightViaFallback() }
      logger('[fallback] AdsGraphAPI OK (has token) → using primary flow')
      reMapValue(r)
      value.orinal_limited = r.adtrust_dsl == '-1' ? 'NO LIMIT' : chiSo(formatMoney(r.adtrust_dsl, false, true)) + ' ' + value.currency // eslint-disable-line eqeqeq
      value.original_threshold = r.adspaymentcycle ? chiSo(formatMoney(r.adspaymentcycle?.data?.[0]?.threshold_amount, true, true)) + ' ' + value.currency : '-'
      value.original_amount_spend = chiSo(formatMoney(r.insights?.data?.[0]?.spend, false, true)) + ' ' + value.currency || '-'
      value.original_balance = chiSo(formatMoney(r.balance, true, true)) + ' ' + value.currency
      value.role = r.user_roles?.data?.[0]?.role || '-'
      value.balance = formatMoney(r.balance)
      value.limited = r.adtrust_dsl == '-1' ? 'NO LIMIT' : formatMoney(r.adtrust_dsl, false) // eslint-disable-line eqeqeq
      value.threshold = r.adspaymentcycle ? formatMoney(r.adspaymentcycle?.data?.[0]?.threshold_amount) : '-'
      value.billing_at = dinhNgay(r.next_bill_date, 'DD-MM-YYYY')
      value.amount_spend = formatMoney(r.insights?.data?.[0]?.spend, false)
      value.account_type = r.owner_business ? 'business' : isUserID(r.owner) ? 'personal-normal' : 'personal-detached'
      ve()
    }
    async function loadInsightViaFallback() {
      const id = value.account_id !== 'loading' ? value.account_id : await getAdAccountID()
      logger('[fallback] account_id resolved:', id)
      const r = await GraphQL({ variables: `{"assetID":"${id}"}`, doc_id: '6401661393282937', locale: 'en_US' })
      const n = (typeof r === 'string' ? JSON.parse(r.split('\n')[0]) : r)?.data?.billable_account_by_asset_id || {}
      logger('[fallback] GraphQL billing response (parsed):', n)
      if (!(n.formatted_dsl || n.account_balance)) logger('[fallback] WARN: billing GraphQL returned empty money fields')
      if (n.currency) value.currency = n.currency
      value.account_id = id; value.account_aid = id; value.account_name = n.name || '-'; value.account_status = statusToCode(n.account_status)
      value.account_type = n.owning_business?.id ? 'business' : 'personal-normal'
      value.limited = n.formatted_dsl ? formatMoney(n.formatted_dsl.replace(/[^0-9.]/g, ''), false) : '-'
      value.orinal_limited = n.formatted_dsl ? chiSo(n.formatted_dsl) + ' ' + value.currency : '-'
      if (n.formatted_dsl) { value.original_limited2 = chiSo(n.formatted_dsl) + ' ' + value.currency; value.limited2 = formatMoney(n.formatted_dsl.replace(/[^0-9.]/g, ''), false) }
      const a = n.billing_threshold_currency_amount?.amount_with_offset
      value.threshold = a != null ? formatMoney(a) : '-'
      value.original_threshold = a != null ? chiSo(formatMoney(a, true, true)) + ' ' + value.currency : '-'
      const o = n.account_balance?.amount_with_offset
      value.balance = o != null ? formatMoney(o) : '-'
      value.original_balance = o != null ? chiSo(formatMoney(o, true, true)) + ' ' + value.currency : '-'
      const i = n.spending_info?.amount_spent_currency_amount?.amount_with_offset
      value.amount_spend = i != null ? formatMoney(i) : '-'
      value.original_amount_spend = i != null ? chiSo(formatMoney(i, true, true)) + ' ' + value.currency : '-'
      value.billing_at = n.next_bill_date ? dinhNgay(1e3 * n.next_bill_date, 'DD-MM-YYYY') : '-'
      logger('[fallback] money fields mapped:', { currency: value.currency, limited: value.limited, threshold: value.threshold, balance: value.balance, amount_spend: value.amount_spend, billing_at: value.billing_at })
      ve()
      await loadInfoViaAccountStore(id)
    }
    async function loadInfoViaAccountStore(id) {
      const u = window.require('CurrentUserInitialData').USER_ID
      const r = await GraphQL({ variables: JSON.stringify({ adAccountID: 'act_' + id, __relay_internal__pv__AdAccountCheapFieldsrelayprovider: false,
        __relay_internal__pv__perseusL4IsPlacementSoftOptOutEnabledrelayprovider: false, __relay_internal__pv__AdAccountLazyBudgetAveragesrelayprovider: false }), doc_id: '26799256319742572', locale: 'en_US' })
      const a = (typeof r === 'string' ? JSON.parse(r) : r)?.data?.ad_account || {}
      logger('[fallback] account store response (parsed):', a)
      if (value.business === 'loading') value.business = a.end_advertiser_name || a.ads_business?.name || '-'
      const o = a.timezone_info?.timezone, i = a.timezone_offset_hours_utc
      if (o || i != null) { const e = i != null ? (i > 0 ? '+' : '') + i : ''; value.timezone = [e, o].filter(Boolean).join(' | ') || '-' }
      if (a.created_with_supported_timezone_offset) value.created_at = dinhNgay(a.created_with_supported_timezone_offset, 'DD-MM-YYYY')
      const s = a.user_permissions || []
      const q = s.find((e) => e.user?.id == u) || s[0] // eslint-disable-line eqeqeq
      if (q?.role) value.role = q.role
      for (const k of ['business', 'timezone', 'created_at', 'role']) if (value[k] === 'loading') value[k] = '-'
      logger('[fallback] account store fields mapped:', { business: value.business, timezone: value.timezone, created_at: value.created_at, role: value.role })
      ve()
    }
    const statusToCode = (e) => (typeof e === 'number' ? e : { ACTIVE: 1, DISABLED: 2, UNSETTLED: 3, PENDING_RISK_REVIEW: 7, PENDING_SETTLEMENT: 8, IN_GRACE_PERIOD: 9, PENDING_CLOSURE: 100, CLOSED: 101 }[e] || e)
    async function xoaThe(c) { // deletePaymentCard hook:1073-1089
      c.loading = true; the?.capNhat(list_card)
      const r = await GraphQL({ variables: JSON.stringify({ input: { payment_account_id: value.account_id, payment_method_id: c.credential_id } }), doc_id: '9195168280589012' })
      c.loading = false
      if (r.errors?.length > 0) { const n = r.errors[0]; c.error = n?.description || n?.summary || n?.message || 'Có lỗi xảy ra khi xóa thẻ thanh toán'; the?.capNhat(list_card) } else loadFundingResourceDetail()
    }
    async function loadFundingResourceDetail() {
      const id = value.account_id !== 'loading' ? value.account_id : await getAdAccountID()
      const ds = (await GraphQL({ variables: `{"paymentAccountID":"${id}"}`, doc_id: '5746473718752934' }))?.data?.billable_account_by_payment_account?.billing_payment_account?.billing_payment_methods || []
      let n = ds.findIndex((e) => e.is_primary)
      if (n === -1 && ds.length) n = 0
      if (n >= 0) { const e = ds[n]?.credential || {}; if (e.__typename === 'ExternalCreditCard') value.payment_card = [e.card_association_name, e.last_four_digits].join(' · ') }
      if (value.payment_card === 'loading') value.payment_card = '-'
      list_card = ds.filter((e) => e.credential.__typename === 'ExternalCreditCard').map((e) => ({ credential_id: e.credential.credential_id, display: e.credential.last_four_digits,
        type: e.credential?.card_association_name || e.credential?.card_association || '-', status: e?.usability || null, loading: false }))
      ve()
    }
    async function loadLimitDayNew() {
      const id = value.account_id !== 'loading' ? value.account_id : await getAdAccountID()
      const r = await GraphQL({ variables: `{"assetID":"${id}"}`, doc_id: '6401661393282937', locale: 'en_US' })
      const [n] = r.split('\n') // SMIT giữ nguyên: máy trả 1 dòng JSON (đã thành object) thì lệnh này lỗi và "Limit ẩn" quay mãi
      const a = JSON.parse(n)
      value.original_limited2 = a?.data?.billable_account_by_asset_id?.formatted_dsl.replace(/[^0-9.,]/g, '') + ' ' + value.currency || '-'
      value.limited2 = a?.data?.billable_account_by_asset_id?.formatted_dsl ? formatMoney(a.data.billable_account_by_asset_id.formatted_dsl.replace(/[^0-9.]/g, ''), false) : '-'
      ve()
    }
    async function countAdminHidden() {
      const id = value.account_id !== 'loading' ? value.account_id : await getAdAccountID()
      const b = await getBusinessID()
      let u = location.origin + '/ads/manager/account_settings/information/?pid=p1&page=account_settings&tab=account_information&act=' + id
      if (b) u += '&business_id=' + b
      const a = await window.fetch(u).then((e) => e.text())
      const [o] = a.match(/"bootstrapAccountAndTimezoneInfo",(.*),adColumnSizes/i) || ['']
      value.admin_hidden = (o.match(/name:null/g) || []).length
      ve()
    }
    // created (hook:942-953)
    ve()
    window.requireLazy(['AdsAccountDataLoader', 'AdsGraphAPI'], (e) => {
      logger('AdsAccountDataLoader', e.getBootstrapData()._value)
      const a = e.getBootstrapData()._value?.accountInfo || {}
      const n = e.getBootstrapData()._value?.accountUsers || []
      if (a.account_id) { reMapValue(a); value.admin_hidden = n.filter((x) => !x.name).length; ve() } else countAdminHidden()
      loadInsightAdaccount(); loadFundingResourceDetail(); loadLimitDayNew()
    })
    goi('doc').then((e) => { if (e && e.convert_currency) { currency = e.convert_currency; ve() } })
    return { el: goc, go: () => { veLai.delete(ve); the?.go() } }
  }

  // ── App.vue (hook:1619-1674, scope 072823dd) ──
  function App(laBubble) {
    const S = 'data-v-072823dd'
    const goc = h('div', { class: 'app' }, null, S)
    let viec = null // user_action
    // Header / Body / Footer sống suốt đời App; ô hành động, Convert, Rename dựng lại theo v-if.
    const dau = Header(laBubble, S), body = Body(S), chan = Footer(S)
    const hop = laBubble ? h('div', { class: 'box' }, [
      h('div', { class: 'box-item', onclick: () => { viec = 'convert_currency'; ve() } }, [anh('convert_currency', S), chu(() => ' ' + t('btn-convert-currency'))], S),
      h('div', { class: 'box-item', onclick: () => { viec = 'rename_adaccount'; ve() } }, [anh('rename_adaccount', S), chu(() => ' ' + t('btn-rename-adaccount'))], S),
    ], S) : null
    const huy = () => { viec = null; ve() }
    // Thẻ "SMIT Agency" (AgencyBanner hook:1549-1595) nằm giữa Body và Footer — quảng cáo SMIT ⇒ không chép.
    const ve = () => {
      goc.replaceChildren(...[dau, laBubble && !viec ? hop : null, viec === 'convert_currency' ? Convert(huy, S) : null,
        viec === 'rename_adaccount' ? Rename(huy, S) : null, body.el, chan].filter(Boolean))
    }
    ve()
    return { el: goc, go: () => body.go() }
  }

  // ── Bubble.vue (hook:1689-1781, scope 9fa10200) ──
  function Bubble(goc) {
    const S = 'data-v-9fa10200'
    let mo = false, lop = 'bottom-right', tenTk = null, app = null, khung = null
    const nut = h('div', { class: 'vaesa-bubble', id: 'vaesa-bubble-icon' }, [anh('logo_smit_white', S)], S)
    const vo = h('div', null, [nut], S)
    goc.appendChild(vo)
    const dong = () => { // Transition leave: bubble-animation bubble-out-<góc> rồi bỏ
      if (!khung) return
      const k = khung, a = app
      khung = null; app = null
      a?.go()
      k.className = `bubble-animation bubble-out-${lop}`
      const bo = () => k.remove()
      k.addEventListener('animationend', bo, { once: true })
      setTimeout(bo, 500)
    }
    async function toggleExtended(e) {
      mo = !mo
      if (!mo) { dong(); return }
      khung = h('div', { id: 'vaesa-bubble-open', class: `bubble-animation bubble-in-${lop}` }, null, S)
      vo.appendChild(khung)
      const k = khung
      k.addEventListener('animationend', () => { k.className = '' }, { once: true })
      await Promise.resolve()
      app = App(true) // openBubblePayment: mỗi lần mở là một App mới ⇒ tải lại dữ liệu, "Thời gian chụp" lấy giờ mở
      k.appendChild(app.el)
      const n = window.innerWidth / 2, a = window.innerHeight / 2, o = k.getBoundingClientRect(), i = e.clientY - o.height > 0
      if (e.clientY > a && e.clientX <= n) { logger('Người dùng mở từ góc dưới bên trái'); k.style.left = e.clientX + 'px'; k.style.right = 'auto'; k.style.top = i ? 'auto' : '5px'; k.style.bottom = i ? window.innerHeight - e.clientY + 'px' : 'auto' }
      else if (e.clientY > a && e.clientX > n) { logger('Người dùng mở từ góc dưới bên phải'); k.style.left = 'auto'; k.style.right = window.innerWidth - e.clientX + 'px'; k.style.top = i ? 'auto' : '5px'; k.style.bottom = i ? window.innerHeight - e.clientY + 'px' : 'auto' }
      else if (e.clientY <= a && e.clientX <= n) { logger('Người dùng mở từ góc trên bên trái'); k.style.left = e.clientX + 'px'; k.style.top = e.clientY + 'px'; k.style.right = 'auto'; k.style.bottom = 'auto' }
      else { logger('Người dùng mở từ góc trên bên phải'); k.style.right = window.innerWidth - e.clientX + 'px'; k.style.top = e.clientY + 'px'; k.style.left = 'auto'; k.style.bottom = 'auto' }
    }
    // mounted (hook:1698-1746)
    cho(100).then(async () => { nut.style.bottom = '36px'; nut.style.opacity = 1; await cho(350); nut.style.transition = 'none' })
    nut.onclick = toggleExtended
    nut.oncontextmenu = () => false
    nut.onmousedown = (e) => {
      e.preventDefault()
      const t2 = e.clientX - nut.getBoundingClientRect().left, n = e.clientY - nut.getBoundingClientRect().top
      document.onmousemove = (m) => {
        m.preventDefault(); nut.onclick = null; nut.style.cursor = 'move'; nut.style.opacity = 0.8
        const a = m.pageY - n, o = m.pageX - t2, i = window.innerWidth - o, s = window.innerHeight - a, r = nut.offsetWidth, d = nut.offsetHeight
        if (a <= 0 || o <= 0 || s - d <= 0 || i - r <= 0) {
          if ((a <= 0 || s <= 0) && o >= 0 && o < window.innerWidth - r) nut.style.left = o + 'px'
          if ((o <= 0 || i <= 0) && a >= 0 && a < window.innerHeight - d) nut.style.top = a + 'px'
          return
        }
        nut.style.top = a + 'px'; nut.style.left = o + 'px'
        const c = window.innerWidth / 2, l = window.innerHeight / 2
        lop = m.clientY > l && m.clientX <= c ? 'bottom-left' : m.clientY > l && m.clientX > c ? 'bottom-right' : m.clientY <= l && m.clientX <= c ? 'top-left' : 'top-right'
      }
      document.onmouseup = (m) => {
        m.preventDefault(); nut.style.cursor = 'pointer'; nut.style.opacity = 1; document.onmouseup = null; document.onmousemove = null
        cho(0).then(() => { nut.onclick = toggleExtended })
      }
    }
    window.addEventListener(SU_KIEN_AN, () => { if (mo) { mo = false; dong() } })
    window.requireLazy(['AdsAccountStore'], async (e) => {
      for (let i = 0; i < 100; i++) {
        const a = e?.getSelectedAccount?.()?.value || {}
        if (a.account_id) { tenTk = a.name; break }
        await cho(1e3)
      }
    })
    // Thẻ ẩn: tiêu đề "<tên TKQC> | SMIT.VN" (hook:1733-1736)
    let tieuDe = document.title
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && tenTk) { tieuDe = document.title; document.title = [tenTk, 'SMIT.VN'].join(' | ') } else document.title = tieuDe
    })
    document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && mo) window.dispatchEvent(new CustomEvent(SU_KIEN_AN, { detail: { data: true } })) })
  }

  // ── Chèn vào trang (hook:2024-2045) ──
  function chenThe() { // insertExtendedPayment: thẻ trong trang Thanh toán, thay chỗ thẻ "Trung tâm trợ giúp" của Facebook
    if (document.querySelector('#vaesa-extended-payment')) { logger('Extended payment already inserted'); return true }
    const a = document.querySelector('div[data-pagelet="BillingHubCard_help_center"]') || document.querySelector('span[data-surface$="help_center"]')?.parentElement
    if (!a) return false
    chenCss()
    const o = a.parentElement
    const i = document.createElement('div')
    i.setAttribute('id', 'vaesa-extended-payment')
    o.prepend(i)
    logger('Extended payment inserted')
    i.appendChild(App(false).el)
    ;(document.querySelector('div[data-pagelet="BillingHubCard_help_center"] div') || document.querySelector('span[data-surface$="help_center"] div'))?.remove()
    return true
  }
  function chenBubble() { // insertBubblePayment
    chenCss()
    const e = document.createElement('div')
    e.setAttribute('id', 'vaesa-bubble-payment')
    document.body.appendChild(e)
    logger('Bubble payment inserted')
    Bubble(e)
  }

  // ── Khởi động (hook:2176-2200) ──
  const TRANG_BUBBLE = [/^https:\/\/[^/]*\.facebook\.com\/adsmanager(\/|\?|#|$)/, /^https:\/\/[^/]*\.facebook\.com\/ads\/manager(\/|\?|#|$)/, /^https:\/\/[^/]*\.facebook\.com\/billing_hub(\/|\?|#|$)/, /^https:\/\/[^/]*\.facebook\.com\/adsreporting(\/|\?|#|$)/]
  let hen = 0
  const xet = () => {
    clearTimeout(hen)
    hen = setTimeout(() => {
      const u = location.href
      if ((u.includes('/ads/manager/account_settings/account_billing') || u.includes('/billing_hub/payment_settings') || u.includes('/billing_hub/accounts/details')) && !document.querySelector('#vaesa-extended-payment')) chenThe()
      if (cd.bat && !document.querySelector('#vaesa-bubble-payment') && TRANG_BUBBLE.some((r) => r.test(u))) chenBubble()
    }, 150)
  }
  const batDau = () => {
    if (typeof window.require !== 'function' || document.readyState !== 'complete') { requestAnimationFrame(batDau); return }
    if (window.__VAESA_EP_hooked) return
    window.__VAESA_EP_hooked = true
    const n = document.querySelector('body')
    if (!n) { window.__VAESA_EP_hooked = false; requestAnimationFrame(batDau); return }
    new ResizeObserver(xet).observe(n)
    new MutationObserver(xet).observe(n, { childList: true, subtree: true })
  }
  napCaiDat()
  batDau()
})()
