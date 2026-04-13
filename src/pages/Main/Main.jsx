import React, { useEffect, useState } from 'react'
import { extractGenogram } from '../../lib/genogram/generateGenogram.js'
import GenogramViewSimple from '../../components/Genogram/GenogramViewSimple.jsx'

const STORAGE_KEY = 'genogram_history'

const toFiniteNumberOr = (v, fallback) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

// 💡 [핵심] level 번호를 믿지 않고 "진짜 이름" 기반으로 제목을 뽑습니다.
const getRecordTitle = (record, fallbackText = '') => {
  const people = Array.isArray(record?.people) ? record.people : []
  if (people.length === 0) {
    return fallbackText ? `${String(fallbackText).substring(0, 12)}...` : '새로운 상담'
  }

  const cleanName = (name) => String(name ?? '').split('(')[0].trim()
  // 💡 괄호를 자르기 "전" 원본 이름으로 '미상/부/모' 여부를 판정합니다.
  const isRealPersonName = (rawName) => {
    const raw = String(rawName ?? '').trim()
    if (!raw) return false
    if (raw.includes('미상')) return false
    // placeholder 부모(예: "김진주의 부(미상)")가 제목 주인공으로 잡히지 않도록 차단
    if (raw.endsWith('부') || raw.endsWith('모')) return false
    return true
  }

  // 1) couples에서 "진짜 이름" 부부/개인을 우선으로 제목 생성
  const couples = Array.isArray(record?.couples) ? record.couples : []
  if (couples.length > 0) {
    const peopleById = new Map(people.map((p) => [p?.id, p]))
    for (const couple of couples) {
      const pA = peopleById.get(couple?.a)
      const pB = peopleById.get(couple?.b)
      if (!pA || !pB) continue

      const nameA = cleanName(pA.name)
      const nameB = cleanName(pB.name)
      const isAReal = isRealPersonName(pA.name)
      const isBReal = isRealPersonName(pB.name)

      // 1순위: 둘 다 "진짜 사람"인 부부만 메인으로 인정
      if (isAReal && isBReal) return `${nameA} · ${nameB} 가족`
    }
  }

  // 2) 부부 매칭이 안 되면, "미상"이 아닌 첫 번째 인물
  const realPeople = people.filter((p) => isRealPersonName(p?.name))
  if (realPeople.length > 0) {
    return `${cleanName(realPeople[0].name)} 가족`
  }

  // 3) 최후: 입력 텍스트 앞부분
  return fallbackText ? `${String(fallbackText).substring(0, 12)}...` : '가족'
}

