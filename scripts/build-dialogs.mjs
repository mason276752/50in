// 會話題庫：scripts/dialogs/*.txt（範本）+ pools.txt（共用值表）→ src/data/dialogs.json
// 1. 振假名：用單字庫、短句庫已經切好的振假名，整理出每個漢字的讀音來對齊（含連濁、促音）
// 2. 每句的「字典」：從單字庫找出句子裡出現的詞（動詞、形容詞比對語幹，變化形也查得到）
// 3. 範本：{變數} 每次出題隨機帶入、[條件] 決定劇情分支（格式見 scripts/dialogs/1.txt 開頭）
// 4. 驗證：每段隨機帶入 300 次，檢查每一題都湊得出 4 個不同的選項
// 用法：node scripts/build-dialogs.mjs
import fs from 'node:fs'
import path from 'node:path'
import { expand, instantiate, rootOf } from '../src/dialogInstance.js'
import { ROOT, KANJI, hira, vocab, align as alignJa } from './lib/furigana.mjs'

const align = (ja, kana, where) => alignJa(ja, kana, where, (w) => warnings.push(w))

// ---- 字典：句子裡出現的單字 ----
const plainZh = (zh) => zh.replace(/（[^）]*）/g, '') || zh
const byJa = new Map()
for (const w of vocab) {
  if (!byJa.has(w.ja)) byJa.set(w.ja, [])
  byJa.get(w.ja).push(w)
}
// 變化形比對用的語幹：動詞去掉最後一個假名（温める→温め、帰る→帰），い形容詞去掉い
const stems = []
for (const w of vocab) {
  if (!KANJI.test(w.ja)) continue
  if ((w.pos === 'v' || w.pos === 'i') && /[ぁ-ん]$/.test(w.ja) && KANJI.test(w.ja.slice(0, -1))) {
    stems.push({ w, stem: w.ja.slice(0, -1), kanaStem: w.kana.slice(0, -1) })
  }
}
// 常是別的詞的一部分（おりまして、ございません）的假名詞
const KANA_STOP = new Set(['まして', 'ません', 'ました'])
const SEG = new Intl.Segmenter('ja', { granularity: 'word' })
function glossOf(ja, kana) {
  const k = hira(kana)
  // 詞的邊界：純假名詞只在邊界上比對，不然「おりまして」會配到「まして」、「ほうがいい」配到「うがい」
  const bounds = new Set([0, ja.length])
  for (const s of SEG.segment(ja)) bounds.add(s.index).add(s.index + s.segment.length)
  const found = [] // { at, len, w }
  const add = (at, len, w) => found.push({ at, len, w })
  for (const [surface, ws] of byJa) {
    if (surface.length < 1) continue
    const kanjiWord = KANJI.test(surface)
    if (!kanjiWord && (surface.length < 3 || KANA_STOP.has(surface))) continue // 短的純假名詞（は、です）太雜
    let at = ja.indexOf(surface)
    if (!kanjiWord) while (at >= 0 && !(bounds.has(at) && bounds.has(at + surface.length))) at = ja.indexOf(surface, at + 1)
    if (at < 0) continue
    // 同寫法多種讀音：挑讀音出現在這句讀音裡的
    const w = ws.find((x) => k.includes(hira(x.kana))) || (kanjiWord ? null : ws[0])
    if (w) add(at, [...surface].length, w)
  }
  for (const { w, stem, kanaStem } of stems) {
    const at = ja.indexOf(stem)
    // 来る 的語幹讀音會變（来ます＝き、来ない＝こ）
    if (at < 0 || (!k.includes(hira(kanaStem)) && !(w.ja === '来る' && /[きこ]/.test(k)))) continue
    const next = ja[at + stem.length]
    if (!next || !/[ぁ-ん]/.test(next)) continue
    // 前面還連著漢字、語幹又全是漢字，是複合詞（承知 不是 知る、販売 不是 売る）；全然涼しく 的 涼し 不算
    if (KANJI.test(ja[at - 1] || '') && !/[ぁ-ん]/.test(stem)) continue
    // い形容詞的語幹後面要接形容詞變化（眠れない 是 眠る 不是 眠い）
    if (w.pos === 'i' && !/^(く|か|い|け|さ|そ|す|み)/.test(ja.slice(at + stem.length))) continue
    add(at, stem.length + 1, w)
  }
  // 重疊的挑長的；同長度挑等級低（常用）的
  found.sort((a, b) => b.len - a.len || a.w.level - b.w.level)
  const used = []
  const keep = []
  for (const f of found) {
    if (used.some(([s, e]) => f.at < e && f.at + f.len > s)) continue
    // 單一漢字的詞（日、人）很容易誤配，前後還連著漢字就不算
    if (f.len === 1 && (KANJI.test(ja[f.at - 1] || '') || KANJI.test(ja[f.at + 1] || ''))) continue
    used.push([f.at, f.at + f.len])
    keep.push(f)
  }
  keep.sort((a, b) => a.at - b.at)
  const seen = new Set()
  return keep
    .filter((f) => !seen.has(f.w.ja) && seen.add(f.w.ja))
    .map((f) => ({
      at: f.at,
      e: [f.w.ja, f.w.kana === f.w.ja ? '' : f.w.kana, plainZh(f.w.zh)],
    }))
}

