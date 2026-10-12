// 短句的變化：scripts/phrases/*.txt → src/data/phrase-ext.json（格式見 scripts/phrases/a.txt 開頭）
// 短句本身還是 src/data/phrases.tsv，這裡只加三種變化，都用短句原文對應，學習紀錄照舊：
//   變數：數量、時間、地點、物品每次換一個值（日文、讀音、中文一起換）
//   挖空：挖掉句子裡的關鍵字，從四個選項選（跟語法題一樣）
//   回應：給對方說的一句話，選出最自然的回應（答案就是這個短句）
// 用法：node scripts/build-phrases.mjs
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, hira, align as alignJa } from './lib/furigana.mjs'
import { KANJI, parseRuby, textOf, kanaOf, mergeKana, loadGloss } from './lib/ruby.mjs'

const dir = path.join(ROOT, 'scripts/phrases')
const errors = []
const warnings = []
const align = (ja, kana, where) => alignJa(ja, kana, where, (w) => warnings.push(w))

// ---- 短句庫 ----
const phrases = new Map() // 原文 → { ja, kana, zh, syn, segs }
for (const line of fs.readFileSync(path.join(ROOT, 'src/data/phrases.tsv'), 'utf8').split('\n')) {
  if (!line) continue
  const [level, group, , ja, reading, zh, en, furi] = line.split('\t')
  const segs = furi ? furi.split('|').map((s) => s.split('=')) : [[ja]]
  phrases.set(ja, { ja, kana: reading || ja, zh, syn: en || '', level: +level, group, segs })
}

// ---- 共用值表（跟會話題庫共用 scripts/dialogs/pools.txt）----
const pools = new Map()
{
  let name = null
  fs.readFileSync(path.join(ROOT, 'scripts/dialogs/pools.txt'), 'utf8')
    .split('\n')
    .forEach((raw, n) => {
      const t = raw.trim()
      if (!t || t.startsWith('#')) return
      if (t.startsWith('@@')) return pools.set((name = t.slice(2)), [])
      pools.get(name).push(parseValue(t, `pools.txt:${n + 1}`))
    })
}
// 值：日文=讀音/中文（沒有漢字可省略讀音）→ [振假名段, 中文]
function parseValue(raw, where) {
  const [jaPart, zh] = raw.split('/')
  if (zh == null) throw new Error(`${where}：值要寫成 日文=讀音/中文「${raw}」`)
  const [ja, kana] = jaPart.split('=')
  return [align(ja.trim(), (kana || ja).trim(), where), zh.trim()]
}

const { gloss: GLOSS, segsOf: GLOSS_SEGS } = loadGloss([path.join(dir, 'gloss.txt'), path.join(ROOT, 'scripts/grammar/gloss.txt')], errors)
const missing = new Map()
function glossOf(ja, inline, bad, where) {
  if (inline) return inline
  if (bad) return '錯誤用法'
  const g = GLOSS.get(ja) ?? (phrases.has(ja) ? phrases.get(ja).zh : null)
  if (g) return g
  if (!missing.has(ja)) missing.set(ja, where)
  return ''
}
// 選項：[!]日文[/中文] → [振假名段, 說明, 1?]；剛好是短句原文的直接用那句的讀音
function parseOpt(raw, where, ctx) {
  const bad = raw.startsWith('!')
  const [ja, zh] = (bad ? raw.slice(1) : raw).split('/')
  const plain = ja.trim()
  let segs
  if (!plain.includes('(') && GLOSS_SEGS.has(plain)) segs = GLOSS_SEGS.get(plain)
  else if (!plain.includes('(') && phrases.has(plain)) segs = phrases.get(plain).segs
  else segs = parseRuby(plain, where, ctx)
  const out = [segs, glossOf(textOf(segs), zh?.trim(), bad, where)]
  return bad ? [...out, 1] : out
}

