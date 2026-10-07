// 單字題庫：JLPT N5–N1 約 7800 詞（詞表來源 tanos.co.uk JLPT 詞彙表，CC BY；中文釋義與情境分類另行整理）
// 資料在 data/vocab.tsv，每行：難度(1=N5…5=N1) 分類 日文 讀音(與日文相同時留空) 中文 英文關鍵字
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
      const [level, group, ja, reading, zh, en] = line.split('\t')
      return { level: Number(level), group, ja, kana: reading || ja, zh, en: en ? en.split(' ') : [] }
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

// 意思太接近的不能同時當選項（例如 美しい / 綺麗 都是「漂亮」）
function tooClose(a, b) {
  if (a.ja === b.ja || a.kana === b.kana) return true
  const ma = meanings(a.zh)
  if (meanings(b.zh).some((x) => ma.includes(x))) return true
  return a.en.some((w) => b.en.includes(w))
}

// 四選一：其他選項用別的考題的答案。同情境、難度接近的優先，比較有鑑別度
export function makeChoices(item) {
  const scored = []
  for (const w of ALL[item.dir]) {
    if (w === item) continue
    scored.push([(w.group === item.group ? 0 : 2) + Math.abs(w.level - item.level) + Math.random() * 1.5, w])
  }
  scored.sort((a, b) => a[0] - b[0])
  const picked = []
  for (const [, w] of scored) {
    if (tooClose(item, w) || picked.some((p) => tooClose(p, w))) continue
    picked.push(w)
    if (picked.length === 3) break
  }
  return shuffle([item, ...picked])
}
