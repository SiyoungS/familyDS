import React, { useMemo } from 'react'

const CONFIG = {
  NODE_SIZE: 48,
  X_SPACING: 260,
  Y_SPACING: 200,
  MIN_GAP: 180,
  SPOUSE_GAP: 140,
}

const computeCenterOutLayout = ({ people, couples, parents }) => {
  const nodeMap = {}
  for (const p of people) {
    if (!p?.id) continue
    nodeMap[p.id] = { ...p, level: Number(p.level) || 0 }
  }

  // 위계 보정: parent.level < child.level
  for (let i = 0; i < 6; i += 1) {
    for (const e of parents) {
      const par = nodeMap[e?.parent]
      const ch = nodeMap[e?.child]
      if (!par || !ch) continue
      if (par.level >= ch.level) par.level = ch.level - 1
    }
  }
  const rawLevels = Object.values(nodeMap).map((n) => n.level)
  const minLevel = rawLevels.length ? Math.min(...rawLevels) : 0
  for (const n of Object.values(nodeMap)) n.level -= minLevel

  // level 압축 (y spacing 고정)
  const usedLevels = Array.from(new Set(Object.values(nodeMap).map((n) => n.level))).sort((a, b) => a - b)
  const displayLevel = new Map()
  usedLevels.forEach((lv, idx) => displayLevel.set(lv, idx))

  const peopleById = new Map(Object.values(nodeMap).map((p) => [p.id, p]))

  const parentsByChild = new Map()
  for (const e of parents) {
    const parentId = e?.parent
    const childId = e?.child
    if (!parentId || !childId) continue
    if (!parentsByChild.has(childId)) parentsByChild.set(childId, new Set())
    parentsByChild.get(childId).add(parentId)
  }

  const coupleKey = (a, b) => [a, b].sort().join('|')
  const couplesByKey = new Map()
  for (const c of couples) {
    if (!c?.a || !c?.b) continue
    couplesByKey.set(coupleKey(c.a, c.b), { a: c.a, b: c.b })
  }

  const normalizeCouple = (a, b) => {
    const pA = peopleById.get(a)
    const pB = peopleById.get(b)
    if (!pA || !pB) return null
    // 대원칙: male 왼쪽, female 오른쪽
    if (pA.gender === 'male' && pB.gender === 'female') return { leftId: a, rightId: b }
    if (pA.gender === 'female' && pB.gender === 'male') return { leftId: b, rightId: a }
    // unknown 포함 시 male 우선
    if (pA.gender === 'male') return { leftId: a, rightId: b }
    if (pB.gender === 'male') return { leftId: b, rightId: a }
    // fallback: id 정렬
    return a < b ? { leftId: a, rightId: b } : { leftId: b, rightId: a }
  }

  // ---- unit graph (couple/individual) ----
  const unitByPerson = new Map() // personId -> unitId
  const units = new Map() // unitId -> unit
  const snap = (n) => {
    const v = Number(n)
    return Number.isFinite(v) ? Math.round(v) : 0
  }

  const ensureCoupleUnit = (a, b) => {
    const key = coupleKey(a, b)
    const id = `c:${key}`
    if (units.has(id)) return id
    const norm = normalizeCouple(a, b)
    if (!norm) return null
    const left = peopleById.get(norm.leftId)
    const right = peopleById.get(norm.rightId)
    if (!left || !right) return null
    const level = Math.max(left.level, right.level)
    left.level = level
    right.level = level
    const u = { id, type: 'couple', leftId: norm.leftId, rightId: norm.rightId, level, children: [], midX: 0, gapPx: CONFIG.SPOUSE_GAP }
    units.set(id, u)
    unitByPerson.set(norm.leftId, id)
    unitByPerson.set(norm.rightId, id)
    return id
  }

  // create couple units
  for (const c of couples) {
    if (!c?.a || !c?.b) continue
    ensureCoupleUnit(c.a, c.b)
  }
  // create individual units
  for (const p of peopleById.values()) {
    if (!p?.id) continue
    if (unitByPerson.has(p.id)) continue
    const id = `p:${p.id}`
    units.set(id, { id, type: 'person', personId: p.id, level: p.level, children: [], midX: 0 })
    unitByPerson.set(p.id, id)
  }

  const parentUnitOfChild = new Map() // childUnitId -> parentUnitId
  for (const [childId, pset] of parentsByChild.entries()) {
    const childUnitId = unitByPerson.get(childId)
    if (!childUnitId) continue
    const parr = Array.from(pset)
    let parentUnitId = null
    if (parr.length >= 2) {
      const key = coupleKey(parr[0], parr[1])
      const cup = couplesByKey.get(key)
      if (cup) parentUnitId = ensureCoupleUnit(cup.a, cup.b)
    }
    if (!parentUnitId && parr.length >= 1) parentUnitId = unitByPerson.get(parr[0]) ?? null
    if (!parentUnitId) continue
    parentUnitOfChild.set(childUnitId, parentUnitId)
  }
  for (const [childU, parentU] of parentUnitOfChild.entries()) {
    const pu = units.get(parentU)
    if (!pu) continue
    pu.children.push(childU)
  }

  // subtree width (bottom-up)
  const SUB_GAP = CONFIG.MIN_GAP
  const OUTER_GAP = 200
  const memoW = new Map()
  const unitWidth = (uid) => {
    const u = units.get(uid)
    if (!u) return CONFIG.NODE_SIZE
    if (u.type === 'couple') return Math.max(u.gapPx, CONFIG.NODE_SIZE)
    return CONFIG.NODE_SIZE
  }
  const widthOf = (uid) => {
    if (memoW.has(uid)) return memoW.get(uid)
    const u = units.get(uid)
    if (!u) return CONFIG.NODE_SIZE
    const own = unitWidth(uid)
    if (!u.children?.length) {
      memoW.set(uid, own)
      return own
    }
    let sum = 0
    for (let i = 0; i < u.children.length; i += 1) {
      sum += widthOf(u.children[i])
      if (i < u.children.length - 1) sum += SUB_GAP
    }
    const w = Math.max(own, sum)
    memoW.set(uid, w)
    return w
  }

  const visited = new Set()
  const placeDescendantsSymmetric = (uid, centerX, opts = {}) => {
    const u = units.get(uid)
    if (!u) return
    const force = Boolean(opts.force)
    if (!force && visited.has(uid)) return
    visited.add(uid)

    u.midX = snap(centerX)
    const y = (displayLevel.get(u.level) ?? 0) * CONFIG.Y_SPACING
    if (u.type === 'couple') {
      const left = peopleById.get(u.leftId)
      const right = peopleById.get(u.rightId)
      if (left) {
        left.x = snap(u.midX - u.gapPx / 2)
        left.y = y
      }
      if (right) {
        right.x = snap(u.midX + u.gapPx / 2)
        right.y = y
      }
    } else {
      const p = peopleById.get(u.personId)
      if (p) {
        p.x = u.midX
        p.y = y
      }
    }

    const kids = Array.isArray(u.children) ? u.children.slice() : []
    if (!kids.length) return
    // stable order by original col hint then name
    kids.sort((a, b) => {
      const ua = units.get(a)
      const ub = units.get(b)
      const pa = ua?.type === 'couple' ? peopleById.get(ua.leftId) : peopleById.get(ua?.personId)
      const pb = ub?.type === 'couple' ? peopleById.get(ub.leftId) : peopleById.get(ub?.personId)
      const ca = typeof pa?.col === 'number' ? pa.col : 0
      const cb = typeof pb?.col === 'number' ? pb.col : 0
      if (ca !== cb) return ca - cb
      return String(pa?.name ?? '').localeCompare(String(pb?.name ?? ''))
    })

    const widths = kids.map(widthOf)
    const total = widths.reduce((acc, w) => acc + w, 0) + (kids.length > 1 ? SUB_GAP * (kids.length - 1) : 0)
    let cursor = u.midX - total / 2
    for (let i = 0; i < kids.length; i += 1) {
      const kid = kids[i]
      const w = widths[i]
      const c = cursor + w / 2
      placeDescendantsSymmetric(kid, c, opts)
      cursor += w + SUB_GAP
    }
  }

  // -------- Center-Out 5-step --------
  // 1) 메인 커플 찾기: children(직계) 수가 가장 많은 커플
  const coupleUnits = Array.from(units.values()).filter((u) => u.type === 'couple')
  const descMemo = new Map()
  const descCount = (uid) => {
    if (descMemo.has(uid)) return descMemo.get(uid)
    const u = units.get(uid)
    if (!u) return 0
    let cnt = (u.children?.length || 0)
    for (const c of u.children || []) cnt += descCount(c)
    descMemo.set(uid, cnt)
    return cnt
  }
  // root는 "자손이 많은 커플"이되, 중간세대에 가까운 커플을 우선
  const levelVals = coupleUnits.map((u) => u.level).sort((a, b) => a - b)
  const medianLevel = levelVals.length ? levelVals[Math.floor(levelVals.length / 2)] : 0
  coupleUnits.sort((a, b) => {
    const da = descCount(a.id)
    const db = descCount(b.id)
    if (db !== da) return db - da
    return Math.abs(a.level - medianLevel) - Math.abs(b.level - medianLevel)
  })
  const root = coupleUnits[0] ?? null
  if (root) {
    // Root hard fix
    // 2) 1세대(메인 부부) 좌표 픽스: 남 -100 / 여 +100
    root.gapPx = Math.max(CONFIG.SPOUSE_GAP, 200)
    placeDescendantsSymmetric(root.id, 0, { force: true })

    const husbandId = root.leftId
    const wifeId = root.rightId
    const husband = peopleById.get(husbandId)
    const wife = peopleById.get(wifeId)

    // 2) 상향식 조부모 앵커링: 배우자 X축에 부모 커플 중심을 강제 일치
    const parentCoupleUnitOf = (childId) => {
      const pset = parentsByChild.get(childId)
      if (!pset || pset.size < 2) return null
      const parr = Array.from(pset)
      const key = coupleKey(parr[0], parr[1])
      const cup = couplesByKey.get(key)
      if (!cup) return null
      return ensureCoupleUnit(cup.a, cup.b)
    }

    const husbandGp = parentCoupleUnitOf(husbandId)
    const wifeGp = parentCoupleUnitOf(wifeId)

    if (husbandGp && husband && typeof husband.x === 'number') {
      placeDescendantsSymmetric(husbandGp, husband.x, { force: true })
    }
    if (wifeGp && wife && typeof wife.x === 'number') {
      placeDescendantsSymmetric(wifeGp, wife.x, { force: true })
    }

    // 4) 형제자매 방향 강제: 남편 형제는 남편 왼쪽, 아내 형제는 아내 오른쪽
    const pushSiblingsOutward = (spouseId, side) => {
      const gp = parentCoupleUnitOf(spouseId)
      if (!gp) return
      const gpUnit = units.get(gp)
      if (!gpUnit) return
      const spouseUnitId = unitByPerson.get(spouseId)
      if (!spouseUnitId) return
      const spouseU = units.get(spouseUnitId)
      if (!spouseU) return
      const spouseX = spouseU.midX

      const sibs = (gpUnit.children || []).filter((cid) => cid !== spouseUnitId)
      if (!sibs.length) return

      // subtree 폭 기반으로 외곽으로 밀기
      const widths = sibs.map(widthOf)
      const total = widths.reduce((a, b) => a + b, 0) + (sibs.length > 1 ? SUB_GAP * (sibs.length - 1) : 0)
      let cursor = side === 'left' ? spouseX - OUTER_GAP - total : spouseX + OUTER_GAP

      for (let i = 0; i < sibs.length; i += 1) {
        const sib = sibs[i]
        const w = widths[i]
        const c = cursor + w / 2
        placeDescendantsSymmetric(sib, c, { force: true })
        cursor += w + SUB_GAP
      }
    }

    pushSiblingsOutward(husbandId, 'left')
    pushSiblingsOutward(wifeId, 'right')
  } else {
    // 커플이 없는 데이터는 기존처럼 컴포넌트별로 좌->우 배치
    const childUnits = new Set(parentUnitOfChild.keys())
    const roots = Array.from(units.keys()).filter((uid) => !childUnits.has(uid))
    let x = 0
    for (const uid of roots) {
      const w = widthOf(uid)
      placeDescendantsSymmetric(uid, x + w / 2, { force: true })
      x += w + OUTER_GAP
    }
  }

  // 1) 노드 누락 100% 방지: 아직 배치되지 않은 유닛/인물을 화면 가장자리 랙에라도 배치
  const placedPersonIds = new Set()
  for (const p of peopleById.values()) {
    if (typeof p.x === 'number' && typeof p.y === 'number') placedPersonIds.add(p.id)
  }
  const unplaced = Array.from(peopleById.values()).filter((p) => !placedPersonIds.has(p.id))
  if (unplaced.length) {
    const maxX = Math.max(0, ...Array.from(peopleById.values()).map((p) => (typeof p.x === 'number' ? p.x : 0)))
    const rackX = snap(maxX + OUTER_GAP + 220)
    // 레벨별로 위에서 아래로
    unplaced.sort((a, b) => (a.level - b.level) || String(a.name ?? '').localeCompare(String(b.name ?? '')))
    unplaced.forEach((p, idx) => {
      p.x = rackX + (idx % 2) * (CONFIG.NODE_SIZE + 24)
      p.y = (displayLevel.get(p.level) ?? 0) * CONFIG.Y_SPACING + Math.floor(idx / 2) * (CONFIG.NODE_SIZE + 42)
    })
  }

  // 최종 bounds
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of Object.values(nodeMap)) {
    if (typeof n.x !== 'number' || typeof n.y !== 'number') continue
    minX = Math.min(minX, n.x)
    maxX = Math.max(maxX, n.x)
    minY = Math.min(minY, n.y)
    maxY = Math.max(maxY, n.y)
  }
  if (minX === Infinity) {
    minX = 0
    maxX = 800
    minY = 0
    maxY = 600
  }
  const PAD_X = 110
  const PAD_Y = 90
  return {
    layoutNodes: nodeMap,
    bounds: { x: minX - PAD_X, y: minY - PAD_Y, w: (maxX - minX) + PAD_X * 2, h: (maxY - minY) + PAD_Y * 2 },
  }
}

