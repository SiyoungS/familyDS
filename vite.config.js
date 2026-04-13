/* eslint-disable no-undef */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite는 `.env*`를 자동으로 `process.env`에 주입하지 않습니다.
  // 서버 미들웨어에서 OPENAI_API_KEY를 쓰려면 loadEnv로 읽어야 합니다.
  const env = loadEnv(mode, process.cwd(), '')
  const openAiKeyFromEnv = env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY

  return {
  plugins: [
    react(),
    {
      name: 'genogram-ai-api',
      configureServer(server) {
        server.middlewares.use('/api/genogram', async (req, res) => {
          const extractJsonText = (content) => {
            const raw = String(content ?? '').trim()
            if (!raw) return null

            // 1) Markdown code fences 제거 (```json ... ```)
            const unfenced = raw
              .replace(/^\s*```(?:json)?\s*/i, '')
              .replace(/\s*```\s*$/i, '')
              .trim()

            // 2) 바로 JSON이면 그대로
            if (unfenced.startsWith('{') || unfenced.startsWith('[')) return unfenced

            // 3) 텍스트 중간의 JSON 객체/배열을 "괄호 짝"으로 추출
            const startIdx = (() => {
              const iObj = unfenced.indexOf('{')
              const iArr = unfenced.indexOf('[')
              if (iObj === -1) return iArr
              if (iArr === -1) return iObj
              return Math.min(iObj, iArr)
            })()
            if (startIdx === -1) return null

            const open = unfenced[startIdx]
            const close = open === '{' ? '}' : ']'
            let depth = 0
            let inStr = false
            let esc = false
            for (let i = startIdx; i < unfenced.length; i += 1) {
              const ch = unfenced[i]
              if (inStr) {
                if (esc) {
                  esc = false
                } else if (ch === '\\') {
                  esc = true
                } else if (ch === '"') {
                  inStr = false
                }
                continue
              }
              if (ch === '"') {
                inStr = true
                continue
              }
              if (ch === open) depth += 1
              if (ch === close) depth -= 1
              if (depth === 0) {
                return unfenced.slice(startIdx, i + 1).trim()
              }
            }
            return null
          }

          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }

          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const raw = Buffer.concat(chunks).toString('utf-8')

          let payload = {}
          try {
            payload = JSON.parse(raw || '{}')
          } catch {
            res.statusCode = 400
            res.end('Invalid JSON body')
            return
          }

          const { prompt, counselorName } = payload ?? {}
          const openAiKey = openAiKeyFromEnv
          if (!openAiKey) {
            // eslint-disable-next-line no-console
            console.error('[genogram] Missing OPENAI_API_KEY (set in .env.local and restart dev server)')
            res.statusCode = 500
            res.end('Missing OPENAI_API_KEY')
            return
          }

          const system = [
            '너는 입력된 한국어 상담 텍스트에서 가족관계를 추출해 가계도(Genogram)를 자동 생성하는 도우미다.',
            '반드시 JSON만 출력하고 Markdown/설명을 금지한다.',
            '',
            '[필수 규칙]',
            '- 독립성 유지: 이전 대화나 컨텍스트에 등장했던 인물과 절대 섞지 마라. 오직 "현재 입력된 텍스트"만 사용하라.',
            '- 창조 금지(원칙): 텍스트에 언급되지 않은 인물(가상의 인물, 임의의 친척 등)을 임의로 추가하지 마라.',
            '  단, 아래 "강제 생성" 규칙(부/모/조부모 placeholder)은 예외로 허용되며 반드시 따라야 한다.',
            '',
            '[데이터 무단 누락 절대 금지]',
            '- 요약/생략 금지: 입력 텍스트에 등장하는 혈연/혼인 관계 인물을 100% people에 반영하라. 길다는 이유로 누락하면 안 된다.',
            '- 다자녀 필수 추출: "첫째/둘째/셋째/넷째", "큰딸/둘째아들" 등으로 여러 자녀가 언급되면, 단 한 명도 빼먹지 말고 people에 각각 개별 객체로 생성하고 parents로 연결하라.',
            '- 조부모 언급 시 4명 강제 생성: 텍스트에 "친할아버지/친할머니/외할아버지/외할머니/외조부/외조모/양가 조부모" 등이 나오면,',
            '  이름/생존/사망 정보가 불완전해도 양가 조부모 4명(예: "<남편이름>의 부(미상)", "<남편이름>의 모(미상)", "<아내이름>의 부(미상)", "<아내이름>의 모(미상)")을 people에 생성하고,',
            '  각각을 해당 부모(남편/아내)의 parent로 parents에 반드시 연결하라.',
            '- 검증 절차(내부): 최종 JSON을 내보내기 전, 텍스트에서 언급된 인물/자녀수/조부모 언급을 스스로 점검하고 누락이 있으면 보완한 뒤 출력하라.',
            '',
            '[가계도 JSON 추출 절대 규칙]',
            '- 0세대(부모) 강제 생성: 텍스트에 "부모님", "형제", "남매", "언니", "동생" 등이 언급되어 혈족(형제) 관계를 묶어야 한다면,',
            '  부모의 구체적인 이름이 텍스트에 없더라도 무조건 people 배열에 부모 2명(예: "김진주의 부(미상)", "김진주의 모(미상)")을 level: 0으로 생성해라.',
            '- 형제 완벽 연결: 생성된 0세대 부모를 couples로 묶고, 모든 형제자매들을 parents 배열을 통해 이 부모들의 child로 완벽하게 연결해라.',
            '',
            '[JSON 포맷 예시 - 자녀가 여러 명일 경우의 작성법]',
            '아래는 "형식 예시"다. 입력 텍스트의 인물/이름/연도에 맞춰 동일한 패턴으로 people/couples/parents를 빠짐없이 생성해라.',
            '{',
            '  "people": [',
            '    { "id": "이철수의 부", "name": "이철수의 부(미상)", "gender": "male", "level": 0 },',
            '    { "id": "이철수의 모", "name": "이철수의 모(미상)", "gender": "female", "level": 0 },',
            '    { "id": "박영희의 부", "name": "박영희의 부(미상)", "gender": "male", "level": 0 },',
            '    { "id": "박영희의 모", "name": "박영희의 모(미상)", "gender": "female", "level": 0 },',
            '    { "id": "이철수", "name": "이철수", "gender": "male", "birthYear": 70, "level": 1 },',
            '    { "id": "박영희", "name": "박영희", "gender": "female", "birthYear": 72, "level": 1 },',
            '    { "id": "이지민", "name": "이지민", "gender": "female", "birthYear": 99, "level": 2 },',
            '    { "id": "이준호", "name": "이준호", "gender": "male", "birthYear": "01", "level": 2 },',
            '    { "id": "이준서", "name": "이준서", "gender": "male", "birthYear": "05", "level": 2 }',
            '  ],',
            '  "couples": [',
            '    { "a": "이철수의 부", "b": "이철수의 모" },',
            '    { "a": "박영희의 부", "b": "박영희의 모" },',
            '    { "a": "이철수", "b": "박영희" }',
            '  ],',
            '  "parents": [',
            '    { "parent": "이철수의 부", "child": "이철수" }, { "parent": "이철수의 모", "child": "이철수" },',
            '    { "parent": "박영희의 부", "child": "박영희" }, { "parent": "박영희의 모", "child": "박영희" },',
            '    { "parent": "이철수", "child": "이지민" }, { "parent": "박영희", "child": "이지민" },',
            '    { "parent": "이철수", "child": "이준호" }, { "parent": "박영희", "child": "이준호" },',
            '    { "parent": "이철수", "child": "이준서" }, { "parent": "박영희", "child": "이준서" }',
            '  ]',
            '}',
            '반환 JSON 스키마:',
            '{',
            '  "people": [',
            '    {',
            '      "id": "string",',
            '      "name": "string",',
            '      "gender": "male|female|unknown",',
            '      "birthYear": number|null,',
            '      "level": number,',
            '      "col": number,',
            '      "row": number',
            '    }',
            '  ],',
            '  "couples": [ { "a": "personId", "b": "personId" } ],',
            '  "parents": [ { "parent": "personId", "child": "personId" } ]',
            '}',
            '규칙:',
            '- level,row는 세대/가로줄로 쓰인다. (본인/부부 중심 세대가 1, 그 부모가 0, 자녀가 2 처럼 상대적으로 잡아도 된다.)',
            '- col/row는 도형 겹침을 최소화하도록 정수/소수로 적절히 배치한다.',
            '- 상담자/가족의 핵심(사용자 프롬프트에 나타난 정성호/김진주/정겨울 같은 사람들)이 중심에 가도록 배치한다.',
          ].join('\\n')

          const userContent = [
            `counselorName: ${counselorName ?? ''}`,
            '-----',
            prompt ?? '',
          ].join('\\n')

          try {
            const r = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openAiKey}`,
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0,
                // 가능한 한 "순수 JSON"만 나오게 강제
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: userContent },
                ],
              }),
            })

            if (!r.ok) {
              const text = await r.text()
              // eslint-disable-next-line no-console
              console.error('[genogram] OpenAI error', r.status, text?.slice?.(0, 1200) ?? text)
              res.statusCode = 500
              res.end(text)
              return
            }

            const data = await r.json()
            const content = data?.choices?.[0]?.message?.content ?? ''
            const jsonText = extractJsonText(content)
            if (!jsonText) {
              res.statusCode = 500
              res.end('Model did not return JSON')
              return
            }

            try {
              const json = JSON.parse(jsonText)
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify(json))
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error('[genogram] JSON.parse failed', (e && e.message) || e, jsonText.slice(0, 1200))
              res.statusCode = 500
              res.end('JSON parse error')
            }
          } catch (e) {
            res.statusCode = 500
            res.end((e && e.message) || 'Server error')
          }
        })
      },
    },
  ],
  server: {
    // Firebase Google 팝업 로그인 시 COOP 때문에 window.closed / postMessage가 막히는 경우 완화
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
  }
})