const MainPage = () => {
  const [inputText, setInputText] = useState('')
  const [currentData, setCurrentData] = useState(null) // 현재 화면에 보여줄 가계도 데이터
  const [history, setHistory] = useState([]) // 과거 상담 기록 리스트
  const [isLoading, setIsLoading] = useState(false)
  const [isGenogramModalOpen, setIsGenogramModalOpen] = useState(false)

  const getSourceBadge = (record) => {
    const source = String(record?.source ?? '').toLowerCase()
    if (!source) return null
    const isOpenAI = source.includes('openai') || source.includes('gpt')
    const label = isOpenAI ? 'AI' : 'fallback'
    const cls = isOpenAI
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    return <span className={`ml-2 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
  }

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        // 과거 기록 중 title이 비어있던 케이스를 자동 복구
        let fixed = false
        const normalized = parsed.map((rec) => {
          if (!rec || typeof rec !== 'object') return rec
          const title = typeof rec.title === 'string' ? rec.title.trim() : ''
          // 💡 "가족"/"새로운 가족 상담"/빈 제목 등도 함께 치료
          if (title && title !== '가족' && title !== '새로운 가족 상담') return rec
          const next = { ...rec }
          const fallbackText = next.prompt ?? next.originalText ?? ''
          next.title = getRecordTitle(next, fallbackText)
          fixed = true
          return next
        })
        setHistory(normalized)
        if (fixed) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
      }
    } catch {
      // ignore broken storage
    }
  }, [])

  const persistHistory = (next) => {
    setHistory(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const handleGenerate = async () => {
    if (!inputText.trim()) return alert('상담 내용을 입력해주세요.')
    setIsLoading(true)
    try {
      const extracted = await extractGenogram({
        prompt: inputText,
        activeTab: '가계도',
        counselorName: '',
        spouseName: '',
      })

      const newRecord = {
        id: Date.now().toString(),
        title: '',
        date: new Date().toLocaleDateString('ko-KR'),
        prompt: inputText,
        ...extracted, // people/couples/parents/meta...
      }
      newRecord.title = getRecordTitle(newRecord, inputText)

      setCurrentData(newRecord)
      const nextHistory = [newRecord, ...history]
      persistHistory(nextHistory)
      setIsGenogramModalOpen(true)
      setInputText('')
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('생성 실패:', error)
      const msg = error instanceof Error ? error.message : String(error ?? '가계도 생성 중 오류가 발생했습니다.')
      alert(msg || '가계도 생성 중 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectHistory = (record) => {
    setCurrentData(record)
  }

  const handleStartNew = () => {
    setCurrentData(null)
    setInputText('')
    setIsGenogramModalOpen(false)
  }

  const handleDeleteHistory = (e, idToDelete) => {
    e.stopPropagation()
    const nextHistory = history.filter((item) => item.id !== idToDelete)
    persistHistory(nextHistory)
    if (currentData && currentData.id === idToDelete) {
      setCurrentData(null)
      setIsGenogramModalOpen(false)
    }
  }

  return (
    <div className="flex h-screen bg-white">
      {isLoading ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white/55 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-label="가계도 생성 중"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-xl">
            <div className="flex items-center gap-3">
              <svg className="h-6 w-6 animate-spin text-slate-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">AI가 가계도를 생성 중입니다</div>
                <div className="mt-0.5 text-xs text-slate-500">잠시만 기다려 주세요. 화면을 벗어나지 마세요.</div>
              </div>
            </div>
            <style>{`
              @keyframes genogram-indeterminate {
                0% { transform: translateX(-60%); }
                50% { transform: translateX(70%); }
                100% { transform: translateX(220%); }
              }
            `}</style>
            <div className="relative mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-slate-900/70"
                style={{ animation: 'genogram-indeterminate 1.05s ease-in-out infinite' }}
              />
              <div
                className="absolute inset-y-0 left-0 w-1/5 rounded-full bg-slate-900/40"
                style={{ animation: 'genogram-indeterminate 1.05s ease-in-out infinite', animationDelay: '0.18s' }}
              />
            </div>
          </div>
        </div>
      ) : null}
      {/* 왼쪽 사이드바: 상담 히스토리 목록 */}
      <div className="w-80 border-r border-slate-200 bg-slate-50 flex flex-col">
        <div className="p-4 border-b border-slate-200 bg-white flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">상담 기록</h2>
          <button
            onClick={handleStartNew}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
          >
            + 새 상담
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {history.length === 0 ? (
            <p className="text-sm text-slate-400 text-center mt-10">저장된 상담 기록이 없습니다.</p>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                onClick={() => handleSelectHistory(item)}
                className={`p-3 mb-2 rounded-xl cursor-pointer border transition-all ${
                  currentData?.id === item.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="text-sm font-bold text-slate-800 line-clamp-1">
                    {typeof item?.title === 'string' && item.title.trim() !== ''
                      ? item.title
                      : getRecordTitle(item, item?.prompt ?? item?.originalText ?? '')}
                    {getSourceBadge(item)}
                  </h3>
                  <button onClick={(e) => handleDeleteHistory(e, item.id)} className="text-slate-400 hover:text-red-500 text-xs px-2">
                    삭제
                  </button>
                </div>
                <p className="text-xs text-slate-500">{item.date}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 오른쪽 메인 컨텐츠 영역 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-8 pb-4">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">{currentData ? '가족 관계도 분석 결과' : 'AI 가족 관계도 생성'}</h1>
          <p className="text-slate-500">
            {currentData ? '저장된 상담 기록을 확인하고 있습니다.' : '상담 내용을 입력하면 AI가 자동으로 가계도를 그려줍니다.'}
          </p>
        </div>

        <div className="flex-1 overflow-auto p-8 pt-0">
          {currentData ? (
            <div className="h-full flex flex-col gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {typeof currentData?.title === 'string' && currentData.title.trim() !== ''
                        ? currentData.title
                        : getRecordTitle(currentData, currentData?.prompt ?? currentData?.originalText ?? '')}
                      {getSourceBadge(currentData)}
                    </div>
                    <div className="text-xs text-slate-500">{currentData.date ?? ''}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsGenogramModalOpen(true)}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    가계도 확인
                  </button>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-sm font-semibold text-slate-700">상담 내용</div>
                    <div className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-800">
                      {currentData.prompt ? currentData.prompt : '저장된 상담 내용이 없습니다. (이전 기록은 prompt가 없을 수 있어요)'}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-sm font-semibold text-slate-700">AI 추출 결과(JSON)</div>
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-4 text-xs leading-relaxed text-slate-900">
                      {JSON.stringify(
                        { people: currentData.people, couples: currentData.couples, parents: currentData.parents, meta: currentData.meta },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                </div>
              </div>

              {/* 작은 인라인 프리뷰(선택): 공간 아낄 때는 제거 가능 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-2 text-sm font-semibold text-slate-700">가계도 미리보기</div>
                <div className="mx-auto w-full max-w-[1200px] h-[640px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50">
                  <GenogramViewSimple data={currentData} className="min-h-0 h-full p-2" />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col max-w-4xl">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="예: 엄마 김진주 95년생, 아빠 정성호 95년생, 둘의 딸 정겨울 26년생..."
                className="w-full flex-1 p-6 border border-slate-200 rounded-2xl bg-slate-50 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-slate-700 leading-relaxed"
              />
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleGenerate}
                  disabled={isLoading}
                  className={`px-6 py-3 rounded-xl text-white font-semibold transition ${
                    isLoading ? 'bg-blue-300 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800 shadow-md'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {isLoading ? (
                      <>
                        <svg
                          className="h-4 w-4 animate-spin text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                          />
                        </svg>
                        AI가 분석 중입니다...
                      </>
                    ) : (
                      '가계도 생성하기'
                    )}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Genogram Modal */}
      {currentData && isGenogramModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={() => setIsGenogramModalOpen(false)}
        >
          <div
            className="flex h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {typeof currentData?.title === 'string' && currentData.title.trim() !== ''
                    ? currentData.title
                    : getRecordTitle(currentData, currentData?.prompt ?? currentData?.originalText ?? '')}
                  {getSourceBadge(currentData)}
                </div>
                <div className="text-xs text-slate-500">{currentData.date ?? ''}</div>
              </div>
              <button
                type="button"
                onClick={() => setIsGenogramModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50 p-4">
              <div className="mx-auto w-full max-w-[1600px] h-[82vh] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50">
                <GenogramViewSimple data={currentData} className="min-h-0 h-full p-2" />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default MainPage