// 句子裡標過的讀音給選項沿用：單字和連續的漢字（ご注文 的 注文）都記
function ctxOf(segs) {
  const ctx = new Map()
  for (let i = 0; i < segs.length; i++) {
    let ja = ''
    let rt = ''
    for (let j = i; j < segs.length && segs[j][1] && KANJI.test(segs[j][0]); j++) {
      ja += segs[j][0]
      rt += segs[j][1]
      if (!ctx.has(ja)) ctx.set(ja, rt)
    }
  }
  return ctx
}

// 在字元位置 cuts 把振假名段切開；漢字段不能從中間切
function cutSegs(segs, cuts, where) {
  const pieces = []
  let cur = []
  let at = 0
  const want = [...new Set(cuts)].sort((a, b) => a - b)
  for (const [text, rt] of segs) {
    const chars = [...text]
    const end = at + chars.length
    const inside = want.filter((c) => c > at && c < end)
    if (inside.length && rt) throw new Error(`${where}：挖空或變數的邊界切在「${text}」中間（這段讀音是整段標的）`)
    let from = 0
    for (const c of [...inside, end]) {
      cur.push(rt ? [text, rt] : [chars.slice(from, c - at).join('')])
      from = c - at
      if (want.includes(c)) {
        pieces.push(cur)
        cur = []
      }
    }
    at = end
  }
  if (cur.length) pieces.push(cur)
  return pieces.map((p) => mergeKana(p.filter((s) => s[0])))
}
// 第 n 個（從 1 起算）出現的位置，以字元計
function findAt(text, sub, n, where) {
  let at = -1
  for (let i = 0; i < n; i++) {
    at = text.indexOf(sub, at + 1)
    if (at < 0) throw new Error(`${where}：「${text}」裡找不到第 ${n} 個「${sub}」`)
  }
  return [...text.slice(0, at)].length
}

const ext = {} // 原文 → { t, z, s, c, r }
const madeBy = new Map() // 帶入變數後的句子 → 原句
let entry = null

function finish() {
  if (!entry) return
  const { ph, where, slots, clozes, replies } = entry
  const out = {}
  const len = [...ph.ja].length
  // 變數、挖空的範圍都要落在振假名段的邊界上
  const ranges = [...slots.map((s) => [s.at, s.at + s.len]), ...clozes.filter((c) => !c.star).map((c) => [c.at, c.at + c.len])]
  const cuts = [0, len, ...ranges.flat()]
  const want = [...new Set(cuts)].sort((a, b) => a - b)
  const pieces = cutSegs(ph.segs, want, where)
  // pieces[i] 是 want[i]～want[i+1] 這一段
  const t = []
  const startIdx = new Map() // 字元位置 → t 的位置
  for (let i = 0; i < pieces.length; i++) {
    startIdx.set(want[i], t.length)
    const k = slots.findIndex((s) => s.at === want[i])
    if (k >= 0) {
      const s = slots[k]
      if (want[i + 1] !== s.at + s.len) throw new Error(`${where}：變數「${s.ja}」跟挖空的範圍交錯`)
      t.push(k)
    } else if (slots.some((s) => want[i] > s.at && want[i] < s.at + s.len)) continue
    else t.push(pieces[i])
  }
  startIdx.set(len, t.length)
  if (slots.length || clozes.length) out.t = t
  if (slots.length) {
    // 帶入變數後不能剛好變成另一個短句（不然那句當錯誤選項時，兩個選項會一模一樣）
    const combos = slots.reduce((acc, s) => acc.flatMap((c) => s.values.map((v) => [...c, v])), [[]])
    for (const c of combos.slice(0, 2000)) {
      const ja = t.map((p) => (typeof p === 'number' ? textOf(c[p][0]) : textOf(p))).join('')
      if (ja !== ph.ja && phrases.has(ja)) throw new Error(`${where}：帶入變數後變成另一個短句「${ja}」`)
      // 兩個有變數的短句也不能帶出同一句
      const other = madeBy.get(ja)
      if (other && other !== ph.ja) throw new Error(`${where}：帶入變數後跟「${other}」帶出的句子一樣「${ja}」`)
      madeBy.set(ja, ph.ja)
    }
    // 中文：把變數的中文片段換成 {變數}
    let z = [ph.zh]
    slots.forEach((s, k) => {
      const i = z.findIndex((p) => typeof p === 'string' && p.includes(s.zh))
      if (i < 0) throw new Error(`${where}：中文「${ph.zh}」裡找不到「${s.zh}」`)
      const p = z[i]
      const j = p.indexOf(s.zh)
      z.splice(i, 1, p.slice(0, j), k, p.slice(j + s.zh.length))
    })
    out.z = z.filter((p) => p !== '')
    out.s = slots.map((s) => s.values)
  }
  if (clozes.length) {
    out.c = clozes.map((c) => {
      if (c.star) {
        if (slots.length !== 1) throw new Error(`${where}：?cloze * 只能用在剛好一個變數的句子`)
        return { b: [startIdx.get(slots[0].at), startIdx.get(slots[0].at) + 1], star: 1 }
      }
      const b = [startIdx.get(c.at), startIdx.get(c.at + c.len)]
      if (t.slice(b[0], b[1]).some((p) => typeof p === 'number')) throw new Error(`${where}：挖空「${c.ja}」包到變數了（要挖變數請用 ?cloze *）`)
      return { b, a: c.a, w: c.w }
    })
  }
  if (replies.length) out.r = replies
  ext[ph.ja] = out
  entry = null
}

