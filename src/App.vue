<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { GROUPS, SCRIPTS, SIMILAR_SETS, buildPool, buildSimilarPool, similarTo, matchTyped, matchSpeech, looksChinese } from './kana'
import { useSpeechRecognition, speak } from './useSpeech'
import { recognize, matchWritten } from './handwriting'
import HandwritePad from './HandwritePad.vue'
import JpWord from './JpWord.vue'
import { playSfx, preloadSfx } from './sfx'
import { WORD_CATS, LEVELS, DIRECTIONS, buildWordPool, loadWords, wordById, wordsByCat, makeChoices, plainZh, baseKey } from './words'

const LS_SETTINGS = 'kana-quiz:settings'
const LS_STATS = 'kana-quiz:stats'
const LS_CONFUSE = 'kana-quiz:confusions'

function load(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }
  } catch {
    return fallback
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

// ---- 設定 ----
const settings = reactive(
  load(LS_SETTINGS, {
    scripts: ['hira', 'kata'],
    groups: ['seion', 'dakuon', 'handakuon', 'youon', 'youon_daku'],
    autoSpeak: false,
    sfx: true, // 答對 / 答錯音效
    mode: 'normal', // 'normal' 依分類 | 'similar' 易混淆
    similarOff: [], // 易混淆模式下關掉的組（記關掉的，預設全開）
    answer: 'type', // 'type' 看假名打拼音 | 'write' 看拼音手寫假名
    subject: 'kana', // 'kana' 假名 | 'vocab' 單字
    vocabDir: 'ja2zh', // 'ja2zh' 日翻中 | 'zh2ja' 中翻日
    vocabCats: WORD_CATS.map((c) => c.key),
    vocabLevels: LEVELS.map((l) => l.key),
    vocabShow: 'kana', // 日文怎麼顯示：'kana' 假名 | 'kanji' 漢字 | 'both' 漢字上標假名
  }),
)
// 舊版題庫的分類 key 已經不存在
settings.vocabCats = settings.vocabCats.filter((k) => WORD_CATS.some((c) => c.key === k))
if (!settings.vocabCats.length) settings.vocabCats = WORD_CATS.map((c) => c.key)
watch(settings, (v) => save(LS_SETTINGS, v), { deep: true })

function toggleIn(list, key) {
  const i = list.indexOf(key)
  if (i >= 0) {
    if (list.length > 1) list.splice(i, 1)
  } else list.push(key)
}

function toggleSimilar(key) {
  const off = settings.similarOff
  const i = off.indexOf(key)
  if (i >= 0) off.splice(i, 1)
  else if (off.length < SIMILAR_SETS.length - 1) off.push(key)
}

const vocab = computed(() => settings.subject === 'vocab')
// 單字資料很大，第一次切到單字模式才載入
const vocabReady = ref(false)
watch(
  vocab,
  (on) => on && loadWords().then(() => (vocabReady.value = true)),
  { immediate: true },
)
const pool = computed(() => {
  if (vocab.value) return vocabReady.value ? buildWordPool(settings.vocabDir, settings.vocabCats, settings.vocabLevels) : []
  return settings.mode === 'similar' ? buildSimilarPool(settings.similarOff) : buildPool(settings.scripts, settings.groups)
})

const writeMode = computed(() => !vocab.value && settings.answer === 'write')

const ALL_KANA = new Map(buildPool(SCRIPTS.map((s) => s.key), GROUPS.map((g) => g.key)).map((x) => [x.id, x]))
const itemById = (id) => ALL_KANA.get(id) ?? wordById(id)
// 字卡下方的小字：假名顯示拼音，單字顯示中文
const caption = (x) => x.caption ?? x.romaji[0]

// ---- 每個假名的累積紀錄（用來加權出題 / 弱點列表）----
const kanaStats = reactive(load(LS_STATS, {}))
// 舊版單字題庫（id 只有 'ja2zh:水'）的紀錄對不上新題庫，清掉
for (const k of Object.keys(kanaStats)) if (/^(ja2zh|zh2ja):[^:]*$/.test(k)) delete kanaStats[k]
watch(kanaStats, (v) => save(LS_STATS, v), { deep: true })
// 認字和寫字是不同能力：手寫的紀錄另外存在 'w|' 開頭的 key
const WRITE_PREFIX = 'w|'
function sk(id) {
  return writeMode.value ? WRITE_PREFIX + id : id
}
function statOf(id) {
  return (kanaStats[sk(id)] ||= { hit: 0, miss: 0, pending: 0 })
}
// 目前題型的紀錄：[[題目 id, 紀錄], …]（單字的 id 本身就帶方向，例如 'ja2zh:水'）
function modeStats() {
  const out = []
  vocabReady.value // 單字載入後要重算
  for (const [k, st] of Object.entries(kanaStats)) {
    const write = k.startsWith(WRITE_PREFIX)
    const id = write ? k.slice(WRITE_PREFIX.length) : k
    const item = itemById(id)
    if (!item || write !== writeMode.value) continue
    if (vocab.value ? item.dir !== settings.vocabDir : item.kind === 'vocab') continue
    out.push([id, st])
  }
  return out
}

// ---- 錯題複習：答錯後要連續答對 REVIEW_STREAK 次才算過關 ----
// 答錯後隔 2 題再出，之後每答對一次間隔加倍（4、8 題）；複習中又錯就從頭來
const REVIEW_STREAK = 3
const REVIEW_GAPS = [2, 4, 8]
let cardNo = 0
const reviewDue = new Map() // id → 第幾張卡該再出（只存在本次，重新整理後待複習的字視為立刻到期）

function scheduleReview(id, done) {
  reviewDue.set(sk(id), cardNo + REVIEW_GAPS[Math.min(done, REVIEW_GAPS.length - 1)])
}
const reviewList = computed(() =>
  modeStats()
    .filter(([, st]) => st.pending > 0)
    .map(([id, st]) => ({ id, done: REVIEW_STREAK - st.pending, item: itemById(id) }))
    .filter((r) => r.item),
)

// ---- 本回合統計 ----
const session = reactive({ correct: 0, wrong: 0, streak: 0, best: 0, totalMs: 0 })
const accuracy = computed(() => {
  const n = session.correct + session.wrong
  return n ? Math.round((session.correct / n) * 100) : 0
})
const avgSec = computed(() => (session.correct ? (session.totalMs / session.correct / 1000).toFixed(1) : '–'))

const history = ref([]) // 最近作答 { item, ok }

// ---- 題目 ----
const current = ref(null)
const card = reactive({ options: [], wrongIds: [], isNew: false, missed: false, hint: false, startedAt: 0, flash: '', shake: false })
const inputEl = ref(null)
let recent = []
let locked = false

// ---- 漸進出題 ----
// 題庫裡的字分三種：沒出過（新字）/ 學習中 / 已掌握。
// 學習中的字少於 LEARN_CAP 個才會加入新字（照題庫順序），其餘時間反覆練學習中的字；
// 已掌握的字偶爾（OLD_RATE）拿出來考，越久沒考、以前錯越多的越容易被抽到。
const LEARN_CAP = 4
const OLD_RATE = 0.2
// 沒錯過的字連對 2 次、錯過的字連對 3 次才算掌握
function streakOf(st) {
  return st.streak ?? (st.pending > 0 ? 0 : st.hit) // 舊版紀錄沒有 streak，用答對次數估
}
function isMastered(st) {
  return st.pending === 0 && streakOf(st) >= (st.miss ? 3 : 2)
}
const progress = computed(() => {
  const out = { fresh: [], learning: [], mastered: [] }
  for (const x of pool.value) {
    const st = kanaStats[sk(x.id)]
    out[!st ? 'fresh' : isMastered(st) ? 'mastered' : 'learning'].push(x)
  }
  return out
})

function weightedPick(list, weightOf) {
  const weights = list.map(weightOf)
  let r = Math.random() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < list.length; i++) {
    r -= weights[i]
    if (r <= 0) return list[i]
  }
  return list[list.length - 1]
}
const learnWeight = (x) => {
  const st = kanaStats[sk(x.id)]
  return (1 + st.miss) / (1 + streakOf(st)) // 錯越多、連對越少的越常出
}
const oldWeight = (x) => {
  const st = kanaStats[sk(x.id)]
  const days = (Date.now() - (st.seen ?? 0)) / 864e5
  return Math.min(days, 30) + 0.2 + st.miss / (st.hit + st.miss || 1)
}

