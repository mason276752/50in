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

export function speak(text, onEnd) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  u.rate = 0.8
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ja'))
  if (voice) u.voice = voice
  u.onend = onEnd
  u.onerror = onEnd
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}
