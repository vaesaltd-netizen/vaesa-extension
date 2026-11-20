// Share Pixel — công cụ tab Pixel (chép SMIT 1128 module 55639 + 67575 + 91021 + 24184, 6747 module 92809).
// Mỗi lệnh = MỘT lần gọi Facebook; trang VAESA (smitPixelCongCu.js) lặp đích + nghỉ 1–3 giây như runner SMIT.
// Trả { ok:true, data } (Graph: nguyên phản hồi jbGoi; business.facebook.com: JSON dòng đầu sau "for (;;);" như 92809 i()) / { ok:false, message }.
;(() => {
const N = self.vaesaSmitNoi
if (!N) return
const SO = /^\d+$/
const sai = (ten) => ({ ok: false, message: `${ten} không hợp lệ` })
const CANH = new Set(['assigned_users', 'assigned_partners', 'permissible_ad_accounts'])
// 55639: các truy vấn GraphQL business mà Share Pixel dùng (chỉ cho phép đúng các doc này).
const DOC = {
  BusinessCometBizSuiteSettingsEventsDatasetRootQuery: '28438439372483298',
  BizKitSettingsAssetStatusBannerQuery: '27883096114632444',
  BizKitAssignUserToAssetModalMutation: '26693060423704893',
  BizKitSettingsAddPartnerToAssetByBusinessIDModalValidationQuery: '9794646500614064',
  BizKitSettingsAddPartnerToAssetMutation: '26759344107065092',
}
function docDong(t) { // 92809 i(): bỏ "for (;;);", lấy dòng đầu, JSON.parse; hỏng ⇒ null
  const s = t.startsWith('for (;;);') ? t.slice(9) : t
  const a = s.includes('\n') ? (s.split('\n')[0] ?? '').trim() : s
  try { return JSON.parse(a) } catch { return null }
}
async function guiForm(url, form) { // 92809 Cl
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') })
  return docDong(await res.text())
}

const LENH = {
  // Phiên: fb_dtsg + user_id (4644 gf) — trang kiểm trước như k() / l() của SMIT.
  'ss-pixel-phien': async () => {
    const t = await N.getAdsToken()
    return { ok: true, fbDtsg: !!t.fb_dtsg, userId: t.user_id || '' }
  },
  // o() 55639: GET /act_{id}?fields=agencies{id},business (+ trang tiếp agencies, tối đa 50).
  'ss-pixel-act-agencies': async ({ acc } = {}) => {
    const a = String(acc ?? '').trim().replace(/^act_/, '')
    if (!SO.test(a)) return sai('ID TKQC')
    const n = await N.jbGoi(`/act_${a}`, { version: 'v24.0', params: { fields: 'agencies{id},business' } })
    if (n?.error) return { ok: true, data: n }
    const ds = []
    for (const e of n.agencies?.data ?? []) if (e.id) ds.push(e.id)
    let s = n.agencies?.paging?.next
    for (let i = 0; i < 50 && s; i += 1) {
      const e = await N.jbGoi(s)
      if (e?.error) break
      for (const t of e.data ?? []) if (t.id) ds.push(t.id)
      s = e.paging?.next
    }
    return { ok: true, data: { agencyIds: ds, ownerBm: n.business?.id } }
  },
  // i() 24184: một trang /{pixel}?fields={canh}.limit(n).business(bm)[.after(c)]{account_id,name,id}.
  'ss-pixel-canh': async ({ pixelId, canh, business, limit = 100, after = '' } = {}) => {
    const p = String(pixelId ?? ''), b = String(business ?? '')
    if (!SO.test(p) || !SO.test(b)) return sai('ID')
    if (!CANH.has(canh)) return sai('Trường')
    const l = Math.min(500, Math.max(1, Number(limit) || 100))
    const c = String(after ?? '')
    const duoi = c ? `.limit(${l}).business(${b}).after(${c})` : `.limit(${l}).business(${b})`
    return { ok: true, data: await N.jbGoi(`/${p}`, { version: 'v24.0', params: { fields: `${canh}${duoi}{account_id,name,id}` } }) }
  },
  // l() 55639: POST /{pixel}/shared_accounts { business, account_id }.
  'ss-pixel-shared-accounts': async ({ pixelId, business, accountId } = {}) => {
    const p = String(pixelId ?? ''), b = String(business ?? ''), a = String(accountId ?? '').replace(/^act_/, '')
    if (!SO.test(p) || !SO.test(b) || !SO.test(a)) return sai('ID')
    return { ok: true, data: await N.jbGoi(`/${p}/shared_accounts`, { method: 'POST', version: 'v24.0', body: { business: b, account_id: a } }) }
  },
  // _() / p() 55639: POST business.facebook.com/api/graphql/ (av, __user, __a, fb_dtsg, jazoest, RelayModern, server_timestamps).
  'ss-pixel-gql': async ({ friendly, variables } = {}) => {
    const doc = DOC[friendly]
    if (!doc) return sai('Truy vấn')
    if (!variables || typeof variables !== 'object') return sai('Biến')
    const t = await N.getAdsToken()
    if (!t.fb_dtsg) return { ok: false, missingFbDtsg: true, message: 'Thiếu fb_dtsg — không thể thực hiện' }
    const u = t.user_id || ''
    return { ok: true, data: await guiForm('https://business.facebook.com/api/graphql/', { av: u, __user: u, __a: 1, fb_dtsg: t.fb_dtsg, jazoest: N.jazoest(t.fb_dtsg),
      fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: friendly, doc_id: doc, server_timestamps: true, variables: JSON.stringify(variables) }) }
  },
  // o() 67575: POST business.facebook.com/business/objects/remove/connections/ (gỡ người / đối tác / TKQC khỏi pixel).
  'ss-pixel-remove': async ({ bm, pixelId, isNew, targetId, toAssetType } = {}) => {
    const b = String(bm ?? ''), p = String(pixelId ?? ''), d = String(targetId ?? '').replace(/^act_/, '')
    if (!SO.test(b) || !SO.test(p) || !SO.test(d)) return sai('ID')
    if (!['user', 'brand', 'ad-account'].includes(toAssetType)) return sai('Loại đích')
    const t = await N.getAdsToken()
    if (!t.fb_dtsg) return { ok: false, missingFbDtsg: true, message: 'Thiếu fb_dtsg — không thể gỡ liên kết' }
    const r = isNew ? 'events-dataset-new' : 'pixel'
    const url = `https://business.facebook.com/business/objects/remove/connections/?business_id=${encodeURIComponent(b)}&from_id=${encodeURIComponent(p)}&from_asset_type=${encodeURIComponent(r)}&to_id=${encodeURIComponent(d)}&to_asset_type=${encodeURIComponent(toAssetType)}&fb_dtsg=${encodeURIComponent(t.fb_dtsg)}&__a=1`
    return { ok: true, data: await guiForm(url, { fb_dtsg: t.fb_dtsg }) }
  },
  // K1 (86425) — tên BM còn thiếu cho bảng chọn người của Pixel (vz 6193:17669).
  'ss-pixel-ten-bm': async ({ ids } = {}) => {
    const ds = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^\d{6,}$/.test(x)))].slice(0, 50)
    if (!ds.length) return { ok: true, data: {} }
    return { ok: true, data: await N.jbGoi('/', { version: 'v24.0', params: { ids: ds.join(','), fields: 'id,name' } }) }
  },
}
self.vaesaSmitThem = Object.assign(self.vaesaSmitThem || {}, LENH)
})()