function pickNext() {
  const p = pool.value
  if (!p.length) {
    current.value = null
    return
  }
  cardNo++

  // 到期的錯題優先（不受「最近出過」限制，只避開剛剛那題）
  const due = p
    .filter((x) => kanaStats[sk(x.id)]?.pending > 0 && x.id !== current.value?.id && (reviewDue.get(sk(x.id)) ?? 0) <= cardNo)
    .sort((a, b) => (reviewDue.get(sk(a.id)) ?? 0) - (reviewDue.get(sk(b.id)) ?? 0))
  if (due.length) return showCard(due[0])

  const { fresh, learning, mastered } = progress.value
  const notRecent = (list) => list.filter((x) => !recent.slice(-2).includes(x.id))
  const oldOnes = notRecent(mastered)

  // 時不時考一下已經會的字
  if (oldOnes.length && (Math.random() < OLD_RATE || (!learning.length && !fresh.length))) {
    return showCard(weightedPick(oldOnes, oldWeight))
  }

  // 學習中的字夠少（都快會了）才拿新字
  if (fresh.length && learning.length < LEARN_CAP) return showCard(fresh[0])

  // 易混淆模式：一半機率接著出跟上一題長得像、而且已經學過的字，逼自己分辨
  if (!vocab.value && settings.mode === 'similar' && current.value && Math.random() < 0.5) {
    const ids = new Set([...learning, ...mastered].map((x) => x.id))
    const lookalikes = notRecent(similarTo(current.value.id).filter((x) => ids.has(x.id)))
    if (lookalikes.length) return showCard(weightedPick(lookalikes, learnWeight))
  }

  const practice = notRecent(learning)
  if (practice.length) return showCard(weightedPick(practice, learnWeight))

  // 學習中的字剛出過：拿新字或舊字頂上，都沒有才重複
  if (fresh.length) return showCard(fresh[0])
  if (oldOnes.length) return showCard(weightedPick(oldOnes, oldWeight))
  const any = p.filter((x) => x.id !== current.value?.id)
  showCard(any.length ? any[Math.floor(Math.random() * any.length)] : p[0])
}

