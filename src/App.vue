<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { GROUPS, SCRIPTS, SIMILAR_SETS, buildPool, buildSimilarPool, similarTo, matchTyped, matchSpeech, looksChinese } from './kana'
import { useSpeechRecognition, speak } from './useSpeech'

const LS_SETTINGS = 'kana-quiz:settings'
const LS_STATS = 'kana-quiz:stats'

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
    mode: 'normal', // 'normal' 依分類 | 'similar' 易混淆
    similarOff: [], // 易混淆模式下關掉的組（記關掉的，預設全開）
  }),
)
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

const pool = computed(() =>
  settings.mode === 'similar' ? buildSimilarPool(settings.similarOff) : buildPool(settings.scripts, settings.groups),
)

// ---- 每個假名的累積紀錄（用來加權出題 / 弱點列表）----
const kanaStats = reactive(load(LS_STATS, {}))
watch(kanaStats, (v) => save(LS_STATS, v), { deep: true })
function statOf(id) {
  return (kanaStats[id] ||= { hit: 0, miss: 0 })
}

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
const card = reactive({ missed: false, hint: false, startedAt: 0, flash: '', shake: false })
const inputEl = ref(null)
let recent = []
let locked = false

function pickNext() {
  const p = pool.value
  if (!p.length) {
    current.value = null
    return
  }
  let candidates = p.filter((x) => !recent.includes(x.id))
  if (!candidates.length) candidates = p

  // 易混淆模式：一半機率接著出跟上一題長得像的字，逼自己分辨
  if (settings.mode === 'similar' && current.value && Math.random() < 0.5) {
    const ids = new Set(p.map((x) => x.id))
    const lookalikes = similarTo(current.value.id).filter((x) => ids.has(x.id) && !recent.slice(-2).includes(x.id))
    if (lookalikes.length) candidates = lookalikes
  }

  // 錯越多、對越少的越常出現
  const weights = candidates.map((x) => {
    const s = kanaStats[x.id] || { hit: 0, miss: 0 }
    return (1 + s.miss * 2) / (1 + s.hit * 0.25)
  })
  let r = Math.random() * weights.reduce((a, b) => a + b, 0)
  let next = candidates[candidates.length - 1]
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) {
      next = candidates[i]
      break
    }
  }

  recent.push(next.id)
  while (recent.length > Math.min(4, p.length - 1)) recent.shift()

  current.value = next
  Object.assign(card, { missed: false, hint: false, startedAt: performance.now(), flash: '', shake: false })
  clearInput()
  locked = false
  if (settings.autoSpeak) playSound()
}

function markWrong() {
  if (!card.missed) {
    card.missed = true
    session.wrong++
    session.streak = 0
    statOf(current.value.id).miss++
  }
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
    statOf(item.id).hit++
  }
  history.value.unshift({ item, ok: !card.missed, key: performance.now() })
  history.value.length = Math.min(history.value.length, 24)
  card.flash = 'ok'
  setTimeout(pickNext, 220)
}

