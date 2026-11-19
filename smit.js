// VAESA Extension — màn Smit: lấy danh sách Tài khoản quảng cáo Facebook bằng phiên FB của chính NV.
// Nạp vào background.js bằng importScripts. Chuyển nguyên từ VAESA Helper (extension-vaesa/scripts/fbAdAccounts.js).
// Không lưu token/cookie lên máy chủ — chỉ trả danh sách TKQC về trang VAESA.
(() => {
const ADSMANAGER_URL = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns'
const GRAPH = 'https://graph.facebook.com/v24.0'

// Nhóm trường — chép đúng SMIT 1927.de94d1f1.js (i/o/s/l/d/f).
const F_BASE = ['account_id', 'name', 'account_status', 'owner_business', 'agencies{id,name,permitted_tasks}']
const F_INFO = ['created_time', 'timezone_name', 'timezone_offset_hours_utc', 'disable_reason', 'business_country_code', 'business_state', 'business_zip', 'owner', 'currency']
const F_FINANCE = ['next_bill_date', 'balance', 'adtrust_dsl', 'spend_cap', 'amount_spent', 'adspaymentcycle{threshold_amount}']
const CAMP_STATUSES = ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ARCHIVED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES']
// SMIT 1927.de94d1f1.js: chỉ đếm tổng qua summary, không kéo từng chiến dịch.
const F_CAMP = [
  `campaigns.effective_status(${JSON.stringify(CAMP_STATUSES)}).limit(0).summary(total_count).as(campaigns_total)`,
  'campaigns.effective_status(["ACTIVE"]).limit(0).summary(total_count).as(campaigns_active)',
]
const PAGE_LIMIT = '50' // SMIT pageLimit mặc định 50
const F_USERS = 'users.limit(5000){id,is_active,name,permissions,role,roles,tasks}'
const F_PAYMENT = ['funding_source_details{display_string}', 'is_prepay_account', 'total_prepay_balance', 'all_payment_methods{pm_credit_card{credential_id,display_string},payment_method_direct_debits{display_string},payment_method_paypal{email_address},payment_method_tokens{type}}']

// Tiền tệ không có phần lẻ (offset = 1) — số từ Graph là đơn vị gốc, không chia 100.
const ZERO_DECIMAL = new Set(['VND', 'JPY', 'KRW', 'IDR', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'PYG', 'TWD', 'UGX'])

let tokenCache = null // { access_token, fb_dtsg, lsd, user_id, user_name, ts }
const TOKEN_TTL = 5 * 60 * 1000

function isReauthUrl(u) {
  return u.includes('/sensitive_action/reauth/') || u.includes('/security/twofac/intro/') || u.includes('/checkpoint/')
}

// Đọc token từ HTML trang adsmanager — chép pattern SMIT (p() dòng 2077 + u.ZM).
function parseAdsTokens(html) {
  const t = {}
  t.access_token = html.match(/__accessToken\s*=\s*"([^"]+)"/)?.[1] || null
  let m = html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/)
  if (m) t.fb_dtsg = m[1]
  m = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)
  if (m) t.lsd = m[1]
  m = html.match(/"USER_ID":"(\d+)"/)
  if (m) t.user_id = m[1]
  m = html.match(/"NAME":"([^"]*)"/)
  if (m) t.user_name = m[1]
  return t
}

async function getAdsToken(force = false) {
  const now = Date.now()
  if (!force && tokenCache && now - tokenCache.ts < TOKEN_TTL && tokenCache.access_token) return tokenCache
  const res = await fetch(ADSMANAGER_URL, { credentials: 'include' })
  if (isReauthUrl(res.url)) throw new Error('need_verify_fb')
  if (res.url.includes('/login')) throw new Error('Chưa đăng nhập Facebook')
  const html = await res.text()
  const t = parseAdsTokens(html)
  if (!t.access_token) {
    if (/__accessToken/.test(html) === false && /IS_BUSINESS_PERSON_ACCOUNT/.test(html) === false) {
      throw new Error('Chưa đăng nhập Facebook (không đọc được mã truy cập)')
    }
    throw new Error('Không đọc được mã truy cập quảng cáo — thử mở adsmanager.facebook.com rồi làm lại')
  }
  t.ts = now
  tokenCache = t
  return t
}

// Gọi Graph REST, tự phân trang theo paging.next.
async function graphGet(path, params, accessToken) {
  const out = []
  let url = `${GRAPH}/${path || ''}?${new URLSearchParams({ ...params, access_token: accessToken }).toString()}`
  for (let guard = 0; guard < 50 && url; guard++) {
    // Mã EAAB lấy từ adsmanager gắn với phiên đăng nhập → PHẢI kèm cookie, bỏ cookie FB trả "Invalid request" (đo 19/11).
    const res = await fetch(url, { credentials: 'include' })
    const json = await res.json()
    if (json.error) {
      const e = json.error
      if (e.code === 190) throw new Error('Mã truy cập hết hạn') // invalid token → caller sẽ lấy lại
      throw new Error(`FB error ${e.code}: ${e.message} [${path}${e.error_subcode ? ' sub ' + e.error_subcode : ''}]`)
    }
    if (Array.isArray(json.data)) out.push(...json.data)
    else return json
    url = json.paging?.next || null
  }
  return { data: out }
}

// Ghép fields cho 1 lượt lấy TKQC.
function buildFields({ payment = true } = {}) {
  const set = new Set([...F_BASE, ...F_INFO, ...F_FINANCE, ...F_CAMP, F_USERS])
  if (payment) for (const f of F_PAYMENT) set.add(f)
  return [...set].join(',')
}

// Đếm chiến dịch từ summary (SMIT: campaigns_total / campaigns_active).
function demChienDich(acc) {
  return {
    tong: acc?.campaigns_total?.summary?.total_count ?? null,
    dangChay: acc?.campaigns_active?.summary?.total_count ?? null,
  }
}

// Vai trò 1 người dùng trong TKQC — chép SMIT 1927.de94d1f1.js hàm p().
function vaiTro(u) {
  const t = new Set([...(u.user_tasks || []), ...(u.tasks || []), ...(u.permissions || []), ...(u.roles || [])]
    .map((x) => String(x).toUpperCase()).concat(String(u.role ?? '').toUpperCase()).filter(Boolean))
  if (t.has('MANAGE') || t.has('ADMIN') || t.has('1001') || t.has('281423141961500')) return 'admin'
  if (t.has('ADVERTISE') || t.has('ADVERTISER') || t.has('1002')) return 'advertiser'
  if (t.has('ANALYZE') || t.has('ANALYST') || t.has('1003')) return 'analyst'
  return 'other'
}

// Danh sách thẻ/phương thức thanh toán — chép SMIT hàm card_data (thẻ trùng funding_source lên đầu).
function theThanhToan(acc) {
  const m = acc.all_payment_methods || {}
  const ds = [
    ...(m.payment_method_direct_debits?.data || []).map((e) => ({ display: e.display_string?.match(/\d+/)?.[0] || 'Unknown', type: 'directdebit', credential_id: 'Unknown' })),
    ...(m.pm_credit_card?.data || []).map((e) => {
      const t = e.display_string || ''
      return { display: t.match(/\d+/)?.[0] || 'Unknown', type: t.toLowerCase().match(/[^\d\W]+/)?.[0], credential_id: e.credential_id || 'Unknown' }
    }),
    ...(m.payment_method_paypal?.data || []).map((e) => ({ display: e.email_address || 'Unknown', type: 'paypal', credential_id: 'Unknown' })),
    ...(m.payment_method_tokens?.data || []).map((e) => ({ display: e.type === undefined ? 'Unknown' : String(e.type), type: 'methodtoken', credential_id: 'Unknown' })),
  ].filter((e, i, arr) => arr.findIndex((x) => x.type === e.type && x.display === e.display && x.credential_id === e.credential_id) === i)
  if (!ds.length) return undefined
  const dau = acc.funding_source_details?.display_string?.match(/\d+/)?.[0]
  const i = dau ? ds.findIndex((e) => e.display === dau) : -1
  if (i <= 0) return ds
  const [x] = ds.splice(i, 1)
  return [x, ...ds]
}

// Map 1 TKQC thô → hàng cho bảng. Số tiền giữ NGUYÊN chuỗi Graph, web chia theo bảng offset tiền tệ.
function mapAccount(acc, myUserId) {
  const users = (acc.users?.data || []).filter((u) => u.id).map((u) => ({ id: u.id, name: u.name, role: vaiTro(u), raw_role: u.role }))
  const dem = (r) => users.filter((u) => u.role === r).length
  const prepay = typeof acc.is_prepay_account === 'boolean' ? acc.is_prepay_account : null
  const tpb = acc.total_prepay_balance
  const prepayBalance = tpb?.amount_in_hundredths != null && tpb.amount_in_hundredths !== '' ? Number(tpb.amount_in_hundredths) / 100
    : (tpb?.amount != null ? Number(String(tpb.amount).replace(/,/g, '')) : null)
  const owner = typeof acc.owner === 'string' ? acc.owner : acc.owner?.id || ''
  return {
    account_id: acc.account_id,
    id: acc.id || (acc.account_id ? `act_${acc.account_id}` : ''),
    name: acc.name || '',
    account_status: acc.account_status ?? 0,
    disable_reason: acc.disable_reason ?? null,
    currency: acc.currency || '',
    balance: acc.balance ?? null,
    spend_cap: acc.spend_cap ?? null,
    amount_spent: acc.amount_spent ?? null,
    adtrust_dsl: acc.adtrust_dsl ?? null,
    threshold: acc.adspaymentcycle?.data?.[0]?.threshold_amount ?? null,
    next_bill_date: acc.next_bill_date || null,
    created_time: acc.created_time || null,
    timezone_name: acc.timezone_name || '',
    timezone_offset_hours_utc: acc.timezone_offset_hours_utc ?? null,
    business_country_code: acc.business_country_code || '',
    business_state: acc.business_state || '',
    business_zip: acc.business_zip || '',
    owner,
    owner_business_id: acc.owner_business?.id || '',
    owner_business_name: acc.owner_business?.name || '',
    agencies: (acc.agencies?.data || []).map((a) => ({ id: a.id, name: a.name })),
    // Vai trò của CHÍNH người đang đăng nhập trong TKQC (cột Quyền).
    my_role: myUserId ? (acc.users?.data || []).find((u) => u.id === myUserId)?.role ?? null : null,
    role_counts: { admin: dem('admin'), analyst: dem('analyst'), advertiser: dem('advertiser') },
    // Danh sách người trong TKQC (SMIT 1927 h(): tên + vai trò) — web dựng gợi ý ô SL Admin (≥ 3.12.32).
    admin_users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    users_count: users.length,
    campaigns: demChienDich(acc),
    is_prepay_account: prepay,
    prepay_balance: prepayBalance,
    card_data: theThanhToan(acc),
  }
}

