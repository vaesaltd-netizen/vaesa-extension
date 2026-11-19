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
    // 1) TKQC cá nhân của user.
    const me = await graphGet('me/adaccounts', { fields, limit: PAGE_LIMIT }, token.access_token)
    // 2) Danh sách BM user có vai trò → owned + client ad accounts.
    const bizRes = await graphGet('me/businesses', { fields: 'id,name', limit: '500' }, token.access_token)
    const bizs = bizRes.data || []
    const byId = new Map()
    for (const a of me.data || []) byId.set(a.account_id || a.id, a)
    for (const b of bizs) {
      for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
        try {
          const r = await graphGet(`${b.id}/${edge}`, { fields, limit: PAGE_LIMIT }, token.access_token)
          for (const a of r.data || []) {
            const k = a.account_id || a.id
            if (!byId.has(k)) byId.set(k, { ...a, __bm: { id: b.id, name: b.name } })
          }
        } catch (e) { /* BM lẻ lỗi quyền — bỏ qua, không chặn cả danh sách */ }
      }
    }
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

self.vaesaSmit = { fetchAdAccounts, fetchHiddenLimit, fetchSpend }
})()