function skip() {
  if (!current.value || locked) return
  if (!card.hint) {
    markWrong() // 第一次按：顯示答案
    return
  }
  locked = true
  history.value.unshift({ item: current.value, ok: false, key: performance.now() })
  history.value.length = Math.min(history.value.length, 24)
  pickNext()
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
  if (!current.value || locked) return false
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

function playSound() {
  if (!current.value) return
  // 播放時暫停比對，避免麥克風收到喇叭聲音自動答對
  ignoreSpeechUntil = Infinity
  speak(current.value.hira, () => (ignoreSpeechUntil = performance.now() + 500))
}

// ---- 鍵盤 ----
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
const ALL_KANA = new Map(buildPool(SCRIPTS.map((s) => s.key), GROUPS.map((g) => g.key)).map((x) => [x.id, x]))
const weakList = computed(() =>
  Object.entries(kanaStats)
    .filter(([, s]) => s.miss > 0)
    .map(([id, s]) => ({ id, ...s, rate: s.miss / (s.hit + s.miss) }))
    .sort((a, b) => b.rate - a.rate || b.miss - a.miss)
    .slice(0, 12)
    .map((w) => ({ ...w, item: ALL_KANA.get(w.id) }))
    .filter((w) => w.item),
)

function resetAll() {
  Object.assign(session, { correct: 0, wrong: 0, streak: 0, best: 0, totalMs: 0 })
  for (const k of Object.keys(kanaStats)) delete kanaStats[k]
  history.value = []
  pickNext()
}

const lookalikes = computed(() => (current.value ? similarTo(current.value.id) : []))

const setsOpen = ref(false)
const showChart = ref(false)
const chartSections = computed(() => {
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

watch(pool, (p) => {
  recent = []
  if (!current.value || !p.some((x) => x.id === current.value.id)) pickNext()
})

// 觸控裝置：不主動叫出鍵盤（用語音作答時很干擾），使用者點輸入框才打字
const isTouch = window.matchMedia('(pointer: coarse)').matches
function focusInput() {
  if (isTouch || mic.listening.value) return
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
  pickNext()
  focusInput()
  window.speechSynthesis?.getVoices() // 預先載入語音
})
onBeforeUnmount(() => {
  mic.stop()
  window.visualViewport?.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <div class="app" @click.self="focusInput">
    <header class="top">
      <h1>五十音<span>測驗</span></h1>
      <button class="settings-btn" :class="{ on: settingsOpen }" @click="settingsOpen = !settingsOpen">
        {{ settingsOpen ? '完成' : `題庫 ${pool.length} ▾` }}
      </button>
      <div class="filters" :class="{ open: settingsOpen }">
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
      </div>
    </header>

    <main class="stage">
      <section class="quiz" @click="focusInput">
        <div class="pool-count">題庫 {{ pool.length }} 個</div>
        <div class="mini-stats">
          <span class="good">✓ {{ session.correct }}</span>
          <span class="bad">✗ {{ session.wrong }}</span>
          <span>{{ accuracy }}%</span>
          <span>連續 {{ session.streak }}</span>
        </div>

        <div v-if="current" ref="cardEl" class="card" :class="{ ok: card.flash === 'ok', shake: card.shake, kata: current.script === 'kata' }">
          <span class="script-tag">{{ current.script === 'kata' ? '片' : '平' }}</span>
          <div class="kana" :lang="'ja'">{{ current.display }}</div>
          <div class="hint" :class="{ show: card.hint }">{{ current.romaji.join(' / ') }}</div>
        </div>
        <div v-if="current && card.hint && lookalikes.length" class="lookalikes">
          <span class="label">別搞混</span>
          <span v-for="x in lookalikes" :key="x.id" class="la" lang="ja">{{ x.display }}<small>{{ x.romaji[0] }}</small></span>
        </div>

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

        <label class="auto">
          <input v-model="settings.autoSpeak" type="checkbox" />
          出題時自動播放發音
        </label>
      </section>

      <aside class="side">
        <div class="stats">
          <div><b>{{ session.correct }}</b><small>答對</small></div>
          <div><b>{{ session.wrong }}</b><small>答錯</small></div>
          <div><b>{{ accuracy }}%</b><small>正確率</small></div>
          <div><b>{{ session.streak }}</b><small>連續 (最佳 {{ session.best }})</small></div>
          <div><b>{{ avgSec }}</b><small>平均秒數</small></div>
        </div>

        <div v-if="history.length" class="block">
          <h3>最近</h3>
          <TransitionGroup tag="div" name="pop" class="history">
            <span v-for="h in history" :key="h.key" class="h" :class="h.ok ? 'good' : 'bad'" :title="h.item.romaji[0]">
              {{ h.item.display }}<small>{{ h.item.romaji[0] }}</small>
            </span>
          </TransitionGroup>
        </div>

        <div v-if="weakList.length" class="block">
          <h3>弱點</h3>
          <div class="weak">
            <span v-for="w in weakList" :key="w.id" class="w">
              {{ w.item.display }}<small>{{ w.item.romaji[0] }} · 錯 {{ w.miss }}</small>
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
      <div v-for="sec in chartSections" :key="sec.key">
        <h3>{{ sec.title }}</h3>
        <div v-for="g in sec.groups" :key="g.key" class="chart-group">
          <h4 v-if="g.label">{{ g.label }}</h4>
          <div class="grid" :class="{ wide: g.wide, similar: !g.label }">
            <span v-for="x in g.items" :key="x.id">{{ x.display }}<small>{{ x.romaji[0] }}</small></span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
