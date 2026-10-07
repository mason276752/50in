// 單字題庫：JLPT N5–N1 約 7800 詞（詞表來源 tanos.co.uk JLPT 詞彙表，CC BY；中文釋義與情境分類另行整理）
// 資料在 data/vocab.tsv，每行：難度(1=N5…5=N1) 分類 詞性 日文 讀音(與日文相同時留空) 中文 英文關鍵字
// 詞性：v 動詞 | i い形容詞 | k 副詞・連接詞・文法 | g 招呼・慣用語 | n 名詞及其他（含な形容詞）
// 檔案約 180KB(gzip)，切到單字模式才載入

export const WORD_CATS = [
  { key: 'g', label: '招呼・慣用語' },
  { key: 'n', label: '數字・時間' },
  { key: 'p', label: '人物・人際' },
  { key: 'f', label: '飲食' },
  { key: 's', label: '購物・金錢' },
  { key: 't', label: '交通・地點' },
  { key: 'r', label: '休閒・旅遊・藝文' },
  { key: 'w', label: '自然・天氣・動植物' },
  { key: 'h', label: '居家・生活' },
  { key: 'e', label: '學校・語言' },
  { key: 'j', label: '工作・職場' },
  { key: 'b', label: '身體・健康' },
  { key: 'm', label: '心情・性格' },
  { key: 'c', label: '社會・政治・法律' },
  { key: 'x', label: '科學・產業' },
  { key: 'a', label: '常用動詞' },
  { key: 'd', label: '形容・狀態' },
  { key: 'k', label: '副詞・連接・文法' },
  { key: 'o', label: '抽象概念' },
]

export const LEVELS = [
  { key: 1, label: 'N5' },
  { key: 2, label: 'N4' },
  { key: 3, label: 'N3' },
  { key: 4, label: 'N2' },
  { key: 5, label: 'N1' },
]

export const DIRECTIONS = [
  { key: 'ja2zh', label: '日→中' },
  { key: 'zh2ja', label: '中→日' },
]

let ALL = null // { ja2zh: [...], zh2ja: [...] }
const BY_ID = new Map()
let loading = null

function parse(raw) {
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [level, group, pos, ja, reading, zh, en] = line.split('\t')
      return { level: Number(level), group, pos, ja, kana: reading || ja, zh, en: en ? en.split(' ') : [] }
    })
  // 同音詞（はし＝橋、箸、端…）只看讀音分不出來，出題時要連漢字一起給
  const sameKana = new Map()
  for (const r of rows) sameKana.set(r.kana, (sameKana.get(r.kana) || 0) + 1)

  ALL = {}
  for (const { key: dir } of DIRECTIONS) {
    ALL[dir] = rows.map((r) => {
      const item = {
        ...r,
        id: `${dir}:${r.ja}:${r.kana}`,
        kind: 'vocab',
        dir,
        display: r.kana,
        caption: r.zh,
        say: r.kana, // 唸讀音，避免語音引擎把漢字唸錯
        homophone: sameKana.get(r.kana) > 1,
      }
      BY_ID.set(item.id, item)
      return item
    })
  }
}

export function loadWords() {
  loading ||= import('./data/vocab.tsv?raw').then((m) => parse(m.default))
  return loading
}

export function wordById(id) {
  return BY_ID.get(id)
}

// 由簡入難：依難度分批，同難度內各情境輪流出，不會一直出同一類
export function buildWordPool(dir, cats, levels) {
  if (!ALL) return []
  const out = []
  for (const { key: level } of LEVELS) {
    if (!levels.includes(level)) continue
    const lists = WORD_CATS.filter((c) => cats.includes(c.key)).map((c) =>
      ALL[dir].filter((w) => w.group === c.key && w.level === level),
    )
    for (let i = 0; lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (l[i]) out.push(l[i])
    }
  }
  return out
}

export function wordsByCat(items) {
  return WORD_CATS.map((c) => ({ key: c.key, label: c.label, items: items.filter((w) => w.group === c.key) })).filter(
    (g) => g.items.length,
  )
}

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 去掉（他動）、（正式）這類補充說明，比較意思本身
const meanings = (zh) => zh.replace(/（[^）]*）/g, '').replace(/～/g, '').split('；')

// 選項上不顯示括號註記：只有一個選項標（謙讓）的話等於提示答案
export function plainZh(zh) {
  return zh.replace(/（[^）]*）/g, '') || zh
}

// 不分出題方向的單字 key，用來記「哪兩個字容易搞混」
export const baseKey = (w) => `${w.ja}:${w.kana}`

// 意思太接近的不能同時當選項（例如 美しい / 綺麗 都是「漂亮」）
function tooClose(a, b) {
  if (a.ja === b.ja || a.kana === b.kana) return true
  const ma = meanings(a.zh)
  if (meanings(b.zh).some((x) => ma.includes(x))) return true
  return a.en.some((w) => b.en.includes(w))
}

// 讀音相似度 0–1（編輯距離），中→日用來挑長得像的假名：こうしょう / こうしょ / ごうしょう
function kanaSimilarity(a, b) {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

const KANJI = /[\u4e00-\u9fff々]/g
const sharedKanji = (a, b) => {
  const ka = a.ja.match(KANJI) || []
  return (b.ja.match(KANJI) || []).filter((c) => ka.includes(c)).length
}

// 分數越低越適合當錯誤選項
function distractorScore(item, w) {
  let s = Math.random() * 1.2
  if (w.pos !== item.pos) s += 4 // 詞性不同，一眼就能刪掉
  if (w.group !== item.group) s += 1.5
  s += Math.abs(w.level - item.level) * 0.7
  if (item.dir === 'zh2ja') {
    s += (1 - kanaSimilarity(item.kana, w.kana)) * 4 // 讀音越像越好
    s -= Math.min(sharedKanji(item, w), 2) * 0.7 // 有共同漢字（顯示漢字時容易混）
  }
  return s
}

// 四選一：其他選項用別的考題的答案
// 1. 以前選錯過的字優先放進來（最多 2 個） 2. 其餘挑詞性相同、同情境、難度接近（中→日再看讀音相似）
export function makeChoices(item, confusedKeys = []) {
  const picked = []
  const ok = (w) => w !== item && !tooClose(item, w) && !picked.some((p) => tooClose(p, w))
  for (const key of confusedKeys) {
    const w = ALL[item.dir].find((x) => baseKey(x) === key)
    if (w && ok(w)) picked.push(w)
    if (picked.length === 2) break
  }
  const scored = []
  for (const w of ALL[item.dir]) if (w !== item) scored.push([distractorScore(item, w), w])
  scored.sort((a, b) => a[0] - b[0])
  for (const [, w] of scored) {
    if (picked.length === 3) break
    if (ok(w)) picked.push(w)
  }
  return shuffle([item, ...picked])
}
