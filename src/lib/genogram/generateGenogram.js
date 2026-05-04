// NOTE: 레이아웃 엔진은 "추출 전용" 모드에서는 사용하지 않습니다.


import { repairGenogramJson } from './repairGenogramJson.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const extractBirthYear = (text) => {
  const match = text.match(/(\d{2,4})\s*년생/)
  if (!match) return null
  const y = Number(match[1])
  if (!Number.isFinite(y)) return null
  // 예: 95년생 -> 1995처럼 바꿀지 여부는 UX 정책인데, 여기선 그대로 표기하되 렌더는 `95년생`.
  return y
}

const pad2 = (n) => String(n).padStart(2, '0')

// 상담 내용에 "상담 날짜"가 없으면 오늘 날짜를 사용합니다.
// 화면 표기는 스샷 스타일에 맞춰 `YYYY.MM.DD`로 통일합니다.
const parseConsultationDate = (text) => {
  // 1) "상담 날짜:" 같은 키워드가 있는 경우만 사용(다른 날짜/생년을 오인하지 않기 위함)
  const iso = text.match(/(상담\s*날짜|상담일)\s*[:：]?\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (iso) {
    const [, , y, m, d] = iso
    return `${y}.${pad2(m)}.${pad2(d)}`
  }

  const kor = text.match(/(상담\s*날짜|상담일)\s*[:：]?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (kor) {
    const [, , y, m, d] = kor
    return `${y}.${pad2(m)}.${pad2(d)}`
  }

  // 2) 키워드가 없으면 오늘 날짜
  const now = new Date()
  return `${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())}`
}

const parseCohabitingFromPrompt = (text, counselorName, spouseNameOverride) => {
  // 예시(기존): "내가 상담한사람 정성호 김진주의 자녀 정겨울"
  // 예시(현재 UI): counselorName 입력 + 프롬프트에 "김진주의 자녀 정겨울" 포함

  const cleanedCounselor = counselorName?.trim() ?? ''
  let clientName = cleanedCounselor || null

  const cleanedSpouse = spouseNameOverride?.trim() ?? ''
  let spouseName = cleanedSpouse || null
  let childName = null

  // 1) 텍스트에 상담한사람/배우자/자녀가 한 번에 있는 경우
  const mFull = text.match(
    /(?:내가\s*)?상담한사람\s*([가-힣A-Za-z]+)\s*,?\s*([가-힣A-Za-z]+)의\s*자녀\s*([가-힣A-Za-z]+)/,
  )
  if (mFull) {
    if (!clientName) clientName = mFull[1]
    spouseName = mFull[2]
    childName = mFull[3]
  } else {
    // 2) spouse/child는 프롬프트에서만 추출
    // 예: "김진주의 자녀 정겨울"
    // "의"가 생략되거나 구두점이 끼어도 잡히게 한다.
    const mSpouseChild = text.match(/([가-힣A-Za-z]+)\s*(?:의)?\s*자녀\s*([가-힣A-Za-z]+)/)
    if (mSpouseChild) {
      if (!spouseName) spouseName = mSpouseChild[1]
      childName = mSpouseChild[2]
    }
  }

  if (!clientName || !spouseName || !childName) return null

  let childGender = 'female'
  if (/아들/.test(text)) childGender = 'male'
  if (/딸/.test(text)) childGender = 'female'

  return { clientName, spouseName, childName, childGender }
}

const applyCohabitingFocusLayout = (result, focus) => {
  let activeFocus = focus

  // [핵심] 프롬프트에 focus 키워드가 없어도,
  // 3세대(level===2) 자녀를 찾아 부모를 역으로 찾아 레이아웃을 강제로 적용합니다.
  if (!activeFocus && result && Array.isArray(result.people)) {
    const child = result.people.find((p) => p?.level === 2)
    if (child && Array.isArray(result.parents)) {
      const parentIds = result.parents.filter((e) => e?.child === child.id).map((e) => e?.parent).filter(Boolean)
      if (parentIds.length >= 2) {
        const p1 = result.people.find((p) => p?.id === parentIds[0])
        const p2 = result.people.find((p) => p?.id === parentIds[1])
        if (p1 && p2) {
          activeFocus = {
            clientName: p1.gender === 'male' ? p1.name : p2.name,
            spouseName: p1.gender === 'female' ? p1.name : p2.name,
            childName: child.name,
            childGender: child.gender,
          }
        }
      }
    }
  }

  if (!activeFocus || !result || !Array.isArray(result.people)) return result

  const people = result.people.map((p) => ({ ...p }))
  const couples = Array.isArray(result.couples) ? result.couples.map((c) => ({ ...c })) : []
  const parents = Array.isArray(result.parents) ? result.parents.map((e) => ({ ...e })) : []

  // 기존 placeholder 정리
  const hasPlaceholder = people.some((p) => p.name === '입력 내용')
  if (hasPlaceholder) {
    // placeholder만 제거(동일 id 기반 edges가 없으니 안전)
    for (let i = people.length - 1; i >= 0; i -= 1) {
      if (people[i].name === '입력 내용') people.splice(i, 1)
    }
    // 안전하게 edges도 placeholder 이름 기반으로 남기지 않음
    // (이번 MVP에서는 focus 주도 그래프를 우선 사용)
  }

  const ensurePerson = ({ name, gender, level, col, row }) => {
    // 이름을 기준으로 먼저 찾고, 성별/좌표는 필요시 덮어쓴다.
    // (AI가 gender를 unknown으로 내보내는 케이스를 방지)
    let person = people.find((p) => p.name === name)
    if (!person) {
      const id = `${name}-${gender}-focus`
      person = {
        id,
        name,
        gender,
        birthYear: null,
        level,
        col,
        row,
      }
      people.push(person)
    } else {
      person.level = level
      person.col = col
      person.row = row
      person.gender = gender
    }
    return person.id
  }

  const clientId = ensurePerson({
    name: activeFocus.clientName,
    gender: 'male',
    level: 1,
    col: 2.0,
    row: 1,
  })
  const spouseId = ensurePerson({
    name: activeFocus.spouseName,
    gender: 'female',
    level: 1,
    col: 1.2,
    row: 1,
  })
  const childId = ensurePerson({
    name: activeFocus.childName,
    gender: activeFocus.childGender,
    level: 2,
    col: 1.6,
    row: 2,
  })

  const hasCouple = couples.some((c) => (c.a === clientId && c.b === spouseId) || (c.a === spouseId && c.b === clientId))
  if (!hasCouple) couples.push({ a: clientId, b: spouseId })

  const ensureParentEdge = (parentId, child) => {
    const exists = parents.some((e) => e.parent === parentId && e.child === child)
    if (!exists) parents.push({ parent: parentId, child })
  }
  ensureParentEdge(clientId, childId)
  ensureParentEdge(spouseId, childId)

  // --- Layout patch (2번 사진 스타일) ---
  // 목표:
  // - 상담자(정성호) 쪽 형제들은 왼쪽 상단 라인에 정렬
  // - 배우자(김진주) 쪽 형제들은 오른쪽 상단 라인에 정렬
  // - 상담자/배우자는 각각 자기 형제선 아래로 길게 떨어지고(렌더러에서 focus로 Y만 내려줌)
  //   둘은 아래에서 긴 결혼선으로 연결
  const peopleById = new Map(people.map((p) => [p.id, p]))
  const parentsByChild = new Map()
  for (const e of parents) {
    if (!e?.parent || !e?.child) continue
    if (!parentsByChild.has(e.child)) parentsByChild.set(e.child, new Set())
    parentsByChild.get(e.child).add(e.parent)
  }

  const getTwoParents = (child) => {
    const set = parentsByChild.get(child)
    if (!set) return null
    const arr = Array.from(set)
    if (arr.length < 2) return null
    return [arr[0], arr[1]]
  }

  const getChildrenOfParents = (p1, p2) => {
    const out = []
    for (const [child, pset] of parentsByChild.entries()) {
      if (pset.has(p1) && pset.has(p2)) out.push(child)
    }
    return out
  }

  // 형제 간 최소 col 간격 (렌더러 xStep과 곱해져 픽셀 간격이 됨)
  const SIBLING_COL_STEP = 1.78
  // 부부는 한 덩어리로 붙인다 (결혼선이 다른 형제 위를 가로지르지 않게)
  const SPOUSE_COL_NEAR = 0.55

  const hasSecondaryCouple = (a, b) =>
    couples.some(
      (c) =>
        c &&
        ((c.a === a && c.b === b) || (c.a === b && c.b === a)) &&
        !((c.a === clientId && c.b === spouseId) || (c.a === spouseId && c.b === clientId)),
    )

  const ensureSecondaryCouple = (a, b) => {
    if (!a || !b || a === b) return
    if (hasSecondaryCouple(a, b)) return
    couples.push({ a, b })
  }

  const normName = (s) =>
    (s ?? '')
      .replace(/\s+/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')

  // AI가 couple 엣지를 빼먹어도 라벨만으로 부부 연결 (setCluster보다 먼저)
  const linkSpousesByKoreanLabels = () => {
    const isL1 = (p) => typeof p?.level === 'number' && Number.isFinite(p.level) && p.level === 1

    for (const p of people) {
      if (!isL1(p)) continue
      const n = normName(p.name)
      if (!n) continue
      const isSisterHusband = /언니.{0,24}의\s*남편|누나.{0,24}의\s*남편|언니의\s*남편|누나의\s*남편/.test(
        p.name ?? '',
      )
      if (!isSisterHusband) continue
      const sib = people.find(
        (x) =>
          x.id !== p.id &&
          isL1(x) &&
          /언니|누나/.test(x.name ?? '') &&
          !/남편/.test(x.name ?? '') &&
          !normName(x.name).includes('언니의') &&
          !normName(x.name).includes('누나의'),
      )
      if (sib) ensureSecondaryCouple(sib.id, p.id)
    }

    for (const p of people) {
      if (!isL1(p)) continue
      if (!/형수/.test(p.name ?? '')) continue
      const sib = people.find(
        (x) =>
          x.id !== p.id &&
          isL1(x) &&
          (/^형\(/.test(x.name ?? '') || (x.name ?? '').startsWith('형(')),
      )
      if (sib) ensureSecondaryCouple(sib.id, p.id)
    }
  }

  linkSpousesByKoreanLabels()

  const setCluster = ({ parentPair, anchorId, side, startCol }) => {
    if (!parentPair) return { usedCols: 0, anchorCol: null, maxCol: startCol }
    const [p1, p2] = parentPair
    let siblingIds = getChildrenOfParents(p1, p2).filter((id) => peopleById.has(id))

    // AI가 일부 형제에게 parent 엣지를 빠뜨리면 getChildrenOfParents에 안 잡혀 같은 col에 겹친다.
    // 같은 조부모 이름/레벨0 부부에 연결된 level1 후보도 형제 줄에 합친다.
    if (siblingIds.length < 2) {
      const gpSet = new Set([p1, p2])
      const extra = []
      for (const p of people) {
        if (p.id === anchorId) continue
        if (typeof p.level !== 'number' || p.level !== 1) continue
        const ps = parentsByChild.get(p.id)
        if (!ps) continue
        const touches = [...ps].filter((x) => gpSet.has(x)).length
        if (touches >= 1) extra.push(p.id)
      }
      const merged = new Set([...siblingIds, ...extra, anchorId])
      siblingIds = [...merged].filter((id) => peopleById.has(id))
    }

    if (!siblingIds.length) return { usedCols: 0, anchorCol: null, maxCol: startCol }

    const sibSetAll = new Set(siblingIds)

    const findSpouseIdFromGraph = (sid) => {
      for (const c of couples) {
        if (!c?.a || !c?.b) continue
        if ((c.a === clientId && c.b === spouseId) || (c.a === spouseId && c.b === clientId)) continue
        const o = c.a === sid ? c.b : c.b === sid ? c.a : null
        if (o == null) continue
        if (!peopleById.has(o)) continue
        // 배우자가 AI에 의해 같은 조부모의 '자녀'로 잘못 묶이면 siblingIds에 들어가지만,
        // 그래도 couples(또는 라벨 추론)로 연결된 배우자는 반드시 인식해야 한다.
        const op = peopleById.get(o)
        // AI가 배우자 level을 1이 아니게 주는 경우가 많아서, '자녀 세대'만 제외
        if (typeof op?.level === 'number' && Number.isFinite(op.level) && op.level >= 2) continue
        return o
      }
      return null
    }

    // couples에 없을 때 흔한 한국어 라벨로 부부 추론 (언니 ↔ 언니의 남편, 형 ↔ 형수)
    const inferSpouseIdByName = (sid) => {
      const s = peopleById.get(sid)
      const raw = s?.name ?? ''
      const nm = raw.replace(/\s+/g, '')
      if (!nm) return null

      // "언니의 남편" / 형수 등 → 혈족 노드 역추적 (배우자도 siblingIds에 들어온 경우 대비)
      if ((/언니|누나/.test(raw) && /남편/.test(raw)) || /언니의\s*남편|누나의\s*남편/.test(raw)) {
        for (const p of people) {
          if (p.id === sid) continue
          const pr = p.name ?? ''
          if (!/언니|누나/.test(pr) || /남편/.test(pr)) continue
          if (/의\s*남편|의남편/.test(pr)) continue
          const op = peopleById.get(p.id)
          if (typeof op?.level === 'number' && Number.isFinite(op.level) && op.level >= 2) continue
          return p.id
        }
      }
      if (/형수/.test(raw)) {
        for (const p of people) {
          if (p.id === sid) continue
          const pr = p.name ?? ''
          if (!/^형\(/.test(pr) && !pr.startsWith('형(')) continue
          const op = peopleById.get(p.id)
          if (typeof op?.level === 'number' && Number.isFinite(op.level) && op.level >= 2) continue
          return p.id
        }
      }

      for (const p of people) {
        if (p.id === sid) continue
        const pr = p.name ?? ''
        const pn = pr.replace(/\s+/g, '')
        if (!pn) continue
        const op = peopleById.get(p.id)
        if (typeof op?.level === 'number' && Number.isFinite(op.level) && op.level >= 2) continue

        if (/언니/.test(nm) && !/남편/.test(nm) && /언니의\s*남편|언니의남편|언니\(이름미상\)의남편/.test(pn)) return p.id
        if (/누나/.test(nm) && !/남편/.test(nm) && /누나의\s*남편|누나의남편/.test(pn)) return p.id
        if ((/^형\(/.test(nm) || nm.startsWith('형(')) && /형수/.test(pr)) return p.id
        if ((/오빠/.test(nm) || /^오빠\(/.test(nm)) && (/오빠의\s*아내|오빠의아내/.test(pr) || /형수/.test(pr))) return p.id
      }
      return null
    }

    const resolveSpouseId = (sid) => {
      let sp = findSpouseIdFromGraph(sid)
      if (!sp) sp = inferSpouseIdByName(sid)
      if (sp) {
        ensureSecondaryCouple(sid, sp)
        const spPerson = peopleById.get(sp)
        if (spPerson && (typeof spPerson.level !== 'number' || !Number.isFinite(spPerson.level) || spPerson.level >= 2)) {
          spPerson.level = 1
        }
        if (spPerson) spPerson.row = 1
      }
      return sp
    }

    // 표준 가계도 줄 세기: 혈족(형제) 전부를 호칭/나이 순으로 먼저 두고,
    // 그 다음에 혈족 순서대로 배우자만 이어 붙인다. (예: 언니 → 남동생 → 언니의 남편 → 앵커)
    // 부부는 col이 떨어져 있어도 결혼선으로 연결된다.
    const others = siblingIds.filter((id) => id !== anchorId)
    const byName = (a, b) => (peopleById.get(a)?.name ?? '').localeCompare(peopleById.get(b)?.name ?? '')
    const bloodRank = (id) => {
      const n = peopleById.get(id)?.name ?? ''
      if (/남동생/.test(n)) return 40
      if (/여동생/.test(n)) return 35
      if (/언니|누나/.test(n)) return 10
      if (/형/.test(n) && !/형수/.test(n)) return 20
      if (/오빠/.test(n)) return 20
      return 25
    }
    const isLikelyInLawSiblingRow = (id) => {
      const raw = peopleById.get(id)?.name ?? ''
      if (/형수/.test(raw)) return true
      if (/(?:언니|누나|형|오빠).{0,24}의\s*남편/.test(raw)) return true
      if (/(?:형|오빠).{0,24}의\s*아내/.test(raw)) return true
      if (/며느리|사위/.test(raw)) return true
      return false
    }

    const bloodIds = [...others]
      .filter((id) => !isLikelyInLawSiblingRow(id))
      .sort((a, b) => bloodRank(a) - bloodRank(b) || byName(a, b))

    // 1) 혈족을 먼저 넣고, 배우자가 있으면 바로 옆에 붙여서 정렬(Pairing)
    const pairedOrdered = []
    const seenSp = new Set()
    for (const sid of bloodIds) {
      pairedOrdered.push(sid)
      const sp = resolveSpouseId(sid)
      if (sp && !seenSp.has(sp)) {
        pairedOrdered.push(sp)
        seenSp.add(sp)
      }
    }

    // 2) Anchor(상담자/배우자 본인) 위치 결정 (Left는 맨 앞, Right는 맨 뒤)
    const ordered = side === 'left'
      ? [anchorId, ...pairedOrdered]
      : [...pairedOrdered, anchorId]

    let cursor = startCol
    let minC = Infinity
    let maxC = -Infinity

    // 3) 배우자는 가깝게(SPOUSE_COL_NEAR), 형제는 멀게(SIBLING_COL_STEP) 간격 부여
    for (let i = 0; i < ordered.length; i += 1) {
      const sid = ordered[i]
      const s = peopleById.get(sid)
      if (!s) continue
      s.level = 1
      s.row = 1
      s.col = cursor
      minC = Math.min(minC, s.col)
      maxC = Math.max(maxC, s.col)
      const nextId = ordered[i + 1]
      if (nextId && hasSecondaryCouple(sid, nextId)) {
        cursor += SPOUSE_COL_NEAR
      } else {
        cursor += SIBLING_COL_STEP
      }
    }

    const midCol = minC !== Infinity && maxC !== -Infinity ? (minC + maxC) / 2 : startCol
    for (const pid of [p1, p2]) {
      const pp = peopleById.get(pid)
      if (!pp) continue
      if (typeof pp.level !== 'number' || !Number.isFinite(pp.level)) pp.level = 0
      pp.row = 0
      pp.col = midCol
    }

    const anchorCol = peopleById.get(anchorId)?.col ?? null
    return { usedCols: ordered.length, anchorCol, maxCol: maxC === -Infinity ? startCol : maxC }
  }

  const clientParents = getTwoParents(clientId)
  const spouseParents = getTwoParents(spouseId)

  // 왼쪽 클러스터(상담자 쪽) + 오른쪽 클러스터(배우자 쪽) 사이에 큰 간격을 둬서
  // 아래 결혼선이 길게 뻗어도 다른 선/도형을 침범하지 않게 한다.
  const left = setCluster({ parentPair: clientParents, anchorId: clientId, side: 'left', startCol: 0 })
  const gap = 7.2
  const rightStart = (typeof left.maxCol === 'number' ? left.maxCol : 0) + gap
  const right = setCluster({ parentPair: spouseParents, anchorId: spouseId, side: 'right', startCol: rightStart })

  // 상담자/배우자 부부 + 자녀 위치:
  // - 상담자/배우자는 각 클러스터의 극단에 있으므로, 자녀는 둘의 중간 col로 배치해서 중심 아래로 떨어지게 한다.
  const clientCol = peopleById.get(clientId)?.col
  const spouseCol = peopleById.get(spouseId)?.col
  if (typeof clientCol === 'number' && typeof spouseCol === 'number') {
    const mid = (clientCol + spouseCol) / 2
    const child = peopleById.get(childId)
    if (child) {
      child.level = 2
      child.row = 3
      child.col = mid
    }
  }

  // setCluster 이후에도 전체 level1 열 간격을 한 번 더 정리한다. (부부는 같은 줄에서 떨어져 있을 수 있음)
  const isLevel1 = (p) => typeof p?.level === 'number' && Number.isFinite(p.level) && p.level === 1

  // 부부(level1 커플)는 서로 붙어 있으면 더 좁은 최소 간격을 허용, 그 외는 더 넓게
  const marriedPairKey = (id1, id2) => [id1, id2].sort().join('|')
  const level1Married = new Set()
  for (const c of couples) {
    if (!c?.a || !c?.b) continue
    if ((c.a === clientId && c.b === spouseId) || (c.a === spouseId && c.b === clientId)) continue
    const pa = peopleById.get(c.a)
    const pb = peopleById.get(c.b)
    if (!isLevel1(pa) || !isLevel1(pb)) continue
    level1Married.add(marriedPairKey(c.a, c.b))
  }

  const MIN_LEVEL1_COL_SEP = 1.45
  const MIN_SPOUSE_PAIR_SEP = SPOUSE_COL_NEAR
  const level1People = people
    .filter((p) => typeof p.level === 'number' && Number.isFinite(p.level) && p.level === 1)
    .slice()
    .sort((a, b) => (a.col ?? 0) - (b.col ?? 0))
  for (let i = 1; i < level1People.length; i += 1) {
    const prev = level1People[i - 1]
    const cur = level1People[i]
    const pair = marriedPairKey(prev.id, cur.id)
    const minSep = level1Married.has(pair) ? MIN_SPOUSE_PAIR_SEP : MIN_LEVEL1_COL_SEP
    const diff = (cur.col ?? 0) - (prev.col ?? 0)
    if (diff < minSep) {
      cur.col = (prev.col ?? 0) + minSep
    }
  }

  // 3세대 자녀가 부모 부부선의 정확한 중앙(centerX)에서 시작하도록 값 주입
  for (const child of people) {
    if (child.level === 2) {
      const myParents = parents.filter((e) => e.child === child.id).map((e) => e.parent)
      if (myParents.length === 2) {
        const p1 = peopleById.get(myParents[0])
        const p2 = peopleById.get(myParents[1])
        if (p1 && p2 && p1.col != null && p2.col != null) {
          child.parentCenterX = (p1.col + p2.col) / 2
        }
      } else if (myParents.length === 1) {
        const p1 = peopleById.get(myParents[0])
        if (p1 && p1.col != null) child.parentCenterX = p1.col
      }
    }
  }

  return {
    ...result,
    people,
    couples,
    parents,
    meta: {
      ...(result.meta ?? {}),
      cohabitingIds: [clientId, spouseId, childId],
    },
  }
}

const tryRegexExtract = (prompt) => {
  // MVP: cafe 예문 형태를 우선 지원 (스샷처럼 genogram "모양" 나오게 col/row 배치까지 포함)
  const people = []
  const couples = []
  const parents = []

  const addPerson = ({ name, gender, birthYear = null, level, col, row }) => {
    const id = `${name}-${gender}-${birthYear ?? 'na'}-L${level}-C${col}-R${row}`
    if (!people.some((p) => p.id === id)) {
      people.push({ id, name, gender, birthYear, level, col, row })
    }
    return id
  }

  // --- Simple Korean role pattern (년생 없이도 지원) ---
  // 예: "아빠 성광제 엄마 임해정 본인 성시영 아내 안선영 아들 성호랑"
  // -> (부모 부부) -> 본인(자녀) -> 본인 부부 -> 자녀
  const trimName = (s) => (s ?? '').trim()
  const rxName = '([가-힣A-Za-z]+)'
  const mDad = prompt.match(new RegExp(`아빠\\s*${rxName}`))
  const mMom = prompt.match(new RegExp(`엄마\\s*${rxName}`))
  const mSelf = prompt.match(new RegExp(`본인\\s*${rxName}`))
  const mWife = prompt.match(new RegExp(`아내\\s*${rxName}`))
  const mHusband = prompt.match(new RegExp(`남편\\s*${rxName}`))
  const mSon = prompt.match(new RegExp(`아들\\s*${rxName}`))
  const mDaughter = prompt.match(new RegExp(`딸\\s*${rxName}`))

  const dadName0 = trimName(mDad?.[1])
  const momName0 = trimName(mMom?.[1])
  const selfName0 = trimName(mSelf?.[1])
  const spouseName0 = trimName(mWife?.[1] || mHusband?.[1])
  const kidName0 = trimName(mSon?.[1] || mDaughter?.[1])

  if (dadName0 && momName0 && selfName0) {
    // 본인 기준: 부모(0) -> 본인/배우자(1) -> 자녀(2)
    const levelParents = 0
    const levelSelf = 1
    const levelKids = 2

    const dadId = addPerson({ name: dadName0, gender: 'male', level: levelParents, col: 0.9, row: 0 })
    const momId = addPerson({ name: momName0, gender: 'female', level: levelParents, col: 1.5, row: 0 })
    couples.push({ a: dadId, b: momId })

    const selfGender = 'male' // 본인 성별은 데이터가 없으면 기본 남성으로 둠(필요시 UI에서 수정)
    const selfId = addPerson({ name: selfName0, gender: selfGender, level: levelSelf, col: 1.2, row: 1 })
    parents.push({ parent: dadId, child: selfId })
    parents.push({ parent: momId, child: selfId })

    if (spouseName0) {
      const spouseGender = mWife ? 'female' : 'female' // 정보가 없으면 여성으로 두고, UI에서 수정 가능
      const spId = addPerson({ name: spouseName0, gender: spouseGender, level: levelSelf, col: 1.8, row: 1 })
      couples.push({ a: selfId, b: spId })

      if (kidName0) {
        const kidGender = mSon ? 'male' : mDaughter ? 'female' : 'unknown'
        const kidId = addPerson({ name: kidName0, gender: kidGender, level: levelKids, col: 1.5, row: 2 })
        parents.push({ parent: selfId, child: kidId })
        parents.push({ parent: spId, child: kidId })
      }
    }

    return { people, couples, parents, source: 'regex-simple' }
  }

  const motherMatch = prompt.match(/엄마\s+([가-힣A-Za-z]+)\s+(\d{1,4})\s*년생/)
  const fatherMatch = prompt.match(/아빠\s+([가-힣A-Za-z]+)\s+(\d{1,4})\s*년생/)
  const daughterMatch = prompt.match(/딸\s+([가-힣A-Za-z]+)\s+(\d{1,4})\s*년생/)

  const motherName = motherMatch?.[1]
  const motherYear = motherMatch ? Number(motherMatch[2]) : null
  const fatherName = fatherMatch?.[1]
  const fatherYear = fatherMatch ? Number(fatherMatch[2]) : null
  const daughterName = daughterMatch?.[1]
  const daughterYear = daughterMatch ? Number(daughterMatch[2]) : null

  if (!motherName || !fatherName || !daughterName) {
    return {
      people: [
        { id: 'user', name: '입력 내용', gender: 'unknown', birthYear: extractBirthYear(prompt), level: 1, col: 0, row: 0 },
      ],
      couples: [],
      parents: [],
      source: 'regex',
    }
  }

  const hasParentsAlive = /부모님이\s*살아/.test(prompt) || /부모님.*살아/.test(prompt)

  // generation(세대): 0 (부모/형제), 1 (본인/배우자), 2 (자녀)
  // [중요] "텍스트에 등장하지 않은 인물"을 임의로 생성하지 않습니다.
  const levelParents = 0
  const levelSelf = 1
  const levelKids = 2

  const sisterId = /언니/.test(prompt)
    ? addPerson({ name: '언니(이름 미상)', gender: 'female', level: levelParents, col: 0.8, row: 0 })
    : null

  const motherId = addPerson({ name: motherName, gender: 'female', birthYear: motherYear, level: levelParents, col: 1.5, row: 0 })

  const youngerBrotherId = /남동생/.test(prompt)
    ? addPerson({ name: '남동생(이름 미상)', gender: 'male', level: levelParents, col: 1.0, row: 0 })
    : null

  const olderBrotherId = /형/.test(prompt)
    ? addPerson({ name: '형(이름 미상)', gender: 'male', level: levelParents, col: 2.9, row: 0 })
    : null
  const fatherId = addPerson({ name: fatherName, gender: 'male', birthYear: fatherYear, level: levelParents, col: 2.2, row: 0 })

  const ensureUnknownParentsOf = (childName, baseCol) => {
    const dadId = addPerson({ name: `${childName}의 부(미상)`, gender: 'male', level: 0, col: baseCol + 0.3, row: 0 })
    const momId = addPerson({ name: `${childName}의 모(미상)`, gender: 'female', level: 0, col: baseCol, row: 0 })
    couples.push({ a: momId, b: dadId })
    return { dadId, momId }
  }

  const needsUnknownParents = hasParentsAlive || /(부모님|형제|남매|언니|누나|오빠|형|동생|남동생|여동생)/.test(prompt)

  // 외가(엄마 쪽) 형제 묶음이 필요하면 0세대 부모(미상) 생성 + 연결
  if (needsUnknownParents && (sisterId || youngerBrotherId)) {
    const { dadId: mdad, momId: mmom } = ensureUnknownParentsOf(motherName, 0.6)
    parents.push({ parent: mdad, child: motherId })
    parents.push({ parent: mmom, child: motherId })
    if (sisterId) {
      parents.push({ parent: mdad, child: sisterId })
      parents.push({ parent: mmom, child: sisterId })
    }
    if (youngerBrotherId) {
      parents.push({ parent: mdad, child: youngerBrotherId })
      parents.push({ parent: mmom, child: youngerBrotherId })
    }
  }

  // 친가(아빠 쪽) 형제 묶음이 필요하면 0세대 부모(미상) 생성 + 연결
  if (needsUnknownParents && olderBrotherId) {
    const { dadId: fdad, momId: fmom } = ensureUnknownParentsOf(fatherName, 2.8)
    parents.push({ parent: fdad, child: fatherId })
    parents.push({ parent: fmom, child: fatherId })
    parents.push({ parent: fdad, child: olderBrotherId })
    parents.push({ parent: fmom, child: olderBrotherId })
  }

  // root couple + child
  couples.push({ a: motherId, b: fatherId })
  const daughterId = addPerson({ name: daughterName, gender: 'female', birthYear: daughterYear, level: levelKids, col: 1.9, row: 2 })
  parents.push({ parent: motherId, child: daughterId })
  parents.push({ parent: fatherId, child: daughterId })

  // maternal sister spouse + child
  if (sisterId && /결혼/.test(prompt)) {
    if (/언니.*결혼|언니는\s*결혼/.test(prompt)) {
      const sisterSpouseId = addPerson({
        name: '언니의 남편(이름 미상)',
        gender: 'male',
        level: levelParents,
        col: 1.1,
        row: 0,
      })
      couples.push({ a: sisterId, b: sisterSpouseId })

      if (/남자아/.test(prompt)) {
        const boyChildId = addPerson({
          name: '남자아이(이름 미상)',
          gender: 'male',
          level: levelKids,
          col: 1.2,
          row: 2,
        })
        parents.push({ parent: sisterId, child: boyChildId })
        parents.push({ parent: sisterSpouseId, child: boyChildId })
      }
    }
  }

  // paternal older brother spouse + child
  if (olderBrotherId && /형.*결혼|형은\s*결혼/.test(prompt)) {
    const brotherSpouseId = addPerson({
      name: '형수(이름 미상)',
      gender: 'female',
      level: levelParents,
      col: 3.2,
      row: 0,
    })
    couples.push({ a: olderBrotherId, b: brotherSpouseId })

    if (/임신중/.test(prompt)) {
      const pregChildId = addPerson({
        name: '임신중 아이(이름 미상)',
        gender: 'unknown',
        level: levelKids,
        col: 2.6,
        row: 2,
      })
      parents.push({ parent: olderBrotherId, child: pregChildId })
      parents.push({ parent: brotherSpouseId, child: pregChildId })
    } else {
      const childId = addPerson({
        name: '자녀(이름 미상)',
        gender: 'unknown',
        level: levelKids,
        col: 2.6,
        row: 2,
      })
      parents.push({ parent: olderBrotherId, child: childId })
      parents.push({ parent: brotherSpouseId, child: childId })
    }
  }

  // 아주 최소라도 그리기
  if (!people.length) {
    return {
      people: [{ id: 'user', name: '입력 내용', gender: 'unknown', birthYear: extractBirthYear(prompt), level: 1, col: 0, row: 0 }],
      couples: [],
      parents: [],
      source: 'regex',
    }
  }

  return { people, couples, parents, source: 'regex' }
}

const generateWithOpenAI = async ({ prompt, activeTab, counselorName }) => {
  // 개발 편의용 regex fallback은 기본적으로 끕니다.
  // (LLM 누락/실패를 regex가 "조용히" 가려서 데이터가 일부만 저장되는 문제를 방지)
  const allowRegexFallback =
    (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_ALLOW_REGEX_FALLBACK === 'true') || false
  try {
    const res = await fetch('/api/genogram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, activeTab, counselorName }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (allowRegexFallback) return tryRegexExtract(prompt)
      throw new Error(text || `AI API error (${res.status})`)
    }

    let json = await res.json()

    // 최소 정규화
    if (!Array.isArray(json.people)) json.people = []
    if (!Array.isArray(json.couples)) json.couples = []
    if (!Array.isArray(json.parents)) json.parents = []

    json = repairGenogramJson(json)

    // LLM 출력은 col/row/level이 문자열인 경우가 많다.
    // 렌더러는 number가 아니면 fallback(이름순) 배치로 돌아가므로 여기서 숫자 강제 변환.
    const toFiniteNumberOr = (v, fallback) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v)
        if (Number.isFinite(n)) return n
      }
      return fallback
    }
    json.people = json.people.map((p, idx) => {
      const id = typeof p?.id === 'string' && p.id.trim() ? p.id : `p_${idx}`
      return {
        ...p,
        id,
        name: typeof p?.name === 'string' ? p.name : (p?.name ?? '미상'),
        gender: p?.gender ?? 'unknown',
        level: toFiniteNumberOr(p?.level, 0),
        col: toFiniteNumberOr(p?.col, null),
        row: toFiniteNumberOr(p?.row, null),
        birthYear: toFiniteNumberOr(p?.birthYear, null),
      }
    })
    json.source = json.source ?? 'openai'
    return json
  } catch (e) {
    if (allowRegexFallback) return tryRegexExtract(prompt)
    // 상위(UI)에서 실제 원인을 볼 수 있게 메시지를 보존합니다.
    if (e instanceof Error) throw e
    throw new Error('AI API 호출에 실패했습니다.')
  }
}

// ✅ 추출 전용: 텍스트 -> 관계(JSON)까지만. (좌표/레이아웃/렌더 트리거 없음)
export const extractGenogram = async ({ prompt, activeTab, counselorName, spouseName }) => {
  await sleep(20)
  if (activeTab !== '가계도') {
    throw new Error('현재는 "가계도" 탭만 지원합니다.')
  }

  const consultationDate = parseConsultationDate(prompt)
  const focus = parseCohabitingFromPrompt(prompt, counselorName, spouseName)
  const result = await generateWithOpenAI({ prompt, activeTab, counselorName })

  return {
    ...result,
    meta: {
      ...(result?.meta ?? {}),
      consultationDate,
      counselorName: counselorName?.trim() ?? '',
      spouseName: spouseName?.trim() ?? '',
      focusNames: focus
        ? { clientName: focus.clientName, spouseName: focus.spouseName, childName: focus.childName }
        : null,
    },
  }
}

// (호환) 기존 이름을 쓰던 곳이 있으면 추출로만 동작하게 둡니다.
export const generateGenogram = extractGenogram