function showCard(next) {
  const p = pool.value
  recent.push(next.id)
  while (recent.length > Math.min(4, p.length - 1)) recent.shift()

  current.value = next
  Object.assign(card, {
    options: vocab.value ? makeChoices(next, confusedWith(next)) : [],
    wrongIds: [],
    isNew: !kanaStats[sk(next.id)], missed: false, hint: false, startedAt: performance.now(), flash: '', shake: false })
  clearInput()
  resetPad()
  locked = false
  if (settings.autoSpeak && !answerIsSpoken()) playSound()
}

// 中翻日的題目，發音就是答案：自動播放改成答完才播
function answerIsSpoken() {
  return current.value?.dir === 'zh2ja'
}

// 播音效；麥克風開著時先暫停比對，免得收到音效聲
function feedback(kind) {
  if (!settings.sfx) return
  ignoreSpeechUntil = Math.max(ignoreSpeechUntil, performance.now() + 800)
  playSfx(kind)
}

// silent：按「看答案」不算真的答錯，不播錯誤音效
function markWrong({ silent = false } = {}) {
  if (!silent) feedback('bad')
  if (!card.missed) {
    card.missed = true
    session.wrong++
    session.streak = 0
    statOf(current.value.id).miss++
  }
  Object.assign(statOf(current.value.id), { pending: REVIEW_STREAK, streak: 0, seen: Date.now() })
  scheduleReview(current.value.id, 0)
  card.hint = true
  navigator.vibrate?.(60)
  card.shake = false
  requestAnimationFrame(() => (card.shake = true))
}

function markCorrect() {
  if (locked) return
  locked = true
  const item = current.value
  if (!card.missed) {
    session.correct++
    session.streak++
    session.best = Math.max(session.best, session.streak)
    session.totalMs += performance.now() - card.startedAt
    const st = statOf(item.id)
    st.hit++
    st.streak = streakOf(st) + 1
    st.seen = Date.now()
    if (st.pending > 0) {
      st.pending--
      if (st.pending > 0) scheduleReview(item.id, REVIEW_STREAK - st.pending)
      else reviewDue.delete(sk(item.id))
    }
  }
  history.value.unshift({ item, ok: !card.missed, key: performance.now() })
  history.value.length = Math.min(history.value.length, 24)
  card.flash = 'ok'
  feedback('ok')
  // 中→日答完才唸，等音效播完再唸，不要疊在一起
  if (settings.autoSpeak && answerIsSpoken()) setTimeout(playSound, settings.sfx ? 450 : 0)
  setTimeout(pickNext, vocab.value ? 650 : 220) // 選擇題多留一下，看清楚各選項的意思
}

function skip() {
  if (!current.value || locked) return
  if (!card.hint) {
    markWrong({ silent: true }) // 第一次按：顯示答案
    return
  }
  locked = true
  history.value.unshift({ item: current.value, ok: false, key: performance.now() })
  history.value.length = Math.min(history.value.length, 24)
  pickNext()
}

// ---- 單字四選一 ----
// 選錯後要再點一次正確答案才換題（跟打字一樣）
function choose(opt) {
  if (!current.value || locked) return
  if (opt.id === current.value.id) return markCorrect()
  if (!card.wrongIds.includes(opt.id)) card.wrongIds.push(opt.id)
  recordConfusion(current.value, opt)
  markWrong()
}

// 選錯的組合記下來（兩個方向都算），之後考其中一個時優先把另一個放進選項
const confusions = load(LS_CONFUSE, {}) // baseKey → { baseKey: 選錯次數 }
function recordConfusion(a, b) {
  for (const [x, y] of [
    [baseKey(a), baseKey(b)],
    [baseKey(b), baseKey(a)],
  ]) {
    const m = (confusions[x] ||= {})
    m[y] = (m[y] || 0) + 1
  }
  save(LS_CONFUSE, confusions)
}
function confusedWith(item) {
  const m = confusions[baseKey(item)]
  return m ? Object.keys(m).sort((x, y) => m[y] - m[x]) : []
}
const SHOW_MODES = [
  { key: 'kana', label: '假名' },
  { key: 'kanji', label: '漢字' },
  { key: 'both', label: '漢字+假名' },
]
// 主要顯示沒給到的那一半（漢字或讀音），答完才補上；同音詞只給假名分不出來，一開始就補漢字
function jpSub(w, revealed) {
  if (w.kana === w.ja) return ''
  if (settings.vocabShow === 'kana') return revealed || w.homophone ? w.ja : ''
  if (settings.vocabShow === 'kanji') return revealed ? w.kana : ''
  return ''
}
const jpMain = (w) => (settings.vocabShow === 'kana' ? w.kana : w.ja)

