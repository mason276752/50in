<script setup>
import { computed, reactive, ref, nextTick, onBeforeUnmount } from 'vue'
import { speak, stopSpeaking } from './useSpeech'
import { makeDialog } from './dialogs'

// 會話測驗：上面是一來一往的對話，下面一題一題作答
// 題型：cloze 克漏字（某句挖空）| reply 接話（某句藏起來，選最合理的那句）| read 閱讀理解（中文問題）
// 還沒答的空格、藏起來的句子不能聽、不能查字典，答完整段才顯示中文翻譯
// 每次出現都重新帶入人名、時間、數量…、重新抽題（複習時也是），背答案沒用
const props = defineProps({
  dialog: { type: Object, required: true },
  show: { type: String, default: 'both' }, // 'kana' | 'kanji' | 'both'
  voiceURI: { type: String, default: '' },
  badge: { type: String, default: '' }, // 新會話／複習中
})
const emit = defineEmits(['wrong', 'right', 'done', 'giveup', 'next'])

const TYPE_LABEL = { cloze: '克漏字', reply: '接話', read: '閱讀理解' }
const TYPE_HINT = { cloze: '選出填入空格最適合的字詞', reply: '選出最適合放在「？」的那句話' }

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const D = makeDialog(props.dialog)
// 每題的選項打亂一次（index 0 是正解）
const questions = D.qs.map((q) => ({ ...q, order: shuffle(q.options.map((o, i) => ({ ...o, i }))) }))

const state = reactive({ qi: 0, wrong: [], revealed: false, solved: [], done: false })
const q = computed(() => questions[state.qi])
const solved = (qi) => state.solved.includes(qi)

// 某句目前的狀態：被接話題藏起來／有克漏字空格（還沒答）／正常
function lineState(li) {
  const qi = questions.findIndex((x) => x.line === li && x.type !== 'read')
  if (qi < 0 || solved(qi)) return { qi, hidden: false, cloze: null, current: false }
  const x = questions[qi]
  return { qi, hidden: x.type === 'reply', cloze: x.type === 'cloze' ? x : null, current: qi === state.qi && !state.done }
}

// 振假名段 → 顯示用的片段（依顯示方式）
function pieces(segs, from = 0, to = segs.length) {
  return segs.slice(from, to).map(([text, rt]) => ({ text, rt: props.show === 'both' ? rt : null, plain: props.show === 'kana' ? rt || text : text }))
}
function linePieces(li) {
  const L = D.lines[li]
  const st = lineState(li)
  // 解過的克漏字：用挖空版本的分段，空格處標出答案
  const qi = questions.findIndex((x) => x.line === li && x.type === 'cloze')
  if (qi >= 0) {
    const x = questions[qi]
    const [a, b] = x.blank
    return {
      before: pieces(x.furi, 0, a),
      blank: st.cloze ? null : pieces(x.furi, a, b),
      after: pieces(x.furi, b),
      hasBlank: true,
    }
  }
  return { before: pieces(L.furi), hasBlank: false }
}

// 字典：點一句展開這句的單字；克漏字還沒答時，跟答案有關的字先不給
const openGloss = ref(-1)
function glossOf(li) {
  const L = D.lines[li]
  const st = lineState(li)
  if (!st.cloze) return L.gloss
  const ans = st.cloze.options[0].ja
  return L.gloss.filter(([ja]) => !ja.includes(ans) && ![...ja].some((c) => /[一-鿿]/.test(c) && ans.includes(c)))
}
function toggleGloss(li) {
  if (lineState(li).hidden) return
  openGloss.value = openGloss.value === li ? -1 : li
}

