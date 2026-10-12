// 題庫改過寫法的詞句（平假名改成平常用的漢字寫法：すてきですね→素敵ですね），舊寫法 → 新寫法
// 單字、短句的 id 含原文，改了寫法 id 就變了：讀取學習紀錄時照這張表把舊 id 搬到新 id
export const RENAMED = {
  phrase: {
    またあした: 'また明日',
    わかりました: '分かりました',
    わかりません: '分かりません',
    ちがいます: '違います',
    たしかに: '確かに',
    わかりましたか: '分かりましたか',
    さびしいです: '寂しいです',
    うらやましい: '羨ましい',
    お腹すいた: 'お腹空いた',
    あとで見てもらえますか: '後で見てもらえますか',
    おっしゃることはわかりますが: 'おっしゃることは分かりますが',
    すてきですね: '素敵ですね',
    'がんばって！': '頑張って！',
    よくがんばったね: 'よく頑張ったね',
    のどが痛いです: '喉が痛いです',
    お金をおろしたいです: 'お金を下ろしたいです',
    あとで送るね: '後で送るね',
    ルールがよくわかりません: 'ルールがよく分かりません',
    すそ上げできますか: '裾上げできますか',
    'はい、わかります': 'はい、分かります',
    この文法の使い方がわかりません: 'この文法の使い方が分かりません',
    '今、電車の中なので、あとでかけます': '今、電車の中なので、後でかけます',
    'あとでいい？': '後でいい？',
    'おもしろい！': '面白い！',
    'こわい！': '怖い！',
    'いやだ！': '嫌だ！',
    'おなかいっぱい、幸せ': 'お腹いっぱい、幸せ',
    おっしゃる意味がよくわかりません: 'おっしゃる意味がよく分かりません',
    一緒にがんばろう: '一緒に頑張ろう',
    お隣さんにあいさつしました: 'お隣さんに挨拶しました',
    この問題がわかりません: 'この問題が分かりません',
    '今、運転中だから、あとでね': '今、運転中だから、後でね',
    笑顔がすてきですね: '笑顔が素敵ですね',
    'わかった、すぐ行く': '分かった、すぐ行く',
    言われなくてもわかっています: '言われなくても分かっています',
    'この味、くせになります': 'この味、癖になります',
    'がんばります！': '頑張ります！',
    'ご丁寧なごあいさつ、恐れ入ります': 'ご丁寧なご挨拶、恐れ入ります',
    理屈ではわかっています: '理屈では分かっています',
  },
  vocab: {
    りっぱ: '立派',
    あいさつする: '挨拶する',
    ごらんになる: 'ご覧になる',
    おつり: 'お釣り',
    かっこう: '格好',
    かまう: '構う',
    すくなくとも: '少なくとも',
    すっぱい: '酸っぱい',
    すてき: '素敵',
    いつのまにか: 'いつの間にか',
    だいいち: '第一',
    おおざっぱ: '大雑把',
    おかまいなく: 'お構いなく',
    さわやか: '爽やか',
    しつれいしました: '失礼しました',
    あいまい: '曖昧',
    みじめ: '惨め',
    やむをえない: 'やむを得ない',
    ごらんなさい: 'ご覧なさい',
    さきに: '先に',
    とぎれる: '途切れる',
    なにより: '何より',
    おおまかな: '大まかな',
    かりに: '仮に',
    きまりわるい: '決まり悪い',
    すみやか: '速やか',
    すれちがい: 'すれ違い',
    まと: '的',
    やりとおす: 'やり通す',
    やりとげる: 'やり遂げる',
  },
}

const VOCAB_DIRS = 'ja2zh|zh2ja|kanji2kana'
// 學習紀錄的 key（可能帶手寫的 'w|' 前綴）：短句 ph:方向:原文、單字 方向:原文:讀音
function renameStatKey(key) {
  let m = key.match(/^(w\|)?ph:([^:]+):(.*)$/)
  if (m && RENAMED.phrase[m[3]]) return `${m[1] || ''}ph:${m[2]}:${RENAMED.phrase[m[3]]}`
  m = key.match(new RegExp(`^(w\\|)?(${VOCAB_DIRS}):(.*):([^:]*)$`))
  if (m && RENAMED.vocab[m[3]]) return `${m[1] || ''}${m[2]}:${RENAMED.vocab[m[3]]}:${m[4]}`
  return key
}
// 容易搞混的紀錄用不分方向的 key：原文:讀音
function renameBaseKey(key) {
  const i = key.lastIndexOf(':')
  const ja = key.slice(0, i)
  const to = RENAMED.phrase[ja] ?? RENAMED.vocab[ja]
  return to ? to + key.slice(i) : key
}
function moveKeys(obj, rename) {
  let moved = false
  for (const k of Object.keys(obj)) {
    const to = rename(k)
    if (to === k) continue
    if (!(to in obj)) obj[to] = obj[k]
    delete obj[k]
    moved = true
  }
  return moved
}

// 學習紀錄 { id: 紀錄 }：舊 id 搬到新 id（新 id 已經有紀錄就保留新的）；有搬動回傳 true
export function migrateStats(stats) {
  return moveKeys(stats, renameStatKey)
}
// 搞混紀錄 { key: { key: 次數 } }：外層、內層的 key 都要搬
export function migrateConfusions(confusions) {
  let moved = moveKeys(confusions, renameBaseKey)
  for (const v of Object.values(confusions)) if (v && typeof v === 'object' && moveKeys(v, renameBaseKey)) moved = true
  return moved
}
