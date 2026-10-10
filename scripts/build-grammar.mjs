// 語法題庫：scripts/grammar/*.txt → src/data/grammar.json（格式見 scripts/grammar/1.txt 開頭）
// 一個文法點有好幾個例句，每次出題隨機挑一句、錯誤選項也隨機挑：同一個文法要真的懂，不是背某一句的答案
// 振假名：漢字後面直接標讀音（毎朝(まいあさ)），再用單字庫的讀音逐字對齊、順便檢查有沒有標錯
// 用法：node scripts/build-grammar.mjs
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, hira, splitRun, groupRead } from './lib/furigana.mjs'

const dir = path.join(ROOT, 'scripts/grammar')
const errors = []
const warnings = []
const CATS = ['p', 'v', 'a', 'j', 'e', 'g', 'q']


const RUN = /[0-9０-９一-鿿々〆〇]/
const KANJI = /[一-鿿々〆〇]/
// 来る的讀音看後面接什麼：来ます・来た・来て＝き、来ない・来よう・来られる・来させる・来い＝こ、来る・来れば＝く
const KURU = { ま: 'き', た: 'き', て: 'き', な: 'こ', よ: 'こ', ら: 'こ', さ: 'こ', い: 'こ', る: 'く', れ: 'く' }

// 一個漢字詞 + 讀音 → 振假名段：逐字對得上就逐字標，熟字訓（今日＝きょう）整段標，對不上就是讀音寫錯了
function rubySegs(run, rt, where) {
  if (/[0-9０-９]/.test(run)) return [[run, rt]] // 數字（7時＝しちじ）整段標
  const r = splitRun(run, hira(rt))
  if (r && !r.segs.some((s) => s[2])) return r.segs.map((s) => s.slice(0, 2))
  if (groupRead.get(run)?.has(hira(rt))) return [[run, rt]]
  if (MANUAL.has(`${run}=${rt}`)) return [[run, rt]]
  throw new Error(`${where}：「${run}(${rt})」讀音對不上單字庫，確定沒寫錯的話加進 build-grammar.mjs 的 MANUAL`)
}
// 單字庫沒有、但確定正確的讀法
const MANUAL = new Set(`一人=ひとり 納豆=なっとう 我=わ 偽物=にせもの 寿司=すし 豆腐=とうふ 堪=た 否=いな 忍=しの 難=かた 形見=かたみ 完璧=かんぺき`.split(/\s+/))

// 「毎朝(まいあさ)7時(しちじ)に」→ [['毎','まい'],['朝','あさ'],['7時','しちじ'],['に']]
// ctx：同一句其他地方標過的讀音（選項裡同一個詞可以不再標）
function parseRuby(str, where, ctx) {
  const segs = []
  let i = 0
  const chars = [...str]
  while (i < chars.length) {
    if (!RUN.test(chars[i])) {
      segs.push([chars[i++]])
      continue
    }
    let j = i
    while (j < chars.length && RUN.test(chars[j])) j++
    const run = chars.slice(i, j).join('')
    if (chars[j] === '(') {
      const end = chars.indexOf(')', j)
      if (end < 0) throw new Error(`${where}：「${run}(」少了右括號`)
      const rt = chars.slice(j + 1, end).join('')
      if (!/^[ぁ-ゖー]+$/.test(rt)) throw new Error(`${where}：「${run}(${rt})」讀音要用平假名`)
      ctx.set(run, ctx.has(run) && ctx.get(run) !== rt ? null : rt)
      segs.push(...rubySegs(run, rt, where))
      i = end + 1
      continue
    }
    const rt = run === '来' && KURU[chars[j]] ? KURU[chars[j]] : ctx.get(run)
    if (!rt) throw new Error(`${where}：「${run}」沒有標讀音（句子裡也沒有同一個詞可以沿用）`)
    segs.push(...rubySegs(run, rt, where))
    i = j
  }
  // 相鄰假名段合併
  const out = []
  for (const s of segs) {
    if (!s[1] && out.length && !out.at(-1)[1]) out.at(-1)[0] += s[0]
    else out.push([...s])
  }
  if (out.some((s) => !s[1] && KANJI.test(s[0]))) throw new Error(`${where}：有漢字沒標讀音「${str}」`)
  return out
}
const textOf = (segs) => segs.map((s) => s[0]).join('')

// 選項的中文說明：句子裡沒寫的查 gloss.txt（は、が、を 這類寫一次就好）
// gloss.txt 的日文也可以標讀音（に反(はん)して）：選項沒標讀音時沿用，複合助詞不用每次都標
const GLOSS = new Map()
const GLOSS_SEGS = new Map()
fs.readFileSync(path.join(dir, 'gloss.txt'), 'utf8')
  .split('\n')
  .forEach((line, n) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const i = t.indexOf('/')
    try {
      const segs = parseRuby(t.slice(0, i), `gloss.txt:${n + 1}`, new Map())
      GLOSS.set(textOf(segs), t.slice(i + 1))
      GLOSS_SEGS.set(textOf(segs), segs)
    } catch (e) {
      errors.push(e.message)
    }
  })