// PUBLIC: lấy toàn bộ TKQC — của chính user + mọi BM user có quyền.
// Trả { accounts: [...], token: {user_id, user_name} }. Limit ẩn KHÔNG lấy ở đây (gọi riêng khi cần).
// Tách danh sách ID người dùng dán — SMIT: "mỗi ID cách nhau bằng dấu xuống dòng, tab hoặc dấu chấm phẩy";
// giữ phần số ≥ 5 chữ số (SMIT 1927 hàm c()), bỏ "act_".
function tachId(txt) {
  return [...new Set(String(txt || '').split(/[\n\t;,]+/).map((x) => x.trim().replace(/^act_/, '')).filter((x) => /^\d{5,}$/.test(x)))]
}

// Gọi nhiều đối tượng 1 lần: GET /?ids=a,b,c&fields=… (tối đa 50 id/lượt).
async function graphIds(ids, fields, accessToken) {
  const out = {}
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50)
    const r = await graphGet('', { ids: part.join(','), fields }, accessToken)
    // Gửi kèm cookie thì FB trả thêm khoá __fb_trace_id__/__www_request_id__ — chỉ giữ đúng id đã hỏi.
    for (const id of part) if (r?.[id]) out[id] = r[id]
  }
  return out
}

// cfg (hộp "Cấu hình tải dữ liệu TKQC" của SMIT, 1628.371c0067.js): source all|tkqcIds|bmIds,
// tkqcIds/bmIds = chuỗi dán, accountType all|personal|bm.
async function fetchAdAccounts({ payment = true, source = 'all', tkqcIds = '', bmIds = '', accountType = 'all' } = {}) {
  let token = await getAdsToken()
  const fields = buildFields({ payment })
  const run = async () => {
    if (source === 'tkqcIds') {
      const ids = tachId(tkqcIds)
      if (!ids.length) throw new Error('Chưa nhập ID TKQC')
      const r = await graphIds(ids.map((x) => `act_${x}`), fields, token.access_token)
      return Object.values(r).filter((a) => a && !a.error)
    }
    if (source === 'bmIds') {
      const ids = tachId(bmIds)
      if (!ids.length) throw new Error('Chưa nhập ID BM')
      const byId = new Map()
      for (const b of ids) {
        for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
          try {
            const r = await graphGet(`${b}/${edge}`, { fields, limit: PAGE_LIMIT }, token.access_token)
            for (const a of r.data || []) { const k = a.account_id || a.id; if (!byId.has(k)) byId.set(k, a) }
          } catch (e) { /* BM lẻ lỗi quyền — bỏ qua */ }
        }
      }
      return [...byId.values()]
    }
    // Danh sách chính = TKQC user CÓ QUYỀN (GET /{uid}/adaccounts, SMIT 1998 k/q — hasRole). TKQC chỉ thấy qua BM mà không có
    // quyền thuộc mục "Tài khoản quảng cáo không có quyền" (fetchNoRoleAccounts), không gộp vào đây.
    const me = await graphGet(`${token.user_id || 'me'}/adaccounts`, { fields, limit: PAGE_LIMIT }, token.access_token)
    const byId = new Map()
    for (const a of me.data || []) byId.set(a.account_id || a.id, a)
    return [...byId.values()]
  }
  let raw
  try {
    raw = await run()
  } catch (e) {
    if (String(e.message).includes('hết hạn')) { token = await getAdsToken(true); raw = await run() } else throw e
  }
  // Loại tài khoản — SMIT 37508 hàm f(): personal = không có owner_business, bm = có.
  if (accountType === 'personal') raw = raw.filter((a) => !a.owner_business?.id)
  else if (accountType === 'bm') raw = raw.filter((a) => !!a.owner_business?.id)
  return {
    accounts: raw.map((a) => {
      const row = mapAccount(a, token.user_id)
      return row
    }),
    token: { user_id: token.user_id, user_name: token.user_name },
  }
}

// TKQC "không có quyền" — SMIT 1998 z()/U()/C(): TKQC thấy qua BM của user (owned + client) TRỪ TKQC user có quyền
// (/{uid}/adaccounts). Quét BM theo lô 50 bằng Graph batch, mỗi BM lấy tối đa 5000 TK/loại (không phân trang, như SMIT);
// BM nào bị từ chối thì bỏ qua. Lọc loại TK: bm = chỉ TK của BM; personal = TK không có owner_business (TK client).
async function fetchNoRoleAccounts({ payment = true, accountType = 'all' } = {}) {
  let token = await getAdsToken()
  const fields = buildFields({ payment })
  const run = async () => {
    const me = await graphGet(`${token.user_id || 'me'}/adaccounts`, { fields: 'name,account_id,account_status,currency,owner_business', limit: '50', summary: '1' }, token.access_token)
    const coQuyen = new Set((me.data || []).map((a) => tachId(a.account_id || a.id)[0]).filter(Boolean))
    const bizs = (await graphGet('me/businesses', { fields: 'id,name', limit: '100' }, token.access_token)).data || []
    const F = 'name,owned_ad_accounts.limit(5000){account_id,name,account_status,currency},client_ad_accounts.limit(5000){account_id,name,account_status,currency}'
    const thay = new Map()
    for (let i = 0; i < bizs.length; i += 50) {
      const lo = bizs.slice(i, i + 50)
      const r = await graphPost('', { include_headers: 'false', batch: JSON.stringify(lo.map((b) => ({ method: 'GET', relative_url: `${b.id}?fields=${encodeURIComponent(F)}` }))) })
      const arr = Array.isArray(r.j) ? r.j : []
      lo.forEach((b, k) => {
        const it = arr[k]
        if (!it || Number(it.code) >= 400) return
        let body
        try { body = JSON.parse(it.body) } catch { return }
        if (!body || body.error) return
        for (const a of body.owned_ad_accounts?.data || []) {
          const id = tachId(a.account_id || a.id)[0]
          if (id && !thay.has(id)) thay.set(id, { ...a, owner_business: a.owner_business || { id: b.id, name: body.name || b.name } })
        }
        for (const a of body.client_ad_accounts?.data || []) {
          const id = tachId(a.account_id || a.id)[0]
          if (id && !thay.has(id)) thay.set(id, a)
        }
      })
    }
    let ids = [...thay.keys()].filter((id) => !coQuyen.has(id))
    if (accountType === 'personal') ids = ids.filter((id) => !thay.get(id)?.owner_business?.id)
    if (!ids.length) return []
    const r = await graphIds(ids.map((x) => `act_${x}`), fields, token.access_token)
    return Object.values(r).filter((a) => a && !a.error)
  }
  let raw
  try {
    raw = await run()
  } catch (e) {
    if (String(e.message).includes('hết hạn')) { token = await getAdsToken(true); raw = await run() } else throw e
  }
  return { accounts: raw.map((a) => ({ ...mapAccount(a, token.user_id), hasRole: false })), token: { user_id: token.user_id, user_name: token.user_name } }
}

// PUBLIC: Limit ẩn (ngưỡng chi tiêu ẩn) cho 1 TKQC — lệnh GraphQL riêng, gọi lười.
async function fetchHiddenLimit(assetId, currency) {
  const token = await getAdsToken()
  // Gọi GraphQL — chép SMIT 1927.de94d1f1.js module 14845 hàm w(): locale en_US, __a=1, x-asbd-id,
  // chỉ đọc DÒNG ĐẦU câu trả lời (FB trả nhiều dòng JSON); www báo 1675002 → thử lại qua business.
  const goi = async (host) => {
    const body = new URLSearchParams({
      locale: 'en_US', __a: '1',
      doc_id: '6401661393282937',
      variables: JSON.stringify({ assetID: String(assetId) }),
      fb_dtsg: token.fb_dtsg || '', lsd: token.lsd || '',
    })
    const res = await fetch(`https://${host}.facebook.com/api/graphql/`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-asbd-id': '1' },
      body: body.toString(),
    })
    let t = await res.text()
    if (t.startsWith('for (;;);')) t = t.slice(9)
    const dong = t.includes('\n') ? (t.split('\n')[0] || '').trim() : t
    try { return JSON.parse(dong) } catch { throw new Error('Không đọc được Limit ẩn') }
  }
  let json = await goi('www')
  if (json.errors?.[0]?.code === 1675002 || json.error === 1675002) json = await goi('business')
  if (json.errors?.[0]?.code === 1675004 || json.error === 1675004) throw new Error('rate_limited') // SMIT: HiddenLimitRateLimitError
  // Đọc số từ formatted_dsl — chép SMIT 1927.de94d1f1.js (module 17506).
  const u = json.data?.billable_account_by_asset_id
  const raw = u?.formatted_dsl
  const cur = (u?.currency || currency || '').toUpperCase()
  if (!raw) return { limit: null, currency: cur }
  const n = raw.replace(/[^\d,.-]/g, '')
  if (!n) return { limit: null, currency: cur }
  let v = n
  if (cur && ZERO_DECIMAL.has(cur)) v = n.replace(/[.,]/g, '')
  else if (n.includes(',') && n.includes('.')) {
    const dec = n.lastIndexOf(',') > n.lastIndexOf('.') ? ',' : '.'
    v = n.replaceAll(dec === ',' ? '.' : ',', '').replace(dec, '.')
  } else if (n.includes(',')) v = n.length - n.lastIndexOf(',') - 1 === 3 ? n.replaceAll(',', '') : n.replace(',', '.')
  else {
    const parts = n.split('.')
    if (parts.length > 2 || (parts.length === 2 && parts[1]?.length === 3)) v = parts.join('')
  }
  const so = Number.parseFloat(v)
  return { limit: Number.isFinite(so) ? so : null, currency: cur }
}

async function fetchSpend({ ids = [], preset = null, since = null, until = null } = {}) {
  const token = await getAdsToken()
  const PRESETS = new Set(['today', 'yesterday', 'last_7d', 'last_30d', 'this_month', 'last_month'])
  const coPreset = PRESETS.has(preset)
  const ins = coPreset ? `insights.date_preset(${preset}){spend,date_start,date_stop}`
    : since && until ? `insights.time_range({since: '${since}',until:'${until}'}){spend,date_stop}`
      : 'insights.date_preset(lifetime){spend,date_stop}'
  const kemHomNay = !coPreset || preset === 'this_month'
  const fields = ['account_id', ins, ...(kemHomNay ? ['insights.date_preset(today).as(today_spend){spend,date_start}'] : [])].join(',')
  const r = await graphIds(ids.map((x) => `act_${String(x).replace(/^act_/, '')}`), fields, token.access_token)
  const out = {}
  for (const [k, v] of Object.entries(r)) {
    if (!v || v.error) continue
    out[k.replace(/^act_/, '')] = { insights: v.insights?.data?.[0] || null, today: v.today_spend?.data?.[0] || null }
  }
  return out
}

