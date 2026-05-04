import { useEffect, useMemo, useState } from 'react'
import GenogramViewSimple from './GenogramViewSimple.jsx'
const EVENT_NAME = 'genogram:render'

const normalizeData = (payload) => {
  if (!payload) return null
  const data = payload?.data ?? payload
  if (!data || !Array.isArray(data.people)) return null
  return {
    people: Array.isArray(data.people) ? data.people : [],
    couples: Array.isArray(data.couples) ? data.couples : [],
    parents: Array.isArray(data.parents) ? data.parents : [],
    meta: data.meta ?? {},
  }
}

const GenogramEventHost = ({ initialData = null }) => {
  const [eventData, setEventData] = useState(() => normalizeData(initialData))

  useEffect(() => {
    const handler = (ev) => {
      setEventData(normalizeData(ev?.detail))
    }
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  const data = useMemo(() => eventData, [eventData])
  if (!data) return null

  return (
    <div className="mt-4">
      <div className="mb-2 text-sm font-semibold text-slate-700">이벤트 렌더 프리뷰</div>
      <GenogramViewSimple data={data} />
    </div>
  )
}

export default GenogramEventHost
export { EVENT_NAME as GENOGRAM_RENDER_EVENT }