// 字越多字越小，長單字也塞得進卡片
function wordSize(text) {
  return { fontSize: `${Math.min(30, 84 / Math.max(Array.from(text).length, 1))}cqw` }
}
function optionClass(opt) {
  const isAnswer = opt.id === current.value?.id
  return {
    good: isAnswer && (locked || card.hint),
    bad: card.wrongIds.includes(opt.id),
    dim: (locked || card.hint) && !isAnswer && !card.wrongIds.includes(opt.id),
  }
}

// ---- 打字 ----
// 不用 v-model：v-model 在輸入法組字期間不會更新，
// 而 Android Gboard 連打英文都算「組字中」，會變成要按空白鍵才判定
function clearInput() {
  if (inputEl.value) inputEl.value.value = ''
}
function onInput(e) {
  if (!current.value || locked) return
  const value = e.target.value
  // 日文輸入法組字到一半（例如「かn」）先不判定；純英數的組字照常判定
  if (e.isComposing && /[^\x00-\x7f]/.test(value)) return
  const result = matchTyped(value, current.value)
  if (result === 'ok') markCorrect()
  else if (result === 'wrong') {
    markWrong()
    clearInput()
  }
}

// ---- 手寫 ----
const padEl = ref(null)
const written = ref([]) // 最近一次辨識的候選字
const writeErr = ref('')
let recogTimer = 0
let recogAbort = null

function cancelRecognize() {
  clearTimeout(recogTimer)
  recogAbort?.abort()
  recogAbort = null
}
function resetPad() {
  cancelRecognize()
  padEl.value?.clear()
  written.value = []
  writeErr.value = ''
}
// 每寫完一筆就在背景辨識：寫對了直接過關；寫錯只有按「判定」才算錯（可能還沒寫完）
function onStroke() {
  cancelRecognize()
  recogTimer = setTimeout(() => checkWriting(false), 350)
}
function undoStroke() {
  cancelRecognize()
  padEl.value?.undo()
  if (padEl.value?.isEmpty()) written.value = []
}
async function checkWriting(submit) {
  const pad = padEl.value
  if (!current.value || locked || !pad) return
  if (pad.isEmpty()) {
    if (submit) skip()
    return
  }
  cancelRecognize()
  const ctrl = (recogAbort = new AbortController())
  const item = current.value
  const { strokes, w, h } = pad.getInk()
  try {
    const candidates = await recognize(strokes, w, h, ctrl.signal)
    if (ctrl.signal.aborted || current.value !== item || locked) return
    writeErr.value = ''
    written.value = candidates.slice(0, 5)
    if (matchWritten(candidates, item)) markCorrect()
    else if (submit) {
      markWrong() // 顯示答案，手寫板淡淡印出正確字形讓你描
      pad.clear()
    }
  } catch (e) {
    if (e.name !== 'AbortError') writeErr.value = '手寫辨識需要網路連線，請稍後再試'
  }
}

// ---- 語音 ----
let ignoreSpeechUntil = 0
const speechMiss = ref('')
const speechLog = ref([]) // 最近的辨識結果，方便看引擎到底聽到什麼
const chineseWarn = ref(false)
function logSpeech(alts, ok) {
  speechLog.value.unshift({ text: alts.join(' ｜ '), ok, key: performance.now() })
  speechLog.value.length = Math.min(speechLog.value.length, 8)
}
const mic = useSpeechRecognition((alts, isFinal) => {
  // 播放發音時麥克風會收到喇叭聲：直接丟掉
  if (performance.now() < ignoreSpeechUntil) return true
  if (!current.value || locked || vocab.value || writeMode.value) return false
  if (alts.some((a) => matchSpeech(a, current.value))) {
    speechMiss.value = ''
    chineseWarn.value = false
    logSpeech(alts, true)
    markCorrect()
    return true
  }
  if (isFinal) {
    speechMiss.value = alts[0] // 唸錯不扣分（辨識本身有誤差），只顯示聽到什麼
    chineseWarn.value = alts.every(looksChinese)
    logSpeech(alts, false)
  }
  return false
})
watch(current, () => (speechMiss.value = ''))
const showLog = ref(false)

function toggleAutoSpeak() {
  settings.autoSpeak = !settings.autoSpeak
  // 打開時順便唸目前這題，不用等下一題才知道有沒有作用
  if (settings.autoSpeak && !locked && !answerIsSpoken()) playSound()
}

function playSound() {
  if (!current.value) return
  // 播放時暫停比對，避免麥克風收到喇叭聲音自動答對
  ignoreSpeechUntil = Infinity
  speak(current.value.say ?? current.value.hira, () => (ignoreSpeechUntil = performance.now() + 500))
}

