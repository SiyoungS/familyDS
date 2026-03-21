/* eslint-disable no-undef */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'genogram-ai-api',
      configureServer(server) {
        server.middlewares.use('/api/genogram', async (req, res) => {
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
          const openAiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
          if (!openAiKey) {
            res.statusCode = 500
            res.end('Missing OPENAI_API_KEY')
            return
          }

          const system = [
            '너는 입력된 한국어 상담 텍스트에서 가족관계를 추출해 가계도(Genogram)를 자동 생성하는 도우미다.',
            '반드시 JSON만 출력하고 Markdown/설명을 금지한다.',
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
            '- level,row는 세대/가로줄로 쓰인다. 보통 조부모가 더 작은 값, 자녀가 더 큰 값.',
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
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: userContent },
                ],
              }),
            })

            if (!r.ok) {
              const text = await r.text()
              res.statusCode = 500
              res.end(text)
              return
            }

            const data = await r.json()
            const content = data?.choices?.[0]?.message?.content ?? ''
            const start = content.indexOf('{')
            const end = content.lastIndexOf('}')
            if (start === -1 || end === -1) {
              res.statusCode = 500
              res.end('Model did not return JSON')
              return
            }

            const json = JSON.parse(content.slice(start, end + 1))
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(json))
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
})
