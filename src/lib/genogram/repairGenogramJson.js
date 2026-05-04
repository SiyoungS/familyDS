/**
 * LLM genogram JSON deterministic repair (server or client).
 * - Removes parent-child edges that duplicate a marriage in `couples`.
 * - If a child has only one parent edge but that parent has a spouse in `couples`, adds the other parent edge.
 * - For ids like "X의 형|동생|…", copies X's parents onto that sibling node.
 * - Ensures every id referenced in `couples` / `parents` exists in `people`.
 * - Dedupes and sorts arrays for stable output.
 *
 * Hangul in patterns uses \\u escapes so the file stays valid UTF-8 without fragile copy/paste.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function repairGenogramJson(raw) {
  const json =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...raw }
      : { people: [], couples: [], parents: [] }

  let people = Array.isArray(json.people) ? json.people.map((p) => ({ ...p })) : []
  let couples = Array.isArray(json.couples) ? json.couples.map((c) => ({ ...c })) : []
  let parents = Array.isArray(json.parents) ? json.parents.map((e) => ({ ...e })) : []

  const peopleById = new Map()
  for (const p of people) {
    if (p && typeof p.id === 'string' && p.id.trim()) peopleById.set(p.id, p)
  }

  const FEMALE_HINTS = ['\uC544\uB0B4', '\uB204\uB098', '\uC5B8\uB2C8', '\uC5EC\uB3D9\uC0DD', '\uC5B4\uBA38\uB2C8']
  const MALE_HINTS = ['\uB0A8\uD3B8', '\uD615', '\uC624\uBE60', '\uB0A8\uB3D9\uC0DD', '\uC544\uBC84\uC9C0']

  const inferGenderFromId = (id) => {
    const s = String(id ?? '')
    if (FEMALE_HINTS.some((h) => s.includes(h))) return 'female'
    if (MALE_HINTS.some((h) => s.includes(h))) return 'male'
    if (s.includes('\uC758\uBD80') || s.includes('\uC758 \uBD80') || s.includes('\uC758 \uBD80(')) return 'male'
    if (s.includes('\uC758\uBAA8') || s.includes('\uC758 \uBAA8') || s.includes('\uC758 \uBAA8(')) return 'female'
    return 'unknown'
  }

  const defaultLevelForId = (id) => {
    const s = String(id ?? '')
    if (
      s.includes('\uC758\uBD80') ||
      s.includes('\uC758 \uBD80') ||
      s.includes('\uC758 \uBD80(') ||
      s.includes('\uC758\uBAA8') ||
      s.includes('\uC758 \uBAA8') ||
      s.includes('\uC758 \uBAA8(')
    )
      return 0
    return 1
  }

  const ensurePerson = (id) => {
    if (!id || typeof id !== 'string' || !id.trim()) return
    if (peopleById.has(id)) return
    const gender = inferGenderFromId(id)
    const level = defaultLevelForId(id)
    const row = { id, name: `${id}(\uBBF8\uC0C1)`, gender, level, birthYear: null, col: null, row: null }
    people.push(row)
    peopleById.set(id, row)
  }

  for (const c of couples) {
    ensurePerson(c?.a)
    ensurePerson(c?.b)
  }
  for (const e of parents) {
    ensurePerson(e?.parent)
    ensurePerson(e?.child)
  }

  const pairKey = (x, y) => {
    if (!x || !y || x === y) return null
    return x < y ? `${x}\0${y}` : `${y}\0${x}`
  }

  const spousePairs = new Set()
  const spouseOf = new Map()
  for (const c of couples) {
    const a = c?.a
    const b = c?.b
    const k = pairKey(a, b)
    if (k) spousePairs.add(k)
    if (a && b) {
      spouseOf.set(a, b)
      spouseOf.set(b, a)
    }
  }

  // Spouses must not also be linked as parent/child.
  parents = parents.filter((e) => {
    if (!e?.parent || !e?.child) return false
    const k = pairKey(e.parent, e.child)
    if (k && spousePairs.has(k)) return false
    return true
  })

  const parentEdgeSet = new Set()
  const addParentEdge = (parentId, childId) => {
    if (!parentId || !childId || parentId === childId) return
    const k = `${parentId}\0${childId}`
    if (parentEdgeSet.has(k)) return
    parentEdgeSet.add(k)
    parents.push({ parent: parentId, child: childId })
  }

  for (const e of parents) {
    if (e?.parent && e?.child) parentEdgeSet.add(`${e.parent}\0${e.child}`)
  }

  const getParentsOf = (childId) => {
    const out = []
    for (const e of parents) {
      if (e.child === childId) out.push(e.parent)
    }
    return out
  }

  // One biological parent edge + known spouse -> add the other parent edge.
  const childIds = new Set(parents.map((e) => e.child).filter(Boolean))
  for (const childId of childIds) {
    const ps = [...new Set(getParentsOf(childId))]
    if (ps.length !== 1) continue
    const p = ps[0]
    const s = spouseOf.get(p)
    if (!s) continue
    addParentEdge(s, childId)
  }

  const siblingOfRe =
    /^(.+?)\uC758\s*(\uD615|\uB204\uB098|\uC5B8\uB2C8|\uC624\uBE60|\uB0A8\uB3D9\uC0DD|\uC5EC\uB3D9\uC0DD|\uB3D9\uC0DD)$/

  for (const p of people) {
    if (!p?.id) continue
    const m = String(p.id).match(siblingOfRe)
    if (!m) continue
    const anchorId = m[1]
    if (!peopleById.has(anchorId)) continue
    for (const par of getParentsOf(anchorId)) {
      addParentEdge(par, p.id)
    }
  }

  // Two people who co-parent the same child should be a couple (if missing).
  const childrenByPair = new Map()
  for (const e of parents) {
    if (!e.parent || !e.child) continue
    for (const e2 of parents) {
      if (e2.child !== e.child || e2.parent === e.parent) continue
      const k = pairKey(e.parent, e2.parent)
      if (!k) continue
      if (!childrenByPair.has(k)) childrenByPair.set(k, new Set())
      childrenByPair.get(k).add(e.child)
    }
  }
  for (const [k, set] of childrenByPair) {
    if (set.size === 0) continue
    const [x, y] = k.split('\0')
    if (!spousePairs.has(k)) {
      couples.push({ a: x, b: y })
      spousePairs.add(k)
      spouseOf.set(x, y)
      spouseOf.set(y, x)
    }
  }

  const seenP = new Set()
  parents = parents.filter((e) => {
    if (!e?.parent || !e?.child) return false
    const k = `${e.parent}\0${e.child}`
    if (seenP.has(k)) return false
    seenP.add(k)
    return true
  })
  parents.sort((a, b) => {
    const c0 = String(a.parent).localeCompare(String(b.parent), 'ko')
    if (c0 !== 0) return c0
    return String(a.child).localeCompare(String(b.child), 'ko')
  })

  const seenC = new Set()
  couples = couples.filter((c) => {
    if (!c?.a || !c?.b || c.a === c.b) return false
    const k = pairKey(c.a, c.b)
    if (!k || seenC.has(k)) return false
    seenC.add(k)
    return true
  })
  couples.sort((a, b) => {
    const ka = pairKey(a.a, a.b) || ''
    const kb = pairKey(b.a, b.b) || ''
    return ka.localeCompare(kb, 'ko')
  })

  people.sort((a, b) => String(a.id).localeCompare(String(b.id), 'ko'))

  return {
    ...json,
    people,
    couples,
    parents,
  }
}
