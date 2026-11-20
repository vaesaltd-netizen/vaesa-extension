// Super Share — công cụ tab BM (chép SMIT). Dùng hàm chung self.vaesaSmitNoi (smit.js), đăng ký lệnh vào self.vaesaSmitThem.
// Mỗi lệnh = MỘT lần gọi Facebook (trang VAESA tự lặp từng BM / mục + nghỉ 1–3 giây như runner SMIT 1128) ⇒ không vướng 5 phút service worker.
// Trả { ok:true, data } = nguyên phản hồi Graph; lỗi đầu vào ⇒ { ok:false, message }.
;(() => {
const N = self.vaesaSmitNoi
if (!N) return
const SO = /^\d{6,}$/
const so = (x) => String(x ?? '').trim().replace(/^act_/i, '')
const sai = (ten) => ({ ok: false, message: `${ten} không hợp lệ` })
const uid = async () => (await N.getAdsToken()).user_id || ''
const loiGraph = (r) => r && typeof r === 'object' && (r.error === true || r.error_code || r.error?.code)

// Vai trò BM: REST roles + GraphQL task IDs (99485 8967:425-428)
const ROLES_ADMIN = ['DEFAULT', 'MANAGE', 'DEVELOPER', 'EMPLOYEE', 'ASSET_MANAGE', 'ASSET_VIEW', 'PEOPLE_MANAGE', 'PEOPLE_VIEW', 'PARTNERS_VIEW', 'PARTNERS_MANAGE', 'PROFILE_MANAGE']
const ROLES_EMPLOYEE = ['EMPLOYEE']
const TASK_ADMIN_GQL = ['864195700451909', '151821535410699', '610690166001223', '186595505260379']
const TASK_EMPLOYEE_GQL = ['926381894526285']
// manage-bm-admins: đổi vai trò (18151 8967:185)
const TASK_ADMIN_FULL = ['926381894526285', '603931664885191', '1327662214465567', '862159105082613', '6161001899617846786', '1633404653754086', '967306614466178', '2848818871965443', '245181923290198', '388517145453246']
// manage-asset-group: quyền share BAG (38542 3732:18880-18886)
const BAG_PERMISSIONS = [
  { asset_type: 'PAGE', permitted_task_ids: ['461340961883703', '556750461849806', '696659004201852', '275298030109664', '270956550540539', '794616964377599', '997951390947110', '2565488997052663'] },
  { asset_type: 'AD_ACCOUNT', permitted_task_ids: ['864195700451909', '151821535410699', '610690166001223', '186595505260379'] },
]

const LENH = {
  // ═══ 1. share-bm-users: mời người vào BM (99485 8967:429-465) ═══════════════════════
  // API 1: POST /{bmId}/business_users, API 2 fallback: ManageBusinessAccountAddPersonMutation
  'ss-bm-invite-email': async ({ bm, email, role } = {}) => {
    const b = so(bm), e = String(email ?? '').trim()
    if (!SO.test(b)) return sai('ID BM')
    if (!e || !e.includes('@')) return sai('Email')
    const r = role === 'admin' ? ROLES_ADMIN : ROLES_EMPLOYEE
    const gqlRoles = role === 'admin' ? TASK_ADMIN_GQL : TASK_EMPLOYEE_GQL
    // API 1: REST
    const u = await N.jbGoi(`/${b}/business_users`, { method: 'POST', body: { email: e, roles: JSON.stringify(r), brandId: b } })
    if (!loiGraph(u)) return { ok: true, data: u, message: `Graph ok · ${e}` }
    // API 2: GraphQL fallback
    const m = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'ManageBusinessAccountAddPersonMutation',
      doc_id: '6237475453040720',
      variables: JSON.stringify({ business_emails: [e], business_roles: gqlRoles, business_id: b, invite_origin_surface: 'MBS_INVITE_USER_FLOW' }),
    })
    if (!loiGraph(m)) return { ok: true, data: m, message: `GraphQL ok · ${e}` }
    const title = u.userTitle && u.userTitle !== u.message ? u.userTitle : undefined
    const msg = title ? `${u.message} — ${title}` : u.message
    return { ok: false, message: `GraphQL: ${(m.message || m.error?.message || '')} · Graph: ${msg}`, ...(title ? { userTitle: title } : {}) }
  },

  // ═══ 2. manage-bm-admins: danh sách, xoá, đổi vai trò (18151 8967:98-208) ══════════
  'ss-bm-admins': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    return { ok: true, data: await N.jbGoi(`/${b}/business_users`, { params: { fields: 'email,name,id,role,backing_user_type', limit: 300 } }) }
  },
  'ss-bm-remove-admin': async ({ bm, userId } = {}) => {
    const b = so(bm), u = String(userId ?? '').trim()
    if (!SO.test(b) || !/^\d+$/.test(u)) return sai('ID')
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsRemoveBusinessUserMutation',
      doc_id: '23932916982960697',
      variables: JSON.stringify({ businessID: b, businessUserID: u, surfaceParams: { entry_point: 'BIZWEB_SETTINGS_PEOPLE_TAB', flow_source: 'BIZ_WEB', tab: 'BUSINESS_USERS' } }),
    })
    if (loiGraph(r)) return { ok: false, message: `${u}: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r }
  },
  'ss-bm-change-admin-role': async ({ bm, userId, role } = {}) => {
    const b = so(bm), u = String(userId ?? '').trim()
    if (!SO.test(b) || !/^\d+$/.test(u)) return sai('ID')
    const tasks = role === 'admin' ? TASK_ADMIN_FULL : TASK_EMPLOYEE_GQL
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BusinessAccountPermissionTasksForUserModalMutation',
      doc_id: '26159731410396148',
      variables: JSON.stringify({ businessUserID: u, business_account_task_ids: tasks, isUnifiedSettings: false }),
    })
    if (loiGraph(r)) return { ok: false, message: `${u}: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r, promoted: role === 'admin' }
  },

  // ═══ 3. remove-partner: xoá đối tác khỏi BM (56440 1128:1487-1634) ══════════════════
  'ss-bm-partners': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    return { ok: true, data: await N.jbGoi(`/${b}/partner_relationships`, { version: 'v17.0', params: { fields: 'id,name', limit: 500 } }) }
  },
  'ss-bm-remove-partner': async ({ bm, partnerId } = {}) => {
    const b = so(bm), p = so(partnerId)
    if (!SO.test(b) || !SO.test(p)) return sai('ID')
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsRemoveBusinessPartnerMutation',
      doc_id: '9742323712551273',
      variables: JSON.stringify({ businessID: b, partnerBusinessID: p }),
    })
    if (loiGraph(r)) return { ok: false, message: `${p}: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r }
  },

  // ═══ 4. claim-adaccount: nhận sở hữu TKQC (1128:11906-12053) ════════════════════════
  // 3 API thử lần lượt: BizKitSettingsClaimAdAccountMutation → ClaimAdAccountMutation → business.facebook.com POST
  'ss-bm-claim-ad': async ({ bm, adId } = {}) => {
    const b = so(bm), a = so(adId)
    if (!SO.test(b) || !SO.test(a)) return sai('ID')
    const u = await uid()
    if (!u) return { ok: false, message: 'Chưa đăng nhập Facebook', notLoggedIn: true }
    // API 1: BizKitSettingsClaimAdAccountMutation (1128:11943-11986)
    const r1 = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsClaimAdAccountMutation',
      doc_id: '27932358343042628',
      fb_api_caller_class: 'RelayModern',
      server_timestamps: true,
      variables: JSON.stringify({ businessID: b, adAccountID: a, baaSource: null, shouldCheckAdAccountNavigationQE: true, qplJoinID: crypto.randomUUID() }),
    }, { them: N.relayBm({ av: u, __user: u, __bid: b, __aaid: 0 }) })
    if (!loiGraph(r1) && r1?.data?.business_settings_add_owned_ad_account != null) return { ok: true, data: r1, confirmed: true }
    // API 3: ClaimAdAccountMutation (1128:11988-12010)
    const r3 = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'ClaimAdAccountMutation',
      doc_id: '26359038520354737',
      variables: JSON.stringify({ input: { client_mutation_id: '1', business_id: b, ad_account_id: a } }),
    })
    if (!loiGraph(r3)) return { ok: true, data: r3, unverified: true }
    // API 2: POST business.facebook.com (1128:11906-11941)
    const t = await N.getAdsToken()
    if (!t.fb_dtsg) return { ok: false, message: `API 1: ${r1?.message || 'Lỗi'}; API 3: ${r3?.message || 'Lỗi'}; API 2: thiếu fb_dtsg` }
    try {
      const url = `https://business.facebook.com/business/objects/add/connections/?business_id=${b}&from_id=${b}&from_asset_type=brand&to_id=${a}&to_asset_type=ad-account`
      const body = new URLSearchParams({ __user: u, fb_dtsg: t.fb_dtsg, lsd: t.lsd || '' }).toString()
      const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
      const text = await res.text()
      if (/"error"|error_user_msg|"errorSummary"/.test(text)) return { ok: false, message: `Cả 3 API thất bại; API 2: ${text.slice(0, 200)}` }
      return { ok: true, unverified: true, text }
    } catch (e) { return { ok: false, message: `Cả 3 API thất bại; API 2: ${e instanceof Error ? e.message : String(e)}` } }
  },

  // ═══ 5. remove-shared-adaccount: xoá TKQC share khỏi BM (93232 8967:210-415) ════════
  'ss-bm-client-ads': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    return { ok: true, data: await N.jbGoi(`/${b}/client_ad_accounts`, { version: 'v14.0', params: { fields: 'id,account_id,name,account_status', limit: 500 } }) }
  },
  'ss-bm-remove-ad': async ({ bm, adId } = {}) => {
    const b = so(bm), a = String(adId ?? '').trim()
    if (!SO.test(b) || !a) return sai('ID')
    const u = await uid()
    if (!u) return { ok: false, message: 'Chưa đăng nhập Facebook', notLoggedIn: true }
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsRemoveAdAccountMutation',
      doc_id: '24277713691817857',
      fb_api_caller_class: 'RelayModern',
      server_timestamps: true,
      variables: JSON.stringify({ businessID: b, adAccountID: a }),
    }, { them: N.relayBm({ av: u, __user: u, __bid: b, __aaid: 0 }) })
    if (loiGraph(r)) return { ok: false, message: `${a}: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r }
  },

  // ═══ 6. request-adaccount-access: yêu cầu quyền truy cập TKQC (1128:12171-12236) ═══
  'ss-bm-request-ad-access': async ({ bm, adId } = {}) => {
    const b = so(bm), a = so(adId)
    if (!SO.test(b) || !SO.test(a)) return sai('ID')
    const u = await uid()
    if (!u) return { ok: false, message: 'Chưa đăng nhập Facebook', notLoggedIn: true }
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsRequestAdAccountAccessMutation',
      doc_id: '23962130140039997',
      fb_api_caller_class: 'RelayModern',
      server_timestamps: true,
      variables: JSON.stringify({ input: { actor_id: u, client_mutation_id: '1', ad_account_id: a, permitted_roles: TASK_ADMIN_GQL, permitted_tasks: [], requesting_business_id: b } }),
    }, { them: N.relayBm({ av: u, __user: u, __bid: b, __aaid: 0 }) })
    if (loiGraph(r)) return { ok: false, message: `${a}: ${r.message || r.error?.message || 'Lỗi'}` }
    const status = r.data?.business_settings_request_ad_account_access?.access_status
    return { ok: true, data: r, accessStatus: status || null }
  },

  // ═══ 7. claim-page: nhận sở hữu Page (30191 1128:668-740) ═══════════════════════════
  'ss-bm-claim-page': async ({ bm, pageId } = {}) => {
    const b = so(bm), p = so(pageId)
    if (!SO.test(b) || !SO.test(p)) return sai('ID')
    // API 1: REST (1128:670-676)
    const u = await N.jbGoi(`/${b}/owned_pages`, { method: 'POST', version: 'v23.0', body: { page_id: p }, tokenPurpose: 'businessManagerAction' })
    if (!loiGraph(u)) return { ok: true, data: u }
    // API 2: GraphQL fallback (1128:677-740)
    const uid2 = await uid()
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsClaimPageMutation',
      doc_id: '27720923774230959',
      fb_api_caller_class: 'RelayModern',
      server_timestamps: true,
      variables: JSON.stringify({ businessID: b, pageID: p }),
    }, { them: N.relayBm({ av: uid2, __user: uid2 }) })
    if (loiGraph(r)) return { ok: false, message: `${p}: REST: ${u.message || 'Lỗi'}; GQL: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r }
  },

  // ═══ 8. remove-page: xoá Page khỏi BM (48951 1128:1337-1485) ════════════════════════
  'ss-bm-pages': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    const owned = await N.jbGoi(`/${b}/owned_pages`, { version: 'v24.0', params: { fields: 'id,name', limit: 500 } })
    const client = await N.jbGoi(`/${b}/client_pages`, { version: 'v24.0', params: { fields: 'id,name', limit: 500 } })
    const rows = [...(owned?.data || []), ...(client?.data || [])]
    return { ok: true, rows, ownedError: loiGraph(owned) ? owned.message : null, clientError: loiGraph(client) ? client.message : null }
  },
  'ss-bm-remove-page': async ({ bm, pageId } = {}) => {
    const b = so(bm), p = so(pageId)
    if (!SO.test(b) || !SO.test(p)) return sai('ID')
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsRemovePageMutation',
      doc_id: '9410980655690803',
      variables: JSON.stringify({ businessID: b, pageID: p }),
    })
    if (loiGraph(r)) return { ok: false, message: `${p}: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r }
  },

  // ═══ 9. remove-ig-account: xoá IG khỏi BM (11810 1128:1147-1335) ════════════════════
  'ss-bm-ig-accounts': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    const owned = await N.jbGoi(`/${b}/owned_instagram_accounts`, { version: 'v17.0', params: { fields: 'id,username', limit: 500 } })
    const client = await N.jbGoi(`/${b}/client_instagram_accounts`, { version: 'v17.0', params: { fields: 'id,username', limit: 500 } })
    const rows = [...(owned?.data || []), ...(client?.data || [])]
    return { ok: true, rows, ownedError: loiGraph(owned) ? owned.message : null, clientError: loiGraph(client) ? client.message : null }
  },
  'ss-bm-remove-ig': async ({ bm, igId } = {}) => {
    const b = so(bm), g = String(igId ?? '').trim()
    if (!SO.test(b) || !g) return sai('ID')
    // Thử 3 cách: GraphQL surface=BUSINESS_ASSETS → surface=INSTAGRAM_ACCOUNT → REST DELETE (1128:1147-1200)
    const r1 = await N.goiGraphql(undefined, {
      fb_api_req_friendly_name: 'RemoveInstagramAccountMutation',
      doc_id: '9416010698507836',
      variables: JSON.stringify({ businessID: b, instagramAccountID: g, surface: 'BUSINESS_ASSETS' }),
    })
    if (!loiGraph(r1)) return { ok: true, data: r1 }
    const r2 = await N.goiGraphql(undefined, {
      fb_api_req_friendly_name: 'RemoveInstagramAccountMutation',
      doc_id: '9416010698507836',
      variables: JSON.stringify({ businessID: b, instagramAccountID: g, surface: 'INSTAGRAM_ACCOUNT' }),
    })
    if (!loiGraph(r2)) return { ok: true, data: r2 }
    const r3 = await N.jbGoi(`/${b}/instagram_accounts`, { method: 'DELETE', version: 'v17.0', body: { instagram_account: g } })
    if (loiGraph(r3)) return { ok: false, message: `${g}: ${r3.message || r3.error?.message || 'Lỗi'}` }
    return { ok: true, data: r3 }
  },

  // ═══ 10. review-bm-requests: duyệt yêu cầu nhận được (6193:9336-9431) ═══════════════
  'ss-bm-received-requests': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    const rows = []
    let cursor = null
    for (let i = 0; i < 20; i++) {
      const r = await N.goiGraphql(undefined, {
        doc_id: '25527406276860121',
        variables: JSON.stringify({ businessID: b, count: 50, cursor, directionFilter: 'RECEIVED', orderBy: 'CREATION_DATE_DESC', statusFilters: ['PENDING'], id: b }),
      })
      if (loiGraph(r)) return { ok: false, message: r.message || r.error?.message || 'Lỗi' }
      const list = r.data?.node?.unified_business_requests_mbs
      if (!list) return { ok: false, message: 'Không đọc được danh sách yêu cầu' }
      for (const edge of list.edges || []) {
        const n = edge.node
        if (!n?.request_id) continue
        const obj = n.bm_request_object
        rows.push({
          reviewId: n.request_id, bmId: b,
          sourceBmId: n.source_business?.id ?? obj?.requestor_business?.id ?? '',
          requestType: n.request_type ?? '',
          summary: n.list_summary_content?.text ?? '',
          assetType: obj?.request_object?.type ?? '',
          assetName: obj?.request_object?.name || n.page_id?.name || '',
          assetId: n.page_id?.id ?? '',
          requesterName: obj?.requestor_name ?? '',
          requesterBmName: obj?.requestor_business?.name ?? '',
          createdAt: n.creation_time ?? 0,
          expiresAt: n.expiration_timestamp ?? null,
        })
      }
      const pi = list.page_info
      if (!pi?.has_next_page || !pi.end_cursor || pi.end_cursor === cursor) break
      cursor = pi.end_cursor
    }
    return { ok: true, rows }
  },
  'ss-bm-approve-request': async ({ bm, reviewId } = {}) => {
    const b = so(bm), r = String(reviewId ?? '').trim()
    if (!SO.test(b) || !r) return sai('ID')
    const res = await N.goiGraphql(undefined, {
      doc_id: '34813920664865375',
      variables: JSON.stringify({ reviewID: r, businessID: b }),
    })
    if (loiGraph(res)) return { ok: false, message: res.message || res.error?.message || 'Lỗi' }
    return res.data ? { ok: true, data: res } : { ok: false, message: 'Facebook không xác nhận phê duyệt' }
  },
  'ss-bm-decline-request': async ({ bm, reviewId } = {}) => {
    const b = so(bm), r = String(reviewId ?? '').trim()
    if (!SO.test(b) || !r) return sai('ID')
    const res = await N.goiGraphql(undefined, {
      doc_id: '25293819953582604',
      variables: JSON.stringify({ reviewID: r, businessID: b }),
    })
    if (loiGraph(res)) return { ok: false, message: res.message || res.error?.message || 'Lỗi' }
    return res.data?.decline_business_request?.status === 'DECLINED' ? { ok: true, data: res } : { ok: false, message: 'Facebook không xác nhận từ chối' }
  },

  // ═══ 11. manage-asset-group: nhóm tài sản (38542 3732:18842-19176) ═══════════════════
  'ss-bm-bag-create': async ({ bm, name } = {}) => {
    const b = so(bm), n = String(name ?? '').trim()
    if (!SO.test(b)) return sai('ID BM')
    if (!n) return sai('Tên nhóm')
    const r = await N.jbGoi(`/${b}/business_asset_groups`, { method: 'POST', body: { name: n }, tokenPurpose: 'businessManagerAction' })
    if (loiGraph(r)) return { ok: false, message: r.message || r.error?.message || 'Lỗi' }
    return { ok: true, id: String(r.id ?? '').trim(), data: r }
  },
  'ss-bm-bag-list': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    // Phân trang REST (38542:h 3732:19105-19153)
    const rows = [], seen = new Set()
    let next
    do {
      const r = next
        ? await N.jbGoi(next, { tokenPurpose: 'businessManagerAction' })
        : await N.jbGoi(`/${b}`, { params: { fields: 'business_asset_groups.limit(100){id,name}' }, tokenPurpose: 'businessManagerAction' })
      if (loiGraph(r)) return next ? { ok: true, rows, complete: false } : { ok: false, message: r.message || r.error?.message || 'Lỗi' }
      const list = next ? r : r.business_asset_groups
      for (const e of list?.data || []) { const id = String(e.id ?? '').trim(); if (id && !seen.has(id)) { seen.add(id); rows.push({ id, name: e.name ?? '(không tên)' }) } }
      next = list?.paging?.next
    } while (next)
    return { ok: true, rows, complete: true }
  },
  'ss-bm-bag-share': async ({ bm, bagId, partnerBmId } = {}) => {
    const b = so(bm), bag = String(bagId ?? '').trim(), p = so(partnerBmId)
    if (!SO.test(b) || !bag || !SO.test(p)) return sai('ID')
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitAssignPartnerToBagModalMutation',
      fb_api_caller_class: 'RelayModern',
      server_timestamps: true,
      doc_id: '9955698604476457',
      variables: JSON.stringify({ clientBusinessID: b, agencyBusinessID: p, assetID: bag, assetPermissions: BAG_PERMISSIONS }),
    })
    if (loiGraph(r)) return { ok: false, message: r.message || r.error?.message || 'Lỗi' }
    const node = r.data?.business_settings_add_partner_business_asset_group_connection
    if (node?.business_asset_group?.id !== bag || node?.agency_business?.id !== p) return { ok: false, message: 'Facebook không xác nhận chia sẻ nhóm tài sản' }
    return { ok: true, data: r }
  },
  'ss-bm-bag-add': async ({ bagId, assetType, assetId } = {}) => {
    const bag = String(bagId ?? '').trim(), a = String(assetId ?? '').trim()
    if (!bag || !a) return sai('ID')
    const edge = assetType === 'page' ? 'contained_pages' : 'contained_adaccounts'
    const id = assetType === 'page' ? a : `act_${a.replace(/^act_/, '')}`
    const r = await N.jbGoi(`/${bag}/${edge}`, { method: 'POST', version: assetType === 'page' ? 'v24.0' : 'v17.0', tokenPurpose: 'businessManagerAction', body: { asset_id: id, ...(assetType === 'page' ? { method: 'post' } : {}) } })
    if (loiGraph(r)) return { ok: false, message: `${a}: ${r.message || r.error?.message || 'Lỗi'}` }
    if (r !== true && r?.success !== true && !r?.id) return { ok: false, message: `${a}: Thêm không được xác nhận` }
    return { ok: true, data: r }
  },
  'ss-bm-bag-remove': async ({ bm, bagId, edge, assetId } = {}) => {
    const b = so(bm), bag = String(bagId ?? '').trim(), a = String(assetId ?? '').trim()
    if (!bag || !a) return sai('ID')
    const e = edge === 'contained_pages' ? 'contained_pages' : 'contained_adaccounts'
    const id = e === 'contained_adaccounts' ? `act_${a.replace(/^act_/, '')}` : a
    const r = await N.jbGoi(`/${bag}/${e}`, { method: 'DELETE', version: 'v24.0', body: { asset_id: id } })
    if (loiGraph(r)) return { ok: false, message: `${a}: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r }
  },
  'ss-bm-bag-delete': async ({ bm, bagId } = {}) => {
    const b = so(bm), bag = String(bagId ?? '').trim()
    if (!SO.test(b) || !bag) return sai('ID')
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsRemoveBusinessAssetGroupMutation',
      doc_id: '24098009339804395',
      variables: JSON.stringify({ bagID: bag, businessID: b }),
    })
    if (loiGraph(r)) return { ok: false, message: r.message || r.error?.message || 'Lỗi' }
    return { ok: true, data: r }
  },

  // ss-bm-bag-members: liệt kê thành viên nhóm tài sản (94034 f() + 83135.Y: contained_adaccounts / contained_pages).
  'ss-bm-bag-members': async ({ bagId, edge } = {}) => {
    const bag = String(bagId ?? '').trim()
    if (!bag) return sai('ID nhóm')
    const e = edge === 'contained_pages' ? 'contained_pages' : 'contained_adaccounts'
    const rows = [], seen = new Set()
    let next
    do {
      const r = next
        ? await N.jbGoi(next, { tokenPurpose: 'businessManagerAction' })
        : await N.jbGoi(`/${bag}/${e}`, { version: 'v24.0', params: { fields: 'id,name', limit: 500 }, tokenPurpose: 'businessManagerAction' })
      if (loiGraph(r)) return next ? { ok: true, rows, complete: false } : { ok: false, message: r.message || r.error?.message || 'Lỗi' }
      for (const item of r?.data || []) { const id = String(item.id ?? '').trim(); if (id && !seen.has(id)) { seen.add(id); rows.push({ id, name: item.name ?? '' }) } }
      next = r?.paging?.next
    } while (next)
    return { ok: true, rows, complete: true }
  },

  // ═══ 12. cancel-pending-invites: huỷ lời mời chờ (1128:11513-11596) ══════════════════
  'ss-bm-pending-users': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    return { ok: true, data: await N.jbGoi(`/${b}/pending_users`, { version: 'v17.0', params: { fields: 'id,email', limit: 9999 } }) }
  },
  'ss-bm-cancel-invite': async ({ userId } = {}) => {
    const u = String(userId ?? '').trim()
    if (!u) return sai('ID')
    const r = await N.jbGoi(`/${u}`, { method: 'POST', version: 'v17.0', body: { method: 'delete' } })
    if (loiGraph(r)) return { ok: false, message: `${u}: ${r.message || r.error?.message || 'Lỗi'}` }
    return { ok: true, data: r }
  },

  // ═══ 13. accept-bm-invite: nhận link mời vào BM (1128 module 77628 bS/mA) ═══
  // bypass=true: GraphQL bizapp_accept_invitation doc_id 6857625997606127
  // bypass=false: form POST business.facebook.com/business/invitation/login/ (cần verify-password trước)
  'ss-bm-accept-link': async ({ link, name, bypass } = {}) => {
    const u = String(link ?? '').trim(), n = String(name ?? '').trim()
    if (!u || !n) return sai('Link hoặc Tên')
    // Parse invitation token (77628 g)
    const parseToken = (s) => {
      try {
        const url = new URL(s.trim())
        if (url.origin !== 'https://business.facebook.com') return null
        if (url.pathname === '/invitation/') { const t = url.searchParams.get('token'); return t ? { link: s.trim(), invitationToken: t } : null }
        if (url.pathname === '/business/loginpage/') {
          const next = url.searchParams.get('next')
          if (!next) return null
          try { const nu = new URL(next); return nu.origin === 'https://business.facebook.com' && nu.pathname === '/invitation/' && nu.searchParams.get('token') ? { link: s.trim(), invitationToken: nu.searchParams.get('token') } : null } catch { return null }
        }
        return null
      } catch { return null }
    }
    if (bypass) {
      const p = parseToken(u)
      if (!p) return { ok: false, message: 'Link mời BM không hợp lệ' }
      try {
        const tk = await N.getAdsToken()
        const body = new URLSearchParams({
          access_token: tk.access_token,
          variables: JSON.stringify({ input: { first_name: n, invitation_token: p.invitationToken, last_name: tk.user_id, receive_marketing_messages: false, user_preferred_business_email: `${tk.user_id}@facebook.com` } }),
          doc_id: '6857625997606127',
        }).toString()
        const res = await fetch('https://b-graph.facebook.com/graphql?locale=en_US', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
        let text = await res.text()
        if (text.startsWith('for (;;);')) text = text.slice(9)
        const j = JSON.parse(text)
        const err = j.errors?.[0]
        if (err) return { ok: false, message: err.description || err.summary || err.message || 'Facebook từ chối link mời BM' }
        const d = j.data?.bizapp_accept_invitation
        if (d?.error === null && d.invitation_token === p.invitationToken && j.extensions?.is_final === true) return { ok: true, message: 'Đã nhận link mời vào BM' }
        return { ok: false, message: 'Facebook trả về phản hồi không thể xác minh' }
      } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } }
    }
    // non-bypass: dùng session đã xác minh mật khẩu (ss-bm-verify-password phải chạy trước)
    try {
      const tk = await N.getAdsToken()
      // Bước 1: GET invite URL → lấy invite_join_id (77628 h)
      const inviteUrl = (() => { try { const x = new URL(u.trim()); return x.origin === 'https://business.facebook.com' && x.pathname === '/invitation/' && x.searchParams.get('token') ? x : null } catch { return null } })()
      if (!inviteUrl) return { ok: false, message: 'Link mời BM không hợp lệ' }
      const r1 = await fetch(inviteUrl.toString(), { credentials: 'include', redirect: 'follow' })
      const finalUrl = (() => { try { const x = new URL(r1.url); if (x.origin !== 'https://business.facebook.com') return null; if (x.pathname === '/invitation/' && x.searchParams.get('token') && x.searchParams.get('invite_join_id')) return x; if (x.pathname === '/business/loginpage/') { const next = x.searchParams.get('next'); if (!next) return null; try { const a = new URL(next); return a.origin === 'https://business.facebook.com' && a.pathname === '/invitation/' && a.searchParams.get('token') && a.searchParams.get('invite_join_id') ? a : null } catch { return null } } return null } catch { return null } })()
      if (!finalUrl) return { ok: false, message: 'Không xác minh được thông tin link mời BM' }
      const token = finalUrl.searchParams.get('token'), joinId = finalUrl.searchParams.get('invite_join_id')
      if (!token || !joinId) return { ok: false, message: 'Link mời BM thiếu thông tin bắt buộc' }
      // Bước 2: GET lại invite URL
      await fetch(finalUrl.toString(), { credentials: 'include' })
      // Bước 3: POST form accept (77628 h)
      const body = new URLSearchParams({
        first_name: n, last_name: String(Math.floor(Math.random() * 90000) + 10000),
        invitation_token: token, receive_marketing_messages: 'false', user_preferred_business_email: '',
        __user: tk.user_id, __a: '1', fb_dtsg: tk.fb_dtsg || '',
      }).toString()
      const r2 = await fetch('https://business.facebook.com/business/invitation/login/', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
      let text = await r2.text()
      if (text.startsWith('for (;;);')) text = text.slice(9)
      const j = JSON.parse(text)
      if (j.error !== undefined || j.errorSummary || j.errorDescription || j.error_user_msg) return { ok: false, message: j.errorDescription || j.error_user_msg || j.errorSummary || 'Facebook từ chối' }
      if (j.__ar === 1 && j.payload === null) return { ok: true, message: 'Đã nhận link mời vào BM' }
      return { ok: false, message: 'Facebook trả về phản hồi không thể xác minh' }
    } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } }
  },
  // ═══ 13b. verify-password: xác minh mật khẩu Facebook (1128 module 77628 BN) ═══
  'ss-bm-verify-password': async ({ password } = {}) => {
    const pw = String(password ?? '')
    if (!pw) return sai('Mật khẩu')
    try {
      const tk = await N.getAdsToken()
      const jazoest = '2' + [...(tk.fb_dtsg || '')].reduce((s, c) => s + c.charCodeAt(0), 0)
      const body = new URLSearchParams({
        fb_dtsg: tk.fb_dtsg || '', jazoest,
        encpass: `#PWD_BROWSER:0:${Math.floor(Date.now() / 1000)}:${pw}`,
      }).toString()
      const r = await fetch('https://m.facebook.com/password/reauth/?next=https%3A%2F%2Fmbasic.facebook.com%2Fsecurity%2F2fac%2Fsettings%2F%3Fpaipv%3D0', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'follow' })
      const is2fac = (u) => { try { const x = new URL(u); return x.origin === 'https://mbasic.facebook.com' && x.pathname === '/security/2fac/settings/' } catch { return false } }
      if (!is2fac(r.url)) return { ok: false, message: 'Không xác minh được mật khẩu Facebook' }
      const r2 = await fetch('https://mbasic.facebook.com/security/2fac/settings/?paipv=0&_rdr', { credentials: 'include' })
      if (!is2fac(r2.url)) return { ok: false, message: 'Không xác minh được phiên Facebook sau khi nhập mật khẩu' }
      return { ok: true }
    } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } }
  },

  // ═══ 14. remove-bm-hidden-admin: quét system user ẩn + xoá (1128:13735 + module 83204) ═══
  // scan: GET /{bmId}/system_users → admins có assigned_apps
  'ss-bm-hidden-admins': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    const rows = []
    let after
    do {
      const params = { fields: 'id,name,assigned_apps.limit(100){id,name}', limit: 300 }
      if (after) params.after = after
      const r = await N.jbGoi(`/${b}/system_users`, { params, tokenPurpose: 'businessManagerAction' })
      if (loiGraph(r)) return { ok: false, message: r.message || r.error?.message || 'Lỗi quét system user' }
      for (const e of (r.data || [])) {
        const apps = (e.assigned_apps?.data || []).filter((a) => a.id).map((a) => ({ id: String(a.id), ...(a.name ? { name: a.name } : {}) }))
        if (e.id && apps.length > 0) rows.push({ id: String(e.id), ...(e.name ? { name: e.name } : {}), apps })
      }
      try { after = r.paging?.next ? new URL(r.paging.next).searchParams.get('after')?.trim() || undefined : undefined } catch { after = undefined }
    } while (after)
    return { ok: true, admins: rows }
  },
  // remove: thu hồi token + xoá kết nối app (83204 d + m)
  'ss-bm-remove-hidden-admin': async ({ bm, admin } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    if (!admin?.id) return sai('admin')
    const revoke = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'BizKitSettingsSystemUserAccessTokenRevocationModalMutation',
      doc_id: '23892262370416074',
      variables: JSON.stringify({ input: { system_user_id: admin.id } }),
    }).catch(() => null)
    const revokeOk = revoke && !loiGraph(revoke) && revoke.data?.xfb_system_user_token_revocation === true
    const remaining = []
    for (const app of (admin.apps || [])) {
      const rm = await N.goiGraphql('business', {
        fb_api_req_friendly_name: 'BizKitRemoveUserAssetConnectionMutation',
        doc_id: '39520861720834154',
        variables: JSON.stringify({ businessID: b, userID: admin.id, assetID: app.id, assetTypes: ['APP'], isDirectAdmin: false, __relay_internal__pv__BillingHubContextFieldCutoverrelayprovider: false }),
      }).catch(() => null)
      const rmOk = rm && !loiGraph(rm) && !!rm.data?.business_settings_remove_user_asset_connection?.business_asset?.id
      if (!rmOk) remaining.push(app)
    }
    const id = admin.name ? `${admin.name} (${admin.id})` : admin.id
    const done = revokeOk && remaining.length === 0
    return { ok: done, remainingApps: remaining, message: done ? `${id}: đã xoá` : !revokeOk ? `${id}: không thu hồi được token` : `${id}: còn ${remaining.length} app chưa gỡ` }
  },

  // ═══ 15. backup-bm: mời email vào BM — thử 3 cách (1128:12620-12750 eF/eD/tf) ═══
  'ss-bm-backup-email': async ({ bm, email, role } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    if (!email || !email.includes('@')) return sai('email')
    const r = role === 'employee' ? 'employee' : 'admin'
    const ADMIN_ROLES = ['DEFAULT', 'MANAGE', 'DEVELOPER', 'EMPLOYEE', 'ASSET_MANAGE', 'ASSET_VIEW', 'PEOPLE_MANAGE', 'PEOPLE_VIEW', 'PARTNERS_VIEW', 'PARTNERS_MANAGE', 'PROFILE_MANAGE']
    const EMP_ROLES = ['DEFAULT', 'EMPLOYEE']
    const roles = r === 'admin' ? ADMIN_ROLES : EMP_ROLES
    const parse = (body) => { if (!body) return null; const t = body.startsWith('for (;;);') ? body.slice(9) : body; try { return JSON.parse(t) } catch { return null } }
    const check = (resp) => {
      if (loiGraph(resp)) return { ok: false, message: resp.message || resp.error?.message || resp.error?.error_user_msg || 'Facebook từ chối lời mời' }
      if (!resp) return { ok: false, message: 'Không nhận được phản hồi' }
      if (resp.error) return { ok: false, message: resp.error.message || resp.error.error_user_msg || resp.error.error_user_title || 'Facebook từ chối lời mời' }
      const id = resp.id?.toString().trim()
      return id ? { ok: true, message: `Đã mời ${email} (invite ${id})` } : { ok: false, message: 'Không nhận được ID lời mời' }
    }
    // method 3: POST /{bm}/business_users v17.0
    try {
      const r3 = await N.jbGoi(`/${b}/business_users`, { method: 'POST', version: 'v17.0', body: { email, role: r === 'admin' ? 'ADMIN' : 'EMPLOYEE' } })
      const c3 = check(r3)
      if (c3.ok) return c3
    } catch { /* fallthrough */ }
    // method 2: POST z-p3-graph v3.0 with cppo
    try {
      const r2 = await N.jbGoi(`/${b}/business_users`, { method: 'POST', tokenPurpose: 'businessManagerAction', params: { __cppo: 1 }, body: { brandId: b, email, method: 'post', pretty: '0', roles: JSON.stringify(roles), suppress_http_code: '1' } })
      const c2 = check(r2)
      if (c2.ok) return c2
    } catch { /* fallthrough */ }
    // method 1: batch POST via adsmanager-graph
    try {
      const batch = [{ method: 'POST', relative_url: `/v3.0/${b}/business_users`, body: new URLSearchParams({ brandId: b, email, roles: JSON.stringify(roles) }).toString() }]
      const r1 = await N.jbGoi('', { baseUrl: 'https://adsmanager-graph.facebook.com/v17.0', method: 'POST', body: { batch: JSON.stringify(batch), method: 'post', pretty: '0', suppress_http_code: '1' } })
      if (loiGraph(r1)) return { ok: false, message: r1.message || 'Batch invite thất bại' }
      const item = Array.isArray(r1) ? r1[0] : null
      if (item?.code === 200 || item?.body) {
        const parsed = parse(item.body)
        if (parsed) return check(parsed)
      }
      return { ok: false, message: `Batch trả mã ${item?.code ?? '???'}` }
    } catch { /* fallthrough */ }
    return { ok: false, message: `Không gửi được lời mời cho ${email}` }
  },


  // ═══ 16. remove-waba: xoá WABA khỏi BM (1128:800-836) ══════════════════════════════
  'ss-bm-waba': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    const r = await N.jbGoi(`/${b}`, { version: 'v20.0', params: { fields: 'whatsapp_business_accounts.limit(200){id,name,verified_name,status}' } })
    if (loiGraph(r)) return { ok: false, message: r.message || r.error?.message || 'Lỗi' }
    return { ok: true, rows: r.whatsapp_business_accounts?.data ?? [] }
  },
  'ss-bm-remove-waba': async ({ bm, wabaId } = {}) => {
    const b = so(bm), w = String(wabaId ?? '').trim()
    if (!SO.test(b) || !w) return sai('ID')
    const u = await uid()
    if (!u) return { ok: false, message: 'Chưa đăng nhập Facebook', notLoggedIn: true }
    const r = await N.goiGraphql('business', {
      fb_api_req_friendly_name: 'useDeleteWhatsAppBusinessAccountMutation',
      doc_id: '9902575596489138',
      variables: JSON.stringify({ input: { actor_id: u, client_mutation_id: '1', waba_id: w } }),
    })
    if (loiGraph(r)) return { ok: false, message: `${w}: ${r.message || r.error?.message || 'Lỗi'}` }
    if (!r.data?.xfb_delete_whatsapp_business_account?.success) return { ok: false, message: `${w}: Xoá không được xác nhận` }
    return { ok: true, data: r }
  },

  // ═══ 17. owned-ads: danh sách TKQC owned của BM (dùng cho hộp tài sản, ghép với client-ads) ═══
  'ss-bm-owned-ads': async ({ bm } = {}) => {
    const b = so(bm)
    if (!SO.test(b)) return sai('ID BM')
    return { ok: true, data: await N.jbGoi(`/${b}/owned_ad_accounts`, { version: 'v14.0', params: { fields: 'id,account_id,name,account_status', limit: 500 } }) }
  },
}
self.vaesaSmitThem = Object.assign(self.vaesaSmitThem || {}, LENH)
})()
