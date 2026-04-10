import React, { useMemo } from 'react'

// 가계도 렌더링을 위한 개선된 설정값 (세대 앵커링 + 충돌 방지 + 버스라인)
const CONFIG = {
  NODE_SIZE: 44, // 도형 크기 조금 더 키움 (시인성 확보)
  X_SPACING: 250, // AI의 col 값에 곱할 넓은 가로 간격
  Y_SPACING: 200, // 세대(Level) 간 넓은 세로 간격
  MIN_GAP: 150, // 인물 간 절대 겹치지 않게 하는 최소 간격
  SPOUSE_GAP: 140, // 부부 사이 간격을 넓혀서 텍스트 공간 확보
  OFFSET_X: 100,
  OFFSET_Y: 100,
}

const buildFallbackColByLevel = (people) => {
  const byLevel = new Map()
  for (const p of people) {
    const lv = typeof p?.level === 'number' ? p.level : Number(p?.level ?? 0)
    const level = Number.isFinite(lv) ? lv : 0
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(p)
  }

  // 같은 레벨 내부는 안정적으로 정렬(이름, id)
  for (const [level, arr] of byLevel.entries()) {
    arr.sort((a, b) => {
      const an = a?.name ?? ''
      const bn = b?.name ?? ''
      const nc = an.localeCompare(bn)
      if (nc !== 0) return nc
      return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
    })
    byLevel.set(level, arr)
  }

  const colById = {}
  for (const [level, arr] of byLevel.entries()) {
    for (let i = 0; i < arr.length; i += 1) {
      const id = arr[i]?.id
      if (!id) continue
      colById[id] = i
    }
  }
  return colById
}