// ---- 解析題庫 ----
const warnings = []
const errors = []
const dictIndex = new Map()
const dict = []
const dictId = (e) => {
  const key = e.join('|')
  if (!dictIndex.has(key)) dictIndex.set(key, dict.push(e) - 1)
  return dictIndex.get(key)
}
const SLOT_SPLIT = /\{(\w+)\}/
const slotNames = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
const slotOf = (d, n) => d.slots.find((s) => s.n === n)

// 值：[分支代號:]日文[=讀音][/中文]
function parseValue(raw, where) {
  const m = raw.trim().match(/^([a-z0-9_]+):(.*)$/)
  const k = m?.[1]
  const [jk, zh] = (m ? m[2] : raw.trim()).split('/')
  const [ja, kana] = jk.split('=')
  if (!ja) throw new Error(`${where}：值是空的「${raw}」`)
  const g = glossOf(ja, kana || ja).map((x) => dictId(x.e))
  return {
    ...(k && { k }),
    ja,
    zh: zh ?? ja,
    f: align(ja, kana, where),
    ...(g.length && { g }),
  }
}

// 日文 + 讀音（可含 {變數}）→ parts：[文字, 讀音?] 或 { s: 變數 }
function parseJa(d, ja, kana, where) {
  const js = ja.split(SLOT_SPLIT)
  const ks = (kana || ja).split(SLOT_SPLIT)
  if (js.length !== ks.length || js.some((x, i) => i % 2 && x !== ks[i])) throw new Error(`${where}：原文和讀音的 {變數} 對不上\n  ${ja}\n  ${kana}`)
  const parts = []
  js.forEach((x, i) => {
    if (i % 2) {
      const s = slotOf(d, x)
      if (!s) throw new Error(`${where}：沒有定義變數 {${x}}`)
      if (s.keys) throw new Error(`${where}：分支變數 {${x}} 沒有文字，不能放在句子裡`)
      parts.push({ s: x })
    } else if (x) parts.push(...align(x, kana ? ks[i] : '', where))
  })
  return parts
}
// 選項：日文[=讀音][/中文]；沒寫中文就查 gloss.txt（常見的助詞、句子寫一次就好）
const GLOSS = new Map()
for (const line of fs.readFileSync(path.join(ROOT, 'scripts/dialogs/gloss.txt'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('/')
  GLOSS.set(t.slice(0, i), t.slice(i + 1))
}
const missingZh = new Map() // 日文 → 出現的位置
function zhOf(d, ja, inline, where) {
  const zh = inline ?? GLOSS.get(ja) ?? (/^\{\w+\}$/.test(ja) ? ja : null)
  if (zh == null) {
    if (!missingZh.has(ja)) missingZh.set(ja, where)
    return ''
  }
  return checkZh(d, zh, where)
}
const parseOpt = (d, s, where) => {
  const [jk, zh] = s.split('/')
  const [ja, kana] = jk.split('=')
  return { p: parseJa(d, ja, kana, where), z: zhOf(d, ja, zh, where) }
}

// 挖空：在 parts 裡切出要挖的那段（變數整個是一格，不能切）
// 同一句出現好幾次的字要寫 字#第幾個（に#2），免得挖錯地方
function cutParts(parts, spec, where) {
  const [target, nth = '1'] = spec.split('#')
  const text = parts.map((p) => (Array.isArray(p) ? p[0] : '\u0000')).join('')
  const all = []
  for (let i = text.indexOf(target); i >= 0; i = text.indexOf(target, i + 1)) all.push(i)
  if (!all.length) throw new Error(`${where}：找不到要挖空的「${target}」`)
  if (all.length > 1 && !spec.includes('#')) throw new Error(`${where}：「${target}」在這句出現 ${all.length} 次，請寫 ${target}#幾 指定挖第幾個`)
  const start = all[+nth - 1]
  if (start == null) throw new Error(`${where}：「${target}」沒有第 ${nth} 個`)
  const end = start + target.length
  const out = []
  let at = 0
  for (const p of parts) {
    const t = Array.isArray(p) ? p[0] : '\u0000'
    const s = at
    const e = at + t.length
    at = e
    const cuts = [start, end].filter((x) => x > s && x < e)
    if (cuts.length && (!Array.isArray(p) || p[1])) throw new Error(`${where}：挖空「${target}」切到「${t}」中間`)
    let prev = s
    for (const c of [...cuts, e]) {
      out.push({
        p: cuts.length ? [t.slice(prev - s, c - s)] : p,
        blank: prev >= start && c <= end,
      })
      prev = c
    }
  }
  const first = out.findIndex((x) => x.blank)
  return {
    parts: out.map((x) => x.p),
    blank: [first, out.findLastIndex((x) => x.blank) + 1],
  }
}

// [變數=a,b][變數!=c] → [[變數, 是否不等於, [代號]]]
function parseCond(d, str, where) {
  if (!str) return undefined
  return [...str.matchAll(/\[(\w+)(!?=)([\w,]+)\]/g)].map(([, n, op, keys]) => {
    const s = slotOf(d, n)
    if (!s) throw new Error(`${where}：條件用了沒定義的變數 ${n}`)
    const valid = s.keys || listOf(d, s).map((v) => v.k)
    for (const k of keys.split(',')) if (!valid.includes(k)) throw new Error(`${where}：變數 ${n} 沒有「${k}」這個代號`)
    return [n, op === '!=', keys.split(',')]
  })
}
const listOf = (d, s) => (s.pool ? pools[s.pool] : s.same ? listOf(d, slotOf(d, s.same)) : s.v)

function checkZh(d, s, where) {
  for (const n of slotNames(s)) {
    const slot = slotOf(d, n)
    if (!slot) throw new Error(`${where}：沒有定義變數 {${n}}`)
    if (slot.keys) throw new Error(`${where}：分支變數 {${n}} 沒有文字`)
  }
  return s
}

// 共用值表：@@名稱 底下一行一個值
const pools = {}
const dir = path.join(ROOT, 'scripts/dialogs')
{
  let cur = null
  fs.readFileSync(path.join(dir, 'pools.txt'), 'utf8')
    .split('\n')
    .forEach((raw, n) => {
      const line = raw.trim()
      if (!line || line.startsWith('#')) return
      if (line.startsWith('@@')) return (cur = pools[line.slice(2).trim()] = [])
      cur.push(parseValue(line, `pools.txt:${n + 1}`))
    })
}

const dialogs = []
const whereOf = new Map() // 題目 → 原始檔位置（驗證時報錯用）
let d = null // 正在讀的這段
for (const file of fs
  .readdirSync(dir)
  .filter((f) => /^\d+\.txt$/.test(f))
  .sort((a, b) => parseInt(a) - parseInt(b))) {
  fs.readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .forEach((raw, n) => {
      // 一行出錯就記下來繼續讀，最後一次列出所有錯誤
      try {
        parseLine(raw.trim(), `${file}:${n + 1}`)
      } catch (e) {
        errors.push(e.message)
      }
    })
}
function parseLine(line, where) {
  if (!line || line.startsWith('#')) return
  if (line.startsWith('===')) {
    const [id, level, cat, title] = line.slice(3).trim().split('|')
    d = { id: +id, level: +level, cat, title, slots: [], lines: [], qs: [] }
    dialogs.push(d)
    return
  }
  if (line.startsWith('%')) {
    const [n, keys] = line.slice(1).split('=')
    if (slotOf(d, n)) throw new Error(`${where}：變數 ${n} 重複定義`)
    d.slots.push({ n, keys: keys.split(';').map((k) => k.trim()) })
    return
  }
  if (line.startsWith('@')) {
    const m = line.match(/^@(\w+)(?:~(\w+))?=(.*)$/)
    if (!m) throw new Error(`${where}：變數格式要 @名稱=值;值 或 @名稱=$共用表`)
    const [, n, link, body] = m
    if (slotOf(d, n)) throw new Error(`${where}：變數 ${n} 重複定義`)
    if (body.startsWith('$')) {
      if (!pools[body.slice(1)]) throw new Error(`${where}：沒有共用值表 ${body}`)
      d.slots.push({ n, pool: body.slice(1) })
    } else if (body.startsWith('@')) {
      if (!slotOf(d, body.slice(1))) throw new Error(`${where}：沒有變數 ${body}`)
      d.slots.push({ n, same: body.slice(1) })
    } else {
      const v = body.split(';').map((x) => parseValue(x, where))
      if (link) {
        const other = slotOf(d, link)
        if (!other || listOf(d, other).length !== v.length) throw new Error(`${where}：${n} 要跟 ${link} 一樣多個值`)
        d.slots.push({ n, link, v })
      } else d.slots.push({ n, v })
    }
    return
  }
  const cm = line.match(/^((?:\[[^\]]+\])+)/)
  const c = parseCond(d, cm?.[1], where)
  if (cm) line = line.slice(cm[1].length)

  if (line.startsWith('?')) {
    const [type, ...rest] = line.slice(1).split('|')
    let q
    if (type === 'cloze') {
      const [li, spec, wrong] = rest
      const [target, tzh] = spec.split('/')
      const L = d.lines[+li]
      if (!L) throw new Error(`${where}：沒有第 ${li} 句`)
      const sm = target.match(/^\{(\w+)\}$/)
      let cut
      if (sm) {
        const at = L.parts.findIndex((p) => p.s === sm[1])
        if (at < 0) throw new Error(`${where}：第 ${li} 句沒有 {${sm[1]}}`)
        const root = (n) => rootOf(d, n)
        if (!d.lines.some((x, i) => i !== +li && x.parts.some((p) => p.s && root(p.s) === root(sm[1]))))
          throw new Error(`${where}：{${sm[1]}} 只出現在這句，沒辦法從上下文推出來`)
        cut = { parts: L.parts, blank: [at, at + 1] }
      } else cut = cutParts(L.parts, target, where)
      const w = wrong.split(';').map((s) => (s === '*' ? '*' : parseOpt(d, s, where)))
      if (w.includes('*') && !sm) throw new Error(`${where}：只有挖空變數時才能用 * 自動出選項`)
      q = { type, line: +li, ...cut, w, ...(!sm && { az: zhOf(d, target.split('#')[0], tzh, where) }) }
    } else if (type === 'reply') {
      const [li, wrong] = rest
      if (!d.lines[+li]) throw new Error(`${where}：沒有第 ${li} 句`)
      q = {
        type,
        line: +li,
        w: wrong.split(';').map((s) => parseOpt(d, s, where)),
      }
    } else if (type === 'read') {
      const [qq, answer, wrong] = rest
      const w = wrong.split(';').map((s) => checkZh(d, s, where))
      if (w.includes('*') && !slotNames(answer).length) throw new Error(`${where}：答案裡沒有 {變數}，不能用 * 自動出選項`)
      q = { type, q: checkZh(d, qq, where), a: checkZh(d, answer, where), w }
    } else throw new Error(`${where}：不認得的題型 ${type}`)
    if (c) q.c = c
    if (q.w.length < 3 && !q.w.includes('*')) throw new Error(`${where}：錯誤選項至少要 3 個`)
    d.qs.push(q)
    whereOf.set(q, where)
    return
  }
  const [who, name, ja, reading, zh] = line.split('|')
  if (zh == null) throw new Error(`${where}：句子格式要 代號|角色|日文|讀音|中文`)
  checkZh(d, name, where)
  checkZh(d, zh, where)
  const parts = parseJa(d, ja, reading, where)
  // 字典：變數先換成佔位字（字典不會跨過它配對），再對回是第幾段
  const ph = (s) => s.replace(/\{\w+\}/g, '〓')
  const starts = []
  let at = 0
  for (const p of parts) {
    starts.push(at)
    at += Array.isArray(p) ? p[0].length : 1
  }
  const g = glossOf(ph(ja), ph(reading || ja)).map((x) => [dictId(x.e), starts.findLastIndex((s) => s <= x.at)])
  d.lines.push({
    who,
    name,
    parts,
    zh,
    ...(g.length && { g }),
    ...(c && { c }),
  })
}

// ---- 驗證：每段隨機帶入很多次，檢查每一題都湊得出 4 個不同的選項、句子沒有漏掉的變數 ----
const data = { pools, dict, dialogs }
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const ids = new Set()
let variants = 0
for (const d of dialogs) {
  if (ids.has(d.id)) errors.push(`會話編號重複：${d.id}`)
  ids.add(d.id)
  const rand = rng(d.id)
  const stat = d.qs.map(() => ({ seen: 0, bad: 0 }))
  const kinds = new Set()
  for (let r = 0; r < 300; r++) {
    const { lines, qs } = expand(d, data, rand)
    kinds.add(lines.map((L) => L.ja).join('/'))
    for (const L of lines) if (/[{}〓]/.test(L.ja + L.zh + L.name)) errors.push(`#${d.id}：句子有沒帶入的變數「${L.ja}」「${L.zh}」`)
    qs.forEach((q, i) => {
      if (q === undefined) return
      stat[i].seen++
      if (!q) stat[i].bad++
    })
    const inst = instantiate(d, data, rand)
    if (inst.qs.length < 2) errors.push(`#${d.id} ${d.title}：這次只抽得到 ${inst.qs.length} 題`)
  }
  variants += kinds.size
  stat.forEach((s, i) => {
    const where = whereOf.get(d.qs[i])
    if (!s.seen) errors.push(`${where}：這題的條件永遠不成立`)
    else if (s.bad) errors.push(`${where}：有 ${s.bad}/${s.seen} 次湊不出 4 個不同的選項`)
  })
  const n = d.qs.filter((q) => !q.c).length
  if (d.qs.length < 4) warnings.push(`#${d.id} ${d.title}：候選題只有 ${d.qs.length} 題，每次都出一樣的題`)
  if (!d.slots.length && n) warnings.push(`#${d.id} ${d.title}：沒有變數，內容每次都一樣`)
}
const missingFile = path.join(ROOT, 'scripts/dialogs/.missing.txt')
fs.rmSync(missingFile, { force: true })
if (missingZh.size) {
  errors.push(`有 ${missingZh.size} 個選項沒有中文，請補在 scripts/dialogs/gloss.txt（或在選項後面寫 /中文），清單在 scripts/dialogs/.missing.txt`)
  fs.writeFileSync(missingFile, [...missingZh].map(([ja, where]) => `${ja}/\t# ${where}`).join('\n') + '\n')
}
if (errors.length) {
  for (const e of [...new Set(errors)].slice(0, 40)) console.error('錯誤', e)
  process.exit(1)
}

fs.writeFileSync(path.join(ROOT, 'src/data/dialogs.json'), JSON.stringify(data))
console.log(
  `${dialogs.length} 段會話、${dialogs.reduce((n, d) => n + d.qs.length, 0)} 道候選題、${Object.keys(pools).length} 個共用值表、字典 ${dict.length} 筆`,
)
console.log(`抽樣 300 次平均每段 ${(variants / dialogs.length).toFixed(1)} 種不同內容`)
for (const w of warnings) console.log('注意', w)