// ---- 發音：A、B 用不同的聲音（有兩個以上日文語音時） ----
const speakers = [...new Set(D.lines.map((l) => l.who))]
function voiceFor(who) {
  const ja = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'))
  if (ja.length < 2) return props.voiceURI
  const first = ja.find((v) => v.voiceURI === props.voiceURI) || ja[0]
  const others = ja.filter((v) => v !== first)
  const idx = speakers.indexOf(who)
  return idx <= 0 ? first.voiceURI : others[(idx - 1) % others.length].voiceURI
}
const playing = ref(-1)
let playToken = 0
const canPlay = (li) => !lineState(li).hidden && !lineState(li).cloze
function playLine(li, onEnd) {
  const token = ++playToken
  playing.value = li
  const L = D.lines[li]
  speak(L.kana, (reason) => {
    if (token !== playToken) return
    playing.value = -1
    if (reason === 'end') onEnd?.()
  }, { voiceURI: voiceFor(L.who) })
}
// 整段依序播放（還沒答的空格、藏起來的句子跳過，不然等於聽到答案）
function playAll() {
  const order = D.lines.map((_, i) => i).filter(canPlay)
  const step = (k) => {
    if (k >= order.length) return
    playLine(order[k], () => setTimeout(() => step(k + 1), 350))
  }
  step(0)
}
function stopAll() {
  playToken++
  playing.value = -1
  stopSpeaking()
}
onBeforeUnmount(stopAll)

