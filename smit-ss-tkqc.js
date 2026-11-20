// Super Share — công cụ tab TKQC (chép SMIT). Dùng hàm chung self.vaesaSmitNoi (smit.js), đăng ký lệnh vào self.vaesaSmitThem.
// Mỗi lệnh = MỘT lần gọi Facebook (trang VAESA tự lặp từng BM / UID + nghỉ 1–3 giây như runner SMIT 1128) ⇒ không vướng 5 phút service worker.
// Trả { ok:true, data } = nguyên phản hồi Graph (jbGoi: lỗi Graph ⇒ { error:true, message, code }); lỗi đầu vào ⇒ { ok:false, message }.
;(() => {
const N = self.vaesaSmitNoi
if (!N) return
const SO = /^\d{6,}$/
const so = (x) => String(x ?? '').trim().replace(/^act_/i, '')
const sai = (ten) => ({ ok: false, message: `${ten} không hợp lệ` })
const TASK_TK = new Set(['ADVERTISE', 'ANALYZE', 'DRAFT', 'MANAGE'])
const TASK_ID = new Set(['864195700451909', '151821535410699', '610690166001223', '186595505260379']) // J.Hx 8967:420
const dsHop = (a, hop) => Array.isArray(a) && a.length > 0 && a.every((x) => hop.has(String(x)))
const uid = async () => (await N.getAdsToken()).user_id || ''

const LENH = {
  // Share quyền đối tác — API0 td (v24.0) / API1 tm (v17.0 + acting_brand_id): POST /act_{id}/agencies (1128:6020-6062).
  'ss-tkqc-agencies-post': async ({ acc, business, tasks, brand } = {}) => {
    const a = so(acc), b = so(business)
    if (!SO.test(a)) return sai('ID TKQC')
    if (!SO.test(b)) return sai('ID BM')
    if (!dsHop(tasks, TASK_TK)) return sai('Quyền')
    if (brand !== undefined && !SO.test(so(brand))) return sai('BM sở hữu')
    const body = brand !== undefined ? { accountId: a, acting_brand_id: so(brand), business: b, permitted_tasks: JSON.stringify(tasks) } : { accountId: a, business: b, permitted_tasks: JSON.stringify(tasks) }
    return { ok: true, data: await N.jbGoi(`/act_${a}/agencies`, { method: 'POST', version: brand !== undefined ? 'v17.0' : 'v24.0', params: { __cppo: 1 }, body }) }
  },
  // ti (1128:5906-5934): BizKitSettingsBusinessAssetsListPaginationQuery — tìm assetID của TKQC trong BM sở hữu.
  'ss-tkqc-asset-id': async ({ bm, acc } = {}) => {
    const b = so(bm), a = so(acc)
    if (!SO.test(b) || !SO.test(a)) return sai('ID')
    const u = await uid()
    if (!u) return { ok: false, message: 'chưa đăng nhập Facebook', notLoggedIn: true }
    const r = await N.goiGraphql('business', { fb_api_req_friendly_name: 'BizKitSettingsBusinessAssetsListPaginationQuery', doc_id: '24978721081784202',
      variables: JSON.stringify({ assetTypes: ['AD_ACCOUNT'], businessID: b, count: 200, searchTerm: a, shouldCountAdmin: false, id: b }) }, { them: { av: u, __user: u } })
    return { ok: true, userId: u, data: r }
  },
  // ts (BizKitSettingsAddPartnerToAssetMutation) / to (useBulkAssignAssetsToPartnersMutation) — API2/API3 (1128:5935-5998).
  'ss-tkqc-partner-gql': async ({ kieu, bm, assetId, toBm, taskIds, userId } = {}) => {
    const b = so(bm), d = so(toBm), s = String(assetId ?? ''), u = String(userId ?? '')
    if (!SO.test(b) || !SO.test(d) || !/^\d+$/.test(s) || !/^\d+$/.test(u)) return sai('ID')
    if (!dsHop(taskIds, TASK_ID)) return sai('Quyền')
    const form = kieu === 'bulk'
      ? { fb_api_req_friendly_name: 'useBulkAssignAssetsToPartnersMutation', doc_id: '9952592081492346', variables: JSON.stringify({ businessID: b,
          surfaceParams: { flow_source: 'BIZ_WEB', entry_point: 'BIZWEB_SETTINGS_PARTNERS_TAB', tab: 'PARTNERS' }, toBusinessID: d,
          assetAssignments: [{ asset_ids: [s], asset_type: 'AD_ACCOUNT', permitted_task_ids: taskIds }] }) }
      : { fb_api_req_friendly_name: 'BizKitSettingsAddPartnerToAssetMutation', doc_id: '26181988954765546', variables: JSON.stringify({ businessID: b, assetID: s, toBusinessID: d,
          taskIDs: taskIds, surfaceParams: { entry_point: 'BIZWEB_SETTINGS_ASSETS_VIEW_DETAILS_HEADER', flow_source: 'BIZ_WEB', tab: 'AD_ACCOUNTS' }, shouldFetchPartnerName: false }) }
    return { ok: true, data: await N.goiGraphql('business', form, { them: N.relayBm({ av: u, __user: u }) }) }
  },
  // Xóa đối tác "Xóa tất cả" — h (18912:7462-7475): GET /act_{id}/agencies.
  'ss-tkqc-agencies-list': async ({ acc } = {}) => {
    const a = so(acc)
    if (!SO.test(a)) return sai('ID TKQC')
    return { ok: true, data: await N.jbGoi(`/act_${a}/agencies`, { version: 'v24.0', params: { fields: 'id,name,access_status,permitted_roles,permitted_tasks', limit: 500 } }) }
  },
  // w (18912:7476-7518): POST adsmanager /ads/manage/settings/remove_agency/ (fb_dtsg của phiên).
  'ss-tkqc-remove-agency': async ({ acc, agencyId } = {}) => {
    const a = so(acc), g = so(agencyId)
    if (!SO.test(a) || !SO.test(g)) return sai('ID')
    const t = await N.getAdsToken()
    if (!t.fb_dtsg) return { ok: false, missingSession: true, message: 'missing_fb_dtsg: Chưa lấy được phiên Facebook (fb_dtsg) để gửi yêu cầu' }
    const q = new URLSearchParams({ agency_id: g, act: a, _flowletID: '2720' })
    let text
    try {
      const res = await fetch(`https://adsmanager.facebook.com/ads/manage/settings/remove_agency/?${q.toString()}`, { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ __a: '1', fb_dtsg: t.fb_dtsg }).toString() })
      text = await res.text()
    } catch (e) { return { ok: true, data: { error: true, message: e instanceof Error ? e.message : String(e) } } }
    return { ok: true, text }
  },
  // Thêm admin — A (1128:3855-3874): POST /act_{id}/users role=1001|1002|1003.
  'ss-tkqc-users-post': async ({ acc, uid: u, role } = {}) => {
    const a = so(acc), x = String(u ?? '').trim()
    if (!SO.test(a) || !SO.test(x)) return sai('ID')
    if (![1001, 1002, 1003].includes(Number(role))) return sai('Vai trò')
    return { ok: true, data: await N.jbGoi(`/act_${a}/users`, { method: 'POST', params: { role: Number(role), uid: x } }) }
  },
  // Chỉ định quyền — y (96758:234-252): POST /act_{id}/assigned_users user + tasks.
  'ss-tkqc-assigned-users': async ({ acc, user, tasks } = {}) => {
    const a = so(acc), x = String(user ?? '').trim()
    if (!SO.test(a) || !SO.test(x)) return sai('ID')
    if (!dsHop(tasks, new Set(['MANAGE', 'ADVERTISE', 'ANALYZE']))) return sai('Quyền')
    return { ok: true, data: await N.jbGoi(`/act_${a}/assigned_users`, { method: 'POST', body: { user: x, tasks: JSON.stringify(tasks) } }) }
  },
  // Thêm dòng 2 BM — y (1128:3663-3687): POST /{bm}/client_ad_accounts AGENCY.
  'ss-tkqc-client-ad-accounts': async ({ acc, bm } = {}) => {
    const a = so(acc), b = so(bm)
    if (!SO.test(a) || !SO.test(b)) return sai('ID')
    return { ok: true, data: await N.jbGoi(`/${b}/client_ad_accounts`, { method: 'POST', params: { __cppo: 1 }, body: { _reqName: 'object:brand/client_ad_accounts', _reqSrc: 'AdAccountActions.brands',
      access_type: 'AGENCY', adaccount_id: `act_${a}`, method: 'post', 'permitted_tasks[0]': 'ADVERTISE', 'permitted_tasks[1]': 'ANALYZE', 'permitted_tasks[2]': 'DRAFT', 'permitted_tasks[3]': 'MANAGE', pretty: 0, suppress_http_code: 1 } }) }
  },
  // Bảng chọn người dùng BM — o (86425:470-510): GET /{bm}/business_users (một trang; trang tiếp theo qua next).
  'ss-tkqc-bm-users': async ({ bm, next } = {}) => {
    if (next) {
      if (!/^https:\/\/graph\.facebook\.com\//.test(String(next))) return sai('Trang tiếp')
      return { ok: true, data: await N.jbGoi(String(next)) }
    }
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    return { ok: true, data: await N.jbGoi(`/${b}/business_users`, { version: 'v24.0', params: { fields: 'id,name,email,role', limit: 300 } }) }
  },
  // Tên BM — p (86425:540-560): GET /?ids=…&fields=id,name.
  'ss-tkqc-ten-bm': async ({ ids } = {}) => {
    const ds = [...new Set((Array.isArray(ids) ? ids : []).map(so).filter((x) => SO.test(x)))].slice(0, 50)
    if (!ds.length) return { ok: true, data: {} }
    return { ok: true, data: await N.jbGoi('/', { version: 'v24.0', params: { ids: ds.join(','), fields: 'id,name' } }) }
  },
}
self.vaesaSmitThem = Object.assign(self.vaesaSmitThem || {}, LENH)
})()
