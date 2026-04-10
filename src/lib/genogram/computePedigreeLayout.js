// Deterministic Pedigree (Pedigree Chart) layout
// - LLM이 SVG 좌표를 만들지 않게 하고, 여기서만 x/y를 계산합니다.
// - 렌더러(GenogramView)는 nodes의 x/y를 그대로 사용합니다.

const keyOfCouple = (a, b) => [a, b].sort().join('|')

const defaultBloodRank = (peopleById, id) => {
  const n = peopleById.get(id)?.name ?? ''
  // 호칭/나이 패턴이 들어온다는 가정(주인님 프로젝트의 기존 규칙을 최대한 재사용)
  if (/남동생/.test(n)) return 40
  if (/여동생/.test(n)) return 35
  if (/언니|누나/.test(n)) return 10
  if (/형/.test(n) && !/형수/.test(n)) return 20
  if (/오빠/.test(n)) return 20
  return 25
}

const defaultNameCompare = (peopleById, a, b) =>
  (peopleById.get(a)?.name ?? '').localeCompare(peopleById.get(b)?.name ?? '')

/**
 * @param {Object} params
 * @param {Array} params.people - [{id,name,gender,level}]
 * @param {Array} params.couples - [{a,b}]
 * @param {Array} params.parents - [{parent,child}]
 * @param {Object} params.options
 * @returns {Object} positions - { [id]: { x, y } }
 */