const GenogramViewSimple = ({ data }) => {
  if (!data || !data.people) {
    return <div className="p-4 text-slate-500">가계도 데이터가 없습니다.</div>
  }

  const people = Array.isArray(data.people) ? data.people : []
  const couples = Array.isArray(data.couples) ? data.couples : []
  const parents = Array.isArray(data.parents) ? data.parents : []

  // 1) 트리 구조 정렬 및 앵커링 엔진
  const layoutNodes = useMemo(() => {
    const nodeMap = {}
    const fallbackCol = buildFallbackColByLevel(people)

    // normalize
    for (const p of people) {
      const lvRaw = typeof p?.level === 'number' ? p.level : Number(p?.level ?? 0)
      const level = Number.isFinite(lvRaw) ? lvRaw : 0
      const colRaw = typeof p?.col === 'number' ? p.col : Number(p?.col)
      const col = Number.isFinite(colRaw) ? colRaw : fallbackCol[p.id] ?? 0
      nodeMap[p.id] = { ...p, level, col }
    }

    const units = []
    const assignedIds = new Set()

    // [STEP A] 부부를 하나의 묶음(Unit)으로 생성
    for (const c of couples) {
      const pA = nodeMap[c.a]
      const pB = nodeMap[c.b]
      if (!pA || !pB) continue

      // AI가 분석한 col 값을 기준으로 좌/우 자연스럽게 배치 (선 교차 방지)
      let left = pA
      let right = pB
      if ((left.col ?? 0) > (right.col ?? 0)) {
        left = pB
        right = pA
      }

      units.push({
        type: 'couple',
        level: pA.level,
        ids: [pA.id, pB.id],
        col: ((pA.col ?? 0) + (pB.col ?? 0)) / 2,
        left,
        right,
      })
      assignedIds.add(pA.id)
      assignedIds.add(pB.id)
    }

    // [STEP B] 싱글 인원을 묶음(Unit)으로 추가
    for (const p of people) {
      if (assignedIds.has(p.id)) continue
      const node = nodeMap[p.id]
      if (!node) continue
      units.push({
        type: 'individual',
        level: node.level,
        ids: [node.id],
        col: node.col ?? 0,
        node,
      })
    }

    // 세대(Level)별로 분류 (현재는 0/1/2 중심. 그 외 레벨은 원래 col 기반으로 둡니다.)
    const unitsByLevel = {}
    for (const u of units) {
      const lv = typeof u.level === 'number' ? u.level : Number(u.level ?? 0)
      const level = Number.isFinite(lv) ? lv : 0
      if (!unitsByLevel[level]) unitsByLevel[level] = []
      unitsByLevel[level].push(u)
    }

    const level1 = unitsByLevel[1] ?? []
    const level0 = unitsByLevel[0] ?? []
    const level2 = unitsByLevel[2] ?? []

    // [STEP C] 중심 세대(Level 1) 배치 (충돌 방지 로직 적용)
    level1.sort((a, b) => (a.col ?? 0) - (b.col ?? 0))
    let currentX = CONFIG.OFFSET_X
    level1.forEach((u) => {
      const preferredX = (u.col ?? 0) * CONFIG.X_SPACING + CONFIG.OFFSET_X
      const width = u.type === 'couple' ? CONFIG.SPOUSE_GAP : 0

      const startX = Math.max(preferredX, currentX + width / 2)
      u.midX = startX
      u.y = 1 * CONFIG.Y_SPACING + CONFIG.OFFSET_Y

      if (u.type === 'couple') {
        u.left.x = startX - CONFIG.SPOUSE_GAP / 2
        u.right.x = startX + CONFIG.SPOUSE_GAP / 2
        u.left.y = u.right.y = u.y
      } else {
        u.node.x = startX
        u.node.y = u.y
      }

      currentX = startX + width / 2 + CONFIG.MIN_GAP
    })

    // [STEP D] 부모 세대(Level 0) 배치: 자녀들의 한가운데 위치로 강제 이동 (수직 정렬)
    level0.forEach((u) => {
      const childIds = parents.filter((rel) => u.ids.includes(rel.parent)).map((rel) => rel.child)
      const childNodes = childIds.map((id) => nodeMap[id]).filter((n) => n && typeof n.x === 'number')

      let targetX = (u.col ?? 0) * CONFIG.X_SPACING + CONFIG.OFFSET_X
      if (childNodes.length > 0) {
        const minX = Math.min(...childNodes.map((n) => n.x))
        const maxX = Math.max(...childNodes.map((n) => n.x))
        targetX = (minX + maxX) / 2
      }

      u.midX = targetX
      u.y = 0 * CONFIG.Y_SPACING + CONFIG.OFFSET_Y

      if (u.type === 'couple') {
        u.left.x = targetX - CONFIG.SPOUSE_GAP / 2
        u.right.x = targetX + CONFIG.SPOUSE_GAP / 2
        u.left.y = u.right.y = u.y
      } else {
        u.node.x = targetX
        u.node.y = u.y
      }
    })

    // [STEP E] 자녀 세대(Level 2) 배치: 부모의 한가운데 위치 아래로 강제 이동
    level2.forEach((u) => {
      const parentRel = parents.find((rel) => u.ids.includes(rel.child))
      let targetX = (u.col ?? 0) * CONFIG.X_SPACING + CONFIG.OFFSET_X

      if (parentRel) {
        const parentUnit = level1.find((pU) => pU.ids.includes(parentRel.parent))
        if (parentUnit && typeof parentUnit.midX === 'number') {
          targetX = parentUnit.midX
        }
      }

      u.midX = targetX
      u.y = 2 * CONFIG.Y_SPACING + CONFIG.OFFSET_Y

      if (u.type === 'couple') {
        u.left.x = targetX - CONFIG.SPOUSE_GAP / 2
        u.right.x = targetX + CONFIG.SPOUSE_GAP / 2
        u.left.y = u.right.y = u.y
      } else {
        u.node.x = targetX
        u.node.y = u.y
      }
    })

    // Other levels: keep their preferred positions (col 기반) + 단순 충돌만 방지
    for (const [levelKey, arr] of Object.entries(unitsByLevel)) {
      const level = Number(levelKey)
      if (level === 0 || level === 1 || level === 2) continue
      arr.sort((a, b) => (a.col ?? 0) - (b.col ?? 0))
      let xCursor = CONFIG.OFFSET_X
      const y = level * CONFIG.Y_SPACING + CONFIG.OFFSET_Y
      arr.forEach((u) => {
        const preferredX = (u.col ?? 0) * CONFIG.X_SPACING + CONFIG.OFFSET_X
        const width = u.type === 'couple' ? CONFIG.SPOUSE_GAP : 0
        const startX = Math.max(preferredX, xCursor + width / 2)
        u.midX = startX
        u.y = y
        if (u.type === 'couple') {
          u.left.x = startX - CONFIG.SPOUSE_GAP / 2
          u.right.x = startX + CONFIG.SPOUSE_GAP / 2
          u.left.y = u.right.y = y
        } else {
          u.node.x = startX
          u.node.y = y
        }
        xCursor = startX + width / 2 + CONFIG.MIN_GAP
      })
    }

    return nodeMap
  }, [people, couples, parents])

  // 2. 부부 연결선(가로선) 렌더링
  const renderCouples = () => {
    return couples.map((couple, idx) => {
      const p1 = layoutNodes[couple.a]
      const p2 = layoutNodes[couple.b]
      if (!p1 || !p2) return null

      return (
        <line key={`couple-${idx}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#475569" strokeWidth="2.5" />
      )
    })
  }

  // 3. 부모-자식 연결 직각선 (절대 끊기지 않는 버스라인 구조)
  const renderChildLines = () => {
    return couples.map((couple, idx) => {
      const pA = layoutNodes[couple.a]
      const pB = layoutNodes[couple.b]
      if (!pA || !pB) return null

      const midX = (pA.x + pB.x) / 2 // 부부 중앙 X좌표
      const parentY = pA.y
      const busY = parentY + 70 // 부모 밑으로 내려와서 꺾이는 지점

      const childIds = [
        ...new Set(parents.filter((rel) => rel.parent === couple.a || rel.parent === couple.b).map((rel) => rel.child)),
      ].filter(Boolean)

      if (childIds.length === 0) return null

      const childrenNodes = childIds.map((id) => layoutNodes[id]).filter(Boolean)
      if (childrenNodes.length === 0) return null

      const allXs = [midX, ...childrenNodes.map((c) => c.x)].filter((x) => typeof x === 'number' && Number.isFinite(x))
      const minX = Math.min(...allXs)
      const maxX = Math.max(...allXs)

      return (
        <g key={`child-lines-${idx}`}>
          <line x1={midX} y1={parentY} x2={midX} y2={busY} stroke="#475569" strokeWidth="2.5" />
          <line x1={minX} y1={busY} x2={maxX} y2={busY} stroke="#475569" strokeWidth="2.5" />
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

  // 4. 인물(도형 및 텍스트) 렌더링
  const renderNodes = () => {
    return Object.values(layoutNodes).map((person) => {
      if (!person || typeof person.x !== 'number' || typeof person.y !== 'number') return null
      const half = CONFIG.NODE_SIZE / 2

      let shape
      // 사회복지 표준 기호 적용
      if (person.gender === 'male') {
        shape = (
          <rect
            x={person.x - half}
            y={person.y - half}
            width={CONFIG.NODE_SIZE}
            height={CONFIG.NODE_SIZE}
            fill="white"
            stroke="#0f172a"
            strokeWidth="2.5"
          />
        )
      } else if (person.gender === 'female') {
        shape = <circle cx={person.x} cy={person.y} r={half} fill="white" stroke="#0f172a" strokeWidth="2.5" />
      } else {
        // 임신 중이거나 성별 미상인 경우 (삼각형)
        shape = (
          <polygon
            points={`${person.x},${person.y - half} ${person.x - half},${person.y + half} ${person.x + half},${person.y + half}`}
            fill="white"
            stroke="#0f172a"
            strokeWidth="2.5"
          />
        )
      }

      // --- 이름 자동 줄바꿈: '('가 있으면 2줄로 분리 ---
      let nameLine1 = person.name || ''
      let nameLine2 = ''
      const parenIdx = nameLine1.indexOf('(')
      if (parenIdx !== -1) {
        nameLine1 = String(person.name ?? '').substring(0, parenIdx)
        nameLine2 = String(person.name ?? '').substring(parenIdx)
      }

      const textStartY = person.y + half + 20
      const line2Y = textStartY + 16
      const birthY = nameLine2 ? line2Y + 18 : textStartY + 18

      return (
        <g key={person.id}>
          {shape}
          <text x={person.x} y={textStartY} textAnchor="middle" className="text-[14px] font-bold fill-slate-900 tracking-tight">
            {nameLine1}
          </text>
          {nameLine2 ? (
            <text x={person.x} y={line2Y} textAnchor="middle" className="text-[12px] font-medium fill-slate-500 tracking-tight">
              {nameLine2}
            </text>
          ) : null}
          {person.birthYear ? (
            <text x={person.x} y={birthY} textAnchor="middle" className="text-[12px] fill-slate-400 font-medium">
              {person.birthYear}년생
            </text>
          ) : null}
        </g>
      )
    })
  }

  return (
    <div className="w-full h-[700px] overflow-auto bg-slate-50/50 rounded-2xl border border-slate-200 shadow-sm p-8 flex justify-center">
      <svg width="1800" height="800" className="max-w-none">
        {/* 선을 먼저 그려서 도형 뒤로 배치 */}
        {renderCouples()}
        {renderChildLines()}
        {/* 인물 도형 렌더링 */}
        {renderNodes()}
      </svg>
    </div>
  )
}

export default GenogramViewSimple