// ── Công cụ (Kho chức năng) — chép SMIT 1128.52251f38.js ───────────────────────────────────────────────────────────
// GraphQL theo phiên đăng nhập (SMIT 14845 w(): locale en_US, __a=1, x-asbd-id, đọc dòng đầu; www báo 1675002 → business).
async function graphql(host, payload) {
  const token = await getAdsToken()
  const goi = async (h) => {
    const body = new URLSearchParams({ locale: 'en_US', __a: '1', ...payload, fb_dtsg: token.fb_dtsg || '', lsd: token.lsd || '' })
    const hdr = { 'content-type': 'application/x-www-form-urlencoded', 'x-asbd-id': '1' }
    if (payload.fb_api_req_friendly_name) hdr['x-fb-friendly-name'] = payload.fb_api_req_friendly_name
    const res = await fetch(`https://${h}.facebook.com/api/graphql/`, { method: 'POST', credentials: 'include', headers: hdr, body: body.toString() })
    let t = await res.text()
    if (t.startsWith('for (;;);')) t = t.slice(9)
    const dong = t.includes('\n') ? (t.split('\n')[0] || '').trim() : t
    try { return { json: JSON.parse(dong), raw: t } } catch { return { json: null, raw: t } }
  }
  let r = await goi(host)
  if (host === 'www' && (r.json?.errors?.[0]?.code === 1675002 || r.json?.error === 1675002)) r = await goi('business')
  // Câu lỗi như SMIT 14845: description_raw → description → summary → message (FB trả tiếng Việt theo tài khoản).
  const e0 = r.json?.errors?.[0]
  const loi = (e0 && [e0.description_raw, e0.description, e0.summary, e0.message].find((x) => typeof x === 'string' && x.trim()))
    || r.json?.errorSummary || (r.json?.error ? r.json?.errorDescription || String(r.json.error) : null)
  return { ...r, loi: loi ? String(loi) : null }
}