const missing = new Map()

function glossOf(ja, inline, bad, where) {
  if (inline) return inline
  if (bad) return '錯誤用法'
  const g = GLOSS.get(ja)
  if (g) return g
  if (!missing.has(ja)) missing.set(ja, where)
  return ''
}

// 選項：[!]日文[/中文] → [振假名段, 說明, 1?（錯誤的變化或接法）]
function parseOpt(raw, where, ctx) {
  const bad = raw.startsWith('!')
  const [ja, zh] = (bad ? raw.slice(1) : raw).split('/')
  const plain = ja.trim()
  const segs = !plain.includes('(') && GLOSS_SEGS.has(plain) ? GLOSS_SEGS.get(plain) : parseRuby(plain, where, ctx)
  const out = [segs, glossOf(textOf(segs), zh?.trim(), bad, where)]
  return bad ? [...out, 1] : out
}

const points = []
let p = null
function parseLine(line, where) {
  if (!line || line.startsWith('#')) return
  if (line.startsWith('==')) {
    const [key, level, cat, form, mean, note] = line
      .slice(2)
      .split('|')
      .map((s) => s.trim())
    if (note == null) throw new Error(`${where}：文法點格式要 == 代號|難度|分類|文法|意思|說明`)
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error(`${where}：代號只能用小寫英數和 -`)
    if (!['1', '2', '3', '4', '5'].includes(level)) throw new Error(`${where}：難度要 1～5`)
    if (!CATS.includes(cat)) throw new Error(`${where}：沒有「${cat}」這個分類`)
    p = { key, level: +level, cat, form, mean, note, qs: [] }
    points.push(p)
    return
  }
  if (!p) throw new Error(`${where}：題目前面要先寫 == 文法點`)
  const [ja, zh, wrong] = line.split('|').map((s) => s.trim())
  if (wrong == null) throw new Error(`${where}：題目格式要 日文|中文|錯誤選項;…`)
  const m = ja.match(/^([^{}]*)\{([^{}]+)\}([^{}]*)$/)
  if (!m) throw new Error(`${where}：日文裡要剛好一個 {答案}`)
  const [ansJa, ansZh] = m[2].split('/')
  const ctx = new Map()
  const s = [m[1], ansJa, m[3]].map((x) => parseRuby(x, where, ctx))
  const answer = textOf(s[1])
  const w = wrong.split(';').map((x) => parseOpt(x.trim(), where, ctx))
  if (w.length < 3) throw new Error(`${where}：錯誤選項至少要 3 個`)
  const seen = new Set([answer])
  for (const [segs] of w) {
    const t = textOf(segs)
    if (seen.has(t)) throw new Error(`${where}：選項「${t}」重複（或跟答案一樣）`)
    seen.add(t)
  }
  if (p.qs.some((q) => q.s.map(textOf).join('') === s.map(textOf).join(''))) throw new Error(`${where}：跟同一個文法點的另一句重複`)
  p.qs.push({ s, zh, a: glossOf(answer, ansZh?.trim(), false, where), w })
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d+\.txt$/.test(f))
  .sort((a, b) => parseInt(a) - parseInt(b))
for (const file of files) {
  p = null
  fs.readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .forEach((raw, n) => {
      try {
        parseLine(raw.trim(), `${file}:${n + 1}`)
      } catch (e) {
        errors.push(e.message)
      }
    })
}

const keys = new Set()
for (const pt of points) {
  if (keys.has(pt.key)) errors.push(`文法點代號重複：${pt.key}`)
  keys.add(pt.key)
  if (pt.qs.length < 3) warnings.push(`${pt.key} ${pt.form}：只有 ${pt.qs.length} 句`)
}
const missingFile = path.join(dir, '.missing.txt')
fs.rmSync(missingFile, { force: true })
if (missing.size) {
  errors.push(`有 ${missing.size} 個選項沒有中文，請補在 scripts/grammar/gloss.txt（或在選項後面寫 /中文），清單在 scripts/grammar/.missing.txt`)
  fs.writeFileSync(missingFile, [...missing].map(([ja, where]) => `${ja}/\t# ${where}`).join('\n') + '\n')
}
if (errors.length) {
  for (const e of [...new Set(errors)].slice(0, 40)) console.error('錯誤', e)
  if (errors.length > 40) console.error(`…還有 ${errors.length - 40} 個錯誤`)
  process.exit(1)
}

fs.writeFileSync(path.join(ROOT, 'src/data/grammar.json'), JSON.stringify({ points }))
const byLevel = ['N5', 'N4', 'N3', 'N2', 'N1'].map((name, i) => `${name} ${points.filter((x) => x.level === i + 1).length}`)
console.log(`${points.length} 個文法點（${byLevel.join('、')}）、${points.reduce((n, x) => n + x.qs.length, 0)} 句`)
for (const w of warnings) console.log('注意', w)