export const computePedigreeLayout = ({ people, couples, parents, options }) => {
  const opts = {
    nodeW: 112,
    nodeH: 112,
    coupleGap: 70,
    siblingGap: 90,
    // 형제 간격/배치는 deterministic하게 계산합니다.
    // (특정 형제만 과도하게 밀리는 현상은 capping 대신 slot 폭/간격 계산을 분리해서 해결합니다.)
    siblingSlotMaxWidth: null,
    groupSpacing: 180,
    // 외가(오른쪽) 쪽이 중앙에서 너무 멀어 보일 때를 대비한 조정값
    // (anchors가 들어온 경우에만 적용)
    rightGroupSpacingMultiplier: 0.55,
    betweenMidRightSpacingMultiplier: 0.38,
    verticalSpacing: 198,
    baseY: 140,
    baseX: 200,
    anchors: null, // { leftAnchorId, rightAnchorId } (선택)
    // 2세대(부모 세대)에서 형제 가로선(sl)의 최대 길이(픽셀).
    // 렌더러는 자녀 노드 x로 바를 그리기 때문에, 여기서 자녀 x 분배를 줄이면 자연스럽게 해결됩니다.
    siblingBarSpanMaxPx: 520,
    ...options,
  }

  const peopleById = new Map((people ?? []).map((p) => [p.id, p]))

  // Unique couples (order-insensitive)
  const uniqueCouples = []
  const seen = new Set()
  for (const c of Array.isArray(couples) ? couples : []) {
    if (!c?.a || !c?.b) continue
    const k = keyOfCouple(c.a, c.b)
    if (seen.has(k)) continue
    seen.add(k)
    uniqueCouples.push({ a: c.a, b: c.b, key: k })
  }

  const coupleByKey = new Map(uniqueCouples.map((c) => [c.key, c]))

  // Couple key lookup by member. (If a member appears multiple times, keep first.)
  const unitKeyByMember = new Map()
  for (const c of uniqueCouples) {
    if (!unitKeyByMember.has(c.a)) unitKeyByMember.set(c.a, c.key)
    if (!unitKeyByMember.has(c.b)) unitKeyByMember.set(c.b, c.key)
  }

  const parentsByChild = new Map()
  for (const e of Array.isArray(parents) ? parents : []) {
    if (!e?.parent || !e?.child) continue
    if (!peopleById.has(e.parent) || !peopleById.has(e.child)) continue
    if (!parentsByChild.has(e.child)) parentsByChild.set(e.child, new Set())
    parentsByChild.get(e.child).add(e.parent)
  }

  // childrenByCoupleKey: only when child's parent set matches an existing couple key.
  const childrenByCoupleKey = new Map()
  for (const [childId, parentSet] of parentsByChild.entries()) {
    const parentArr = Array.from(parentSet).filter((pid) => peopleById.has(pid))
    if (parentArr.length < 2) continue
    // brute pair check (small graphs)
    for (let i = 0; i < parentArr.length; i += 1) {
      for (let j = i + 1; j < parentArr.length; j += 1) {
        const k = keyOfCouple(parentArr[i], parentArr[j])
        if (!coupleByKey.has(k)) continue
        if (!childrenByCoupleKey.has(k)) childrenByCoupleKey.set(k, [])
        childrenByCoupleKey.get(k).push(childId)
      }
    }
  }

  // Ensure unique children per couple key
  for (const [k, arr] of childrenByCoupleKey.entries()) {
    const s = new Set(arr)
    childrenByCoupleKey.set(k, Array.from(s))
  }

  const bloodRank = (id) => (options?.bloodRank ? options.bloodRank(peopleById, id) : defaultBloodRank(peopleById, id))
  const nameCompare = (a, b) => (options?.nameCompare ? options.nameCompare(peopleById, a, b) : defaultNameCompare(peopleById, a, b))

  // unitWidth cache
  const unitWidth = new Map()
  const widthOfSolo = () => opts.nodeW
  const widthOfCouple = () => opts.nodeW * 2 + opts.coupleGap

  // 형제 배치(가로 간격)는 "하위 자녀 서브트리 폭"이 아니라,
  // 해당 레벨에서 실제로 차지하는 심볼 폭(=solo/couple base width)만 기준으로 잡는다.
  // 그래야 특정 형제(예: 본인은 couple이고 아래에 자녀가 많아서 subtree width가 커지는 경우)만
  // 과도하게 밀려나는 현상을 줄일 수 있다.
  const slotWidthOfUnit = (unitKey) => {
    const isCouple = coupleByKey.has(unitKey)
    return isCouple ? widthOfCouple() : widthOfSolo()
  }

  // Determine which unit key represents an individual.
  const unitKeyOfPerson = (pid) => unitKeyByMember.get(pid) ?? pid

  const widthOfUnit = (unitKey) => {
    if (unitWidth.has(unitKey)) return unitWidth.get(unitKey)

    const isCouple = coupleByKey.has(unitKey)
    if (!isCouple) {
      unitWidth.set(unitKey, widthOfSolo())
      return widthOfSolo()
    }

    const baseW = widthOfCouple()
    const children = childrenByCoupleKey.get(unitKey) ?? []
    if (!children.length) {
      unitWidth.set(unitKey, baseW)
      return baseW
    }

    const sortedChildren = children.slice().sort((a, b) => bloodRank(a) - bloodRank(b) || nameCompare(a, b))

    let totalChildrenW = 0
    for (let i = 0; i < sortedChildren.length; i += 1) {
      const childId = sortedChildren[i]
      const childUnitKey = unitKeyOfPerson(childId)
    totalChildrenW += widthOfUnit(childUnitKey)
      if (i < sortedChildren.length - 1) totalChildrenW += opts.siblingGap
    }

    const finalW = Math.max(baseW, totalChildrenW)
    unitWidth.set(unitKey, finalW)
    return finalW
  }

  const positions = {}
  const visitedPlace = new Set()

  const getGeneration = (pid) => {
    const lv = peopleById.get(pid)?.level
    const n = typeof lv === 'number' ? lv : Number(lv)
    return Number.isFinite(n) ? n : 0
  }

  const placeUnit = (unitKey, startX, xMode = 'subtree') => {
    if (!unitKey) return

    // prevent deep recursion cycles
    if (visitedPlace.has(unitKey)) {
      // Still allow re-placement in some complex graphs; do nothing for now.
      return
    }
    visitedPlace.add(unitKey)

    // siblings row에서는 cursor를 slotWidth로 움직이는데,
    // centerX를 subtree width로 잡으면 (w - slotW)/2 만큼 "밀림"이 생김.
    // 그래서 xMode==='slot'일 땐 slotWidth 기준으로 centerX를 계산한다.
    const w = xMode === 'slot' ? slotWidthOfUnit(unitKey) : widthOfUnit(unitKey)
    const centerX = startX + w / 2

    const isCouple = coupleByKey.has(unitKey)
    if (isCouple) {
      const { a, b } = coupleByKey.get(unitKey)
      const aGender = peopleById.get(a)?.gender
      // male(square) left, female(circle) right
      const leftId = aGender === 'male' ? a : b
      const rightId = leftId === a ? b : a

      const gen = getGeneration(leftId)
      const y = opts.baseY + gen * opts.verticalSpacing

      positions[leftId] = { x: centerX - (opts.nodeW + opts.coupleGap) / 2, y }
      positions[rightId] = { x: centerX + (opts.nodeW + opts.coupleGap) / 2, y }

      const children = childrenByCoupleKey.get(unitKey) ?? []
      if (children.length) {
        const sortedChildren = children.slice().sort((x, y2) => bloodRank(x) - bloodRank(y2) || nameCompare(x, y2))
        const n = sortedChildren.length

        // [문제 대응] 렌더러/바만 자르기보다, 이미 배치된(visited) 유닛은 제외하고
        // 실제로 새로 배치되는 자녀(activeN)만 기준으로 간격(effectiveSiblingGap)을 계산합니다.
        const activeChildren = sortedChildren.filter((cid) => !visitedPlace.has(unitKeyOfPerson(cid)))
        const activeN = activeChildren.length

        let effectiveSiblingGap = opts.siblingGap
        if (gen === 1 && activeN > 1) {
          const siblingBarMax = opts.siblingBarSpanMaxPx
          const slotWidths = activeChildren.map((childId) => slotWidthOfUnit(unitKeyOfPerson(childId)))
          const slotSum = slotWidths.reduce((a, b) => a + b, 0)
          const spanAtGap0 = slotSum - (slotWidths[0] + slotWidths[activeN - 1]) / 2
          const computed = (siblingBarMax - spanAtGap0) / (activeN - 1)
          effectiveSiblingGap = Math.max(0, Math.min(opts.siblingGap, computed))
        }

        let totalChildrenW = 0
        for (let i = 0; i < activeN; i += 1) {
          const childUnitKey = unitKeyOfPerson(activeChildren[i])
          totalChildrenW += slotWidthOfUnit(childUnitKey)
          if (i < activeN - 1) totalChildrenW += effectiveSiblingGap
        }

        let cursor = activeN > 0 ? centerX - totalChildrenW / 2 : centerX
        for (let i = 0; i < activeN; i += 1) {
          const childUnitKey = unitKeyOfPerson(activeChildren[i])
          placeUnit(childUnitKey, cursor, 'slot')
          cursor += slotWidthOfUnit(childUnitKey) + effectiveSiblingGap
        }

        // 안전 장치: 제외된 자녀들도 내부 꼬임 방지를 위해 visited 처리는 해줍니다.
        for (const childId of sortedChildren) {
          if (!activeChildren.includes(childId)) {
            visitedPlace.add(unitKeyOfPerson(childId))
          }
        }
      }
    } else {
      const gen = getGeneration(unitKey)
      const y = opts.baseY + gen * opts.verticalSpacing
      positions[unitKey] = { x: centerX, y }
    }
  }

  // Root units: people not present as a child, then map to their unitKey (couple if married)
  const isPersonChild = new Set(parentsByChild.keys())
  const rootPersons = people.filter((p) => !isPersonChild.has(p.id))
  const rootUnits = []
  const seenRoot = new Set()
  for (const p of rootPersons) {
    const u = unitKeyOfPerson(p.id)
    if (!seenRoot.has(u)) {
      seenRoot.add(u)
      rootUnits.push(u)
    }
  }

  const unitMembers = (u) => {
    if (coupleByKey.has(u)) {
      const { a, b } = coupleByKey.get(u)
      return [a, b]
    }
    return [u]
  }

  const minRankOfUnit = (u) => {
    const members = unitMembers(u)
    return Math.min(...members.map((id) => bloodRank(id)))
  }

  // When anchors are provided, split maternal/paternal (or left/right) by ancestry:
  // - left group: rootUnits whose members intersect ancestors(leftAnchorId)
  // - right group: rootUnits whose members intersect ancestors(rightAnchorId)
  // - everything else goes to the middle (keeps old behavior without forcing failure)
  let orderedRootUnits = rootUnits.slice()
  let sideOfRootUnit = new Map() // unitKey -> 'left' | 'mid' | 'right' (anchors mode)
  if (opts?.anchors?.leftAnchorId && opts?.anchors?.rightAnchorId) {
    const computeAncestors = (anchorId) => {
      const anc = new Set([anchorId])
      const stack = [anchorId]
      while (stack.length) {
        const child = stack.pop()
        const ps = parentsByChild.get(child)
        if (!ps) continue
        for (const p of ps) {
          if (!anc.has(p)) {
            anc.add(p)
            stack.push(p)
          }
        }
      }
      return anc
    }

    const leftAnc = computeAncestors(opts.anchors.leftAnchorId)
    const rightAnc = computeAncestors(opts.anchors.rightAnchorId)

    const leftUnits = []
    const rightUnits = []
    const midUnits = []
    for (const u of orderedRootUnits) {
      const members = unitMembers(u)
      const isLeft = members.some((id) => leftAnc.has(id))
      const isRight = members.some((id) => rightAnc.has(id))
      if (isLeft && !isRight) leftUnits.push(u)
      else if (isRight && !isLeft) rightUnits.push(u)
      else midUnits.push(u)
    }

    leftUnits.sort((ua, ub) => minRankOfUnit(ua) - minRankOfUnit(ub))
    rightUnits.sort((ua, ub) => minRankOfUnit(ua) - minRankOfUnit(ub))
    // midUnits keep deterministic ordering
    midUnits.sort((ua, ub) => minRankOfUnit(ua) - minRankOfUnit(ub))

    orderedRootUnits = [...leftUnits, ...midUnits, ...rightUnits]
    for (const u of leftUnits) sideOfRootUnit.set(u, 'left')
    for (const u of midUnits) sideOfRootUnit.set(u, 'mid')
    for (const u of rightUnits) sideOfRootUnit.set(u, 'right')
  } else {
    // Old behavior: sort root units by their min blood rank
    orderedRootUnits.sort((ua, ub) => minRankOfUnit(ua) - minRankOfUnit(ub))
  }

  let curX = opts.baseX
  let prevSide = null
  for (const u of orderedRootUnits) {
    placeUnit(u, curX, 'subtree')
    const nextSide = sideOfRootUnit.get(u) ?? prevSide

    // anchors 모드에서, 외가(right)가 너무 멀어 보이면 spacing을 줄인다.
    let spacing = opts.groupSpacing
    if (opts?.anchors?.leftAnchorId && opts?.anchors?.rightAnchorId) {
      if (prevSide === 'mid' && nextSide === 'right') {
        spacing = opts.groupSpacing * opts.betweenMidRightSpacingMultiplier
      } else if (nextSide === 'right') {
        spacing = opts.groupSpacing * opts.rightGroupSpacingMultiplier
      }
    }

    curX += widthOfUnit(u) + spacing
    prevSide = nextSide
  }

  // Fill missing nodes (rare)
  for (const p of people) {
    if (positions[p.id]) continue
    const gen = getGeneration(p.id)
    positions[p.id] = { x: curX + opts.nodeW, y: opts.baseY + gen * opts.verticalSpacing }
    curX += opts.nodeW + opts.siblingGap
  }

  return positions
}

