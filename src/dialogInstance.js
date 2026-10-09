// 會話範本 → 這一次實際出的對話
// 範本裡的變數（人名、時間、數量、地點、物品…）每次隨機帶入，分支變數決定劇情走向，
// 題目從候選題裡抽，選項也每次重新組合：同一段對話每次的內容、答案都不一樣，背不起來，只能真的看懂
// 純函式、不依賴 Vite，scripts/build-dialogs.mjs 也拿它來驗證題庫
//
// 資料格式（由 scripts/build-dialogs.mjs 產生）
//   data = { pools: { 名稱: 值[] }, dict: [[日文, 讀音, 中文]], dialogs: 範本[] }
//   值 = { k?: 分支代號, ja, zh, f: 振假名段, g?: 字典索引[] }
//   變數 = { n: 名稱, pool?: 共用值表, v?: 值[], same?: 跟哪個變數用同一份值表（值不重複）, link?: 跟哪個變數同一組（同一個位置）, keys?: 分支代號[] }
//   日文（句子、選項）= parts：[文字, 讀音?] 或 { s: 變數名 }
//   條件 = [[變數名, 是否「不等於」, 代號[]]]

const COUNT = { 1: 3, 2: 3, 3: 4 } // 每段出幾題

const pick = (a, rand) => a[Math.floor(rand() * a.length)]
function shuffle(list, rand) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const slotOf = (t, n) => t.slots.find((s) => s.n === n)
// 同一組的變數（數量 ~ 總價）算同一個：句子裡出現總價，也能推出數量
export const rootOf = (t, n) => {
  const s = slotOf(t, n)
  return s?.link ? rootOf(t, s.link) : n
}
function listOf(t, data, s) {
  if (s.pool) return data.pools[s.pool]
  if (s.same) return listOf(t, data, slotOf(t, s.same))
  return s.v
}
// 同一份值表的變數彼此不重複（兩個人不會同名、改期前後不會同一天）
const listId = (t, s) => (s.pool ? `p:${s.pool}` : s.same ? listId(t, slotOf(t, s.same)) : `s:${s.n}`)

function pickValues(t, data, rand) {
  const vals = {}
  const taken = new Map()
  for (const s of t.slots) {
    if (s.keys) {
      vals[s.n] = { k: pick(s.keys, rand) }
      continue
    }
    const list = listOf(t, data, s)
    let i
    if (s.link) i = vals[s.link].i
    else {
      const id = listId(t, s)
      if (!taken.has(id)) taken.set(id, new Set())
      const used = taken.get(id)
      i = pick(list.map((_, j) => j).filter((j) => !used.has(j)), rand)
      used.add(i)
    }
    vals[s.n] = { ...list[i], i }
  }
  return vals
}

const okCond = (cond, vals) => !cond || cond.every(([n, neg, keys]) => keys.includes(vals[n]?.k) !== neg)

function render(parts, vals) {
  const furi = []
  for (const p of parts) {
    if (Array.isArray(p)) furi.push(p)
    else furi.push(...vals[p.s].f)
  }
  return { ja: furi.map((s) => s[0]).join(''), kana: furi.map((s) => s[1] || s[0]).join(''), furi }
}
const fill = (str, vals, field = 'zh') => str.replace(/\{(\w+)\}/g, (_, n) => vals[n][field])
const slotsIn = (parts) => parts.filter((p) => !Array.isArray(p)).map((p) => p.s)

// 字典：照句子順序，變數的部分換成帶入的值的單字
function glossOf(L, vals, dict) {
  const out = []
  const seen = new Set()
  L.parts.forEach((p, i) => {
    const ids = Array.isArray(p) ? (L.g || []).filter((x) => x[1] === i).map((x) => x[0]) : vals[p.s].g || []
    for (const d of ids) {
      const e = dict[d]
      if (!seen.has(e[0])) seen.add(e[0]) && out.push(e)
    }
  })
  return out
}

// 變數的其他值（自動產生的錯誤選項）：這段對話裡其他變數用到的值排前面（最容易混淆，要真的看懂才選得對）
function othersOf(t, data, vals, n) {
  const s = slotOf(t, n)
  const list = listOf(t, data, s)
  const id = listId(t, s)
  const inDialog = t.slots.filter((x) => x.n !== n && !x.keys && listId(t, x) === id).map((x) => vals[x.n].i)
  const near = [...new Set(inDialog)].filter((i) => i !== vals[n].i)
  const rest = list.map((_, i) => i).filter((i) => i !== vals[n].i && !near.includes(i))
  const val = (i) => ({ ...list[i], i })
  return { near: near.map(val), rest: rest.map(val) }
}

// 正解 + 3 個不重複的錯誤選項；湊不滿回傳 null
function assemble(answer, near, others, key, rand) {
  const seen = new Set([key(answer)])
  const wrong = []
  for (const o of [...near, ...shuffle(others, rand)]) {
    if (wrong.length === 3) break
    if (seen.has(key(o))) continue
    seen.add(key(o))
    wrong.push(o)
  }
  return wrong.length === 3 ? [answer, ...wrong] : null
}