// Graph POST /act_X (SMIT 14845 JB, tokenPurpose powerEditorAction) — mã EAAB adsmanager, kèm cookie.
async function graphPost(path, params) {
  const token = await getAdsToken()
  const res = await fetch(`${GRAPH}/${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, access_token: token.access_token }).toString(),
  })
  const j = await res.json().catch(() => null)
  return j?.error ? { loi: String(j.error.error_user_msg || j.error.message || 'Graph lỗi'), j } : { j }
}
const boAct = (id) => String(id || '').replace(/^act_/, '')

// Mở/Đóng TKQC — SMIT eS (đóng: BizKitSettingsDeactivateAdAccountMutation @business) / eA (mở: useBillingReactivateAdAccountMutation @adsmanager).
async function openCloseAccount({ id, mode }) {
  const acc = boAct(id)
  if (mode !== 'open' && mode !== 'close') return { ok: false, message: 'Mode không hợp lệ (phải là open hoặc close)' }
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản' }
  if (mode === 'close') {
    const r = await graphql('business', { fb_api_req_friendly_name: 'BizKitSettingsDeactivateAdAccountMutation', doc_id: '9895135750555877', variables: JSON.stringify({ adAccountID: acc }) })
    if (r.loi) return { ok: false, message: r.loi }
    return r.json?.data?.business_settings_deactivate_ad_account
      ? { ok: true, message: 'Đã đóng tài khoản (GraphQL)', patch: { account_status: 101 } }
      : { ok: false, message: 'GraphQL không xác nhận được đóng tài khoản' }
  }
  const tk = await getAdsToken()
  const r = await graphql('adsmanager', {
    fb_api_req_friendly_name: 'useBillingReactivateAdAccountMutation', doc_id: '9984888131552276',
    variables: JSON.stringify({ input: { billable_account_payment_legacy_account_id: acc, actor_id: tk.user_id, client_mutation_id: '1', logging_data: {}, upl_logging_data: { wizard_name: 'REACTIVATE_AD_ACCOUNT' } } }),
  })
  if (r.loi) return { ok: false, message: r.loi }
  // SMIT kR(n, "ADMARKET_ACCOUNT_STATUS_ACTIVE"): câu trả lời có chuỗi trạng thái hoạt động.
  return String(r.raw || '').includes('ADMARKET_ACCOUNT_STATUS_ACTIVE')
    ? { ok: true, message: 'Đã mở tài khoản (GraphQL)', patch: { account_status: 1 } }
    : { ok: false, message: 'GraphQL không xác nhận được mở tài khoản' }
}

// Đặt giới hạn chi tiêu — SMIT 83831: set (spend_cap) / remove (spend_cap_action=delete) / reset (GraphQL 5205066939546485 @www).
// amount đã là tiền CỦA TKQC (web quy đổi trước như SMIT 3732).
async function spendLimit({ id, mode, amount }) {
  const acc = boAct(id)
  if (!['set', 'remove', 'reset'].includes(mode)) return { ok: false, message: 'Mode không hợp lệ (phải là set, remove, hoặc reset)' }
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản' }
  if (mode === 'set') {
    const so = Number(amount)
    if (!Number.isFinite(so) || so <= 0) return { ok: false, message: 'Số tiền giới hạn phải là số dương' }
    const r = await graphPost(`act_${acc}`, { spend_cap: String(so) })
    if (r.loi) return { ok: false, message: r.loi }
    return r.j?.success === true ? { ok: true, message: `Đã đặt giới hạn chi tiêu: ${so}`, patch: { spend_cap_don_vi: so } } : { ok: false, message: 'Graph không xác nhận được đặt giới hạn chi tiêu' }
  }
  if (mode === 'remove') {
    const r = await graphPost(`act_${acc}`, { spend_cap_action: 'delete' })
    if (r.loi) return { ok: false, message: r.loi }
    return r.j?.success === true ? { ok: true, message: 'Đã gỡ giới hạn chi tiêu', patch: { spend_cap: '0' } } : { ok: false, message: 'Graph không xác nhận được gỡ giới hạn chi tiêu' }
  }
  const tk = await getAdsToken()
  const r = await graphql('www', { doc_id: '5205066939546485', variables: JSON.stringify({ input: { billable_account_payment_legacy_account_id: acc, actor_id: tk.user_id, client_mutation_id: '1' } }) })
  if (r.loi) return { ok: false, message: r.loi }
  return r.json?.data?.billable_account_reset_spend_limit?.billable_account?.spending_info
    ? { ok: true, message: 'Đã reset số tiền đã chi về 0', patch: { amount_spent: '0' } }
    : { ok: false, message: 'GraphQL không xác nhận được reset số đã chi' }
}

// Đổi tên TKQC — SMIT 1128 module 95953 hàm c(): POST /act_X {name}; tên đã tính sẵn ở web (hậu tố ngẫu nhiên/tuần tự).
async function renameAccount({ id, name }) {
  const acc = boAct(id)
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản' }
  const r = await graphPost(`act_${acc}`, { name: String(name || '') })
  if (r.loi) return { ok: false, message: r.loi }
  return { ok: true, message: `Đã đổi tên → ${name}`, patch: { name } }
}

// Đổi thông tin của TKQC — SMIT 1128 module 26429 (K) + 24085 + 37324 (spin), bản đọc: docs/modules/smit/doi-thong-tin-tkqc.md §4–6.
// Giữ ID: chạy lần lượt Múi giờ → Tiền tệ → Thông tin doanh nghiệp/Quốc gia (mỗi phần cách 1–3 giây).
// ĐỔI ID: một lệnh GraphQL tạo TKQC mới mang quốc gia/tiền tệ/múi giờ/thông tin đã chọn (không trả patch).
const CI_GIU = '__keep__'
const CI_CHU = ['businessName', 'taxId', 'street1', 'street2', 'city', 'state', 'zip']
const CI_NHAN = { businessName: 'Tên', street1: 'Địa chỉ 1', street2: 'Địa chỉ 2', city: 'Thành phố', state: 'Bang', zip: 'Zip', taxId: 'MST' }
const CI_DICH = { timezone: 'Múi giờ', currency: 'Loại tiền tệ', country: 'Quốc gia', businessInfo: 'Thông tin doanh nghiệp', newId: 'Đổi ID' }
const BANG_MY = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' }
const ciCo = (v, k) => (typeof v[k] === 'string' ? v[k].trim() : '')
const ciQG = (v) => { const c = ciCo(v, 'countryCode').toUpperCase(); return c && c !== '__KEEP__' ? c : '' }
const ciCoChu = (v) => CI_CHU.some((k) => ciCo(v, k) !== '')
const ciMG = (v) => { const z = ciCo(v, 'timezoneName'); return z !== '' && z !== CI_GIU }
const ciTT = (v) => { const z = ciCo(v, 'currency'); return z !== '' && z !== CI_GIU }
const ciDoiId = (v) => v.changeId === true || v.changeId === 'true'
const ngauNhien = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const nghiCi = () => new Promise((r) => setTimeout(r, 1000 + Math.floor(2001 * Math.random())))
function ciSpin(s) {
  let x = String(s ?? '')
  for (let g = 0; g < 100; g++) {
    const m = x.match(/{([^{}]+?)}/)
    if (!m) break
    const p = m[1].split('|')
    x = x.replace(m[0], p[Math.floor(Math.random() * p.length)])
  }
  return x
}
function bangMy(x) {
  const t = String(x || '').trim()
  if (!t) return t
  const k = BANG_MY[t.toLowerCase().replace(/\s+/g, ' ')]
  if (k) return k
  const hoa = t.toUpperCase()
  return Object.values(BANG_MY).includes(hoa) ? hoa : t
}
const ciTachMG = (tz) => { const i = String(tz).indexOf('|'); return i < 0 ? { id: String(tz).trim(), timezone: String(tz).trim() } : { id: tz.slice(0, i).trim(), timezone: tz.slice(i + 1).trim() } }
const ciLog = () => ({ logging_counter: ngauNhien(10, 40), logging_id: `1017${ngauNhien(500000, 700000)}` })
function ciThue(v, qg) {
  return {
    business_address: {
      country_code: qg,
      city: ciSpin(ciCo(v, 'city')),
      state: qg === 'US' ? bangMy(ciSpin(ciCo(v, 'state'))) : ciSpin(ciCo(v, 'state')),
      street1: ciSpin(ciCo(v, 'street1')),
      street2: ciSpin(ciCo(v, 'street2')),
      zip: ciSpin(ciCo(v, 'zip')),
    },
    business_name: ciSpin(ciCo(v, 'businessName')),
    is_personal_use: typeof v.isPersonalUse === 'boolean' ? v.isPersonalUse : v.isPersonalUse === 'true',
    tax_id: ciSpin(ciCo(v, 'taxId')),
    tax_registration_status: '',
  }
}
// Graph REST như SMIT JB: POST act_X với tham số method=POST (+ định dạng chuẩn).
async function ciGraph(acc, params) {
  const r = await graphPost(`act_${acc}`, { method: 'POST', ...params, format: 'json', pretty: '0', suppress_http_code: '1', locale: 'en_US' })
  return r
}
async function ciMuiGio(acc, tz) {
  const { id, timezone } = ciTachMG(tz)
  const r = await ciGraph(acc, { timezone_id: id })
  if (r.loi) return { part: 'timezone', ok: false, message: r.loi }
  return r.j?.success === true ? { part: 'timezone', ok: true, message: `Múi giờ ${timezone}` } : { part: 'timezone', ok: false, message: 'Facebook không xác nhận đổi timezone' }
}
async function ciTienTe(acc, ma) {
  const r = await ciGraph(acc, { currency: ma })
  if (r.loi) return { part: 'currency', ok: false, message: r.loi }
  return r.j?.success === true ? { part: 'currency', ok: true, message: `Tiền tệ ${ma}` } : { part: 'currency', ok: false, message: 'Facebook không xác nhận đổi tiền tệ' }
}
async function ciThongTin(acc, thue, actor) {
  const r = await graphql('business', {
    doc_id: '5664358410294804',
    variables: JSON.stringify({ input: { billable_account_payment_legacy_account_id: acc, currency: null, timezone: null, logging_data: ciLog(), tax: { ...thue, second_tax_id: '' }, actor_id: actor, client_mutation_id: String(ngauNhien(1, 30)) } }),
  })
  if (r.loi) return { part: 'info', ok: false, message: r.loi, sentTax: thue }
  return r.json?.data?.billable_account_update?.billable_account?.id ? { part: 'info', ok: true, message: '', sentTax: thue } : { part: 'info', ok: false, message: 'Facebook không xác nhận đổi thông tin', sentTax: thue }
}
async function ciIdMoi(acc, v, actor, phan, qg) {
  const r = await graphql('business', {
    doc_id: '4831122253676348',
    variables: JSON.stringify({ input: {
      current_payment_legacy_account_id: acc,
      logging_data: ciLog(),
      new_country_code: qg,
      new_currency_code: phan.includes('currency') ? ciCo(v, 'currency').toUpperCase() : null,
      new_timezone: phan.includes('timezone') && ciCo(v, 'timezoneName') ? ciTachMG(ciCo(v, 'timezoneName')).timezone : null,
      new_tax: { ...ciThue(v, qg), tax_id_type: 'NONE' },
      actor_id: actor,
      client_mutation_id: String(ngauNhien(1, 30)),
    } }),
  })
  if (r.loi) return { ok: false, message: r.loi }
  const d = r.json?.data?.new_billable_account_from_old
  const id = d?.id ?? d?.billable_account?.id
  return id ? { ok: true, message: `Đã tạo TKQC ID mới ${id}. Hãy quét lại danh sách để cập nhật cache.` } : { ok: false, message: 'Facebook không xác nhận tạo TKQC ID mới' }
}
const ciDich = (id, r) => ({ id, displayId: CI_DICH[id], ok: r.ok, message: r.message })
async function changeInfo({ id, values = {}, country = '' }) {
  const v = Object.fromEntries(Object.entries(values || {}).filter(([, x]) => typeof x === 'string' || typeof x === 'boolean'))
  const acc = boAct(id)
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản' }
  const phan = [ciMG(v) && 'timezone', ciTT(v) && 'currency', (ciQG(v) || ciCoChu(v)) && 'info'].filter(Boolean)
  const qgCu = String(country || '').trim().toUpperCase()
  const qg = ciQG(v) || qgCu
  if (ciDoiId(v)) {
    const loi = !phan.length ? 'Chọn ít nhất một phần cần đổi khi thay đổi ID TKQC' : !qg ? 'Thiếu mã quốc gia để đổi ID mới'
      : phan.includes('currency') && !ciCo(v, 'currency') ? 'Thiếu tiền tệ' : phan.includes('timezone') && !ciCo(v, 'timezoneName') ? 'Thiếu múi giờ' : null
    if (loi) return { ok: false, message: loi }
    const tk = await getAdsToken()
    const r = await ciIdMoi(acc, v, tk.user_id, phan, qg)
    return { ...r, targets: [ciDich('newId', r)] }
  }
  const loi = !phan.length ? 'Chọn ít nhất một phần cần đổi khi giữ ID'
    : phan.includes('currency') && !ciCo(v, 'currency') ? 'Thiếu tiền tệ' : phan.includes('timezone') && !ciCo(v, 'timezoneName') ? 'Thiếu múi giờ'
      : phan.includes('info') && !qg ? 'Thiếu mã quốc gia' : null
  if (loi) return { ok: false, message: loi }
  const tk = await getAdsToken()
  const targets = [], patch = {}
  for (let i = 0; i < phan.length; i++) {
    if (i > 0) await nghiCi()
    if (phan[i] === 'timezone') {
      const r = await ciMuiGio(acc, ciCo(v, 'timezoneName'))
      targets.push(ciDich('timezone', r))
      if (r.ok) patch.timezone_name = ciTachMG(ciCo(v, 'timezoneName')).timezone
    } else if (phan[i] === 'currency') {
      const ma = ciCo(v, 'currency').toUpperCase()
      const r = await ciTienTe(acc, ma)
      targets.push(ciDich('currency', r))
      if (r.ok) patch.currency = ma
    } else {
      const chonQG = ciQG(v) !== '', coChu = ciCoChu(v)
      const res = await ciThongTin(acc, ciThue(v, qg), tk.user_id)
      let p = res, qgDung = qg
      // Thử lại với quốc gia cũ của TKQC khi đổi quốc gia + thông tin bị từ chối (26429 N()).
      if (!res.ok && chonQG && coChu && res.sentTax && qgCu && qgCu !== qg) {
        await nghiCi()
        p = await ciThongTin(acc, { ...res.sentTax, business_address: { ...res.sentTax.business_address, country_code: qgCu } }, tk.user_id)
        qgDung = qgCu
      }
      if (chonQG) targets.push(ciDich('country', res.ok ? { ok: true, message: `Quốc gia ${qg}` } : res))
      if (coChu) {
        const t = p.sentTax
        const chiTiet = t ? [['businessName', t.business_name], ['street1', t.business_address.street1], ['street2', t.business_address.street2], ['city', t.business_address.city], ['state', t.business_address.state], ['zip', t.business_address.zip], ['taxId', t.tax_id]]
          .filter(([, x]) => x).map(([k, x]) => `${CI_NHAN[k]}: ${x}`).join(' · ') : ''
        targets.push(ciDich('businessInfo', p.ok && p.sentTax ? { ok: true, message: chiTiet } : p))
      }
      if (p.ok && p.sentTax) { patch.business_country_code = qgDung; patch.business_state = p.sentTax.business_address.state; patch.business_zip = p.sentTax.business_address.zip }
    }
  }
  const tomTat = targets.map((t) => (t.ok ? `${t.id}: OK` : `${t.id}: FAIL (${t.message})`)).join('; ')
  const okHet = targets.every((t) => t.ok), okMot = targets.some((t) => t.ok)
  const coPatch = Object.keys(patch).length > 0
  if (okHet) return { ok: true, message: tomTat, targets, ...(coPatch ? { patch } : {}) }
  if (okMot) return { ok: false, message: `PARTIAL — ${tomTat}`, targets, ...(coPatch ? { patch } : {}) }
  return { ok: false, message: tomTat, targets }
}

// ── Nhóm "Thẻ & thanh toán" — chép SMIT 1128.52251f38.js (10053 B / L, 85228 vZ, 87242 ey) + 1927 (17506 CK, 14845 UG) ──
// Bản đọc mã: vaesa-livechat/docs/modules/smit/thanh-toan-2.md.
const so5 = (id) => (String(id ?? '').match(/\d{5,}/) || [''])[0] // 1927 Sv: dãy ≥ 5 chữ số đầu tiên
const laDoiTuong = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const ngu = (ms) => new Promise((r) => setTimeout(r, ms))
// Đọc trả lời GraphQL như UG (1927:1922-1971): có errors[] mà các trường "một phần" còn trống mới là lỗi; ghep = mergeDeferred
// (FB trả nhiều khúc JSON, khúc sau mang path + data ⇒ ghép vào khúc đầu).
function docGraphql(t, { partial = [], ghep = false } = {}) {
  const s = t.startsWith('for (;;);') ? t.slice(9) : t
  let e
  try {
    if (ghep) {
      const kh = s.split(/\s+(?={")/).map((x) => x.trim()).filter(Boolean)
      e = JSON.parse(kh[0] ?? '')
      for (const x of kh.slice(1)) {
        let c
        try { c = JSON.parse(x) } catch { continue }
        if (Array.isArray(c.errors) && c.errors.length) e.errors = [...(e.errors ?? []), ...c.errors]
        if (!Array.isArray(c.path) || !laDoiTuong(c.data)) continue
        let r = e.data
        for (const p of c.path) r = typeof r === 'object' && r !== null ? r[String(p)] : undefined
        if (laDoiTuong(r)) Object.assign(r, c.data)
      }
    } else e = JSON.parse(s.includes('\n') ? (s.split('\n')[0] ?? '').trim() : s)
  } catch { return { error: true, message: 'Phản hồi GraphQL không hợp lệ' } }
  const du = partial.length > 0 && partial.every((p) => { let n = e; for (const k of p.split('.')) { if (typeof n !== 'object' || n === null) return false; n = n[k] } return n != null })
  if (e.errors?.length && !du) {
    const x = e.errors[0]
    return { error: true, message: [x?.description_raw, x?.description, x?.summary, x?.message].find((v) => typeof v === 'string' && v.trim()) || 'GraphQL error', ...(typeof x?.code === 'number' ? { code: x.code } : {}) }
  }
  if (e.error) {
    const code = typeof e.error === 'number' ? e.error : typeof e.code === 'number' ? e.code : undefined
    return { error: true, message: e.errorDescription || e.errorSummary || String(e.error), ...(code !== undefined ? { code } : {}) }
  }
  return e
}
const loiPhien = (r) => r?.error && ([190, 102, 463, 467, 1357004].includes(r.code) || /fb_dtsg|access token|session|login|log in|logged in|đăng nhập/i.test(r.message || ''))
// UG: www báo 1675002 ⇒ gọi lại qua business; lỗi giống hết phiên ⇒ lấy phiên mới, thử lại 1 lần.
async function goiGraphql(host, form, opt = {}) {
  const chay = async (token) => {
    const goi = async (h) => {
      const body = new URLSearchParams({ locale: 'en_US', __a: '1', ...form, fb_dtsg: token.fb_dtsg || '', lsd: token.lsd || '', ...(opt.them || {}) })
      const res = await fetch(`https://${h}.facebook.com/api/graphql/`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-asbd-id': '1' }, body: body.toString() })
      return docGraphql(await res.text(), opt)
    }
    let r = await goi(host)
    if (host === 'www' && r.error && r.code === 1675002) r = await goi('business')
    return r
  }
  const r = await chay(await getAdsToken())
  return loiPhien(r) ? chay(await getAdsToken(true)) : r
}
async function lan3(f) { // 1927:183 / 1128:8478: tối đa 3 lần, nghỉ 800ms rồi 1600ms
  let loi
  for (let i = 0; i < 3; i++) {
    try { return await f() } catch (e) { loi = e; if (e?.dung) throw e; if (i < 2) await ngu(Math.min(5000, 800 * (i + 1))) }
  }
  throw loi
}
const CHU_KHONG_TT = 'Tài khoản chưa có tài khoản thanh toán nên không có trạng thái hold'

