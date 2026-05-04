/* eslint-disable no-undef */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { repairGenogramJson } from './src/lib/genogram/repairGenogramJson.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite는 `.env*`를 자동으로 `process.env`에 주입하지 않습니다.
  // 서버 미들웨어에서 OPENAI_API_KEY를 쓰려면 loadEnv로 읽어야 합니다.
  const env = loadEnv(mode, process.cwd(), '')
  const openAiKeyFromEnv = env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
  // Repeatable completions: same seed + temperature 0. Set GENOGRAM_OPENAI_SEED in .env.local to override.
  // .env.local 예: GENOGRAM_OPENAI_SEED=42
  const genogramSeedRaw = env.GENOGRAM_OPENAI_SEED ?? env.VITE_GENOGRAM_OPENAI_SEED
  const genogramSeedParsed =
    genogramSeedRaw != null && String(genogramSeedRaw).trim() !== ''
      ? Number.parseInt(String(genogramSeedRaw), 10)
      : 42
  const openAiSeed = Number.isFinite(genogramSeedParsed) ? genogramSeedParsed : 42

  return {
  plugins: [
    react(),
    {
      name: 'genogram-ai-api',
      configureServer(server) {
        // 동일 입력(prompt/counselorName + system prompt + seed)에 대해 항상 동일 결과를 반환하기 위한 캐시
        // (LLM의 미세 변동으로 관계 JSON이 흔들리면 레이아웃도 크게 흔들리는 문제를 차단)
        const responseCache = new Map()

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

          const systemPromptPath = path.resolve(process.cwd(), 'prompts/genogram.system.txt')
          const system = fs.readFileSync(systemPromptPath, 'utf-8')

          const userContent = [
            `counselorName: ${counselorName ?? ''}`,
            '-----',
            prompt ?? '',
          ].join('\\n')

          try {
            const cacheKey = crypto
              .createHash('sha256')
              .update(String(openAiSeed))
              .update('\\n---system---\\n')
              .update(system)
              .update('\\n---user---\\n')
              .update(userContent)
              .digest('hex')

            const cached = responseCache.get(cacheKey)
            if (cached) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(cached)
              return
            }

            const r = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openAiKey}`,
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0,
                top_p: 1,
                seed: openAiSeed,
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
            console.log('jsonText:\n', system);
            try {
              const json = repairGenogramJson(JSON.parse(jsonText))
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              const stable = JSON.stringify(json)
              responseCache.set(cacheKey, stable)
              res.end(stable)
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
