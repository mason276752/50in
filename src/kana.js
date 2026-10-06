// 每筆資料：[平假名, 可接受的羅馬拼音（以 | 分隔）, 額外可接受的語音讀法（選填）]
const SEION = [
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi|si'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi|ti'], ['つ', 'tsu|tu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu|hu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra|la'], ['り', 'ri|li'], ['る', 'ru|lu'], ['れ', 're|le'], ['ろ', 'ro|lo'],
  ['わ', 'wa'], ['を', 'wo|o', 'お'], ['ん', 'n|nn'],
]

const DAKUON = [
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji|zi'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji|di|zi', 'じ'], ['づ', 'zu|du', 'ず'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
]

const HANDAKUON = [
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
]

const YOUON = [
  ['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo'],
  ['しゃ', 'sha|sya'], ['しゅ', 'shu|syu'], ['しょ', 'sho|syo'],
  ['ちゃ', 'cha|tya|cya'], ['ちゅ', 'chu|tyu|cyu'], ['ちょ', 'cho|tyo|cyo'],
  ['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo'],
  ['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo'],
  ['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo'],
  ['りゃ', 'rya|lya'], ['りゅ', 'ryu|lyu'], ['りょ', 'ryo|lyo'],
]

const YOUON_DAKU = [
  ['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo'],
  ['じゃ', 'ja|zya|jya'], ['じゅ', 'ju|zyu|jyu'], ['じょ', 'jo|zyo|jyo'],
  ['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo'],
  ['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo'],
]

export const GROUPS = [
  { key: 'seion', label: '清音', rows: SEION },
  { key: 'dakuon', label: '濁音', rows: DAKUON },
  { key: 'handakuon', label: '半濁音', rows: HANDAKUON },
  { key: 'youon', label: '拗音', rows: YOUON },
  { key: 'youon_daku', label: '濁・半濁拗音', rows: YOUON_DAKU },
]

export const SCRIPTS = [
  { key: 'hira', label: '平假名' },
  { key: 'kata', label: '片假名' },
]