function buildQuestion(t, data, vals, q, rand) {
  const ja = (o) => o.ja
  if (q.type === 'read') {
    const answer = { zh: fill(q.a, vals) }
    const fixed = q.w.filter((w) => w !== '*').map((w) => ({ zh: fill(w, vals) }))
    let near = []
    let auto = []
    if (q.w.includes('*')) {
      const n = q.a.match(/\{(\w+)\}/)[1]
      const o = othersOf(t, data, vals, n)
      const as = (v) => ({ zh: fill(q.a, { ...vals, [n]: v }) })
      near = o.near.map(as)
      auto = o.rest.map(as)
    }
    const options = assemble(answer, near, [...fixed, ...auto], (o) => o.zh, rand)
    return options && { type: 'read', q: fill(q.q, vals), options }
  }
  const fixed = q.w.filter((w) => w !== '*').map((w) => render(w, vals))
  if (q.type === 'reply') {
    const options = assemble(render(t.lines[q.line].parts, vals), [], fixed, ja, rand)
    return options && { type: 'reply', line: q.line, options }
  }
  // cloze：挖空處切開；挖的是變數時，錯誤選項可以用它的其他值（*）
  const [a, b] = q.blank
  const pre = render(q.parts.slice(0, a), vals)
  const mid = render(q.parts.slice(a, b), vals)
  const post = render(q.parts.slice(b), vals)
  let near = []
  let auto = []
  if (q.w.includes('*')) {
    const n = q.parts[a].s
    const o = othersOf(t, data, vals, n)
    near = o.near.map((v) => render([{ s: n }], { [n]: v }))
    auto = o.rest.map((v) => render([{ s: n }], { [n]: v }))
  }
  const options = assemble(mid, near, [...fixed, ...auto], ja, rand)
  return (
    options && {
      type: 'cloze',
      line: q.line,
      slot: q.parts[a].s && rootOf(t, q.parts[a].s),
      furi: [...pre.furi, ...mid.furi, ...post.furi],
      blank: [pre.furi.length, pre.furi.length + mid.furi.length],
      options,
    }
  )
}

// 挖掉變數的克漏字，要靠別句提到的同一個值作答：那一句在作答時不能被藏起來或挖掉
function consistent(list, lines) {
  for (const q of list) {
    if (q.type !== 'cloze' || !q.slot) continue
    const visible = lines.some((L, li) => {
      if (li === q.line || !L.slots.includes(q.slot)) return false
      const later = list.find((x) => x.line === li && x.type !== 'read')
      return !later || li < q.line || (later.type === 'cloze' && later.slot !== q.slot)
    })
    if (!visible) return false
  }
  return true
}

// 抽題：盡量每種題型都有，同一句只出一題
function selectQuestions(cands, lines, n, rand) {
  const chosen = []
  const tryAdd = (q) => {
    if (chosen.length >= n || chosen.includes(q)) return
    if (q.line != null && chosen.some((x) => x.line === q.line && x.type !== 'read')) return
    if (consistent([...chosen, q], lines)) chosen.push(q)
  }
  const order = shuffle(cands, rand)
  for (const type of shuffle(['cloze', 'reply', 'read'], rand)) {
    const q = order.find((x) => x.type === type && !chosen.includes(x))
    if (q) tryAdd(q)
  }
  for (const q of order) tryAdd(q)
  return chosen.sort((a, b) => (a.type === 'read') - (b.type === 'read') || (a.line ?? 0) - (b.line ?? 0) || cands.indexOf(a) - cands.indexOf(b))
}

// 帶入變數、決定劇情；all 時回傳每一題候選題的結果（驗證題庫用）
export function expand(t, data, rand = Math.random) {
  const vals = pickValues(t, data, rand)
  const index = new Map() // 範本句號 → 實際句號
  const lines = []
  t.lines.forEach((L, i) => {
    if (!okCond(L.c, vals)) return
    index.set(i, lines.length)
    const r = render(L.parts, vals)
    lines.push({
      who: L.who,
      name: fill(L.name, vals, 'ja'),
      ja: r.ja,
      kana: r.kana,
      furi: r.furi,
      zh: fill(L.zh, vals),
      gloss: glossOf(L, vals, data.dict),
      slots: slotsIn(L.parts).map((n) => rootOf(t, n)),
    })
  })
  const qs = t.qs.map((q) => {
    if (!okCond(q.c, vals) || (q.line != null && !index.has(q.line))) return undefined // 這次的劇情沒有這題
    const built = buildQuestion(t, data, vals, q, rand)
    return built && (built.line != null ? { ...built, line: index.get(q.line) } : built)
  })
  return { vals, lines, qs }
}

export function instantiate(t, data, rand = Math.random) {
  const { lines, qs } = expand(t, data, rand)
  const cands = qs.filter(Boolean)
  return { lines, qs: selectQuestions(cands, lines, Math.min(COUNT[t.level] || 3, cands.length), rand) }
}