// Check Hold (B + ey): TK thanh toán theo TKQC (doc 6401661393282937) → cờ hạn chế (doc 6975887429148122).
async function checkHold({ id }) {
  const t = String(id ?? '').trim()
  if (!t) return { ok: false, message: 'Thiếu ID tài khoản' }
  const tk = await lan3(async () => {
    const r = await goiGraphql('www', { doc_id: '6401661393282937', variables: JSON.stringify({ assetID: so5(t) }) }, { partial: ['data.billable_account_by_asset_id.formatted_dsl'] })
    if (r.error) {
      const e = new Error(r.code === 1675004 ? 'Hidden limit rate limited' : r.message)
      if (r.code === 1675004 || r.code === 1675002) e.dung = true
      throw e
    }
    return r.data?.billable_account_by_asset_id
  })
  const legacy = String(tk?.legacy_account_id ?? '').trim()
  if (!legacy) return { ok: false, message: CHU_KHONG_TT }
  const s = await lan3(async () => {
    const r = await goiGraphql('www', { doc_id: '6975887429148122', variables: JSON.stringify({ paymentAccountID: legacy }) })
    if (r.error) throw new Error(r.message)
    return r.data?.billable_account_by_payment_account
  })
  if (!s) return { ok: false, message: CHU_KHONG_TT }
  const holdNeed = s.prisk_restrictions?.length || s.is_reauth_restricted || s.is_sdc_restricted ? 'HOLD' : 'OK'
  return { ok: true, message: holdNeed, patch: { holdNeed } }
}

// Check xác minh vị trí (L): cùng doc 6401661393282937 nhưng gọi thẳng business, kèm __aaid, ghép khúc; có tin VERIFY_COUNTRY ⇒ cần xác minh.
async function checkLocation({ id }) {
  const t = so5(id)
  if (!t) return { ok: false, message: 'Thiếu ID tài khoản' }
  const r = await goiGraphql('business', { doc_id: '6401661393282937', variables: JSON.stringify({ assetID: t }) },
    { them: { __aaid: t }, partial: ['data.billable_account_by_asset_id.billing_hub_messages'], ghep: true })
  if (r.error) return { ok: false, message: r.message }
  const a = r.data?.billable_account_by_asset_id?.billing_hub_messages?.messages
  if (!a) return { ok: false, message: 'Facebook không trả về tài khoản thanh toán nên không xác định được' }
  if (a.some((m) => m?.primary_action?.wizard_name === 'VERIFY_COUNTRY')) return { ok: true, message: 'Cần xác minh vị trí kinh doanh', alert: true }
  return { ok: true, message: 'Không bị yêu cầu xác minh vị trí' }
}

// Tải hoá đơn (vZ): trang tính sẵn đường dẫn + tên tệp; tiện ích đặt luật đổi tên tệp (sống 120 giây) rồi mở tab Facebook.
// Facebook trả tệp theo phiên đăng nhập của trình duyệt; tiện ích không tải, không nén gì cả.
const luatHoaDon = new Map()
const henXoaLuat = new Map()
let soLuat = 0
async function openInvoices({ id, url, fileName }) {
  const acc = boAct(id)
  if (!luatHoaDon.has(acc)) luatHoaDon.set(acc, 940000000 + soLuat++)
  const ruleId = luatHoaDon.get(acc)
  const ascii = String(fileName).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\x20-\x7e]/g, '_')
  const ma = encodeURIComponent(fileName).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  let dat = false
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{ id: ruleId, priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Content-Disposition', operation: 'set', value: `attachment; filename="${ascii}"; filename*=UTF-8''${ma}` }] },
        condition: { urlFilter: `||facebook.com/ads/manage/invoices_generator/?act=${acc}&`, resourceTypes: ['main_frame'] } }],
    })
    dat = true
  } catch { /* SMIT: đặt luật lỗi vẫn mở tab — tệp giữ tên Facebook đặt */ }
  if (dat) {
    clearTimeout(henXoaLuat.get(acc))
    henXoaLuat.set(acc, setTimeout(() => { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {}) }, 120000))
  }
  try {
    await chrome.tabs.create({ url })
    return { ok: true, message: 'Đã yêu cầu mở liên kết Facebook trong tab mới' }
  } catch {
    return { ok: false, message: 'VAESA Extension không thể mở tab tải xuống. Hãy kiểm tra extension rồi thử lại.' }
  }
}