// ---- 鍵盤 ----
// 手寫、單字模式沒有輸入框，鍵盤快捷鍵掛在 window 上
function onWindowKeydown(e) {
  if (e.isComposing || /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.metaKey || e.altKey) return
  if (vocab.value) {
    const n = Number(e.key)
    if (n >= 1 && n <= card.options.length) choose(card.options[n - 1])
    else if (e.key === 'Enter') {
      e.preventDefault()
      skip()
    } else if (e.key === 'Escape') playSound()
    return
  }
  if (!writeMode.value) return
  if (e.key === 'Enter') {
    e.preventDefault()
    checkWriting(true)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    playSound()
  } else if (e.key === 'Backspace' || (e.key === 'z' && e.ctrlKey)) {
    e.preventDefault()
    undoStroke()
  } else if (e.key === 'Delete') {
    resetPad()
  }
}
function onKeydown(e) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    skip()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    playSound()
  }
}

// ---- 弱點 ----
const weakList = computed(() =>
  modeStats()
    .filter(([, s]) => s.miss > 0)
    .map(([id, s]) => ({ id, ...s, rate: s.miss / (s.hit + s.miss) }))
    .sort((a, b) => b.rate - a.rate || b.miss - a.miss)
    .slice(0, 12)
    .map((w) => ({ ...w, item: itemById(w.id) }))
    .filter((w) => w.item),
)

function resetAll() {
  Object.assign(session, { correct: 0, wrong: 0, streak: 0, best: 0, totalMs: 0 })
  for (const k of Object.keys(kanaStats)) delete kanaStats[k]
  history.value = []
  reviewDue.clear()
  for (const k of Object.keys(confusions)) delete confusions[k]
  save(LS_CONFUSE, confusions)
  pickNext()
}

const currentReview = computed(() => {
  const st = current.value && kanaStats[sk(current.value.id)]
  return st?.pending > 0 ? REVIEW_STREAK - st.pending : null
})
const lookalikes = computed(() => (current.value && !vocab.value ? similarTo(current.value.id) : []))

const setsOpen = ref(false)
const showChart = ref(false)
const chartSections = computed(() => {
  if (vocab.value) {
    return [
      {
        key: 'vocab',
        // 單字太多，只列學過的
        title: '學過的單字',
        groups: wordsByCat(pool.value.filter((w) => kanaStats[w.id])).map((g) => ({ ...g, words: true })),
      },
    ]
  }
  if (settings.mode === 'similar') {
    return [
      {
        key: 'similar',
        title: '易混淆',
        groups: SIMILAR_SETS.filter((x) => !settings.similarOff.includes(x.key)).map((x) => ({
          key: x.key,
          label: '',
          items: x.items,
          wide: true,
        })),
      },
    ]
  }
  return SCRIPTS.filter((sc) => settings.scripts.includes(sc.key)).map((sc) => ({
    key: sc.key,
    title: sc.label,
    groups: GROUPS.filter((g) => settings.groups.includes(g.key)).map((g) => ({
      key: g.key,
      label: g.label,
      items: pool.value.filter((x) => x.script === sc.key && x.group === g.key),
      wide: g.key.startsWith('youon'),
    })),
  }))
})

watch(
  () => settings.subject,
  () => vocab.value && mic.stop(),
)

watch(
  () => settings.answer,
  () => {
    if (writeMode.value) mic.stop() // 手寫時不要讓語音順便答題
    recent = []
    pickNext()
    focusInput()
  },
)

watch(pool, (p) => {
  recent = []
  if (!current.value || !p.some((x) => x.id === current.value.id)) pickNext()
})

// 觸控裝置：不主動叫出鍵盤（用語音作答時很干擾），使用者點輸入框才打字
const isTouch = window.matchMedia('(pointer: coarse)').matches
function focusInput() {
  if (isTouch || writeMode.value || vocab.value || mic.listening.value) return
  nextTick(() => inputEl.value?.focus())
}

// 手機鍵盤彈出時，可視高度會變小：記下來讓字卡跟著縮，並把字卡捲到最上面
const settingsOpen = ref(false)
const cardEl = ref(null)
function syncViewport() {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--vvh', `${h}px`)
}
function onInputFocus() {
  if (!isTouch) return
  setTimeout(() => cardEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300)
}
watch(
  () => mic.listening.value,
  (on) => on && isTouch && inputEl.value?.blur(),
)

onMounted(() => {
  syncViewport()
  window.visualViewport?.addEventListener('resize', syncViewport)
  window.addEventListener('keydown', onWindowKeydown)
  pickNext()
  focusInput()
  window.speechSynthesis?.getVoices() // 預先載入語音
  preloadSfx()
})
onBeforeUnmount(() => {
  mic.stop()
  window.visualViewport?.removeEventListener('resize', syncViewport)
  window.removeEventListener('keydown', onWindowKeydown)
  cancelRecognize()
})
</script>