function parseLine(line, where) {
  if (!line || line.startsWith('#')) return
  if (line.startsWith('==')) {
    try {
      finish()
    } catch (e) {
      errors.push(e.message)
      entry = null
    }
    const ja = line.slice(2).trim()
    const ph = phrases.get(ja)
    if (!ph) throw new Error(`${where}：短句庫沒有「${ja}」`)
    if (ext[ja]) throw new Error(`${where}：「${ja}」寫了兩次`)
    entry = { ph, where, slots: [], clozes: [], replies: [], ctx: ctxOf(ph.segs) }
    return
  }
  if (!entry) throw new Error(`${where}：前面要先寫 == 短句原文`)
  const { ph } = entry
  if (line.startsWith('@')) {
    // @原文片段|中文片段=$值表 或 =值;值
    const m = line.match(/^@([^|=]+)\|([^=]+)=(.+)$/)
    if (!m) throw new Error(`${where}：變數格式要 @原文片段|中文片段=$值表（或 =值;值）`)
    const [, ja, zh, src] = m.map((s) => s.trim())
    const at = findAt(ph.ja, ja, 1, where)
    const own = cutSegs(ph.segs, [at, at + [...ja].length], where)
    const original = [own.find((p) => textOf(p) === ja) ?? [[ja]], zh]
    let values
    if (src.startsWith('$')) {
      values = pools.get(src.slice(1))
      if (!values) throw new Error(`${where}：沒有「${src}」這個值表`)
    } else values = src.split(';').map((v) => parseValue(v.trim(), where))
    // 原句的值一定在裡面，原句才出得來
    if (!values.some(([segs]) => textOf(segs) === ja)) values = [original, ...values]
    const texts = values.map(([segs]) => textOf(segs))
    if (new Set(texts).size !== texts.length) throw new Error(`${where}：變數的值重複`)
    if (new Set(values.map(([, z]) => z)).size !== values.length) throw new Error(`${where}：變數的值中文重複（換了值中文卻一樣，分不出來）`)
    if (values.length < 3) warnings.push(`${where}：變數「${ja}」只有 ${values.length} 個值`)
    entry.slots.push({ ja, zh, at, len: [...ja].length, values })
    return
  }
  if (line.startsWith('?cloze')) {
    const body = line.slice(6).trim()
    if (body === '*') return entry.clozes.push({ star: true })
    const [blank, wrong] = body.split('|').map((s) => s.trim())
    if (wrong == null) throw new Error(`${where}：挖空格式要 ?cloze 挖空的原文|錯誤選項;…`)
    const m = blank.match(/^([^#/]+)(?:#(\d+))?(?:\/(.+))?$/)
    const ja = m[1].trim()
    const at = findAt(ph.ja, ja, +(m[2] || 1), where)
    const w = wrong.split(';').map((x) => parseOpt(x.trim(), where, new Map(entry.ctx)))
    if (w.length < 3) throw new Error(`${where}：錯誤選項至少要 3 個`)
    const seen = new Set([hira(ja)])
    for (const [segs] of w) {
      const k = hira(kanaOf(segs))
      if (seen.has(k)) throw new Error(`${where}：選項「${textOf(segs)}」重複（或跟答案同音）`)
      seen.add(k)
    }
    // 答案的讀音用原句的
    const answerKana = kanaOf(cutSegs(ph.segs, [at, at + [...ja].length], where).find((p) => textOf(p) === ja) ?? [[ja]])
    if (w.some(([segs]) => hira(kanaOf(segs)) === hira(answerKana))) throw new Error(`${where}：有選項跟答案同音`)
    entry.clozes.push({ ja, at, len: [...ja].length, a: glossOf(ja, m[3]?.trim(), false, where), w })
    return
  }
  if (line.startsWith('?reply')) {
    // ?reply 角色|對方說的話|中文|錯誤回應;…
    const [who, said, zh, wrong] = line
      .slice(6)
      .split('|')
      .map((s) => s.trim())
    if (wrong == null) throw new Error(`${where}：回應格式要 ?reply 角色|對方說的話|中文|錯誤回應;…`)
    const ctx = ctxOf(ph.segs)
    const p = parseRuby(said, where, ctx)
    const w = wrong.split(';').map((x) => parseOpt(x.trim(), where, new Map(ctx)))
    if (w.length < 3) throw new Error(`${where}：錯誤回應至少要 3 個`)
    const seen = new Set([hira(ph.kana)])
    for (const [segs] of w) {
      const t = textOf(segs)
      const k = hira(kanaOf(segs))
      if (seen.has(k)) throw new Error(`${where}：回應「${t}」重複（或跟答案一樣）`)
      seen.add(k)
      // 同義組（ありがとう／ありがとうございます）的另一句也是對的
      const other = phrases.get(t)
      if (other && other.syn && other.syn === ph.syn) throw new Error(`${where}：「${t}」跟答案意思一樣（同義組 ${ph.syn}）`)
    }
    entry.replies.push({ who, p, pz: zh, w })
    return
  }
  throw new Error(`${where}：看不懂這行「${line}」`)
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^[a-z]\.txt$/.test(f))
  .sort()
for (const file of files) {
  entry = null
  fs.readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .forEach((raw, n) => {
      try {
        parseLine(raw.trim(), `${file}:${n + 1}`)
      } catch (e) {
        errors.push(e.message)
        if (raw.trim().startsWith('==')) entry = null
      }
    })
  try {
    finish()
  } catch (e) {
    errors.push(e.message)
  }
}

const missingFile = path.join(dir, '.missing.txt')
fs.rmSync(missingFile, { force: true })
if (missing.size) {
  errors.push(`有 ${missing.size} 個選項沒有中文，請補在 scripts/phrases/gloss.txt（或在選項後面寫 /中文），清單在 scripts/phrases/.missing.txt`)
  fs.writeFileSync(missingFile, [...missing].map(([ja, where]) => `${ja}/\t# ${where}`).join('\n') + '\n')
}
if (errors.length) {
  for (const e of [...new Set(errors)].slice(0, 40)) console.error('錯誤', e)
  if (errors.length > 40) console.error(`…還有 ${errors.length - 40} 個錯誤`)
  process.exit(1)
}

fs.writeFileSync(path.join(ROOT, 'src/data/phrase-ext.json'), JSON.stringify(ext))
const all = Object.values(ext)
const count = (k) => all.filter((x) => x[k]).length
console.log(
  `${all.length} 句有變化：變數 ${count('s')} 句、挖空 ${count('c')} 句（${all.reduce((n, x) => n + (x.c?.length || 0), 0)} 題）、回應 ${count('r')} 句（${all.reduce((n, x) => n + (x.r?.length || 0), 0)} 題）`,
)
for (const w of warnings) console.log('注意', w)
