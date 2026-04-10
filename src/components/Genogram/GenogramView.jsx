import { useEffect, useMemo, useRef, useState } from 'react'

const getPersonDisplay = (person) => {
  const name = person.name ?? '미상'
  const year = person.birthYear ? `${person.birthYear}년생` : ''
  return { name, year }
}

const genderToStyle = (gender) => {
  switch (gender) {
    case 'male':
      return { shape: 'square', stroke: '#111827' }
    case 'female':
      return { shape: 'circle', stroke: '#111827' }
    default:
      return { shape: 'circle', stroke: '#111827' }
  }
}

const GenogramView = ({ genogram }) => {
  const [localPeople, setLocalPeople] = useState(() => genogram?.people ?? [])
  const [nodePositions, setNodePositions] = useState({})
  const [editMode, setEditMode] = useState(true)
  const svgRef = useRef(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalPeople(genogram?.people ?? [])
    setNodePositions({})
    setEditMode(true)
  }, [genogram])

  const consultationDate = genogram?.meta?.consultationDate ?? ''
  const cohabitingIds = Array.isArray(genogram?.meta?.cohabitingIds) ? genogram.meta.cohabitingIds : []
  const counselorName = genogram?.meta?.counselorName ?? ''
  const spouseName = genogram?.meta?.spouseName ?? ''
  const focusNames = genogram?.meta?.focusNames ?? null

  const peopleById = useMemo(() => new Map(localPeople.map((p) => [p.id, p])), [localPeople])
  const couples = Array.isArray(genogram.couples) ? genogram.couples : []
  const uniqueCouples = useMemo(() => {
    const out = []
    const seen = new Set()
    for (const c of couples) {
      const a = c?.a
      const b = c?.b
      if (!a || !b) continue
      const key = [a, b].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(c)
    }
    return out
  }, [couples])
  const parentEdges = Array.isArray(genogram.parents) ? genogram.parents : []

  if (!genogram?.people?.length) return null

  // 화면에서도 잘 보이도록 간격·도형·글자를 크게 잡는다.
  const xStep = 520
  const yStep = 198
  const genGap12 = 142
  const nodeW = 112
  const nodeH = 112
  const lineStroke = 2.75
  const labelFontMain = 16
  const labelFontSub = 14

  // "부모의 자식" 구간을 따로 빼기:
  // - 부모->자녀 연결선은 숨기고
  // - 자녀(가장 아래 level) 노드만 아래로 이동해서 별도 블록처럼 보이게 한다.
  const renderParentChildLinks = true

  const levels = localPeople
    .map((p) => (typeof p.level === 'number' && Number.isFinite(p.level) ? p.level : 0))
    .filter((v) => typeof v === 'number' && Number.isFinite(v))

  const kidLevel = Math.max(0, ...(levels.length ? levels : [0]))
  const hasKids = localPeople.some((p) => (typeof p.level === 'number' && Number.isFinite(p.level) ? p.level : 0) === kidLevel)
  const hasUpper = localPeople.some((p) => (typeof p.level === 'number' && Number.isFinite(p.level) ? p.level : 0) < kidLevel)
  const kidShiftY = renderParentChildLinks || !hasKids || !hasUpper ? 0 : yStep * 2
  const cols = localPeople
    .map((p) => (typeof p.col === 'number' && Number.isFinite(p.col) ? p.col : p.level))
    .filter((x) => typeof x === 'number' && Number.isFinite(x))
  const minCol = Math.min(...cols, 0)
  const maxCol = Math.max(...cols, 0)

  // fallback positioning when col/row are not provided
  const byLevel = new Map()
  for (const p of localPeople) {
    const level = typeof p.level === 'number' && Number.isFinite(p.level) ? p.level : 0
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(p.id)
  }
  for (const [, ids] of byLevel.entries()) {
    ids.sort((a, b) => (peopleById.get(a)?.name ?? '').localeCompare(peopleById.get(b)?.name ?? ''))
  }

  const fallbackRowById = new Map()
  const fallbackColById = new Map()
  for (const [level, ids] of byLevel.entries()) {
    ids.forEach((id, idx) => {
      if (!fallbackRowById.has(id)) fallbackRowById.set(id, idx)
      if (!fallbackColById.has(id)) fallbackColById.set(id, level)
    })
  }

  const maxRow = Math.max(
    0,
    ...localPeople.map((p) => (typeof p.row === 'number' && Number.isFinite(p.row) ? p.row : fallbackRowById.get(p.id) ?? 0)),
  )

  const getBaseNodeRaw = (id) => {
    const person = peopleById.get(id)

    // Layout engine가 계산한 절대좌표가 있으면 우선 사용합니다.
    const layoutX = Number(person?.layoutX)
    const layoutY = Number(person?.layoutY)
    if (Number.isFinite(layoutX) && Number.isFinite(layoutY)) {
      return { x: layoutX, y: layoutY }
    }

    const colNum = typeof person?.col === 'number' ? person.col : typeof person?.col === 'string' ? Number(person.col) : NaN
    const rowNum = typeof person?.row === 'number' ? person.row : typeof person?.row === 'string' ? Number(person.row) : NaN
    const col = Number.isFinite(colNum) ? colNum : fallbackColById.get(id) ?? 0
    const row = Number.isFinite(rowNum) ? rowNum : fallbackRowById.get(id) ?? 0
    const x = 180 + (col - minCol) * xStep
    let y = 140 + row * yStep

    // 1세대(level 0)와 2세대(level 1) 사이 간격을 더 벌린다.
    const lvl0to2 = person?.level
    if (typeof lvl0to2 === 'number' && Number.isFinite(lvl0to2) && lvl0to2 >= 1) {
      y += genGap12
    }

    // 예시(신랑측)처럼 "상담자/배우자"는 형제들보다 더 아래로 내려오게 해서
    // 부모-자녀 구간의 세로선이 더 길게(강조) 보이도록 한다.
    const isFocusById = cohabitingIds.includes(id)
    const isFocusByName =
      (focusNames?.clientName && person?.name === focusNames.clientName) ||
      (focusNames?.spouseName && person?.name === focusNames.spouseName) ||
      (counselorName && person?.name === counselorName) ||
      (spouseName && person?.name === spouseName)

    if (isFocusById || isFocusByName) {
      const lvl = person?.level
      if (typeof lvl === 'number' && Number.isFinite(lvl) && lvl === 1) {
        y += yStep * 1.4
      }
    }

    // 최하단 level(자녀)만 아래로 내려 별도 블록처럼 보이게 한다.
    const personLevel = person?.level
    const isKid = typeof personLevel === 'number' && Number.isFinite(personLevel) && personLevel === kidLevel
    if (isKid) {
      y += kidShiftY
    }

    return { x, y }
  }

  // 충돌 방지: 같은 세대/같은 row에 있는 도형이 겹치면 자동으로 옆으로 민다.
  // (AI가 parent/couple을 일부 누락해도 "도형 겹침"만큼은 무조건 막는다)
  const baseXOverrideById = useMemo(() => {
    const hasExternalLayout = localPeople.some((p) => Number.isFinite(Number(p.layoutX)) && Number.isFinite(Number(p.layoutY)))
    if (hasExternalLayout) return new Map()

    const minGap = nodeW + 76
    const byRow = new Map() // key -> [{id,x}]
    for (const p of localPeople) {
      const lvl = typeof p.level === 'number' && Number.isFinite(p.level) ? p.level : 0
      const row = typeof p.row === 'number' && Number.isFinite(p.row) ? p.row : fallbackRowById.get(p.id) ?? 0
      const key = `${lvl}:${row}`
      const n = getBaseNodeRaw(p.id)
      if (!byRow.has(key)) byRow.set(key, [])
      byRow.get(key).push({ id: p.id, x: n.x })
    }

    const overrides = new Map()
    for (const items of byRow.values()) {
      items.sort((a, b) => a.x - b.x)
      for (let i = 1; i < items.length; i += 1) {
        const prev = items[i - 1]
        const cur = items[i]
        const nextX = Math.max(cur.x, prev.x + minGap)
        if (nextX !== cur.x) {
          cur.x = nextX
          overrides.set(cur.id, nextX)
        }
      }
    }
    return overrides
  }, [fallbackRowById, localPeople, nodeW])

  const getBaseNode = (id) => {
    const base = getBaseNodeRaw(id)
    const ox = baseXOverrideById.get(id)
    return typeof ox === 'number' && Number.isFinite(ox) ? { x: ox, y: base.y } : base
  }

  const getNode = (id) => {
    const edited = nodePositions?.[id]
    if (edited && typeof edited.x === 'number' && typeof edited.y === 'number') {
      return { x: edited.x, y: edited.y }
    }
    return getBaseNode(id)
  }

  const width = 340 + (maxCol - minCol + 1) * xStep
  const height = 300 + (maxRow + 1) * yStep + kidShiftY

  // 콘텐츠(노드들) 경계 기준으로 viewBox를 잡아 컨테이너에 꽉 차게 보이도록 한다.
  const view = useMemo(() => {
    const hasExternalLayout = localPeople.some(
      (p) => Number.isFinite(Number(p.layoutX)) && Number.isFinite(Number(p.layoutY)),
    )
    // layout 엔진 기반으로 viewBox 범위가 커지는 케이스가 있어,
    // 외부 레이아웃이 있을 때는 여백(padding)을 줄여서 전체 크기/폰트가 작아 보이지 않게 합니다.
    const padX = hasExternalLayout ? 60 : 140
    const padY = hasExternalLayout ? 80 : 170
    if (!localPeople.length) return { minX: 0, minY: 0, w: width, h: height, viewBox: `0 0 ${width} ${height}` }

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const p of localPeople) {
      const n = getBaseNode(p.id)
      minX = Math.min(minX, n.x - nodeW / 2)
      maxX = Math.max(maxX, n.x + nodeW / 2)
      minY = Math.min(minY, n.y - nodeH / 2)
      maxY = Math.max(maxY, n.y + nodeH / 2)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return { minX: 0, minY: 0, w: width, h: height, viewBox: `0 0 ${width} ${height}` }
    }

    const vbMinX = Math.floor(minX - padX)
    const vbMinY = Math.floor(minY - padY)
    const vbW = Math.ceil((maxX - minX) + padX * 2)
    const vbH = Math.ceil((maxY - minY) + padY * 2)
    return {
      minX: vbMinX,
      minY: vbMinY,
      w: vbW,
      h: vbH,
      viewBox: `${vbMinX} ${vbMinY} ${vbW} ${vbH}`,
    }
  }, [getBaseNode, height, localPeople, nodeH, nodeW, width])

  const cohabitingBox = (() => {
    if (!cohabitingIds.length) return null
    const boxPeople = localPeople.filter((p) => cohabitingIds.includes(p.id))
    if (!boxPeople.length) return null

    const pad = 22
    const minX = Math.min(...boxPeople.map((p) => getNode(p.id).x - nodeW / 2))
    const maxX = Math.max(...boxPeople.map((p) => getNode(p.id).x + nodeW / 2))
    const minY = Math.min(...boxPeople.map((p) => getNode(p.id).y - nodeH / 2))
    const maxY = Math.max(...boxPeople.map((p) => getNode(p.id).y + nodeH / 2))

    const x = minX - pad
    const y = minY - pad
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2

    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null

    return (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={18}
        ry={18}
        fill="none"
        stroke="#111827"
        strokeWidth={lineStroke}
        strokeDasharray="6 6"
      />
    )
  })()

  const paths = []
  const snap = (n) => Math.round(n)
  const getMarriageGeom = (a, b) => {
    const na = getNode(a)
    const nb = getNode(b)
    const ba = getBaseNode(a)
    const bb = getBaseNode(b)

    const leftId = na.x < nb.x ? a : b
    const rightId = na.x < nb.x ? b : a
    const leftPartner = na.x < nb.x ? na : nb
    const rightPartner = na.x < nb.x ? nb : na
    const leftBase = ba.x < bb.x ? ba : bb
    const rightBase = ba.x < bb.x ? bb : ba

    const getHalfExtentX = (id) => {
      const person = peopleById.get(id)
      const style = genderToStyle(person?.gender)
      // circle은 r = nodeW/2 - 2 로 그리므로, 선 접점도 그 외곽에 맞춘다.
      return style.shape === 'square' ? nodeW / 2 : nodeW / 2 - 2
    }
    const leftExtent = getHalfExtentX(leftId)
    const rightExtent = getHalfExtentX(rightId)

    // X는 드래그를 반영(가로 이동 가능)하되,
    // 결혼선 기준 Y와 중앙선 시작점은 "기본 좌표"를 기준으로 고정한다.
    const leftX = snap(leftPartner.x + leftExtent)
    const rightX = snap(rightPartner.x - rightExtent)
    const leftY = snap(leftPartner.y)
    const rightY = snap(rightPartner.y)
    const baseMarriageY = snap((leftBase.y + rightBase.y) / 2)
    // 중요: 세로선 시작점은 "실제로 그려진 결혼선"의 정확한 중앙(50:50)이어야 한다.
    // leftX/rightX는 snap 이후 값이므로, 이 둘의 중앙을 다시 snap 해서 일관성을 유지한다.
    const centerX = snap((leftX + rightX) / 2)

    return { na, nb, leftX, rightX, leftY, rightY, marriageY: baseMarriageY, centerX }
  }

  // childId -> Set(parentId)
  const parentsByChild = new Map()
  for (const { parent, child } of parentEdges) {
    if (!peopleById.has(parent) || !peopleById.has(child)) continue
    if (!parentsByChild.has(child)) parentsByChild.set(child, new Set())
    parentsByChild.get(child).add(parent)
  }

  // 1) Marriage line (부부 가로선)
  for (const { a, b } of uniqueCouples) {
    if (!peopleById.has(a) || !peopleById.has(b)) continue
    const { leftX, rightX, leftY, rightY, marriageY } = getMarriageGeom(a, b)

    paths.push(
      <path
        key={`mar-${a}-${b}`}
        d={`M ${leftX} ${leftY} L ${leftX} ${marriageY} L ${rightX} ${marriageY} L ${rightX} ${rightY}`}
        stroke="#111827"
        strokeWidth={lineStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />,
    )
  }

  // 2) Couple -> children (전형적인 genogram 연결: 세로선 + 형제들 가로선)
  for (const { a, b } of uniqueCouples) {
    if (!renderParentChildLinks) continue
    if (!peopleById.has(a) || !peopleById.has(b)) continue

    // layoutX/layoutY 기반의 부부 "결혼선" 중앙에서 자녀 선을 내려보내기 위해,
    // coupleCenterX는 항상 getMarriageGeom(a,b).centerX를 사용합니다.
    const { centerX: coupleCenterX, marriageY } = getMarriageGeom(a, b)

    const children = []
    for (const person of localPeople) {
      const childId = person.id
      const ps = parentsByChild.get(childId)
      if (!ps) continue
      if (ps.has(a) && ps.has(b)) {
        const nc = getNode(childId)
        children.push({ id: childId, x: nc.x, y: nc.y })
      }
    }

    if (!children.length) continue

    children.sort((x, y) => x.y - y.y)

    if (children.length === 1) {
      const only = children[0]
      const childX = snap(only.x)
      const childTopY = snap(only.y - nodeH / 2)
      paths.push(
        <path
          key={`sv-${a}-${b}-${only.id}`}
          d={`M ${coupleCenterX} ${marriageY} V ${marriageY + 40} H ${childX} V ${childTopY}`}
          stroke="#111827"
          strokeWidth={lineStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />,
      )
    } else {
      // 자녀가 2명 이상인 경우만 공용 기준선을 만든다.
      // 형제선은 자녀 노드 "위"에 있어야 한다. (센터 기준으로 그리면 도형을 관통함)
      const baseChildTopYs = children.map((c) => getBaseNode(c.id).y - nodeH / 2)
      const minChildTop = Math.min(...baseChildTopYs)
      // marriageY 바로 아래에서 끊겨 보이지 않도록 최소 낙차를 두고, 형제 가로선은 자녀 윤곽 위에 둔다.
      const minDropPx = 40
      const rawBar = snap(minChildTop - 22)
      const floorY = snap(marriageY + minDropPx)
      const ceilY = snap(minChildTop - 6)
      let siblingY = Math.max(floorY, Math.min(ceilY, rawBar))
      if (ceilY < floorY + 8) {
        siblingY = snap((marriageY + minChildTop) / 2)
      }

      const childXs = children.map((c) => snap(c.x))
      let leftX = Math.min(...childXs, coupleCenterX)
      let rightX = Math.max(...childXs, coupleCenterX)

      paths.push(
        <path
          key={`vc-${a}-${b}`}
          d={`M ${coupleCenterX} ${marriageY} L ${coupleCenterX} ${siblingY}`}
          stroke="#111827"
          strokeWidth={lineStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />,
      )

      // 형제 가로선(1개) + 각자 세로 스텁(배우자와 연결된 것처럼 보이는 가로선 착시 방지)
      paths.push(
        <path
          key={`sl-${a}-${b}`}
          d={`M ${leftX} ${siblingY} L ${rightX} ${siblingY}`}
          stroke="#111827"
          strokeWidth={lineStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />,
      )

      for (const child of children) {
        const childX = snap(child.x)
        const childTopY = snap(child.y - nodeH / 2)
        paths.push(
          <path
            key={`sv-${a}-${b}-${child.id}`}
            d={`M ${childX} ${siblingY} L ${childX} ${childTopY}`}
            stroke="#111827"
            strokeWidth={lineStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />,
        )
      }
    }
  }

  const nodes = localPeople.map((person) => {
    const { x, y } = getNode(person.id)
    const { name, year } = getPersonDisplay(person)
    const style = genderToStyle(person.gender)

    const common = {
      stroke: style.stroke,
      strokeWidth: lineStroke,
      fill: '#ffffff',
    }

    const symbol =
      style.shape === 'square' ? (
        <rect x={x - nodeW / 2} y={y - nodeH / 2} width={nodeW} height={nodeH} {...common} rx={14} />
      ) : (
        <circle cx={x} cy={y} r={nodeW / 2 - 3} {...common} />
      )

    return (
      <g
        key={person.id}
        style={{ cursor: editMode ? 'grab' : 'default' }}
        onDoubleClick={() => {
          if (!editMode) return
          const nextName = window.prompt('이름', person.name ?? '')
          if (nextName == null) return
          const nextYearRaw = window.prompt('출생년도(예: 95). 비우면 미상', person.birthYear ?? '')
          if (nextYearRaw == null) return
          const nextYear = nextYearRaw.trim() === '' ? null : Number(nextYearRaw)
          setLocalPeople((prev) =>
            prev.map((p) =>
              p.id === person.id
                ? {
                    ...p,
                    name: nextName,
                    birthYear: Number.isFinite(nextYear) ? nextYear : null,
                  }
                : p,
            ),
          )
        }}
        onPointerDown={(e) => {
          if (!editMode) return
          if (e.button !== 0) return
          e.preventDefault()
          e.stopPropagation()

          const svg = svgRef.current
          if (!svg) return

          const move = (ev) => {
            const rect = svg.getBoundingClientRect()
            const vbX = view.minX + ((ev.clientX - rect.left) / rect.width) * view.w
            const vbY = view.minY + ((ev.clientY - rect.top) / rect.height) * view.h
            const clampedX = Math.max(view.minX + nodeW / 2, Math.min(view.minX + view.w - nodeW / 2, vbX))
            const clampedY = Math.max(view.minY + nodeH / 2, Math.min(view.minY + view.h - nodeH / 2, vbY))
            setNodePositions((prev) => ({
              ...prev,
              [person.id]: { x: clampedX, y: clampedY },
            }))
          }

          window.addEventListener('pointermove', move)
          window.addEventListener(
            'pointerup',
            () => {
              window.removeEventListener('pointermove', move)
            },
            { once: true },
          )
        }}
      >
        {symbol}
        <text x={x} y={y + nodeH / 2 + 22} textAnchor="middle" fontSize={labelFontMain} fill="#111827" fontWeight="600">
          {name}
        </text>
        {year ? (
          <text x={x} y={y + nodeH / 2 + 44} textAnchor="middle" fontSize={labelFontSub} fill="#374151">
            {year}
          </text>
        ) : null}
      </g>
    )
  })

  const handleDownloadSvg = () => {
    const svgEl = svgRef.current
    if (!svgEl) return

    // 이벤트 핸들러 같은 동적 요소는 포함되지 않도록 SVG만 직렬화
    const clone = svgEl.cloneNode(true)
    if (clone instanceof Element && !clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    }

    const source = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `family-genogram-${Date.now()}.svg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="relative w-full rounded-lg border border-slate-200 bg-white px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div />
        <button
          type="button"
          onClick={handleDownloadSvg}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          다운로드
        </button>
      </div>

      <div className="relative mt-3 flex min-h-[min(78vh,960px)] items-start justify-center rounded-md border border-slate-300 bg-slate-50/80 px-4 py-8">
        {consultationDate ? (
          <div className="absolute bottom-3 right-4 text-xs font-semibold text-slate-700">
            상담일 {consultationDate}
          </div>
        ) : null}

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={view.viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="가계도"
          className="block h-full w-full"
        >
          {cohabitingBox}
          {paths}
          {nodes}
        </svg>
      </div>

      <div className="mt-4 flex justify-center gap-4">
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className="rounded-md bg-slate-200 px-5 py-2 text-sm font-semibold text-slate-900"
        >
          {editMode ? '수정 모드 끄기' : '직접 수정하기'}
        </button>
        <button
          type="button"
          onClick={() => {
            setLocalPeople(genogram?.people ?? [])
            setNodePositions({})
            setEditMode(true)
          }}
          className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
        >
          다시하기
        </button>
      </div>
    </div>
  )
}

export default GenogramView