const GenogramViewSimple = ({ data, className = '' }) => {
  if (!data || !data.people) {
    return <div className="p-4 text-slate-500">가계도 데이터가 없습니다.</div>
  }

  const people = Array.isArray(data.people) ? data.people : []
  const couplesRaw = Array.isArray(data.couples) ? data.couples : []
  const parents = Array.isArray(data.parents) ? data.parents : []

  // 1) 모든 커플 성별 강제 정렬 (male=왼쪽(a), female=오른쪽(b))
  // - 렌더링과 레이아웃이 같은 규칙을 공유하도록, data.couples를 먼저 정규화합니다.
  const couples = useMemo(() => {
    const byId = new Map(people.map((p) => [p?.id, p]))
    return couplesRaw
      .map((c) => {
        const a = c?.a
        const b = c?.b
        if (!a || !b) return null
        const pA = byId.get(a)
        const pB = byId.get(b)
        if (!pA || !pB) return { a, b }
        if (pA.gender === 'female' && pB.gender === 'male') return { a: b, b: a }
        return { a, b }
      })
      .filter(Boolean)
  }, [couplesRaw, people])

  // 1. 다이나믹 세대 레이아웃 엔진 (세대 수 제한 없음)
  const { layoutNodes, bounds } = useMemo(() => {
    return computeCenterOutLayout({ people, couples, parents })
  }, [people, couples, parents])

  const renderCouples = () => {
    return couples.map((couple, idx) => {
      const p1 = layoutNodes[couple.a]
      const p2 = layoutNodes[couple.b]
      if (!p1 || !p2) return null
      return <line key={`couple-${idx}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#475569" strokeWidth="2.5" />
    })
  }

  const renderChildLines = () => {
    return couples.map((couple, idx) => {
      const pA = layoutNodes[couple.a]
      const pB = layoutNodes[couple.b]
      if (!pA || !pB) return null

      // 4) 자식 연결선은 항상 "부모 커플 중앙(midX)"에서 시작
      const parentMidX = (pA.x + pB.x) / 2
      const parentY = pA.y
      // 💡 가로선을 세대 간격(Y_SPACING)의 정확히 "절반" 위치에
      // (글자와 겹치지 않고 위/아래 선 길이가 대칭으로 맞춰짐)
      const busY = parentY + (CONFIG.Y_SPACING / 2)

      const childIds = [
        ...new Set(parents.filter((rel) => rel.parent === couple.a || rel.parent === couple.b).map((rel) => rel.child)),
      ].filter(Boolean)
      if (childIds.length === 0) return null

      const childrenNodes = childIds.map((id) => layoutNodes[id]).filter(Boolean)
      if (childrenNodes.length === 0) return null

      const childXs = childrenNodes.map((c) => c.x)
      const busMinX = Math.min(parentMidX, ...childXs)
      const busMaxX = Math.max(parentMidX, ...childXs)

      return (
        <g key={`child-line-${idx}`}>
          <line x1={parentMidX} y1={parentY} x2={parentMidX} y2={busY} stroke="#475569" strokeWidth="2.5" />
          <line x1={busMinX} y1={busY} x2={busMaxX} y2={busY} stroke="#475569" strokeWidth="2.5" />
          {childrenNodes.map((child) => (
            <line
              key={`to-child-${child.id}`}
              x1={child.x}
              y1={busY}
              x2={child.x}
              y2={child.y - CONFIG.NODE_SIZE / 2}
              stroke="#475569"
              strokeWidth="2.5"
            />
          ))}
        </g>
      )
    })
  }

  const renderNodes = () => {
    return Object.values(layoutNodes).map((person) => {
      if (!person?.id || typeof person.x !== 'number' || typeof person.y !== 'number') return null

      const half = CONFIG.NODE_SIZE / 2
      let shape

      if (person.gender === 'male') {
        shape = (
          <rect
            x={person.x - half}
            y={person.y - half}
            width={CONFIG.NODE_SIZE}
            height={CONFIG.NODE_SIZE}
            fill="white"
            stroke="#0f172a"
            strokeWidth="3"
          />
        )
      } else if (person.gender === 'female') {
        shape = <circle cx={person.x} cy={person.y} r={half} fill="white" stroke="#0f172a" strokeWidth="3" />
      } else {
        shape = (
          <polygon
            points={`${person.x},${person.y - half} ${person.x - half},${person.y + half} ${person.x + half},${person.y + half}`}
            fill="white"
            stroke="#0f172a"
            strokeWidth="3"
          />
        )
      }

      let nameLine1 = person.name || ''
      let nameLine2 = ''
      const parenIdx = nameLine1.indexOf('(')

      if (parenIdx !== -1) {
        nameLine1 = String(person.name ?? '').substring(0, parenIdx)
        nameLine2 = String(person.name ?? '').substring(parenIdx)
      }

      const textStartY = person.y + half + 26
      const line2Y = textStartY + 20
      const birthY = nameLine2 ? line2Y + 22 : textStartY + 22

      return (
        <g key={person.id}>
          {shape}
          <text x={person.x} y={textStartY} textAnchor="middle" className="text-[16px] font-bold fill-slate-900 tracking-tight">
            {nameLine1}
          </text>
          {nameLine2 ? (
            <text x={person.x} y={line2Y} textAnchor="middle" className="text-[14px] font-medium fill-slate-500 tracking-tight">
              {nameLine2}
            </text>
          ) : null}
          {person.birthYear ? (
            <text x={person.x} y={birthY} textAnchor="middle" className="text-[13px] fill-slate-400 font-medium">
              {person.birthYear}년생
            </text>
          ) : null}
        </g>
      )
    })
  }

  return (
    <div
      className={[
        'w-full h-full min-h-[620px] overflow-hidden bg-slate-50/80 flex items-center justify-center p-4',
        className,
      ].join(' ')}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="transition-all duration-300 ease-in-out"
      >
        {renderCouples()}
        {renderChildLines()}
        {renderNodes()}
      </svg>
    </div>
  )
}

export default GenogramViewSimple

