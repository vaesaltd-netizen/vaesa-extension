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
  let url = `${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: accessToken }).toString()}`
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

// Map 1 TKQC thô → hàng cho bảng (32 cột). Số tiền giữ NGUYÊN chuỗi Graph (đã theo đơn vị tiền tệ),
// web tự định dạng. account_status: 1 = Live, còn lại = Die.
function mapAccount(acc) {
  return {
    account_id: acc.account_id,
    id: acc.id || (acc.account_id ? `act_${acc.account_id}` : ''),
    name: acc.name || '',
    account_status: acc.account_status ?? 0,
    disable_reason: acc.disable_reason ?? 0,
    currency: acc.currency || '',
    balance: acc.balance ?? null,
    spend_cap: acc.spend_cap ?? null,
    amount_spent: acc.amount_spent ?? null,
    adtrust_dsl: acc.adtrust_dsl ?? null,
    threshold: acc.adspaymentcycle?.data?.[0]?.threshold_amount ?? acc.adspaymentcycle?.threshold_amount ?? null,
    next_bill_date: acc.next_bill_date || null,
    created_time: acc.created_time || null,
    timezone_name: acc.timezone_name || '',
    timezone_offset_hours_utc: acc.timezone_offset_hours_utc ?? null,
    business_country_code: acc.business_country_code || '',
    business_state: acc.business_state || '',
    business_zip: acc.business_zip || '',
    owner: acc.owner || '',
    owner_business_id: acc.owner_business?.id || '',
    owner_business_name: acc.owner_business?.name || '',
    agencies: (acc.agencies?.data || []).map((a) => ({ id: a.id, name: a.name })),
    admin_count: (acc.users?.data || []).filter((u) => (u.tasks || []).includes('MANAGE') || u.role === 1001).length,
    users_count: (acc.users?.data || []).length,
    campaigns: demChienDich(acc),
    is_prepay_account: acc.is_prepay_account ?? null,
    total_prepay_balance: acc.total_prepay_balance ?? null,
    funding: acc.funding_source_details?.display_string || '',
  }
}

// PUBLIC: lấy toàn bộ TKQC — của chính user + mọi BM user có quyền.
// Trả { accounts: [...], token: {user_id, user_name} }. Limit ẩn KHÔNG lấy ở đây (gọi riêng khi cần).
async function fetchAdAccounts({ payment = true } = {}) {
  let token = await getAdsToken()
  const fields = buildFields({ payment })
  const run = async () => {
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
  return {
    accounts: raw.map((a) => {
      const row = mapAccount(a)
      if (a.__bm && !row.owner_business_id) { row.owner_business_id = a.__bm.id; row.owner_business_name = a.__bm.name }
      return row
    }),
    token: { user_id: token.user_id, user_name: token.user_name },
  }
}

// PUBLIC: Limit ẩn (ngưỡng chi tiêu ẩn) cho 1 TKQC — lệnh GraphQL riêng, gọi lười.
async function fetchHiddenLimit(assetId, currency) {
  const token = await getAdsToken()
  const body = new URLSearchParams({
    doc_id: '6401661393282937',
    variables: JSON.stringify({ assetID: String(assetId) }),
    fb_dtsg: token.fb_dtsg || '',
    lsd: token.lsd || '',
    av: token.user_id || '0',
    __a: '1',
  })
  const res = await fetch('https://www.facebook.com/api/graphql/', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-FB-LSD': token.lsd || '' },
    body: body.toString(),
  })
  const text = (await res.text()).replace(/^for \(;;\);/, '')
  let json
  try { json = JSON.parse(text) } catch { throw new Error('Không đọc được Limit ẩn') }
  if (json.errors?.[0]?.code === 1675004) throw new Error('rate_limited') // SMIT: HiddenLimitRateLimitError
  const raw = json.data?.billable_account_by_asset_id?.formatted_dsl
  if (!raw) return null
  // Chuẩn hoá: bỏ ký tự không phải số; tiền không lẻ thì bỏ hết dấu phân cách.
  let n = raw.replace(/[^\d,.-]/g, '')
  if (!n) return null
  const cur = (currency || '').toUpperCase()
  if (ZERO_DECIMAL.has(cur)) n = n.replace(/[.,]/g, '')
  else if (n.includes(',') && n.includes('.')) {
    const dec = n.lastIndexOf(',') > n.lastIndexOf('.') ? ',' : '.'
    n = n.replaceAll(dec === ',' ? '.' : ',', '').replace(dec, '.')
  }
  return { raw, value: n }
}

self.vaesaSmit = { fetchAdAccounts, fetchHiddenLimit }
})()