// ---- 作答 ----
// 答對後停在這題：每個選項底下都顯示中文，看完按「下一題」（Enter）才往下；最後一題按了才看全文翻譯
const isLast = computed(() => state.qi === questions.length - 1)
function choose(k) {
  const opt = q.value?.order[k]
  if (!opt || state.done || solved(state.qi)) return
  if (opt.i !== 0) {
    if (state.wrong.includes(k)) return
    state.wrong.push(k)
    emit('wrong')
    return
  }
  state.solved.push(state.qi)
  openGloss.value = -1
  emit(isLast.value ? 'done' : 'right')
  scrollToQuestion()
}
function nextQuestion() {
  if (!solved(state.qi)) return
  if (isLast.value) {
    state.done = true
    return
  }
  Object.assign(state, { qi: state.qi + 1, wrong: [], revealed: false })
  scrollToQuestion()
}
// 看答案：標出正解，還是要點它才往下（跟單字題一樣）
function reveal() {
  if (state.done || state.revealed || solved(state.qi)) return
  state.revealed = true
  emit('giveup')
}
function enter() {
  if (state.done) emit('next')
  else if (solved(state.qi)) nextQuestion()
  else reveal()
}
// 日文選項的中文：答對、看答案後全部顯示；選錯的那格馬上顯示它的意思（不會洩漏答案）
const showZh = (k) => solved(state.qi) || state.revealed || state.wrong.includes(k)
const qEl = ref(null)
function scrollToQuestion() {
  nextTick(() => qEl.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
}
function optClass(k) {
  const opt = q.value.order[k]
  const isAnswer = opt.i === 0
  const answered = solved(state.qi)
  return {
    good: isAnswer && (answered || state.revealed),
    bad: state.wrong.includes(k),
    dim: (answered || state.revealed) && !isAnswer && !state.wrong.includes(k),
  }
}

defineExpose({ choose, enter, reveal, playAll })
</script>

<template>
  <div class="dlg">
    <div class="dlg-head">
      <span class="script-tag">{{ dialog.caption }} · {{ dialog.title }}</span>
      <span v-if="badge" class="review-tag">{{ badge }}</span>
      <button class="dlg-play" title="整段播放" @click.stop="playing >= 0 ? stopAll() : playAll()">{{ playing >= 0 ? '■ 停止' : '▶ 整段播放' }}</button>
    </div>

    <ol class="dlg-lines">
      <li
        v-for="(L, li) in D.lines"
        :key="li"
        class="dlg-line"
        :class="[`who-${speakers.indexOf(L.who) % 3}`, { right: speakers.indexOf(L.who) === 1, focus: lineState(li).current, playing: playing === li }]"
      >
        <span class="dlg-name">{{ L.name }}</span>
        <div class="dlg-bubble-row">
          <div class="dlg-bubble" :class="{ hidden: lineState(li).hidden, open: openGloss === li }" @click.stop="toggleGloss(li)">
            <template v-if="lineState(li).hidden"><span class="dlg-q">？</span></template>
            <span v-else class="dlg-jp" lang="ja"
              ><template v-for="(p, j) in linePieces(li).before" :key="'b' + j"
                ><ruby v-if="p.rt">{{ p.text }}<rt>{{ p.rt }}</rt></ruby
                ><template v-else>{{ p.plain }}</template></template
              ><template v-if="linePieces(li).hasBlank"
                ><span v-if="!linePieces(li).blank" class="dlg-blank">？</span
                ><span v-else class="dlg-filled"
                  ><template v-for="(p, j) in linePieces(li).blank" :key="'k' + j"
                    ><ruby v-if="p.rt">{{ p.text }}<rt>{{ p.rt }}</rt></ruby
                    ><template v-else>{{ p.plain }}</template></template
                  ></span
                ><template v-for="(p, j) in linePieces(li).after" :key="'a' + j"
                  ><ruby v-if="p.rt">{{ p.text }}<rt>{{ p.rt }}</rt></ruby
                  ><template v-else>{{ p.plain }}</template></template
                ></template
              ></span
            >
            <div v-if="state.done" class="dlg-zh">{{ L.zh }}</div>
          </div>
          <button v-if="canPlay(li)" class="dlg-say" :title="'播放這句'" @click.stop="playLine(li)">🔊</button>
        </div>
        <ul v-if="openGloss === li" class="dlg-gloss">
          <li v-for="g in glossOf(li)" :key="g[0]">
            <b lang="ja">{{ g[0] }}</b><span v-if="g[1]" lang="ja">（{{ g[1] }}）</span>{{ g[2] }}
          </li>
          <li v-if="!glossOf(li).length" class="none">這句沒有查得到的單字</li>
        </ul>
      </li>
    </ol>

    <div v-if="!state.done" ref="qEl" class="dlg-question">
      <div class="dlg-qhead">
        <span>第 {{ state.qi + 1 }} / {{ questions.length }} 題 · {{ TYPE_LABEL[q.type] }}</span>
        <template v-if="!solved(state.qi)">
          <button v-if="!state.revealed" class="link" @click.stop="reveal">看答案</button>
          <span v-else class="dlg-revealed">點綠色的答案繼續</span>
        </template>
      </div>
      <p class="dlg-prompt">{{ q.type === 'read' ? q.q : TYPE_HINT[q.type] }}</p>
      <div class="options dlg-options" :class="{ wide: q.type !== 'cloze' }">
        <button v-for="(opt, k) in q.order" :key="k" class="opt" :class="optClass(k)" @click.stop="choose(k)">
          <span class="num">{{ k + 1 }}</span>
          <span v-if="q.type === 'read'" class="main">{{ opt.zh }}</span>
          <template v-else>
            <span class="main dlg-jp" lang="ja"
              ><template v-for="(p, j) in pieces(opt.furi)" :key="j"
                ><ruby v-if="p.rt">{{ p.text }}<rt>{{ p.rt }}</rt></ruby
                ><template v-else>{{ p.plain }}</template></template
              ></span
            >
            <small v-if="showZh(k)" class="zh">{{ opt.zh }}</small>
          </template>
        </button>
      </div>
      <button v-if="solved(state.qi)" class="btn dlg-next" @click.stop="nextQuestion">{{ isLast ? '看全文翻譯 →' : '下一題 →' }}</button>
    </div>
    <div v-else class="dlg-done">
      <p>這段答完了。點句子可以查單字，🔊 可以聽每一句。</p>
      <button class="btn dlg-next" @click.stop="emit('next')">下一段 →</button>
    </div>
  </div>
</template>
