// 單字題庫：JLPT N5–N1 約 7800 詞（詞表來源 tanos.co.uk JLPT 詞彙表，CC BY；中文釋義與情境分類另行整理）
// 資料在 data/vocab.tsv，每行：難度(1=N5…5=N1) 分類 詞性 日文 讀音(與日文相同時留空) 中文 英文關鍵字 振假名
// 振假名是產生題庫時用 KANJIDIC（EDRDG，CC BY-SA）的漢字讀音逐字切好的：「一=いち|部=ぶ|分=ぶん」，
// 假名段不標；熟字訓（明日=あした）整段標
// 詞性：v 動詞 | i い形容詞 | k 副詞・連接詞・文法 | g 招呼・慣用語 | n 名詞及其他（含な形容詞）
// 檔案約 180KB(gzip)，切到單字模式才載入
// 短句題庫 data/phrases.tsv 格式相同（自編，約 2000 句，26 種情境），難度分 入門／基礎／進階，詞性一律 g

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
  { key: 'kanji2kana', label: '漢→假' }, // 看漢字選讀音
]

export const PHRASE_CATS = [
  { key: 'a', label: '招呼・寒暄' },
  { key: 'i', label: '自我介紹' },
  { key: 't', label: '感謝・道歉' },
  { key: 'q', label: '回應・附和' },
  { key: 'k', label: '請求・許可' },
  { key: 'o', label: '意見・討論' },
  { key: 'r', label: '稱讚・安慰' },
  { key: 'm', label: '心情・感嘆' },
  { key: 'y', label: '日常對話' },
  { key: 'z', label: '天氣・季節' },
  { key: 'p', label: '邀約・約定' },
  { key: 'g', label: '朋友・戀愛' },
  { key: 'j', label: '興趣・娛樂' },
  { key: 's', label: '購物' },
  { key: 'f', label: '餐廳・飲食' },
  { key: 'v', label: '店員用語' },
  { key: 'd', label: '問路・交通' },
  { key: 'h', label: '住宿・觀光' },
  { key: 'u', label: '租屋・居家' },
  { key: 'n', label: '銀行・郵局・手續' },
  { key: 'x', label: '手機・網路' },
  { key: 'c', label: '課堂・學習' },
  { key: 'w', label: '職場・敬語' },
  { key: 'l', label: '電話' },
  { key: 'b', label: '醫院・藥局' },
  { key: 'e', label: '緊急狀況' },
]

export const PHRASE_LEVELS = [
  { key: 1, label: '入門' },
  { key: 2, label: '基礎' },
  { key: 3, label: '進階' },
]

// 兩副選擇題題庫：單字、短句（短句沒有「漢→假」）
export const DECKS = {
  vocab: { cats: WORD_CATS, levels: LEVELS, dirs: DIRECTIONS, load: () => import('./data/vocab.tsv?raw') },
  phrase: { cats: PHRASE_CATS, levels: PHRASE_LEVELS, dirs: DIRECTIONS.slice(0, 2), load: () => import('./data/phrases.tsv?raw') },
}

const ALL = {} // { vocab: { ja2zh: [...], … }, phrase: { ja2zh: [...], zh2ja: [...] } }
const BY_ID = new Map()
// 單一漢字 → 題庫裡出現過的讀音，分兩種語境（用來造「唸錯」的選項）：
// comp：熟語裡，前後也是漢字（学校 的 学＝がっ）；kun：後面接假名或單獨成詞（学ぶ 的 学＝まな）
const KANJI_READINGS = { comp: new Map(), kun: new Map() }
const isKanjiSeg = (seg) => seg && seg[1] != null
const READINGS_OF_JA = new Map() // 寫法 → 所有正確讀音（明日：あした、あす）
const loading = {}

