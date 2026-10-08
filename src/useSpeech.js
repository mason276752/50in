import { ref, onBeforeUnmount } from 'vue'

// 包一層 Web Speech API（Chrome / Edge / Safari 支援）
// onText(alternatives, isFinal) 回傳 true 表示目前為止的文字已用掉，之後只會收到新唸的部分
export function useSpeechRecognition(onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const supported = !!SR
  const listening = ref(false)
  const heard = ref('')
  const error = ref('')

  let rec = null
  let wanted = false
  // 每段結果已用掉的字數。連續模式下 Chrome 會把接著唸的內容接在同一段後面，
  // 所以只能丟掉已用過的前綴，不能整段忽略
  let consumed = []

  function start() {
    if (!SR || wanted) return
    error.value = ''
    wanted = true
    rec = new SR()
    rec.lang = 'ja-JP'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 5

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const used = consumed[i] || 0
        const alts = Array.from(result, (a) => a.transcript.slice(used)).filter((s) => s.trim())
        if (!alts.length) continue
        heard.value = alts[0]
        if (onText(alts, result.isFinal)) consumed[i] = result[0].transcript.length
      }
    }

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted = false
        error.value = '麥克風權限被拒絕，請在瀏覽器允許麥克風'
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        error.value = `語音辨識錯誤：${e.error}`
      }
    }

    // 瀏覽器靜音一段時間會自動結束，還想聽就重新啟動
    rec.onend = () => {
      consumed = []
      if (wanted) {
        try {
          rec.start()
          return
        } catch {
          wanted = false
        }
      }
      listening.value = false
    }

    rec.start()
    listening.value = true
  }

  function stop() {
    wanted = false
    rec?.stop()
    listening.value = false
  }

  function toggle() {
    listening.value ? stop() : start()
  }

  onBeforeUnmount(stop)

  return { supported, listening, heard, error, start, stop, toggle }
}

// ---- 語音合成（發音）----
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined

// 聲音品質比較好的優先當預設
const PREFERRED = /Google|Nanami|Kyoko|O-Ren|Otoya|Haruka|Ayumi/i

// 列出裝置上的日文語音。有些瀏覽器一開始回傳空清單，要等 voiceschanged；
// 有些永遠不會觸發，所以最多等 1.5 秒就當作載入完成
export function useJapaneseVoices() {
  const voices = ref([])
  const loaded = ref(!synth)
  if (!synth) return { supported: false, voices, loaded }

  const refresh = () => {
    const list = synth.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'))
    list.sort((a, b) => PREFERRED.test(b.name) - PREFERRED.test(a.name))
    voices.value = list
    if (list.length || synth.getVoices().length) loaded.value = true
  }
  refresh()
  synth.addEventListener?.('voiceschanged', refresh)
  const timer = setTimeout(() => {
    refresh()
    loaded.value = true
  }, 1500)
  onBeforeUnmount(() => {
    clearTimeout(timer)
    synth.removeEventListener?.('voiceschanged', refresh)
  })
  return { supported: true, voices, loaded }
}

// voiceURI 沒指定或找不到時，用第一個（品質較好的）日文語音
// 語速固定 0.5：有理會 rate 的語音（Kyoko、Google）會唸慢一點，其他語音照原速
export function speak(text, onEnd, { voiceURI = '' } = {}) {
  if (!synth) return onEnd?.()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  u.rate = 0.5
  const ja = synth.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'))
  const voice = ja.find((v) => v.voiceURI === voiceURI) || ja.find((v) => PREFERRED.test(v.name)) || ja[0]
  if (voice) u.voice = voice
  // onEnd 收到結束原因：'end' 唸完；'interrupted'／'canceled' 被新的發音或換題打斷
  u.onend = () => onEnd?.('end')
  u.onerror = (e) => onEnd?.(e.error || 'error')
  synth.cancel()
  synth.speak(u)
}

// 在點擊事件裡同步唸一段無聲的空白：iOS／Chrome 從此允許程式自己發音
export function unlockSpeech() {
  if (!synth) return
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  synth.speak(u)
}

// 換題時停掉還沒唸完的發音，不要讓上一題的聲音蓋到新題目
export function stopSpeaking() {
  synth?.cancel()
}
