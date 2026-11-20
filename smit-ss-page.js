// Super Share — công cụ tab Page (chép SMIT). Dùng hàm chung self.vaesaSmitNoi (smit.js), đăng ký lệnh vào self.vaesaSmitThem.
// Nguồn: 1128.52251f38.js module 78305 (d/p/f/h 16456-16595, E/T/C/O/x/B 16688-16961, ey 17699-17730), 30191 (Thêm Page vào BM),
// 48951 b (Gỡ Page khỏi BM), 41217 (lời mời QTV), 1760 (xác minh 2 bước), 86425 o / 8967:18151 l (người dùng BM), 67386 (mã quyền).
// Vòng lặp từng UID / BM / người dùng, nghỉ ngẫu nhiên và hộp nhập mã OTP chạy ở TRANG (smitPageCongCu.js) như SMIT; mỗi lệnh dưới đây là MỘT
// yêu cầu lên Facebook. "actAsProfile" của SMIT Connect: như các lệnh danh tính Page sẵn có, danh tính do av/__user trong thân GraphQL quyết định.
;(() => {
const N = self.vaesaSmitNoi
if (!N) return
const { getAdsToken, goiGraphql, jbGoi, relayBm, bmBoc, docGraphql, loiPhien, jazoest, ngu } = N
const so = (x) => /^\d+$/.test(String(x ?? ''))
const coChuoi = (e, t) => { try { return JSON.stringify(e).includes(t) } catch { return false } } // kR 1927:1981
const nghiNgau = () => ngu(1000 + Math.floor(2001 * Math.random())) // NG 8967:478
const gqlNguoi = (form, them = {}, host = 'www') => goiGraphql(host, form, { them: relayBm(them) })

// UG friendlyNameInRequest (1927:1898-1913): tên truy vấn ở URL + header x-fb-friendly-name.
async function gqlTenUrl(host, form, them = {}) {
  const chay = async (t) => {
    const body = new URLSearchParams({ locale: 'en_US', __a: '1', ...form, fb_dtsg: t.fb_dtsg || '', lsd: t.lsd || '', ...relayBm(them)(t) })
    const res = await fetch(`https://${host}.facebook.com/api/graphql/?${new URLSearchParams({ fb_api_req_friendly_name: form.fb_api_req_friendly_name })}`, { method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-asbd-id': '1', 'x-fb-friendly-name': form.fb_api_req_friendly_name }, body: body.toString() })
    return docGraphql(await res.text())
  }
  const r = await chay(await getAdsToken())
  return loiPhien(r) ? chay(await getAdsToken(true)) : r
}
// Lỗi "challenge_type: reauth" của Facebook ⇒ encrypted_context (h/m: JSON trong message lỗi).
function docThachThuc(r) {
  if (!r?.error || !String(r.message || '').includes('challenge_type')) return null
  try { const e = JSON.parse(r.message); if (e.challenge_type === 'reauth' && typeof e.encrypted_context === 'string' && e.encrypted_context.length > 0) return e.encrypted_context } catch { /* như SMIT */ }
  return null
}

// ── Mã quyền Page (67386) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const QUYEN = [['CREATE_CONTENT', 'business', 'PROFILE_PLUS_CREATE_CONTENT', '556750461849806'], ['MODERATE', 'business', 'PROFILE_PLUS_MODERATE', '275298030109664'],
  ['MESSAGING', 'business', 'PROFILE_PLUS_MESSAGING', '696659004201852'], ['ADVERTISE', 'business', 'PROFILE_PLUS_ADVERTISE', '270956550540539'],
  ['ANALYZE', 'business', 'PROFILE_PLUS_ANALYZE', '794616964377599'], ['CREATIVE_MANAGEMENT', 'business', 'PROFILE_PLUS_CREATIVE_MANAGEMENT', '1370797498202499'],
  ['CREATOR_MANAGEMENT', 'business', 'PROFILE_PLUS_CREATOR_MANAGEMENT', '967977242754531'], ['FACEBOOK_ACCESS', 'businessAndFacebook', 'PROFILE_PLUS_FACEBOOK_ACCESS', '461340961883703'],
  ['MANAGE', 'full', 'PROFILE_PLUS_MANAGE', '2565488997052663'], ['FULL_CONTROL', 'full', 'PROFILE_PLUS_FULL_CONTROL', '290727579301631']].map(([key, group, rest, id]) => ({ key, group, rest, id }))
const THEO_KHOA = new Map(QUYEN.map((e) => [e.key, e]))
const THU_TU = QUYEN.map((e) => e.key)
const NHOM_BUS = QUYEN.filter((e) => e.group === 'business').map((e) => e.key)
const keoTheo = (ds) => (ds.includes('MANAGE') || ds.includes('FULL_CONTROL') ? new Set([...NHOM_BUS, 'FACEBOOK_ACCESS']) : ds.includes('FACEBOOK_ACCESS') ? new Set(NHOM_BUS) : new Set()) // c
const moRong = (ds) => { const t = new Set(ds); for (const n of keoTheo(ds)) t.add(n); if (t.has('FULL_CONTROL')) { t.add('MANAGE'); t.add('FULL_CONTROL') } return THU_TU.filter((e) => t.has(e)) } // p
const maRest = (ds) => { const t = moRong(ds).map((e) => THEO_KHOA.get(e).rest); return ds.includes('FACEBOOK_ACCESS') || ds.includes('MANAGE') || ds.includes('FULL_CONTROL') ? ['PROFILE_PLUS_REVENUE', ...t] : t } // yE
const maId = (ds) => moRong(ds).map((e) => THEO_KHOA.get(e).id) // km
const quyenHop = (x) => (Array.isArray(x) ? x.filter((e) => THEO_KHOA.has(e)) : [])

// ── Thêm QTV vào Page (d / p / f) ───────────────────────────────────────────────────────────────────────────────────────────────────
async function pageSsReauth({ profileId, password }) { // d(): ProfilePlusMarkReauthedMutation, av = tài khoản đang đăng nhập
  const tk = await getAdsToken()
  if (!tk.user_id) return { ok: false, message: 'chưa đăng nhập Facebook' }
  if (!so(profileId)) return { ok: false, message: 'thiếu profile id (NPE) của Page — tải lại danh sách Page rồi thử lại' }
  const r = await gqlNguoi({ fb_api_req_friendly_name: 'ProfilePlusMarkReauthedMutation', doc_id: '24066063156313418',
    variables: JSON.stringify({ input: { password: String(password ?? ''), actor_id: String(profileId), client_mutation_id: '1' } }) }, { av: tk.user_id, __user: tk.user_id })
  if (r.error) return { ok: false, message: r.message }
  return r.data?.admin_management_mark_reauthed?.reauth_is_successful !== true
    ? { ok: false, message: 'reauth thất bại — sai password, cần xác minh, hoặc trình duyệt đang ở chế độ Page (thoát về tài khoản cá nhân trên facebook.com rồi thử lại)' }
    : { ok: true, message: 'reauthed' }
}
async function pageSsMoiQtv({ profileId, uid, cmid, full = true }) { // p() + f(): mời QTV dưới danh tính Page; thách thức reauth ⇒ trả encryptedContext
  if (!so(profileId) || !so(uid)) return { ok: false, message: 'thiếu profile id (NPE) của Page — tải lại danh sách Page rồi thử lại' }
  const r = await gqlNguoi({ fb_api_req_friendly_name: 'ProfilePlusCoreAppAdminInviteMutation', doc_id: '26222265997429595',
    variables: JSON.stringify({ input: { additional_profile_id: String(profileId), admin_id: String(uid), grant_full_control: full !== false, actor_id: String(profileId), client_mutation_id: String(cmid ?? '2') }, scale: 1 }) },
  { av: String(profileId), __user: String(profileId) })
  if (!r.error && (r.data?.profile_plus_core_admin_invite?.is_invite_sent === true || coChuoi(r, 'is_invite_sent'))) return { ok: true, message: 'đã gửi lời mời' }
  const ctx = docThachThuc(r)
  if (ctx) return { ok: false, challenge: true, encryptedContext: ctx, message: r.message }
  return { ok: false, message: r.error ? r.message : 'không xác nhận được lời mời (is_invite_sent)' }
}

// ── Xác minh 2 bước (1760: o / l / u). actorId = av/__user (Page khi Thêm QTV, tài khoản khi Chấp nhận lời mời). ───────────────────────
async function pageSs2fa({ buoc, actorId, encryptedContext, method, maskedContactPoint, code }) {
  if (!so(actorId)) return { ok: false, message: 'không lấy được phương thức xác minh 2 bước' }
  const them = { av: String(actorId), __user: String(actorId) }
  if (buoc === 'cach') {
    const r = await gqlNguoi({ fb_api_req_friendly_name: 'TwoStepVerificationRootQuery', doc_id: '26677319665197312',
      variables: JSON.stringify({ doesRequireTwoFacData: true, encryptedContext, isLoginChallenges: false, isPreAuthentication: false }) }, them)
    if (r.error) return { ok: false, message: r.message }
    const m = r.data?.xfb_two_factor_login_default_method?.method
    if (!m?.method || !m?.method_representation) return { ok: false, message: 'không lấy được phương thức xác minh 2 bước' }
    if (m.method !== 'EMAIL') return { ok: false, message: 'chưa hỗ trợ phương thức xác minh này (chỉ hỗ trợ email)' }
    return { ok: true, method: m.method, maskedContactPoint: m.method_representation, message: 'method' }
  }
  if (buoc === 'gui') {
    const r = await gqlNguoi({ fb_api_req_friendly_name: 'useTwoStepVerificationSendCodeMutation', doc_id: '27297512486584094',
      variables: JSON.stringify({ encryptedContext, challenge: method, maskedContactPoint }) }, them)
    if (r.error) return { ok: false, message: r.message }
    return r.data?.xfb_two_step_verification_send_notification?.is_success === true || coChuoi(r, 'is_success') ? { ok: true, message: 'sent' } : { ok: false, message: 'gửi mã OTP thất bại' }
  }
  if (buoc === 'xac') {
    const r = await gqlNguoi({ fb_api_req_friendly_name: 'useTwoFactorLoginValidateCodeMutation', doc_id: '26264014419868193',
      variables: JSON.stringify({ code: { sensitive_string_value: String(code ?? '') }, method, flow: 'SECURED_ACTION', encryptedContext, maskedContactPoint, next_uri: null, shared_prefs_data: null, trust_this_device: null }) }, them)
    if (r.error) return { ok: false, message: r.message }
    return r.data?.xfb_two_factor_login_validate_code?.is_code_valid === true || coChuoi(r, 'is_code_valid') ? { ok: true, message: 'validated' } : { ok: false, message: 'mã OTP không đúng' }
  }
  return { ok: false, message: 'Bước xác minh không hợp lệ' }
}

// ── Lời mời QTV (41217) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function pageSsLoiMoiDs() { // u(): PageCometLaunchpointInvitesRootQuery
  const tk = await getAdsToken()
  if (!tk.user_id) return { ok: false, invites: [], message: 'chưa đăng nhập Facebook' }
  const r = await goiGraphql('www', { fb_api_req_friendly_name: 'PageCometLaunchpointInvitesRootQuery', doc_id: '7224925170868877', variables: JSON.stringify({ id: tk.user_id }), server_timestamps: 'true' })
  if (r.error) return { ok: false, invites: [], message: r.message }
  return { ok: true, userId: tk.user_id, invites: (r.data?.user?.profile_admin_invites ?? []).map((e) => {
    const p = e.target_profile_for_admin_invite?.delegate_page ?? e.profile_plus_admin_invite_target?.delegate_page
    return { inviteId: e.profile_admin_invite_id || e.id || '', pageId: p?.id || '', pageName: p?.name || '', inviterName: e.profile_admin_inviter?.name || '' }
  }).filter((e) => e.inviteId) }
}
async function pageSsLoiMoiTl({ inviteId, userId, accept }) { // c() + d(): ProfilePlusCometAcceptOrDeclineAdminInviteMutation
  const r = await gqlNguoi({ fb_api_req_friendly_name: 'ProfilePlusCometAcceptOrDeclineAdminInviteMutation', doc_id: '27979406878326879', server_timestamps: 'true',
    variables: JSON.stringify({ input: { actor_id: String(userId), client_mutation_id: '1', is_accept: !!accept, profile_admin_invite_id: String(inviteId), user_id: String(userId) }, scale: 1 }) },
  { av: String(userId), __user: String(userId) })
  if (!r.error && r.data?.accept_or_decline_profile_plus_admin_invite?.id === String(userId)) return { ok: true, message: accept ? 'đã chấp nhận' : 'đã từ chối' }
  const ctx = docThachThuc(r)
  if (ctx) return { ok: false, challenge: true, encryptedContext: ctx, message: r.message }
  return { ok: false, message: r.error ? r.message : 'không có data trả về' }
}

// ── Thêm Page vào BM (30191 u: Graph owned_pages ⇒ lỗi thì GraphQL BizKitSettingsClaimPageMutation) ──────────────────────────────────
async function pageSsVaoBm({ bmId, pageId }) {
  const u = await jbGoi(`/${bmId}/owned_pages`, { method: 'POST', version: 'v23.0', body: { page_id: pageId } })
  let ok
  if (u.error) {
    await nghiNgau()
    const n = await gqlTenUrl('business', { fb_api_req_friendly_name: 'BizKitSettingsClaimPageMutation', doc_id: '27720923774230959',
      variables: JSON.stringify({ businessID: bmId, pageID: pageId, claimingEntryPoint: 'BIZWEB_SETTINGS', igAuthCode: '', igOIDCToken: '', shouldRemoveDirectUsersBeforeClaiming: 'KEEP', selectedFBUserID: null, isMMAPageTransfer: false, qplJoinID: crypto.randomUUID() }) })
    const a = n.error ? { ok: false, message: n.message } : n.data?.business_settings_add_owned_page?.business_object_relationship_to_business !== 'OWNER' ? { ok: false, message: `${pageId}: không xác nhận được Page đã nhét` } : { ok: true }
    if (!a.ok) return { ok: false, message: `API 1: ${u.message} · API 2: ${a.message}` }
    ok = true
  } else ok = u.access_status === 'CONFIRMED' || u.success === true || !!u.id
  return ok ? { ok: true, message: `Đã nhét Page ${pageId} vào BM ${bmId}` } : { ok: false, message: `${pageId}: không xác nhận được Page đã nhét` }
}
// ── Gỡ Page khỏi BM (48951 b: BizKitSettingsRemovePageMutation @business) ──────────────────────────────────────────────────────────────
async function pageSsGoBm({ bmId, pageId }) {
  const n = String(pageId ?? '').trim()
  const r = await goiGraphql('business', { fb_api_req_friendly_name: 'BizKitSettingsRemovePageMutation', doc_id: '9410980655690803', variables: JSON.stringify({ businessID: bmId, pageID: n }) })
  return r.error ? { ok: false, message: `${n}: ${r.message}` } : { ok: true, message: `Đã xóa Page ${n}` }
}

// ── Đối tác Page (E / T / C, M: Graph trước, GraphQL dự phòng) ─────────────────────────────────────────────────────────────────────────
async function pageSsDoiTacThem({ pageId, ownerBm, partnerBm, tasks }) {
  const q = quyenHop(tasks)
  const r = await jbGoi(`/${pageId}/agencies`, { method: 'POST', version: 'v25.0', params: { __cppo: 1 }, body: { acting_brand_id: ownerBm, business: partnerBm, permitted_tasks: JSON.stringify(maRest(q)) } })
  let e
  if (r.error) e = r.code === 3989 ? { ok: false, final: true, message: 'Đối tác đang có toàn quyền (Mọi thứ) nên Facebook không cho hạ quyền. Hãy Gỡ đối tác rồi Thêm lại với quyền mới.' } : { ok: false, message: r.message }
  else e = r.success === true || r.id != null ? (r.requires_admin_approval === true ? { ok: true, message: 'Chờ admin khác của BM duyệt' } : { ok: true, message: 'success' }) : { ok: false, message: 'Graph không trả success/id' }
  if (e.ok || e.final) return e
  const tk = await getAdsToken()
  if (!tk.user_id) return { ok: false, message: `${e.message} · fallback bỏ qua (chưa đăng nhập)` }
  const s = await gqlNguoi({ fb_api_req_friendly_name: 'BizKitSettingsAddPartnerToAssetMutation', doc_id: '38674382165478809',
    variables: JSON.stringify({ businessID: ownerBm, assetID: pageId, surfaceParams: { entry_point: 'BIZWEB_SETTINGS_ASSETS_VIEW_DETAILS_HEADER', flow_source: 'BIZ_WEB', tab: 'PAGES' }, toBusinessID: partnerBm, taskIDs: maId(q), shouldFetchPartnerName: false, qplJoinID: null }) },
  { av: tk.user_id, __user: tk.user_id }, 'business')
  const l = s.error ? { ok: false, message: `GraphQL: ${s.message}` } : s.data?.business_settings_add_partner_to_asset_connection?.results?.result_type === 'SUCCESS' ? { ok: true, message: 'success (graphql)' } : { ok: false, message: 'GraphQL không trả result_type=SUCCESS' }
  return l.ok ? l : { ok: false, message: `Graph: ${e.message} · ${l.message}` }
}
async function pageSsDoiTacGo({ pageId, ownerBm, partnerBm }) { // C
  const a = await jbGoi(`/${pageId}/agencies`, { method: 'DELETE', version: 'v24.0', params: { method: 'delete', acting_brand_id: ownerBm, business: partnerBm } })
  return a.error ? { ok: false, message: a.message } : a.success === true ? { ok: true, message: 'success' } : { ok: false, message: 'Graph không trả success=true' }
}

// ── Chỉ định/Cập nhật quyền VIA (O / x / B, U: Graph trước, GraphQL dự phòng) ─────────────────────────────────────────────────────────
async function pageSsQuyenCap({ pageId, bmId, userId, tasks }) {
  const q = quyenHop(tasks)
  const c = await jbGoi(`/${pageId}/assigned_users`, { method: 'POST', params: { user: userId, business: bmId, tasks: JSON.stringify(maRest(q)) } })
  const g = c.error ? { ok: false, message: c.message } : c.success === true || c.id != null ? { ok: true, message: 'đã cấp quyền' } : { ok: false, message: 'Graph không trả success/id' }
  if (g.ok) return g
  const r = await gqlNguoi({ fb_api_req_friendly_name: 'BizKitAssignUserToAssetModalMutation', doc_id: '38320362567578755',
    variables: JSON.stringify({ businessID: bmId, assetID: pageId, userIDs: [userId], taskIDs: maId(q), shouldRecommendAssets: true }) }, {}, 'business')
  let d
  if (r.error) d = /verify.*email|need_verify_email/i.test(r.message) ? { ok: false, message: 'cần verify email trong Business Manager rồi thử lại' } : { ok: false, message: `GraphQL: ${r.message}` }
  else {
    const s = r.data?.xfb_business_settings_bulk_add_user_to_asset?.results
    d = (Array.isArray(s) && s.length > 0 && s.every((e) => e.result_type === 'SUCCESS')) || coChuoi(r, '"result_type":"SUCCESS"') ? { ok: true, message: 'đã cấp quyền (graphql)' } : { ok: false, message: 'không xác nhận được kết quả gán quyền (result_type)' }
  }
  return d.ok ? d : { ok: false, message: `Graph: ${g.message} · ${d.message}` }
}
async function pageSsQuyenGo({ pageId, bmId, userId }) { // B
  const { fb_dtsg } = await getAdsToken()
  if (!fb_dtsg) return { ok: false, message: 'chưa đăng nhập Facebook' }
  const r = await jbGoi(`/${pageId}/userpermissions`, { method: 'POST', body: { pageId, business: bmId, user: userId, method: 'delete', fb_dtsg } })
  return r.error ? { ok: false, message: r.message } : r.success === true ? { ok: true, message: 'đã xóa quyền' } : { ok: false, message: 'Graph không trả success=true' }
}
// Người dùng của một BM (8967:18151 l): business_users email,name,id,role,backing_user_type, limit 300, đọc theo after.
async function pageSsBmNguoi({ bmId }) {
  const rows = []
  let after
  for (let k = 0; k < 50; k += 1) {
    const r = await jbGoi(`/${bmId}/business_users`, { params: { fields: 'email,name,id,role,backing_user_type', limit: 300, ...(after ? { after } : {}) } })
    if (r.error) return { ok: false, message: r.message }
    for (const e of r.data ?? []) if (e.id) rows.push({ id: String(e.id), name: String(e.name ?? ''), email: String(e.email ?? ''), role: String(e.role ?? '') })
    const n = r.paging?.next
    if (!n) return { ok: true, rows }
    after = new URL(n).searchParams.get('after')?.trim()
    if (!after) return { ok: false, message: 'bm-pagination-missing-cursor' }
  }
  return { ok: true, rows }
}

// ── Gỡ Instagram khỏi Page (ey: PageLinkInstagramMutationUnlinkMutation av = Page) ─────────────────────────────────────────────────────
async function pageSsGoIg({ pageId, profileId, cmid }) {
  if (!so(profileId)) return { ok: false, message: 'thiếu profile id của Page (NPE)' }
  const r = await gqlNguoi({ fb_api_req_friendly_name: 'PageLinkInstagramMutationUnlinkMutation', doc_id: '35456894030590891',
    variables: JSON.stringify({ input: { entry_point: 'PROFILE_PLUS_SETTINGS', page_id: String(pageId), actor_id: String(profileId), client_mutation_id: String(cmid ?? '1') }, page_id: String(pageId) }) },
  { av: String(profileId), __user: String(profileId) })
  if (r.error) return { ok: false, message: r.message }
  return r.data?.page_unlink_instagram_account_v2?.page ? { ok: true, message: 'đã gỡ liên kết Instagram' } : { ok: false, message: 'Facebook không xác nhận việc gỡ liên kết Instagram' }
}

const LENH = {
  'page-ss-reauth': bmBoc(pageSsReauth), 'page-ss-moi-qtv': bmBoc(pageSsMoiQtv), 'page-ss-2fa': bmBoc(pageSs2fa),
  'page-ss-loi-moi-ds': bmBoc(pageSsLoiMoiDs), 'page-ss-loi-moi-tl': bmBoc(pageSsLoiMoiTl),
  'page-ss-vao-bm': bmBoc(pageSsVaoBm), 'page-ss-go-bm': bmBoc(pageSsGoBm),
  'page-ss-doi-tac-them': bmBoc(pageSsDoiTacThem), 'page-ss-doi-tac-go': bmBoc(pageSsDoiTacGo),
  'page-ss-quyen-cap': bmBoc(pageSsQuyenCap), 'page-ss-quyen-go': bmBoc(pageSsQuyenGo), 'page-ss-bm-nguoi': bmBoc(pageSsBmNguoi),
  'page-ss-go-ig': bmBoc(pageSsGoIg),
}
self.vaesaSmitThem = Object.assign(self.vaesaSmitThem || {}, LENH)
})()
