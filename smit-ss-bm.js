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

  // ═══ 13. accept-bm-invite: chấp nhận lời mời vào BM (chỉ dạng link, không lưu mật khẩu) ═══
  'ss-bm-accept-link': async ({ url } = {}) => {
    const u = String(url ?? '').trim()
    if (!u) return sai('URL')
    // Chỉ kiểm tra dạng link hợp lệ của Facebook business invite
    const ok = /^https:\/\/(www\.|business\.)?facebook\.com\/(business_invite|businessmanager\/invitations)/.test(u)
    if (!ok) return { ok: false, message: 'URL không phải dạng lời mời BM Facebook hợp lệ' }
    return { ok: true, url: u, message: 'Link hợp lệ — mở trong trình duyệt để chấp nhận' }
  },
}
self.vaesaSmitThem = Object.assign(self.vaesaSmitThem || {}, LENH)
})()
