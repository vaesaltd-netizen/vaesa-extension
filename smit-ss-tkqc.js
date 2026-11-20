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
  // ── Xoá QTV ẩn / Xoá QTV / Xoá quyền người dùng BM (1128 module 19033 + 4800-5320) ─────────────────────────────────────────
  // Tài khoản Facebook đang đăng nhập (eD → 1859 em().user_id).
  'ss-tkqc-phien': async () => ({ ok: true, userId: (await N.getAdsToken()).user_id || '' }),
  // 19033 d() / m(): GET /act_{id} (d có danh sách users; m chỉ owner + userpermissions).
  'ss-tkqc-act-nguoi': async ({ acc, coUsers = true } = {}) => {
    const a = so(acc)
    if (!SO.test(a)) return sai('ID TKQC')
    const fields = coUsers ? 'account_id,owner,owner_business{id},users.limit(5000){id,name,is_active,permissions,role,tasks,roles},userpermissions.limit(500){user{id},business{id}}'
      : 'account_id,owner,owner_business{id},userpermissions.limit(500){user{id},business{id}}'
    return { ok: true, data: await N.jbGoi(`/act_${a}`, { params: { fields } }) }
  },
  // 19033 g()/p()/f(): đọc trang cài đặt TKQC của Ads Manager (đi theo window.location.replace), dò admin ẩn trong HTML.
  'ss-tkqc-qtv-an': async ({ acc } = {}) => {
    const a = so(acc)
    if (!SO.test(a)) return sai('ID TKQC')
    const lay = async (u) => (await fetch(u, { credentials: 'include' })).text()
    const goc = `https://adsmanager.facebook.com/ads/manager/account_settings/information/?act=${a}`
    let t = await lay(goc)
    const da = new Set([goc])
    for (;;) {
      const e = t.match(/window\.location\.replace\("(.*?)"\)/)?.[1]?.replace(/\\/g, '') ?? null
      if (!e?.startsWith('https') || da.has(e)) break
      da.add(e); t = await lay(e)
    }
    const ids = new Set()
    for (const m of t.matchAll(/\b(\d+)\,(name:null)\b/g)) if (m[1] && /^\d{6,}$/.test(m[1])) ids.add(m[1])
    for (const m of t.matchAll(/"id"\s*:\s*"(\d+)"\s*,\s*"name"\s*:\s*null/g)) if (m[1] && /^\d{6,}$/.test(m[1])) ids.add(m[1])
    return { ok: true, hiddenUserIds: [...ids], anonymousCount: [...t.matchAll(/"user"\s*:\s*null\s*,\s*"role"\s*:\s*"[A-Z_]+"/g)].length, detectMethod: 'html' }
  },
  // 19033 h(): DELETE /act_{id}/users/{uid}; hỏng mà có BM ⇒ DELETE /act_{id}/userpermissions (user, business).
  'ss-tkqc-xoa-qtv': async ({ acc, uid, bm } = {}) => {
    const a = so(acc), u = String(uid ?? '').trim(), b = bm ? so(bm) : ''
    if (!SO.test(a) || !SO.test(u) || (b && !SO.test(b))) return sai('ID')
    const ok = (e) => { if (typeof e === 'boolean') return e; if (typeof e !== 'object' || e === null) return false; const t = Array.isArray(e.errors) ? e.errors : null; return e.success !== false && !e.error && (!t || !(t.length > 0)) && !e.message && e.success === true } // w
    const ly = (e) => (e?.error ? e.message : typeof e !== 'object' || e === null ? null : String(e.message || e.error?.message || e.errors?.[0]?.message || '') || null) // y
    const r = await N.jbGoi(`/act_${a}/users/${u}`, { params: { method: 'DELETE' } })
    const thu = [{ method: 'users_delete', ok: !r?.error && ok(r), reason: ly(r) ?? undefined }]
    if (thu[0].ok) return { ok: true, data: { ok: true, message: 'OK', methodUsed: 'users_delete', attempts: thu } }
    const o = ly(r) || 'Xóa quyền qua /users thất bại'
    if (!b) return { ok: true, data: { ok: false, message: o, methodUsed: null, attempts: thu } }
    const p = await N.jbGoi(`/act_${a}/userpermissions`, { params: { user: u, method: 'DELETE', business: b } })
    thu.push({ method: 'userpermissions_delete', ok: !p?.error && ok(p), reason: ly(p) ?? undefined })
    if (thu[1].ok) return { ok: true, data: { ok: true, message: 'OK', methodUsed: 'userpermissions_delete', attempts: thu } }
    return { ok: true, data: { ok: false, message: (ly(p) || 'Xóa quyền qua /userpermissions thất bại') || o, methodUsed: null, attempts: thu } }
  },
  // eB/eO (1128:4840-4960): tìm BM cấp quyền cho từng UID — batch /{bm}?fields=business_users.limit(500) (50 BM/lượt, đọc tiếp trang).
  'ss-tkqc-bm-cua-uid': async ({ bms, uids } = {}) => {
    const dsBm = [...new Set((Array.isArray(bms) ? bms : []).map(so).filter((x) => SO.test(x)))]
    const can = new Set((Array.isArray(uids) ? uids : []).map(String).filter((x) => SO.test(x)))
    const khop = Object.fromEntries([...can].map((u) => [u, []]))
    let loi
    const doc = async (trang, bm) => { // eM
      const lay = (ds) => { for (const t of ds) if (t.id && can.has(t.id)) { khop[t.id].push(bm); can.delete(t.id) } }
      lay(trang.data ?? [])
      let a = trang.paging?.next
      const da = new Set()
      for (let i = 0; a && can.size; i += 1) {
        if (i >= 50) return 'lookup_page_limit: Facebook trả quá nhiều trang'
        if (da.has(a)) return 'lookup_cursor_loop: Facebook trả cursor phân trang lặp'
        da.add(a)
        const n = await N.jbGoi(a)
        if (n?.error) return n.message
        if (!Array.isArray(n.data)) return 'lookup_invalid_page: Phản hồi phân trang không hợp lệ'
        lay(n.data); a = n.paging?.next
      }
      return null
    }
    for (let k = 0; k < dsBm.length && can.size; k += 50) {
      const nhom = dsBm.slice(k, k + 50)
      const i = await N.jbGoi('/', { method: 'POST', version: 'v24.0', body: { include_headers: false, batch: JSON.stringify(nhom.map((e) => ({ id: e, relative_url: `/${e}?fields=id,business_users.limit(500){id,name}`, method: 'GET' }))) } })
      if (i?.error) { loi ??= i.message; continue }
      if (!Array.isArray(i) || i.length !== nhom.length) { loi ??= 'batch_invalid: Phản hồi batch lookup không đầy đủ'; continue }
      for (const [e, s] of nhom.entries()) {
        if (!can.size) break
        const o = i[e]
        if (!o || (o.code ?? 500) >= 400 || typeof o.body !== 'string') { loi ??= `bm_lookup_failed: Không tải được business users của BM ${s}`; continue }
        let t
        try { t = JSON.parse(o.body) } catch { loi ??= `bm_lookup_invalid: Phản hồi BM ${s} không hợp lệ`; continue }
        if (t.error || !t.business_users) { loi ??= t.error?.message || `bm_lookup_failed: Không tải được business users của BM ${s}`; continue }
        const l = Array.isArray(t.business_users.data) ? await doc(t.business_users, s) : 'business_users_invalid: Phản hồi business users không hợp lệ' // eP
        if (l) loi ??= `${s}: ${l}`
      }
    }
    return { ok: true, matches: khop, ...(loi ? { error: loi } : {}) }
  },
  // e$ (1128:5065-5076): POST /act_{id}/userpermissions method=delete (gỡ quyền của người qua BM đã cấp).
  'ss-tkqc-go-quyen-bm': async ({ acc, bm, user } = {}) => {
    const a = so(acc), b = so(bm), u = String(user ?? '').trim()
    if (!SO.test(a) || !SO.test(b) || !SO.test(u)) return sai('ID')
    return { ok: true, data: await N.jbGoi(`/act_${a}/userpermissions`, { method: 'POST', version: 'v24.0', body: { accountId: a, business: b, method: 'delete', user: u } }) }
  },
  // ── Kháng nghị (1128:4018-4300) ─────────────────────────────────────────────────────────────────────────────────────────────
  // M(): kháng TKQC bị vô hiệu / 273 — GraphQL business doc 7045373122221158, actor = owner của TKQC.
  'ss-tkqc-khang': async ({ owner, acc, issue, comment } = {}) => {
    const o = String(owner ?? '').trim(), a = so(acc), i = String(issue ?? '')
    if (!/^\d+$/.test(o) || !SO.test(a) || !/^\d+$/.test(i) || typeof comment !== 'string' || !comment.trim()) return sai('Tham số')
    return { ok: true, data: await N.goiGraphql('business', { doc_id: '7045373122221158', variables: JSON.stringify({ input: { client_mutation_id: '1', actor_id: o, ad_account_id: a, ids_issue_ent_id: i, appeal_comment: comment, callsite: 'ACCOUNT_QUALITY' } }) }) }
  },
  // W(): POST business.facebook.com/business_share/genlink/ (asset_id, task_ids = J.Hx) ⇒ tokenlink.
  'ss-tkqc-genlink': async ({ acc } = {}) => {
    const a = so(acc)
    if (!SO.test(a)) return sai('ID TKQC')
    const t = await N.getAdsToken()
    const p = new URLSearchParams({ asset_id: a, __user: t.user_id || '', __a: '1', fb_dtsg: t.fb_dtsg || '', jazoest: N.jazoest(t.fb_dtsg || ''), lsd: t.lsd || '' })
    ;['864195700451909', '151821535410699', '610690166001223', '186595505260379'].forEach((e, n) => p.set(`task_ids[${n}]`, e))
    const res = await fetch('https://business.facebook.com/business_share/genlink/?_callFlowletID=0&_triggerFlowletID=7839', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: p.toString() })
    return { ok: true, text: await res.text() }
  },
}
self.vaesaSmitThem = Object.assign(self.vaesaSmitThem || {}, LENH)
})()