<template>
  <div class="app" @click.self="focusInput">
    <header class="top">
      <h1>五十音<span>測驗</span></h1>
      <div class="seg subject-seg">
        <button :class="{ on: !vocab }" @click="settings.subject = 'kana'">假名</button>
        <button :class="{ on: vocab }" @click="settings.subject = 'vocab'">單字</button>
      </div>
      <button class="settings-btn" :class="{ on: settingsOpen }" @click="settingsOpen = !settingsOpen">
        {{ settingsOpen ? '完成' : `題庫 ${pool.length} ▾` }}
      </button>
      <div class="filters" :class="{ open: settingsOpen }">
        <div v-if="vocab" class="chips">
          <button
            v-for="l in LEVELS"
            :key="l.key"
            class="chip"
            :class="{ on: settings.vocabLevels.includes(l.key) }"
            @click="toggleIn(settings.vocabLevels, l.key)"
          >
            {{ l.label }}
          </button>
        </div>
        <div v-if="vocab" class="chips">
          <button
            v-for="c in WORD_CATS"
            :key="c.key"
            class="chip"
            :class="{ on: settings.vocabCats.includes(c.key) }"
            @click="toggleIn(settings.vocabCats, c.key)"
          >
            {{ c.label }}
          </button>
        </div>
        <template v-else>
          <div class="seg">
            <button :class="{ on: settings.mode === 'normal' }" @click="settings.mode = 'normal'">依分類</button>
            <button :class="{ on: settings.mode === 'similar' }" @click="settings.mode = 'similar'">易混淆</button>
          </div>
          <template v-if="settings.mode === 'normal'">
            <div class="chips">
              <button
                v-for="sc in SCRIPTS"
                :key="sc.key"
                class="chip"
                :class="{ on: settings.scripts.includes(sc.key) }"
                @click="toggleIn(settings.scripts, sc.key)"
              >
                {{ sc.label }}
              </button>
            </div>
            <div class="chips">
              <button
                v-for="g in GROUPS"
                :key="g.key"
                class="chip"
                :class="{ on: settings.groups.includes(g.key) }"
                @click="toggleIn(settings.groups, g.key)"
              >
                {{ g.label }}
              </button>
            </div>
          </template>
          <button v-else class="chip sets-toggle" @click="setsOpen = !setsOpen">
            組合 {{ SIMILAR_SETS.length - settings.similarOff.length }}/{{ SIMILAR_SETS.length }} {{ setsOpen ? '▴' : '▾' }}
          </button>
          <div v-if="settings.mode === 'similar' && setsOpen" class="chips similar-chips">
            <button
              v-for="set in SIMILAR_SETS"
              :key="set.key"
              class="chip"
              :class="{ on: !settings.similarOff.includes(set.key) }"
              lang="ja"
              @click="toggleSimilar(set.key)"
            >
              {{ set.label }}
            </button>
          </div>
        </template>
      </div>
    </header>

    <main class="stage">
      <section class="quiz" @click="focusInput">
        <div class="quiz-top">
          <div v-if="vocab" class="seg answer-seg">
            <button v-for="d in DIRECTIONS" :key="d.key" :class="{ on: settings.vocabDir === d.key }" @click.stop="settings.vocabDir = d.key">
              {{ d.label }}
            </button>
          </div>
          <div v-if="vocab" class="seg show-seg" title="日文的顯示方式">
            <button v-for="m in SHOW_MODES" :key="m.key" :class="{ on: settings.vocabShow === m.key }" @click.stop="settings.vocabShow = m.key">
              {{ m.label }}
            </button>
          </div>
          <div v-else class="seg answer-seg">
            <button :class="{ on: !writeMode }" @click.stop="settings.answer = 'type'">看字答拼音</button>
            <button :class="{ on: writeMode }" @click.stop="settings.answer = 'write'">看拼音手寫</button>
          </div>
          <button
            class="auto-toggle"
            :class="{ on: settings.autoSpeak }"
            role="switch"
            :aria-checked="settings.autoSpeak"
            title="每題出現時自動唸一次（中→日在答完後唸）"
            @click.stop="toggleAutoSpeak"
          >
            <i />自動發音
          </button>
          <button
            class="auto-toggle sfx-toggle"
            :class="{ on: settings.sfx }"
            role="switch"
            :aria-checked="settings.sfx"
            title="答對、答錯時播放音效"
            @click.stop="settings.sfx = !settings.sfx"
          >
            <i />音效
          </button>
          <div class="pool-count">
            題庫 {{ pool.length }} · 已掌握 {{ progress.mastered.length }} · 學習中 {{ progress.learning.length }}
          </div>
        </div>
        <div class="mini-stats">
          <span class="good">✓ {{ session.correct }}</span>
          <span class="bad">✗ {{ session.wrong }}</span>
          <span>{{ accuracy }}%</span>
          <span>連續 {{ session.streak }}</span>
          <span>掌握 {{ progress.mastered.length }}/{{ pool.length }}</span>
          <span v-if="reviewList.length" class="rv">複習 {{ reviewList.length }}</span>
        </div>

        <div v-if="vocab && !vocabReady" class="speech-line">載入單字中…</div>
        <div
          v-if="current"
          ref="cardEl"
          class="card"
          :class="{ ok: card.flash === 'ok', shake: card.shake, kata: current.script === 'kata', prompt: writeMode || vocab }"
        >
          <span class="script-tag">{{ vocab ? `${LEVELS[current.level - 1].label} · ${current.dir === 'ja2zh' ? '日→中' : '中→日'}` : current.script === 'kata' ? '片' : '平' }}</span>
          <span v-if="currentReview !== null" class="review-tag" :title="`複習中：再連續答對 ${REVIEW_STREAK - currentReview} 次`">
            複習 <i v-for="n in REVIEW_STREAK" :key="n" :class="{ done: n <= currentReview }" />
          </span>
          <span v-else-if="card.isNew" class="review-tag">{{ vocab ? '新單字' : '新字' }}</span>
          <template v-if="vocab">
            <template v-if="current.dir === 'ja2zh'">
              <JpWord class="word" :class="{ ruby: settings.vocabShow === 'both' }" :word="current" :mode="settings.vocabShow" :style="wordSize(jpMain(current))" />
              <div class="word-reading" lang="ja">{{ jpSub(current, locked || card.hint) }}</div>
            </template>
            <div v-else class="word" :style="wordSize(current.zh)">{{ current.zh }}</div>
          </template>
          <template v-else-if="writeMode">
            <div class="romaji">{{ current.romaji[0] }}</div>
            <div class="script-name">寫出{{ current.script === 'kata' ? '片假名' : '平假名' }}</div>
          </template>
          <template v-else>
            <div class="kana" :lang="'ja'">{{ current.display }}</div>
            <div class="hint" :class="{ show: card.hint }">{{ current.romaji.join(' / ') }}</div>
          </template>
        </div>
        <div v-if="current && card.hint && lookalikes.length" class="lookalikes">
          <span class="label">別搞混</span>
          <span v-for="x in lookalikes" :key="x.id" class="la" lang="ja">{{ x.display }}<small>{{ x.romaji[0] }}</small></span>
        </div>

        <template v-if="vocab">
          <div class="options">
            <button v-for="(opt, i) in card.options" :key="opt.id" class="opt" :class="optionClass(opt)" @click.stop="choose(opt)">
              <span class="num">{{ i + 1 }}</span>
              <template v-if="current.dir === 'ja2zh'">
                <span class="main">{{ locked || card.hint ? opt.zh : plainZh(opt.zh) }}</span>
                <small v-if="locked || card.hint" lang="ja">{{ opt.ja }}{{ opt.kana !== opt.ja ? `（${opt.kana}）` : '' }}</small>
              </template>
              <template v-else>
                <JpWord class="main" :word="opt" :mode="settings.vocabShow" />
                <small v-if="locked || card.hint" class="zh">{{ jpSub(opt, true) ? `${jpSub(opt, true)}・` : '' }}{{ opt.zh }}</small>
              </template>
            </button>
          </div>
          <div class="actions vocab">
            <button class="btn" title="Esc" @click.stop="playSound">🔊<span class="label"> 發音</span></button>
            <button class="btn" title="Enter" @click.stop="skip">{{ card.hint ? '下一題' : '看答案' }}</button>
          </div>
          <div class="speech-line">
            <template v-if="card.hint">點正確答案（綠色）繼續</template>
            <template v-else-if="!isTouch">1–4：選答案　Enter：看答案 / 下一題　Esc：聽發音</template>
          </div>
        </template>

        <template v-else-if="writeMode">
          <HandwritePad
            ref="padEl"
            :class="{ bad: card.shake }"
            :guide="card.hint && current ? current.display : ''"
            @pen-down="cancelRecognize"
            @stroke="onStroke"
          />
          <div class="speech-line">
            <span v-if="writeErr" class="err">{{ writeErr }}</span>
            <template v-else-if="written.length">辨識：<b lang="ja">{{ written.join('　') }}</b></template>
            <template v-else-if="card.hint">照著淡色字形描一次</template>
            <template v-else>寫在框內，寫對會自動跳下一題</template>
          </div>
          <div class="actions write">
            <button class="btn primary" title="Enter" @click.stop="checkWriting(true)">判定</button>
            <button class="btn" title="Backspace" @click.stop="undoStroke">↶<span class="label"> 復原</span></button>
            <button class="btn" title="Delete" @click.stop="resetPad">清除</button>
            <button class="btn" title="Esc" @click.stop="playSound">🔊<span class="label"> 發音</span></button>
            <button class="btn" @click.stop="skip">{{ card.hint ? '下一題' : '看答案' }}</button>
          </div>
          <div v-if="!isTouch" class="speech-line">Enter：判定　Backspace：復原一筆　Delete：清除　Esc：聽發音</div>
        </template>

        <template v-else>
          <input
            ref="inputEl"
            class="answer"
            :class="{ bad: card.shake }"
            placeholder="輸入羅馬拼音…"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            enterkeyhint="next"
            @input="onInput"
            @compositionend="onInput"
            @focus="onInputFocus"
            @keydown="onKeydown"
          />

          <div class="actions">
            <button
              class="btn mic"
              :class="{ live: mic.listening.value }"
              :disabled="!mic.supported"
              :title="mic.supported ? '開/關語音作答' : '此瀏覽器不支援語音辨識，請用 Chrome / Edge / Safari'"
              @click.stop="mic.toggle()"
            >
              <span class="dot" />
              {{ mic.listening.value ? '聆聽中…' : '語音作答' }}
            </button>
            <button class="btn" title="Esc" @click.stop="playSound">🔊<span class="label"> 發音</span></button>
            <button class="btn" title="Enter" @click.stop="skip">{{ card.hint ? '下一題' : '看答案' }}</button>
          </div>

          <div class="speech-line">
            <template v-if="mic.error.value"><span class="err">{{ mic.error.value }}</span></template>
            <template v-else-if="speechMiss">聽到「<b>{{ speechMiss }}</b>」，再唸一次</template>
            <template v-else-if="mic.listening.value">唸出畫面上的假名（連唸 2–3 次如「かかか」較容易辨識）</template>
            <template v-else-if="!isTouch">Enter：看答案 / 下一題　Esc：聽發音</template>
          </div>

          <div v-if="chineseWarn" class="warn">
            辨識結果看起來是<b>中文</b>，瀏覽器可能沒有使用日文辨識。
            Safari 用的是 macOS 聽寫：請到「系統設定 → 鍵盤 → 聽寫 → 語言」加入日文；
            或改用 Chrome / Edge。
          </div>

          <div v-if="mic.supported" class="log">
            <button class="link" @click.stop="showLog = !showLog">{{ showLog ? '隱藏' : '顯示' }}辨識紀錄</button>
            <ul v-if="showLog">
              <li v-if="!speechLog.length" class="empty">還沒有辨識結果</li>
              <li v-for="l in speechLog" :key="l.key" :class="l.ok ? 'good' : 'bad'">{{ l.ok ? '✓' : '✗' }} {{ l.text }}</li>
            </ul>
          </div>
        </template>
      </section>

      <aside class="side">
        <div class="stats">
          <div><b>{{ session.correct }}</b><small>答對</small></div>
          <div><b>{{ session.wrong }}</b><small>答錯</small></div>
          <div><b>{{ accuracy }}%</b><small>正確率</small></div>
          <div><b>{{ session.streak }}</b><small>連續 (最佳 {{ session.best }})</small></div>
          <div><b>{{ avgSec }}</b><small>平均秒數</small></div>
        </div>

        <div class="block">
          <h3>進度 · 會了才加新字</h3>
          <div class="progress">
            <i class="m" :style="{ flex: progress.mastered.length }" />
            <i class="l" :style="{ flex: progress.learning.length }" />
            <i class="f" :style="{ flex: progress.fresh.length }" />
          </div>
          <div class="progress-legend">
            <span><i class="m" />已掌握 {{ progress.mastered.length }}</span>
            <span><i class="l" />學習中 {{ progress.learning.length }}</span>
            <span><i class="f" />未學 {{ progress.fresh.length }}</span>
          </div>
        </div>

        <div v-if="history.length" class="block">
          <h3>最近</h3>
          <TransitionGroup tag="div" name="pop" class="history">
            <span v-for="h in history" :key="h.key" class="h" :class="h.ok ? 'good' : 'bad'" :title="caption(h.item)">
              {{ h.item.display }}<small>{{ caption(h.item) }}</small>
            </span>
          </TransitionGroup>
        </div>

        <div v-if="reviewList.length" class="block">
          <h3>待複習 · 連續答對 {{ REVIEW_STREAK }} 次過關</h3>
          <div class="weak">
            <span v-for="r in reviewList" :key="r.id" class="w" lang="ja">
              {{ r.item.display }}<small class="dots"><i v-for="n in REVIEW_STREAK" :key="n" :class="{ done: n <= r.done }" /></small>
            </span>
          </div>
        </div>

        <div v-if="weakList.length" class="block">
          <h3>弱點</h3>
          <div class="weak">
            <span v-for="w in weakList" :key="w.id" class="w">
              {{ w.item.display }}<small>{{ caption(w.item) }} · 錯 {{ w.miss }}</small>
            </span>
          </div>
        </div>

        <div class="block row">
          <button class="link" @click="showChart = !showChart">{{ showChart ? '收起' : '顯示' }}對照表</button>
          <button class="link danger" @click="resetAll">重置紀錄</button>
        </div>
      </aside>
    </main>

    <section v-if="showChart" class="chart">
      <p v-if="vocab" class="credit">
        詞表來源：<a href="http://www.tanos.co.uk/jlpt/" target="_blank" rel="noopener">tanos.co.uk JLPT 詞彙表</a>（CC BY），中文釋義與分類另行整理
      </p>
      <p v-if="vocab && !chartSections[0].groups.length" class="credit">還沒有學過的單字</p>
      <div v-for="sec in chartSections" :key="sec.key">
        <h3>{{ sec.title }}</h3>
        <div v-for="g in sec.groups" :key="g.key" class="chart-group">
          <h4 v-if="g.label">{{ g.label }}</h4>
          <div class="grid" :class="{ wide: g.wide, similar: !g.label, words: g.words }">
            <span v-for="x in g.items" :key="x.id" lang="ja">{{ x.display }}<small>{{ caption(x) }}</small></span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