// 平假名 U+3041–U+3096 與片假名相差 0x60
export function toKatakana(s) {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

export function toHiragana(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

const ROW_BY_HIRA = new Map(GROUPS.flatMap((g) => g.rows.map((row) => [row[0], { group: g.key, row }])))

// 拗音的其他寫法，由「前字拼音 + 小字」推出來：
// ちゃ ← chi + ゃ → chya / chiya / chixya / chilya / cha；りょ ← li + ょ → lyo / liyo …
const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' }
function youonVariants(hira, listed) {
  const out = new Set(listed)
  const v = SMALL_Y[hira[1]]
  if (!v) return [...out]
  for (const b of ROW_BY_HIRA.get(hira[0]).row[1].split('|')) {
    const c = b.slice(0, -1) // 去掉結尾的 i
    out.add(`${c}y${v}`)
    out.add(`${b}y${v}`)
    out.add(`${b}xy${v}`) // 輸入法打小字的寫法
    out.add(`${b}ly${v}`)
    if (/^(sh|ch|j)$/.test(c)) out.add(c + v)
  }
  return [...out]
}

function makeItem(hira, script) {
  const { group, row } = ROW_BY_HIRA.get(hira)
  const [, romaji, extraSpeech] = row
  const listed = romaji.split('|')
  return {
    id: `${script}:${hira}`,
    script,
    group,
    hira,
    display: script === 'kata' ? toKatakana(hira) : hira,
    romaji: listed, // 顯示用
    accept: hira.length === 2 ? youonVariants(hira, listed) : listed, // 作答可接受的所有寫法
    speech: extraSpeech ? [hira, extraSpeech] : [hira],
  }
}

// 直接寫假名本身（平/片自動判斷）
function itemFromChar(kana) {
  const script = /[\u30a1-\u30f6]/.test(kana) ? 'kata' : 'hira'
  return makeItem(toHiragana(kana), script)
}

export function buildPool(scripts, groups) {
  const pool = []
  for (const script of scripts) {
    for (const group of GROUPS) {
      if (!groups.includes(group.key)) continue
      for (const [hira] of group.rows) pool.push(makeItem(hira, script))
    }
  }
  return pool
}

// 長得像、容易搞混的字（不分平假名/片假名，可以混在同一組）
const SIMILAR_RAW = [
  'シ ツ ソ ン',
  'ク タ ケ',
  'ウ ワ ク',
  'フ ヲ ラ',
  'う ら ラ',
  'コ ユ ヨ ロ',
  'ヌ ス メ',
  'マ ア ム',
  'チ テ ナ',
  'ル レ',
  'セ ヤ',
  'ホ オ',
  'し レ',
  'い り リ',
  'く へ ヘ',
  'あ お',
  'ぬ め',
  'ね れ わ',
  'け は ほ ま',
  'き さ ち ら',
  'た な',
  'る ろ',
  'ほ ぼ ぽ',
  'フ ブ プ',
  'ベ ペ',
  'しゅ しょ',
  'ちゅ ちょ',
  'きゅ きょ',
  'シュ ショ',
  'ジュ ジョ',
]

export const SIMILAR_SETS = SIMILAR_RAW.map((line) => {
  const items = line.split(' ').map(itemFromChar)
  return { key: line, label: line, items }
})

export function buildSimilarPool(offKeys) {
  const seen = new Map()
  for (const set of SIMILAR_SETS) {
    if (offKeys.includes(set.key)) continue
    for (const item of set.items) if (!seen.has(item.id)) seen.set(item.id, item)
  }
  return [...seen.values()]
}

// 跟某個字長得像的其他字
export function similarTo(id) {
  const out = new Map()
  for (const set of SIMILAR_SETS) {
    if (!set.items.some((x) => x.id === id)) continue
    for (const x of set.items) if (x.id !== id) out.set(x.id, x)
  }
  return [...out.values()]
}

// 打字比對：回傳 'ok' | 'partial'（還在打）| 'wrong'
export function matchTyped(raw, item) {
  const compact = raw.replace(/\s/g, '')
  if (!compact) return 'partial'

  // 開著日文輸入法直接打出假名也接受
  const kana = toHiragana(compact)
  if (/[ぁ-ゖ]/.test(kana)) {
    if (item.speech.includes(kana)) return 'ok'
    if (item.speech.some((r) => r.startsWith(kana))) return 'partial'
    return 'wrong'
  }

  const v = compact.toLowerCase().replace(/[^a-z]/g, '')
  if (!v) return 'partial'
  if (item.accept.includes(v)) return 'ok'
  if (item.accept.some((r) => r.startsWith(v))) return 'partial'
  return 'wrong'
}

// 單一音節唸出來時，辨識引擎常會回傳同音漢字、數字或英文字母
const HOMOPHONES = {
  '亜': 'あ', '阿': 'あ', '胃': 'い', '井': 'い', '意': 'い', '位': 'い', '医': 'い', '鵜': 'う', '卯': 'う',
  '絵': 'え', '江': 'え', '餌': 'え', '尾': 'お', '御': 'お',
  '蚊': 'か', '可': 'か', '課': 'か', '科': 'か', '木': 'き', '気': 'き', '期': 'き', '機': 'き', '樹': 'き',
  '区': 'く', '句': 'く', '苦': 'く', '九': 'く', '毛': 'け', '家': 'け', '子': 'こ', '個': 'こ', '粉': 'こ', '故': 'こ',
  '差': 'さ', '左': 'さ', '四': 'し', '死': 'し', '詩': 'し', '市': 'し', '氏': 'し', '師': 'し', '史': 'し', '士': 'し',
  '巣': 'す', '酢': 'す', '背': 'せ', '瀬': 'せ', '畝': 'せ', '祖': 'そ', '其': 'そ',
  '田': 'た', '他': 'た', '多': 'た', '血': 'ち', '地': 'ち', '知': 'ち', '千': 'ち', '津': 'つ', '手': 'て',
  '戸': 'と', '都': 'と', '十': 'と',
  '名': 'な', '菜': 'な', '二': 'に', '荷': 'に', '尼': 'に', '根': 'ね', '値': 'ね', '野': 'の', '乃': 'の',
  '歯': 'は', '葉': 'は', '羽': 'は', '派': 'は', '日': 'ひ', '火': 'ひ', '比': 'ひ', '非': 'ひ', '費': 'ひ',
  '府': 'ふ', '譜': 'ふ', '負': 'ふ', '屁': 'へ', '帆': 'ほ', '歩': 'ほ',
  '間': 'ま', '魔': 'ま', '実': 'み', '身': 'み', '見': 'み', '三': 'み', '六': 'む', '無': 'む', '夢': 'む',
  '目': 'め', '芽': 'め', '藻': 'も', '喪': 'も',
  '矢': 'や', '屋': 'や', '湯': 'ゆ', '世': 'よ', '夜': 'よ', '余': 'よ', '予': 'よ',
  '羅': 'ら', '利': 'り', '理': 'り', '里': 'り', '流': 'る', '例': 'れ', '炉': 'ろ', '路': 'ろ', '輪': 'わ', '和': 'わ', '環': 'わ',
  '蛾': 'が', '我': 'が', '画': 'が', '具': 'ぐ', '碁': 'ご', '五': 'ご', '語': 'ご', '後': 'ご',
  '座': 'ざ', '字': 'じ', '時': 'じ', '次': 'じ', '路': 'じ', '図': 'ず', '頭': 'ず', '是': 'ぜ',
  '駄': 'だ', '出': 'で', '度': 'ど', '土': 'ど',
  '場': 'ば', '美': 'び', '部': 'ぶ', '母': 'ぼ',
  '社': 'しゃ', '者': 'しゃ', '車': 'しゃ', '書': 'しょ', '所': 'しょ', '諸': 'しょ', '主': 'しゅ', '種': 'しゅ', '酒': 'しゅ',
  '茶': 'ちゃ', '著': 'ちょ', '蛇': 'じゃ', '邪': 'じゃ', '寿': 'じゅ', '女': 'じょ', '序': 'じょ',
  '脈': 'みゃく', '略': 'りゃく', '客': 'きゃく', '百': 'ひゃく', '表': 'ひょう', '牛': 'ぎゅう', '旧': 'きゅう',
  '1': 'いち', '2': 'に', '3': 'さん', '4': 'し', '5': 'ご', '6': 'ろく', '7': 'なな', '8': 'はち', '9': 'く', '10': 'じゅう',
}

// 英文辨識結果（ja-JP 有時會回傳英文字母或單字）
const LATIN = {
  a: 'あ', ah: 'あ', i: 'い', e: 'え', eh: 'え', o: 'お', oh: 'お', oo: 'う', u: 'う',
  key: 'き', ku: 'く', coo: 'く', ko: 'こ', co: 'こ', she: 'し', sue: 'す', so: 'そ', sew: 'そ',
  tea: 'ち', chi: 'ち', tsu: 'つ', to: 'と', toe: 'と', no: 'の', know: 'の', knee: 'に', nee: 'に', neigh: 'ね',
  ha: 'は', he: 'ひ', who: 'ふ', hey: 'へ', ho: 'ほ', ma: 'ま', me: 'み', moo: 'む', mo: 'も',
  ya: 'や', you: 'ゆ', yo: 'よ', ra: 'ら', re: 'れ', row: 'ろ', wa: 'わ', go: 'ご', gay: 'げ', day: 'で',
  bay: 'べ', bee: 'び', boo: 'ぶ', pa: 'ぱ', pay: 'ぺ', pee: 'ぴ', poo: 'ぷ', jew: 'じゅ', joe: 'じょ',
  sha: 'しゃ', show: 'しょ', shoe: 'しゅ', chew: 'ちゅ', cha: 'ちゃ', cho: 'ちょ', q: 'きゅ', cue: 'きゅ',
}

const PUNCT = /[\s。、，,.!?！？「」『』ー〜~・…]/g
const SMALL = 'ゃゅょぁぃぅぇぉ'

// 目標出現在字串任一位置都算（方便連唸「かかか」），但後面接小字的不算（き ≠ きゃ）
function containsKana(text, target) {
  for (let i = text.indexOf(target); i >= 0; i = text.indexOf(target, i + 1)) {
    const next = text[i + target.length]
    if (!next || !SMALL.includes(next)) return true
  }
  return false
}

function homophonesToKana(t) {
  if (HOMOPHONES[t]) return HOMOPHONES[t]
  return Array.from(t, (c) => HOMOPHONES[c] ?? c).join('')
}

// 結果全是漢字、沒有假名、也不在同音字表裡 → 多半是中文辨識（瀏覽器沒用日文模型）
export function looksChinese(text) {
  const t = text.replace(PUNCT, '')
  return /\p{Script=Han}/u.test(t) && !/[\u3040-\u30ff]/.test(t) && Array.from(t).some((c) => /\p{Script=Han}/u.test(c) && !HOMOPHONES[c])
}

// 語音比對：辨識結果可能含漢字/片假名/羅馬字
export function matchSpeech(text, item) {
  const raw = text.trim()
  if (!raw) return false

  const words = raw.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.some((w) => item.accept.includes(w) || item.speech.includes(LATIN[w]))) return true

  const t = toHiragana(raw).replace(PUNCT, '')
  if (!t) return false
  return [t, homophonesToKana(t)].some((c) => item.speech.some((r) => containsKana(c, r)))
}