function parse(raw, deck) {
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [level, group, pos, ja, reading, zh, en, furi] = line.split('\t')
      return {
        level: Number(level),
        group,
        pos,
        ja,
        kana: reading || ja,
        zh,
        en: en ? en.split(' ') : [],
        furi: furi ? furi.split('|').map((seg) => seg.split('=')) : null, // [[漢字, 讀音], [假名]]
      }
    })
  // 同音詞（はし＝橋、箸、端…）只看讀音分不出來，出題時要連漢字一起給
  const sameKana = new Map()
  for (const r of rows) sameKana.set(r.kana, (sameKana.get(r.kana) || 0) + 1)

  // 漢→假的讀音資料只取自單字
  for (const r of deck === 'vocab' ? rows : []) {
    if (!READINGS_OF_JA.has(r.ja)) READINGS_OF_JA.set(r.ja, new Set())
    READINGS_OF_JA.get(r.ja).add(r.kana)
    const segs = r.furi || []
    segs.forEach(([text, rt], i) => {
      if (!rt || text.length !== 1) return
      const map = KANJI_READINGS[segContext(segs, i)]
      if (!map.has(text)) map.set(text, new Set())
      map.get(text).add(rt)
    })
  }

  ALL[deck] = {}
  for (const { key: dir } of DECKS[deck].dirs) {
    ALL[deck][dir] = rows.map((r) => {
      const item = {
        ...r,
        // 單字沿用舊 id，學習紀錄才接得上
        id: deck === 'vocab' ? `${dir}:${r.ja}:${r.kana}` : `ph:${dir}:${r.ja}`,
        kind: 'vocab',
        deck,
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

export function loadDeck(deck) {
  loading[deck] ||= DECKS[deck].load().then((m) => parse(m.default, deck))
  return loading[deck]
}

export function wordById(id) {
  return BY_ID.get(id)
}

// 由簡入難：依難度分批，同難度內各情境輪流出，不會一直出同一類
export function buildWordPool(deck, dir, cats, levels) {
  const items = ALL[deck]?.[dir]
  if (!items) return []
  const out = []
  for (const { key: level } of DECKS[deck].levels) {
    if (!levels.includes(level)) continue
    // 漢→假只考有漢字的詞
    const lists = DECKS[deck].cats.filter((c) => cats.includes(c.key)).map((c) =>
      items.filter((w) => w.group === c.key && w.level === level && (dir !== 'kanji2kana' || w.ja !== w.kana)),
    )
    for (let i = 0; lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (l[i]) out.push(l[i])
    }
  }
  return out
}

export function wordsByCat(items, deck) {
  return DECKS[deck].cats.map((c) => ({ key: c.key, label: c.label, items: items.filter((w) => w.group === c.key) })).filter(
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

// 短句比意思用：去掉註記、標點、語助詞和人稱（「多少錢？」→「多少錢」）
const coreZh = (zh) => zh.replace(/（[^）]*）/g, '').replace(/[？！，、。…；～ 喔呢吧了嗎啊囉耶我你您請的]/g, '')

// 意思太接近的不能同時當選項（例如 美しい / 綺麗 都是「漂亮」）
// 英文關鍵字欄在短句裡是同義組代號（ありがとう／ありがとうございます 同一組）
function tooClose(a, b) {
  if (a.fake || b.fake) return a.kana === b.kana
  if (a.ja === b.ja || a.kana === b.kana) return true
  const ma = meanings(a.zh)
  if (meanings(b.zh).some((x) => ma.includes(x))) return true
  if (a.deck === 'phrase') {
    // 「多少錢？」和「全部多少錢？」放在一起，兩個都像對的
    const [x, y] = [coreZh(a.zh), coreZh(b.zh)].sort((p, q) => p.length - q.length)
    if (x === y || (x.length >= 3 && y.includes(x))) return true
  }
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
  if (item.dir !== 'ja2zh') {
    s += (1 - kanaSimilarity(item.kana, w.kana)) * 4 // 讀音越像越好
    s -= Math.min(sharedKanji(item, w), 2) * 0.7 // 有共同漢字（顯示漢字時容易混）
  }
  return s
}

// ---- 漢→假：造「常見的唸錯」選項 ----
const VOICED = Object.fromEntries(
  [...'かきくけこさしすせそたちつてとはひふへほ'].map((c, i) => [c, 'がぎぐげござじずぜぞだぢづでどばびぶべぼ'[i]]),
)
const UNVOICED = Object.fromEntries(Object.entries(VOICED).map(([a, b]) => [b, a]))
const O_U_ROW = /[おこそとのほもよろごぞどぼぽょうくすつぬふむゆるぐずづぶぷゅ]/

// 後面接送り仮名（見分ける 的 分＝わ）算訓讀語境；前後是漢字才算熟語
function segContext(segs, i) {
  if (segs[i + 1] && !isKanjiSeg(segs[i + 1])) return 'kun'
  return isKanjiSeg(segs[i - 1]) || isKanjiSeg(segs[i + 1]) ? 'comp' : 'kun'
}

// 清濁互換（ほんだな↔ほんたな）、長音有無（こうこう↔こうこ）、促音有無（がっこう↔がくこう）
function soundSlips(s) {
  const out = new Set()
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (i > 0 && (VOICED[c] || UNVOICED[c])) out.add(s.slice(0, i) + (VOICED[c] || UNVOICED[c]) + s.slice(i + 1))
    if (c === 'う' && i > 0 && O_U_ROW.test(s[i - 1])) out.add(s.slice(0, i) + s.slice(i + 1))
    if (O_U_ROW.test(c) && i < s.length - 1 && !/[うっんゃゅょぁぃぅぇぉー]/.test(s[i + 1])) out.add(s.slice(0, i + 1) + 'う' + s.slice(i + 1))
    if (c === 'っ') {
      out.add(s.slice(0, i) + s.slice(i + 1))
      out.add(s.slice(0, i) + 'く' + s.slice(i + 1))
    }
  }
  return out
}

// 把某一個漢字換成它的其他讀音：一部分 → ひとぶぶん、いちぶふん
function readingSwaps(item) {
  const segs = item.furi || []
  const out = new Set()
  segs.forEach(([text, rt], i) => {
    if (!rt || text.length !== 1) return
    for (const alt of KANJI_READINGS[segContext(segs, i)].get(text) || []) {
      // 促音（しょっ）、詞首的連濁（ぽん）只在特定位置成立，拿來換會變成沒人會唸錯的怪讀音
      if (alt === rt || alt.endsWith('っ') || (i === 0 && (UNVOICED[alt[0]] || /^[ぱぴぷぺぽ]/.test(alt)))) continue
      out.add(segs.map(([t, r], j) => (j === i ? alt : r ?? t)).join(''))
    }
  })
  return out
}

function misreadings(item) {
  const valid = READINGS_OF_JA.get(item.ja) || new Set([item.kana])
  const keep = (s) => s !== item.kana && !valid.has(s) && s.length > 1
  const swaps = shuffle([...readingSwaps(item)].filter(keep))
  const slips = shuffle([...soundSlips(item.kana)].filter(keep))
  // 換讀音最能考出「會不會唸」，優先；不夠再用清濁／長音／促音
  return [...swaps.slice(0, 2), ...slips].slice(0, 2).map((kana) => ({ id: `fake:${kana}`, kana, fake: true }))
}

// 四選一：其他選項用別的考題的答案
// 1. 以前選錯過的字優先放進來（最多 2 個） 2. 其餘挑詞性相同、同情境、難度接近（中→日、漢→假再看讀音相似）
// 漢→假另外放 2 個「常見的唸錯」，只拿別的字的讀音太容易分辨
export function makeChoices(item, confusedKeys = []) {
  const picked = []
  const ok = (w) => w !== item && !tooClose(item, w) && !picked.some((p) => tooClose(p, w))
  if (item.dir === 'kanji2kana') {
    const valid = READINGS_OF_JA.get(item.ja)
    for (const f of misreadings(item)) if (!picked.some((p) => p.kana === f.kana)) picked.push(f)
    const okReal = (w) => ok(w) && !valid.has(w.kana) && w.ja !== w.kana && w.kana.length > 1
    for (const key of confusedKeys) {
      if (picked.length === 3) break
      const w = ALL[item.deck][item.dir].find((x) => baseKey(x) === key)
      if (w && okReal(w)) picked.push(w)
    }
    const scored = []
    for (const w of ALL[item.deck][item.dir]) if (w !== item) scored.push([distractorScore(item, w), w])
    scored.sort((a, b) => a[0] - b[0])
    for (const [, w] of scored) {
      if (picked.length === 3) break
      if (okReal(w)) picked.push(w)
    }
    return shuffle([item, ...picked])
  }
  for (const key of confusedKeys) {
    const w = ALL[item.deck][item.dir].find((x) => baseKey(x) === key)
    if (w && ok(w)) picked.push(w)
    if (picked.length === 2) break
  }
  const scored = []
  for (const w of ALL[item.deck][item.dir]) if (w !== item) scored.push([distractorScore(item, w), w])
  scored.sort((a, b) => a[0] - b[0])
  for (const [, w] of scored) {
    if (picked.length === 3) break
    if (ok(w)) picked.push(w)
  }
  return shuffle([item, ...picked])
}