// Graph REST như SMIT JB (1927:1760-1842): tham số rồi access_token, format=json, pretty=0, suppress_http_code=1, locale=en_US.
async function graphJB(path, params = {}) {
  const chay = async (token) => {
    const q = new URLSearchParams({ ...params, access_token: token.access_token, format: 'json', pretty: '0', suppress_http_code: '1', locale: 'en_US' })
    const res = await fetch(`${GRAPH}/${path}?${q.toString()}`, { credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    let j
    try { j = await res.json() } catch { return { error: true, message: 'Phản hồi Graph không hợp lệ' } }
    if (j?.error) return { error: true, message: j.error.message || j.error.error_user_msg || j.error.error_user_title || 'Graph error', code: j.error.code }
    return j
  }
  const r = await chay(await getAdsToken())
  return loiPhien(r) ? chay(await getAdsToken(true)) : r
}
// Thẻ của TKQC (delete-card g 1128:3246-3263 / set-default-card l 7917-7934): xoá thẻ lấy dãy số ĐẦU, đặt mặc định lấy nhóm 4 số CUỐI.
async function layThe(acc, kieuSo, them = '') {
  const r = await graphJB(`act_${acc}`, { fields: `all_payment_methods{pm_credit_card{credential_id,display_string}}${them}` })
  if (r.error) throw new Error(r.message)
  return (r.all_payment_methods?.pm_credit_card?.data || []).map((e) => {
    const t = e.display_string ?? ''
    const display = kieuSo === 'cuoi' ? (t.match(/\d{4}(?!.*\d)/)?.[0] || t.match(/\d+/)?.[0] || 'Unknown') : (t.match(/\d+/)?.[0] || 'Unknown')
    return { display, type: t.toLowerCase().match(/[^\d\W]+/)?.[0], credential_id: e.credential_id || 'Unknown' }
  })
}

// Kích hoạt trả trước (u, 1128:3601-3632): BillingPrepayActivateMutation @business; không lỗi GraphQL là xong.
async function activatePrepay({ id }) {
  const acc = boAct(id)
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản' }
  const token = await getAdsToken()
  const r = await goiGraphql('business', { fb_api_req_friendly_name: 'BillingPrepayActivateMutation', doc_id: '4886770528075857',
    variables: JSON.stringify({ input: { billable_account_payment_legacy_account_id: acc, recurring_enabled: false, actor_id: token.user_id, client_mutation_id: '3' } }) })
  if (r.error) return { ok: false, message: r.message }
  return { ok: true, message: 'Đã kích hoạt trả trước (GraphQL)' }
}

// Xoá thẻ (w, 1128:3289-3423): chọn thẻ theo chế độ, xoá LẦN LƯỢT từng thẻ (nghỉ 1–3 giây giữa 2 thẻ), mỗi thẻ một đích.
async function deleteCard({ id, values = {}, cardData = [] }) {
  const mode = String(values.mode ?? 'all')
  if (!['all', 'card_list', 'credential'].includes(mode)) return { ok: false, message: 'Chế độ xóa thẻ không hợp lệ' }
  if (values.confirm !== true) return { ok: false, message: 'Cần bật xác nhận trước khi xóa thẻ thanh toán' }
  const acc = boAct(id)
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản' }
  const duoi = [...new Set(String(values.cardNumbers ?? '').match(/\d{4}/g) ?? [])]
  if (mode === 'card_list' && !duoi.length) return { ok: false, message: 'Vui lòng nhập ít nhất một mã 4 số cuối thẻ cần xóa' }
  const ma = [...String(values.credentialIds ?? '').split(/\r?\n/), String(values.credentialId ?? '')].map((x) => x.trim()).filter(Boolean)
  if (mode === 'credential' && !ma.length) return { ok: false, message: 'Thiếu mã định danh thẻ cần xóa' }
  const ds = await layThe(acc, 'dau', ',funding_source_details{display_string,type}')
  const the = ds.length ? ds : cardData
  const xoaDuoc = the.filter((c) => c.credential_id && c.credential_id !== 'Unknown')
  const chon = mode === 'credential' ? xoaDuoc.filter((c) => ma.includes(c.credential_id)) : mode === 'card_list' ? xoaDuoc.filter((c) => duoi.includes(c.display)) : xoaDuoc
  const theoMa = mode === 'all' || (mode === 'credential' && String(values.credentialIds ?? '').trim() !== '')
  const thieu = mode === 'credential' && theoMa
    ? ma.filter((x) => !chon.some((c) => c.credential_id === x)).map((x) => ({ id: x, ok: false, message: 'Không tìm thấy thẻ cần xóa — có thể thẻ đã bị gỡ' })) : []
  if (!chon.length) {
    if (mode === 'credential') return { ok: false, message: 'Không tìm thấy thẻ cần xóa — có thể thẻ đã bị gỡ', ...(thieu.length ? { targets: thieu } : {}) }
    if (mode === 'card_list') return { ok: false, message: `Không tìm thấy thẻ khớp 4 số cuối: ${duoi.join(', ')}` }
    return { ok: false, message: 'Không tìm thấy thẻ có credential_id' }
  }
  const dich = (c) => (theoMa ? { id: c.credential_id, displayId: c.display } : { id: c.display })
  const token = await getAdsToken()
  const kq = []
  for (let i = 0; i < chon.length; i++) {
    if (i > 0) await ngu(1000 + Math.floor(2001 * Math.random()))
    const c = chon[i]
    const r = await goiGraphql('www', { doc_id: '9195168280589012', variables: JSON.stringify({ input: { payment_account_id: acc, payment_method_id: c.credential_id, actor_id: token.user_id } }) })
    kq.push({ c, ok: !r.error, reason: r.error ? r.message : undefined })
  }
  const okC = kq.filter((x) => x.ok), loiC = kq.filter((x) => !x.ok)
  const nhan = okC.map((x) => x.c.display).join(', ')
  const nhanLoi = loiC.map((x) => `${x.c.display}: ${x.reason ?? 'không rõ lỗi'}`).join('; ')
  const tom = okC.length && !loiC.length ? { ok: true, message: `Đã xóa ${okC.length} thẻ${nhan ? ` (${nhan})` : ''}` }
    : okC.length ? { ok: false, message: `PARTIAL — đã xóa ${okC.length} thẻ${nhan ? ` (${nhan})` : ''}; lỗi ${loiC.length} thẻ: ${nhanLoi}` }
      : { ok: false, message: `Không xóa được thẻ nào: ${nhanLoi || 'không rõ lỗi'}` }
  const daXoa = new Set(okC.map((x) => x.c.credential_id))
  const patch = daXoa.size ? { card_data: the.filter((c) => !daXoa.has(c.credential_id)) } : undefined
  return { ok: tom.ok, message: tom.message, targets: [...kq.map((x) => ({ ...dich(x.c), ok: x.ok, message: x.ok ? 'Đã xóa' : x.reason ?? 'không rõ lỗi' })), ...thieu], ...(patch ? { patch } : {}) }
}

// Đặt thẻ mặc định (c, 1128:7939-8001): thẻ đầu tiên có 4 số cuối khớp → đặt làm thẻ chính; không thẻ nào khớp = bỏ qua (không phải lỗi).
async function setDefaultCard({ id, values = {}, cardData = [] }) {
  const cred = String(values.credentialId ?? '')
  const duoi = cred ? '' : (String(values.cardSuffix ?? '').match(/\d{4}/)?.[0] ?? '')
  if (!cred && !duoi) return { ok: false, message: 'Vui lòng nhập 4 số cuối thẻ cần đặt mặc định' }
  const acc = boAct(id)
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản quảng cáo' }
  const ds = await layThe(acc, 'cuoi')
  const the = ds.length ? ds : cardData
  const c = the.find((x) => x.credential_id && x.credential_id !== 'Unknown' && (cred ? x.credential_id === cred : String(x.display).endsWith(duoi)))
  if (!c) return cred ? { ok: false, message: 'Không tìm thấy thẻ này trên tài khoản — có thể thẻ đã bị xoá' } : { ok: true, skipped: true, message: `Không tìm thấy thẻ khớp 4 số cuối ${duoi}` }
  const token = await getAdsToken()
  const r = await goiGraphql('www', { doc_id: '24268156329457050',
    variables: JSON.stringify({ input: { billable_account_payment_legacy_account_id: acc, primary_funding_id: c.credential_id, actor_id: token.user_id, client_mutation_id: String(Math.floor(30 * Math.random()) + 1) } }) })
  if (r.error) return { ok: false, message: r.message }
  const i = cardData.findIndex((x) => x.credential_id === c.credential_id)
  return { ok: true, message: `Đã set thẻ mặc định ${c.display}`, ...(i > 0 ? { patch: { card_data: [cardData[i], ...cardData.filter((_, j) => j !== i)] } } : {}) }
}

// Thanh toán dư nợ (v + b, 1128:7097-7439). Trang chỉ gọi khi dòng đang "Cần thanh toán" (status 3).
// Màn Billing Hub "Thanh toán ngay" → xem lại thẻ → gửi lệnh trả (tối đa 3 lần; Facebook đòi 3DS thì mở trang 3DS rồi gửi lại).
// Thử lần lượt từng thẻ (thẻ chính trước), dừng ở thẻ đầu tiên trả được.
const bon = (x) => { const d = String(x ?? '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : d } // f
const maNgau = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
const b64 = (s) => { let n = ''; for (const c of new TextEncoder().encode(s)) n += String.fromCharCode(c); return btoa(n) }
async function manNo(acc) { // BillingPayNowLandingScreenQuery
  const r = await goiGraphql('business', { fb_api_req_friendly_name: 'BillingPayNowLandingScreenQuery', doc_id: '27042179815412290', variables: JSON.stringify({ intent: 'PAY_NOW', paymentAccountID: acc }) })
  if (r.error) return { ok: false, message: r.message }
  const B = r.data?.payment_account?.billable_account
  if (!B) return { ok: false, message: 'Landing không trả billable_account' }
  const bal = B.account_balance_with_offset ?? B.account_balance
  const amount = String(bal?.amount ?? '').trim()
  const so = Number(amount)
  if (!amount || !(Number.isFinite(so) && so > 0)) return { ok: true, skipped: true, message: 'Không có dư nợ cần trả' }
  const key = String(B.selected_payment_card_key ?? B.selected_payment_method_key ?? '')
  const m = new Map()
  for (const x of [...(Array.isArray(B.payment_methods) ? B.payment_methods : B.payment_methods?.data || []), ...(B.all_payment_methods?.pm_credit_card?.data || [])]) {
    const raw = x?.credential_id ?? x?.id
    if (raw == null || raw === '') continue
    const id = String(raw)
    m.set(id, { credentialId: id, credentialType: String(x.credential_type ?? x.type ?? 'CREDIT_CARD').toUpperCase(), display: String(x.display_string ?? x.display ?? id), isPrimary: key !== '' && id === key })
  }
  if (key && !m.has(key)) m.set(key, { credentialId: key, credentialType: 'CREDIT_CARD', display: key, isPrimary: true })
  const cards = [...m.values()].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
  if (!cards.length) return { ok: false, message: 'Không có thẻ thanh toán hiển thị' }
  return { amount, amountWithOffset: String(bal?.amount_with_offset ?? amount).trim() || amount, currency: String(bal?.currency ?? '').trim().toUpperCase() || 'USD', cards }
}
function tim3ds(t) { // tìm sâu: chuỗi external_uri / external_url / url trỏ trang /payments/3ds_ của facebook.com
  if (!t || typeof t !== 'object') return null
  const n = t.external_uri ?? t.external_url ?? t.url
  if (typeof n === 'string') {
    try { const u = new URL(n, 'https://business.facebook.com'); if (/(^|\.)facebook\.com$/i.test(u.hostname) && u.pathname.includes('/payments/3ds_')) return n } catch { /* không phải đường dẫn */ }
  }
  for (const v of Object.values(t)) {
    if (Array.isArray(v)) { for (const x of v) { const u = tim3ds(x); if (u) return u } } else if (v && typeof v === 'object') { const u = tim3ds(v); if (u) return u }
  }
  return null
}
async function traBangThe(acc, actor, ln, the, truocKhiTra) {
  const ten = bon(the.display) || the.display
  const xem = await goiGraphql('business', { fb_api_req_friendly_name: 'BillingReviewPaymentScreenQuery', doc_id: '25448543034774360',
    variables: JSON.stringify({ creditCardID: the.credentialId, paymentAccountID: acc, sharedStoredBalanceID: '' }) })
  if (xem.error) return { ok: false, message: `Review thẻ ${ten} thất bại: ${xem.message ?? 'không rõ lỗi'}` }
  await truocKhiTra()
  for (let lan = 0; lan <= 2; lan += 1) {
    const U = `upl_${Math.floor(Date.now() / 1000)}_${maNgau()}`, W = `rd_${Date.now()}_${maNgau()}`
    const T = b64(JSON.stringify({ payload: b64(JSON.stringify({ data: { amount: String(ln.amountWithOffset), cred_id: String(the.credentialId), currency: ln.currency }, nonce: maNgau(), op: 'CHARGE', ver: 1 })), signatures: [] }))
    const r = await goiGraphql('business', { fb_api_req_friendly_name: 'BillingPayNowOrSettleStatePayNowMutation', doc_id: '24676694655347193',
      variables: JSON.stringify({ input: {
        billable_account_payment_legacy_account_id: acc, credential_id: the.credentialId, payment_amount: { amount: ln.amount, currency: ln.currency },
        transaction_initiation_source: 'CUSTOMER',
        upl_logging_data: { billing_notification_id: '', context: 'billingpaynow', credential_id: the.credentialId, credential_type: the.credentialType || 'CREDIT_CARD', entry_point: 'BILLING_HUB',
          external_flow_id: U, target_name: 'BillingPayNowOrSettleStatePayNowMutation', user_session_id: U, wizard_config_name: 'PAY_NOW_BILLING_HUB', wizard_name: 'PAY_NOW',
          wizard_screen_name: 'pay_now_review_state_display', wizard_session_id: W },
        platform_trust_token: T, actor_id: actor, client_mutation_id: String(Date.now()),
      } }) })
    if (r.error) return { ok: false, message: r.message }
    const url = tim3ds(r)
    if (!url) {
      const t = JSON.stringify(r).toLowerCase()
      return t.includes('billable_account') || t.includes('payment_account')
        ? { ok: true, message: `Đã thanh toán dư nợ ${ln.amount} ${ln.currency} bằng thẻ ${ten}` }
        : { ok: false, message: 'GraphQL không xác nhận được thanh toán dư nợ' }
    }
    if (lan >= 2) break
    try { await fetch(url, { method: 'GET', credentials: 'include', headers: { 'cache-control': 'no-store' } }) } catch (e) {
      return { ok: false, message: `Không xử lý được xác minh 3DS: ${e?.message || 'không rõ lỗi'}` }
    }
  }
  return { ok: false, message: 'Chưa hoàn tất xác minh 3DS' }
}
async function lamMoiSoDu(acc) { // đọc lại trạng thái / số dư / ngưỡng sau khi trả (1128:7097-7118), theo khuôn dòng của mapAccount
  const r = await graphJB(`act_${acc}`, { fields: 'account_id,account_status,currency,balance,adspaymentcycle{threshold_amount},is_prepay_account,total_prepay_balance' })
  if (r.error) return undefined
  const tpb = r.total_prepay_balance
  return {
    account_status: r.account_status ?? 0, balance: r.balance ?? null, threshold: r.adspaymentcycle?.data?.[0]?.threshold_amount ?? null,
    is_prepay_account: typeof r.is_prepay_account === 'boolean' ? r.is_prepay_account : null,
    prepay_balance: tpb?.amount_in_hundredths != null && tpb.amount_in_hundredths !== '' ? Number(tpb.amount_in_hundredths) / 100 : (tpb?.amount != null ? Number(String(tpb.amount).replace(/,/g, '')) : null),
  }
}
async function payDebt({ id, values = {} }) {
  const acc = boAct(id)
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản' }
  const s = typeof values.cardLast4 === 'string' ? values.cardLast4.trim() : ''
  let bonSo = ''
  if (s) { const d = s.replace(/\D/g, ''); if (!/^\d{4}$/.test(d)) return { ok: false, message: '4 số cuối thẻ phải gồm đúng 4 chữ số' }; bonSo = d }
  const ln = await manNo(acc)
  if ('ok' in ln) return ln
  const cards = bonSo ? ln.cards.filter((c) => bon(c.display) === bonSo || bon(c.credentialId) === bonSo) : ln.cards
  if (!cards.length) return { ok: false, message: `Không tìm thấy thẻ có 4 số cuối ${bonSo}` }
  const token = await getAdsToken()
  const loi = []
  let daNghi = false
  for (const the of cards) {
    const r = await traBangThe(acc, token.user_id, ln, the, async () => { if (daNghi) await ngu(1000 + Math.floor(2001 * Math.random())); daNghi = true })
    if (r.ok) { const p = await lamMoiSoDu(acc).catch(() => undefined); return p ? { ...r, patch: p } : r }
    loi.push(`${bon(the.display) || the.display}: ${r.message}`)
  }
  return { ok: false, message: `Thanh toán dư nợ thất bại với ${bonSo ? `thẻ ${bonSo}` : `${cards.length} thẻ`}: ${loi.join(' | ')}` }
}

// ── Tạo chiến dịch bằng file XLSX (eI, 1128:4307-4714) — vòng tạo + nghỉ chạy ở TRANG như SMIT (runner ở trang, tiện ích là
// đường gửi); ở đây chỉ hai việc ngắn để không vướng giới hạn 5 phút của service worker:
//   phase "check":  er (hỏi tiền tệ/trạng thái nếu trang không có) → trạng thái {1,8,9} → kiểm tài sản ed/em/ev/ek.
//   phase "create": một lệnh POST /act_{id}/{campaigns|adsets|adcreatives|ads} (eg). Graph v18.0.
async function jbGoi(path, { version = 'v24.0', method = 'GET', params = {}, body } = {}) { // JB 1927:1760-1844
  const chay = async (token) => {
    let url
    if (path.startsWith('https')) {
      const u = new URL(path)
      for (const k of ['access_token', 'format', 'pretty', 'suppress_http_code', 'locale']) u.searchParams.delete(k)
      for (const [k, v] of Object.entries({ access_token: token.access_token, format: 'json', pretty: '0', suppress_http_code: '1', locale: 'en_US' })) u.searchParams.set(k, v)
      url = u.toString()
    } else url = `https://graph.facebook.com/${version}${path}?${new URLSearchParams({ ...params, access_token: token.access_token, format: 'json', pretty: '0', suppress_http_code: '1', locale: 'en_US' })}`
    const init = { method, credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' } }
    if (method !== 'GET' && body) init.body = Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    const res = await fetch(url, init)
    let j
    try { j = await res.json() } catch { return { error: true, message: 'Phản hồi Graph không hợp lệ' } }
    if (j?.error) return { error: true, message: j.error.message || j.error.error_user_msg || j.error.error_user_title || 'Graph error', code: j.error.code }
    return j
  }
  const r = await chay(await getAdsToken())
  return loiPhien(r) ? chay(await getAdsToken(true)) : r
}
class LoiKiemTaiSan extends Error {} // ei
async function docHet(path, params) { // es: đọc hết các trang (paging.next)
  const out = []
  let a = path
  while (a) {
    const r = await jbGoi(a, { version: 'v18.0', ...(a.startsWith('https') ? {} : { params }) })
    if (r.error) throw new LoiKiemTaiSan(r.message)
    out.push(...(r.data ?? []))
    a = r.paging?.next
  }
  return out
}
const TRUONG_PAGE = 'id,is_published,is_promotable' // el
const TRUONG_BM = `owned_pages.limit(100){${TRUONG_PAGE}},client_pages.limit(100){${TRUONG_PAGE}}` // eu
async function taiSanTK(acc, hashes) { // ed
  const fields = ['adspixels.limit(100){id}', ...(hashes.length ? [`adimages.hashes(${JSON.stringify(hashes)}){hash}`] : []), `owner_business{id,${TRUONG_BM}}`, `agencies.limit(50){id,${TRUONG_BM}}`].join(',')
  const a = await jbGoi(`/act_${acc}`, { version: 'v18.0', params: { fields } })
  if (a.error) throw new LoiKiemTaiSan(a.message)
  const pixels = new Set(a.adspixels?.paging?.next ? (await docHet(`/act_${acc}/adspixels`, { fields: 'id', limit: 100 })).map((x) => x.id ?? '') : (a.adspixels?.data ?? []).map((x) => x.id ?? ''))
  pixels.delete('')
  const images = new Set((a.adimages?.data ?? []).map((x) => x.hash ?? '').filter(Boolean))
  const pages = []
  for (const b of [a.owner_business, ...(a.agencies?.data ?? [])].filter((x) => !!x?.id)) {
    for (const k of ['owned_pages', 'client_pages']) pages.push(...(b[k]?.paging?.next ? await docHet(`/${b.id}/${k}`, { fields: TRUONG_PAGE, limit: 100 }) : b[k]?.data ?? []))
  }
  return { pixels, images, businessPages: pages }
}
async function kiemPage(bmPages, canDs) { // ev + em
  const can = new Set(canDs)
  if (!can.size) return []
  const biet = new Set(), chuaXB = new Set()
  const ghi = (p) => { if (!p.id) return; biet.add(p.id); if (can.has(p.id) && (p.is_published === false || p.is_promotable === false)) chuaXB.add(p.id) }
  for (const p of bmPages) ghi(p)
  let thieu = [...can].filter((x) => !biet.has(x))
  let chac = true
  if (thieu.length) {
    try { for (const p of await docHet('/me/accounts', { fields: 'id,tasks,is_published,is_promotable', limit: 100 })) if (p.tasks?.some((t) => t === 'ADVERTISE' || t.endsWith('_ADVERTISE'))) ghi(p) } catch { chac = false }
    if (chac) thieu = thieu.filter((x) => !biet.has(x))
  }
  const ra = [...chuaXB].map((p) => `Page ${p} chưa sẵn sàng chạy quảng cáo (chưa xuất bản, hoặc đang bị hạn chế quảng cáo) — Facebook sẽ nhận quảng cáo rồi từ chối phân phối. Vào cài đặt page bật xuất bản và gỡ hạn chế, hoặc sửa cột "Link Object ID" và "Story ID" sang page khác.`)
  if (!thieu.length) return ra
  if (!chac) throw new LoiKiemTaiSan('page-routes-incomplete')
  return [...ra, ...thieu.map((p) => `Page ${p} không dùng được: Via đang chạy không có quyền quảng cáo (ADVERTISE) trên page, và BM của TKQC cũng không sở hữu page này — cấp quyền ADVERTISE cho Via, gắn page vào BM của TKQC, hoặc sửa cột "Link Object ID" và "Story ID" sang page dùng được.`)]
}
async function kiemAnhVideo(images, anhDs, videoDs) { // ek — anhDs = [[mã đã bỏ tiền tố, mã gốc], …]
  const ra = []
  for (const [h, goc] of anhDs) if (!images.has(h)) ra.push(`Ảnh ${goc} không thuộc TKQC này — mã ảnh chỉ dùng được ở TKQC đã tải nó lên. Tải lại ảnh vào TKQC này rồi thay cột "Image Hash", hoặc xoá cột "Image Hash" để dùng ảnh mặc định của bài viết.`)
  for (const v of videoDs) {
    const r = await jbGoi(`/${v}`, { version: 'v18.0', params: { fields: 'id' } })
    if (r.error) throw new LoiKiemTaiSan(`video ${v}: ${r.message}`)
    if (!r.id) ra.push(`Video ${v} không dùng được với Via đang chạy — cấp quyền cho Via trên page/TKQC chứa video, hoặc sửa cột "Video ID" sang video khác.`)
  }
  return ra
}
const LOAI_TAO = new Set(['campaigns', 'adsets', 'adcreatives', 'ads'])
async function importXlsx(q) {
  const acc = boAct(q.id)
  if (!acc) return { ok: false, message: 'Thiếu ID tài khoản quảng cáo' }
  if (q.phase === 'create') { // eg
    if (!LOAI_TAO.has(q.kind)) return { ok: false, message: `Lệnh tạo không hợp lệ: ${q.kind}` }
    const path = `/act_${acc}/${q.kind}`
    const n = await jbGoi(path, { version: 'v18.0', method: 'POST', body: q.body || {} })
    if (n.error) return { ok: false, message: n.message }
    if (!n.id) return { ok: false, message: `Graph không trả id cho ${path}: ${JSON.stringify(n)}` }
    return { ok: true, id: n.id }
  }
  if (q.phase !== 'check') return { ok: false, message: `Bước không hợp lệ: ${q.phase}` }
  let cur = q.currency, st = q.status
  if (!cur) { // er
    const r = await jbGoi(`/act_${acc}`, { version: 'v18.0', params: { fields: 'currency,account_status' } })
    if (r.error) throw new Error(r.message)
    cur = r.currency || 'USD'; st = r.account_status ?? 0
  }
  if (![1, 8, 9].includes(st)) return { ok: false, message: `TKQC đang ở trạng thái ${st} nên Facebook không cho chạy quảng cáo (chỉ chạy được khi trạng thái là 1, 8 hoặc 9). Chưa tạo gì cả — kháng nghị TKQC hoặc chọn TKQC khác rồi chạy lại.` }
  const hong = [], khongKiem = []
  const anh = Array.isArray(q.images) ? q.images : []
  let m = { pixels: new Set(), images: new Set(), businessPages: [] }
  try { m = await taiSanTK(acc, anh.map(([h]) => h)) } catch (e) { if (!(e instanceof LoiKiemTaiSan)) throw e; khongKiem.push(e.message) }
  if (!khongKiem.length) {
    hong.push(...(q.pixels || []).filter((p) => !m.pixels.has(p)).map((p) => `Pixel ${p} chưa được chia sẻ cho TKQC này — chia sẻ pixel cho TKQC trong BM, hoặc xoá cột "Optimized Conversion Tracking Pixels" và "Optimized Event" rồi đổi "Optimization Goal" OFFSITE_CONVERSIONS sang mục tiêu khác (vd LINK_CLICKS).`))
    for (const kiem of [() => kiemPage(m.businessPages, q.pages || []), () => kiemAnhVideo(m.images, anh, q.videos || [])]) {
      try { hong.push(...(await kiem())) } catch (e) { if (!(e instanceof LoiKiemTaiSan)) throw e; khongKiem.push(e.message) }
    }
  }
  if (!hong.length && khongKiem.length) return { ok: false, message: `Chưa kiểm được quyền dùng page/video nên không tạo gì cả (${khongKiem.join('; ')}). Thường do token thiếu quyền đọc trang hoặc video. Chạy lại bằng Via có quyền với các tài sản đó, hoặc sửa file XLSX cho khớp.` }
  if (hong.length) return { ok: false, message: `TKQC này không dùng được một số tài sản trong file nên chưa tạo gì cả. Sửa file XLSX rồi chạy lại:\n${hong.join('\n')}` }
  return { ok: true, currency: cur }
}

// ── Lên Camp Boost Post (1128 runner e0 + 3732 oM đăng bài) — runner chạy ở TRANG như SMIT; tiện ích chỉ là đường gửi ─────────────
// GraphQL theo UG friendlyNameInRequest + relayFields (1927:1846-1925): URL ?fb_api_req_friendly_name, đầu x-fb-friendly-name,
// thân locale · __a · tên · RelayModern · doc_id · variables · fb_dtsg · lsd · __comet_req · jazoest · (av, __user cho G1-G4).
// Chỉ nhận đúng 8 truy vấn đã chép (bảng dưới) — trang không gửi được doc_id khác.
const BOOST_GQL = {
  objectiveSpec: ['useLWICometObjectiveSpecListQuery', '28283176124712575', true],
  budgetSlider: ['LWICometBudgetSliderEditorQuery', '28765281086465766', true],
  locationMeta: ['lwiCometFetchLocationMetaQuery', '9716123845173867', true],
  create: ['LWICometCreateBoostedComponentMutation', '9955578997835249', true],
  locationSearch: ['useLWICometLocationDataSourceQuery', '9978491788870764', false],
  targetingSearch: ['useLWICometDetailedTargetingSearchSuggestionsDataSourceQuery', '9723665934418669', false],
  targetingRoot: ['LWICometBrowseDetailedTargetingTabsRootQuery', '9985674161496482', false],
  targetingTab: ['LWICometBrowseDetailedTargetingBaseTabQuery', '9680794761958016', false],
}
const jazoest = (s) => { let t = 0; for (let n = 0; n < s.length; n++) t += s.charCodeAt(n); return `2${t}` } // p
async function gqlTen(ten, docId, variables, coActor) {
  const chay = async (token) => {
    if (!token.fb_dtsg || !token.lsd) return { error: true, message: 'Token policy không trả session GraphQL' }
    const goi = async (h) => {
      const f = { locale: 'en_US', __a: '1', fb_api_req_friendly_name: ten, fb_api_caller_class: 'RelayModern', doc_id: docId, variables: JSON.stringify(variables),
        fb_dtsg: token.fb_dtsg, lsd: token.lsd, __comet_req: '1', jazoest: jazoest(token.fb_dtsg), ...(coActor && token.user_id ? { av: token.user_id, __user: token.user_id } : {}) }
      const res = await fetch(`https://${h}.facebook.com/api/graphql/?${new URLSearchParams({ fb_api_req_friendly_name: ten })}`, { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-asbd-id': '1', 'x-fb-friendly-name': ten }, body: new URLSearchParams(f).toString() })
      return docGraphql(await res.text())
    }
    let r = await goi('www')
    if (r.error && r.code === 1675002) r = await goi('business') // www đăng xuất ⇒ gọi qua business như SMIT
    return r
  }
  const r = await chay(await getAdsToken())
  return loiPhien(r) ? chay(await getAdsToken(true)) : r
}
async function boostGql({ key, variables }) {
  const q = BOOST_GQL[key]
  if (!q) return { ok: false, message: `Truy vấn không hợp lệ: ${key}` }
  const r = await gqlTen(q[0], q[1], variables || {}, q[2])
  return r.error ? { ok: false, message: r.message || 'GraphQL error' } : { ok: true, data: r.data }
}
async function boostSession() { // em(): phiên Facebook hiện tại (user id dùng cho av/__user + actor_id)
  const t = await getAdsToken()
  return t.user_id ? { ok: true, userId: t.user_id } : { ok: false, message: 'Không lấy được phiên Facebook để tạo Boost Post' }
}
// 22646 u: đọc hết trang Graph; trang sau phải ở graph.facebook.com (bỏ access_token để JB gắn lại); lặp vòng ⇒ dừng.
const trangGraphHopLe = (s) => { const u = new URL(s); if (u.protocol !== 'https:' || u.hostname !== 'graph.facebook.com') throw new Error('seed-camp-invalid-pagination-origin'); return u }
async function docTrangGraph(path, params) {
  const out = [], da = new Set()
  let a = path, dau = true
  while (a) {
    if (da.has(a)) throw new Error('seed-camp-pagination-cycle')
    da.add(a)
    const r = await jbGoi(a, dau ? { params } : {})
    if (r.error) throw new Error(r.message)
    out.push(...(r.data ?? []))
    a = r.paging?.next ? (() => { const u = trangGraphHopLe(r.paging.next); u.searchParams.delete('access_token'); return u.toString() })() : undefined
    dau = false
  }
  return out
}
async function boostMePages() { // eT: Via + Page của Via (lọc ở trang)
  const e = await jbGoi('/me', { params: { fields: 'id,name' } })
  if (e.error) return { ok: false, message: e.message }
  if (!e.id) return { ok: false, message: 'Facebook did not return the current Via ID' }
  const pages = await docTrangGraph('/me/accounts', { fields: 'id,name,is_published,is_promotable,tasks,roles{id,tasks}', limit: 40, type: 'page' })
  return { ok: true, via: { id: e.id, name: e.name ?? e.id }, pages }
}
// VIA của trình duyệt này (500:343-363 v()): Graph /me id,name,picture.width(100){url} bằng mã đọc — tab VIA (≥ 3.12.33).
async function viaMe() {
  const e = await jbGoi('/me', { params: { fields: 'id,name,picture.width(100){url}' } })
  if (e.error) return { ok: false, message: e.message }
  if (!e.id) return { ok: false, message: 'Không lấy được thông tin VIA từ Facebook.' }
  return { ok: true, profile: { id: String(e.id), name: e.name ?? '', avatar: e.picture?.data?.url ?? '' } }
}
async function boostCurrency({ id }) { // oE
  if (!/^act_\d+$/.test(String(id ?? ''))) return { ok: false, message: 'Thiếu ID tài khoản quảng cáo' }
  const t = await jbGoi(`/${id}`, { params: { fields: 'currency,account_currency_ratio_to_usd' } })
  if (t.error) return { ok: false, message: t.message }
  if (!t.currency) return { ok: false, message: 'Facebook did not return the ad account currency' }
  return { ok: true, currency: t.currency, ratio: t.account_currency_ratio_to_usd }
}
const TRUONG_BAI = 'call_to_action,message,is_eligible_for_promotion,promotable_id,attachments.limit(10){description,description_tags,media,media_type,target,title,type,subattachments,unshimmed_url,url},likes.summary(total_count),shares,comments.summary(total_count).limit(0)'
async function boostPagePosts({ pageId }) { // o5: mã Page → đọc hết bài (100/trang) bằng mã Page
  if (!/^\d+$/.test(String(pageId ?? ''))) return { ok: false, message: 'Page ID không hợp lệ' }
  const n = await jbGoi(`/${pageId}`, { params: { fields: 'access_token' } })
  if (n.error) return { ok: false, message: n.message }
  if (!n.access_token) return { ok: false, message: 'Facebook did not return the Page access token' }
  const out = [], da = new Set()
  let c = `https://graph.facebook.com/v24.0/${pageId}/posts?${new URLSearchParams({ fields: TRUONG_BAI, limit: '100', access_token: n.access_token, suppress_http_code: '1' })}`
  while (c) {
    if (da.has(c)) throw new Error('seed-camp-pagination-cycle')
    da.add(c)
    const e = JSON.parse(await (await fetch(c, { credentials: 'include' })).text())
    if (e.error) return { ok: false, message: e.error.message ?? 'Facebook could not load Page Posts' }
    out.push(...(e.data ?? []))
    c = e.paging?.next ? (() => { const u = trangGraphHopLe(e.paging.next); u.searchParams.set('access_token', n.access_token); return u.toString() })() : undefined
  }
  return { ok: true, posts: out }
}
// oM (3732:10795-10895): mã Page (access_token rồi additional_profile_id,access_token) → có ảnh: POST /photos (ảnh + caption);
// chỉ chữ: POST /feed message. Mất mạng / 502-504 ⇒ "không xác định" (bài có thể đã lên). Tên phần ảnh "source" theo Graph API
// (SMIT dựng multipart trong tiện ích SMIT Connect, mã không có trong bản đọc).
async function boostPublish({ pageId, text = '', image }) {
  if (!/^\d+$/.test(String(pageId ?? ''))) return { ok: false, message: 'Page ID không hợp lệ' }
  let tok = null, loi = null
  for (const f of ['access_token', 'additional_profile_id,access_token']) {
    const l = await jbGoi(`/${pageId}`, { params: { fields: f } })
    if (!l.error && l.access_token) { tok = l.access_token; break }
    if (l.error) loi ??= l.message
  }
  if (!tok) return loi ? { ok: false, message: loi } : { ok: false, tokenMissing: true }
  const dc = (p, t) => `https://graph.facebook.com/v24.0${p}?${new URLSearchParams({ ...t, suppress_http_code: '1', format: 'json' })}` // o_
  let raw
  try {
    if (image) {
      const bin = Uint8Array.from(atob(String(image.fileBase64 || '')), (x) => x.charCodeAt(0))
      const fd = new FormData()
      fd.append('source', new Blob([bin], { type: image.fileType }), image.fileType === 'image/png' ? 'image.png' : 'image.jpg')
      const res = await fetch(dc(`/${pageId}/photos`, { access_token: tok, caption: text, published: 'true' }), { method: 'POST', credentials: 'include', body: fd })
      if ([502, 503, 504].includes(res.status)) return { ok: false, unverified: true, detail: `HTTP ${res.status}` }
      raw = await res.text()
    } else {
      const res = await fetch(dc(`/${pageId}/feed`, { access_token: tok }), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ message: text, published: 'true' }).toString() })
      raw = await res.text()
    }
  } catch (e) { return { ok: false, unverified: true, detail: String(e?.message || e) } }
  let l = null
  try { l = JSON.parse(String(raw).replace(/^for \(;;\);/, '')) } catch { l = null } // oE
  const t = l && l.error
  if (t) return { ok: false, message: t.message || t.error_user_msg || t.error_user_title || 'Facebook error' }
  const r = image ? l?.post_id : l?.id
  return r ? { ok: true, postId: r } : { ok: false, noId: true }
}

// Mở trang thanh toán Facebook ở tab nền (lite:651-662 chrome.tabs.create active:false) — chỉ nhận đường dẫn facebook.com.
async function openTab({ url }) {
  let u
  try { u = new URL(String(url)) } catch { return { ok: false, message: 'Đường dẫn không hợp lệ' } }
  if (u.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(u.hostname)) return { ok: false, message: 'Chỉ mở được trang facebook.com' }
  await chrome.tabs.create({ url: u.toString(), active: false })
  return { ok: true }
}

// Một cửa cho các công cụ mới (trang gọi FB_TOOL { fn, payload }) — đỡ phải thêm lệnh riêng cho từng công cụ.
const CONG_CU = { 'check-hold': checkHold, 'check-location-verification': checkLocation, 'download-invoices': openInvoices,
  'activate-prepay': activatePrepay, 'delete-card': deleteCard, 'set-default-card': setDefaultCard, 'pay-debt': payDebt, 'open-tab': openTab,
  'import-campaign-xlsx': importXlsx, 'boost-gql': boostGql, 'boost-session': boostSession, 'boost-me-pages': boostMePages,
  'boost-currency': boostCurrency, 'boost-page-posts': boostPagePosts, 'boost-publish': boostPublish, 'via-me': viaMe }
async function runTool(fn, payload) {
  const f = CONG_CU[fn]
  if (!f) return { ok: false, message: `Tiện ích chưa có chức năng ${fn} — cập nhật VAESA Extension` }
  try { return await f(payload || {}) } catch (e) { return { ok: false, message: String(e?.message || e) } }
}

self.vaesaSmit = { changeInfo, fetchAdAccounts, fetchNoRoleAccounts, fetchHiddenLimit, fetchSpend, openCloseAccount, spendLimit, renameAccount, runTool }
})()
