// 語法題庫：一個文法點（〜てください、に：時間點…）是一題，底下有好幾個例句
// 例句輪流出（全部出過一輪才重複）、錯誤選項隨機挑，所以同一個文法點每次看到的句子不一樣，要真的懂才答得出來
// 資料在 data/grammar.json，由 scripts/build-grammar.mjs 從 scripts/grammar/*.txt 產生
//   point = { key, level, cat, form: 文法, mean: 意思, note: 說明, qs: 例句[] }
//   例句 = { s: [挖空前, 答案, 挖空後]（振假名段 [[文字, 讀音?]]）, zh: 中文, a: 答案的說明, w: [[振假名段, 說明, 1?]] 錯誤選項（1＝錯誤的變化或接法）}
// 切到語法模式才載入

export const GRAMMAR_LEVELS = [
  { key: 1, label: 'N5' },
  { key: 2, label: 'N4' },
  { key: 3, label: 'N3' },
]

export const GRAMMAR_CATS = [
  { key: 'p', label: '助詞' },
  { key: 'v', label: '動詞變化' },
  { key: 'a', label: '形容詞・名詞' },
  { key: 'q', label: '指示・疑問詞' },
  { key: 'j', label: '接續・條件' },
  { key: 'e', label: '句型・語氣' },
  { key: 'g', label: '授受・敬語' },
]

let ALL = null
const BY_ID = new Map()
let loading = null

export function loadGrammar() {
  loading ||= import('./data/grammar.json').then((m) => {
    ALL = m.default.points.map((p) => ({
      ...p,
      id: `gr:${p.key}`,
      kind: 'grammar',
      deck: 'grammar',
      group: p.cat,
      display: p.form, // 對照表、弱點列表顯示的名稱
      caption: p.mean,
    }))
    for (const p of ALL) BY_ID.set(p.id, p)
  })
  return loading
}

export function grammarById(id) {
  return BY_ID.get(id)
}

// 由簡入難：依難度分批，同難度內各分類輪流出（不會一直考助詞），分類內照課本順序（檔案裡的順序）
export function buildGrammarPool(cats, levels) {
  if (!ALL) return []
  const out = []
  for (const { key: level } of GRAMMAR_LEVELS) {
    if (!levels.includes(level)) continue
    const lists = GRAMMAR_CATS.filter((c) => cats.includes(c.key)).map((c) => ALL.filter((p) => p.cat === c.key && p.level === level))
    for (let i = 0; lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (l[i]) out.push(l[i])
    }
  }
  return out
}

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const wordOf = (furi) => ({ furi, ja: furi.map((s) => s[0]).join(''), kana: furi.map((s) => s[1] || s[0]).join('') })

// 每個文法點的例句輪流出：打亂順序後一句一句出，全部出過一輪才重新打亂（新的一輪第一句不會跟上一句一樣）
const decks = new Map() // id → { left: 還沒出的例句, last: 上一句 }
function nextSentence(item) {
  const d = decks.get(item.id) || { left: [], last: -1 }
  decks.set(item.id, d)
  if (!d.left.length) {
    d.left = shuffle(item.qs.map((_, i) => i))
    if (d.left.length > 1 && d.left[0] === d.last) d.left.push(d.left.shift())
  }
  d.last = d.left.shift()
  return item.qs[d.last]
}

// 這一次的題目：挑一句、挑 3 個錯誤選項、打亂；答案選項的 id 跟文法點相同（App 用 id 判斷答對）
export function makeGrammarQ(item) {
  const q = nextSentence(item)
  const [before, answer, after] = q.s.map(wordOf)
  const options = shuffle([
    { id: item.id, ...answer, zh: q.a },
    ...shuffle(q.w)
      .slice(0, 3)
      .map(([furi, zh, bad]) => ({ ...wordOf(furi), id: `${item.id}#${wordOf(furi).ja}`, zh, fake: !!bad })),
  ])
  return { before, answer, after, zh: q.zh, options, kana: before.kana + answer.kana + after.kana }
}
