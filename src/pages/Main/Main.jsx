import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth.js'
import { extractGenogram } from '../../lib/genogram/generateGenogram.js'
import GenogramEventHost, { GENOGRAM_RENDER_EVENT } from '../../components/Genogram/GenogramEventHost.jsx'

const MainPage = () => {
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const [activeTab, setActiveTab] = useState('가계도')
  const [counseledPersonName, setCounseledPersonName] = useState('')
  const [spouseName, setSpouseName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [attachedFileName, setAttachedFileName] = useState('')
  const [extracted, setExtracted] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [genogramError, setGenogramError] = useState('')

  const displayName = useMemo(() => user?.displayName ?? user?.email?.split('@')?.[0] ?? '사용자', [user])

  const handlePickFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    setAttachedFileName(file ? file.name : '')
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (activeTab !== '가계도') return
    if (!prompt.trim()) return

    setIsGenerating(true)
    setGenogramError('')
    setExtracted(null)

    extractGenogram({
      prompt,
      activeTab,
      counselorName: counseledPersonName.trim(),
      spouseName: spouseName.trim(),
    })
      .then((next) => {
        setExtracted(next)
        window.dispatchEvent(new CustomEvent(GENOGRAM_RENDER_EVENT, { detail: { data: next } }))
      })
      .catch((err) => {
        setGenogramError(err?.message ?? '가계도 생성에 실패했습니다.')
      })
      .finally(() => {
        setIsGenerating(false)
      })
  }

  return (
    <div className="flex flex-1">
      <div className="w-full rounded-2xl border border-slate-200 bg-white px-6 py-7 shadow-sm sm:px-8 sm:py-10">
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              안녕하세요, {displayName}님
            </h1>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              AI로 빠르게 만들게요
            </p>
          </div>

          <div className="hidden shrink-0 sm:flex" />
        </header>

        <form onSubmit={handleSubmit} className="mt-8">
          <div className="rounded-[28px] border border-slate-300 bg-white px-6 py-5 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
            <div className="mb-3 flex flex-wrap items-center justify-end gap-3 text-sm">
              <label className="text-slate-600" htmlFor="counseledPersonName">
                상담자 성함
              </label>
              <input
                id="counseledPersonName"
                value={counseledPersonName}
                onChange={(e) => setCounseledPersonName(e.target.value)}
                placeholder="예: 정성호"
                className="w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
              <label className="ml-2 text-slate-600" htmlFor="spouseName">
                배우자 성함
              </label>
              <input
                id="spouseName"
                value={spouseName}
                onChange={(e) => setSpouseName(e.target.value)}
                placeholder="예: 김진주"
                className="w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="예) 엄마/아빠/형제 정보와 관계를 적고 ‘이 내용으로 가계도 그려줘’ 처럼 요청해 보세요."
              rows={8}
              className="w-full resize-none border-0 bg-transparent text-base leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
            />

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                <button
                  type="button"
                  onClick={handlePickFile}
                  className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  +파일 첨부
                </button>
                {attachedFileName ? <span className="truncate text-slate-500">{attachedFileName}</span> : null}
              </div>

              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-sm font-semibold text-slate-700">{activeTab}</span>
                <button
                  type="submit"
                  className="grid h-11 w-11 place-items-center rounded-full bg-black text-white transition hover:bg-slate-800"
                  aria-label="전송"
                >
                  {isGenerating ? <span className="text-xs">...</span> : <span className="text-lg leading-none">↑</span>}
                </button>
              </div>
            </div>
          </div>
        </form>

        {genogramError ? (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {genogramError}
          </div>
        ) : null}

        {extracted ? (
          <div className="mt-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">AI 추출 결과(JSON)</div>
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-4 text-xs leading-relaxed text-slate-900">
                {JSON.stringify(extracted, null, 2)}
              </pre>
            </div>

            <GenogramEventHost initialData={extracted} />
          </div>
        ) : null}

        <nav className="mt-8 flex justify-center">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-100 p-2">
            {['가계도', '생태도', '사례보고서'].map((tab) => {
              const isActive = tab === activeTab
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={[
                    'min-w-24 rounded-xl px-6 py-2 text-sm font-semibold transition',
                    isActive ? 'bg-blue-600 text-white shadow-sm' : 'bg-white/60 text-slate-800 hover:bg-white',
                  ].join(' ')}
                >
                  {tab}
                </button>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}

export default MainPage
