import { useCallback, useMemo, useRef, useState } from 'react'
import './App.css'
import { Mic } from 'lucide-react'

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{
    0: { transcript: string }
    isFinal: boolean
    length: number
  }>
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionCtor
    SpeechRecognition?: SpeechRecognitionCtor
  }
}

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]

  const mr = window.MediaRecorder
  if (!mr?.isTypeSupported) return undefined

  return candidates.find((t) => mr.isTypeSupported(t))
}

function extractAnalyzedInfo(text: string) {
  const normalized = text.trim()
  if (!normalized) {
    return { hizmet: '', musteri: '', tutar: '' }
  }

  const hizmetMatch = normalized.match(/(?:hizmet|islem)\s*[:\-]?\s*([a-zA-ZcCgGiIoOsSuU\u00c7\u011e\u0130\u00d6\u015e\u00dc0-9 ]{2,40})/i)
  const musteriMatch = normalized.match(/(?:musteri|müşteri|ad[ıi])\s*[:\-]?\s*([a-zA-ZcCgGiIoOsSuU\u00c7\u011e\u0130\u00d6\u015e\u00dc ]{2,40})/i)
  const tutarMatch = normalized.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:tl|₺|lira))/i)

  return {
    hizmet: hizmetMatch?.[1]?.trim() ?? '',
    musteri: musteriMatch?.[1]?.trim() ?? '',
    tutar: tutarMatch?.[1]?.trim() ?? '',
  }
}

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [transcriptText, setTranscriptText] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const transcriptRef = useRef('')

  const mimeType = useMemo(() => pickMimeType(), [])
  const analyzedInfo = useMemo(() => extractAnalyzedInfo(transcriptText), [transcriptText])
  const isSpeechRecognitionSupported = useMemo(
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  )

  const stopAllTracks = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    for (const track of stream.getTracks()) track.stop()
    streamRef.current = null
  }, [])

  const startRecording = useCallback(async () => {
    setStatusText(
      isSpeechRecognitionSupported
        ? null
        : 'Tarayıcınız konuşmadan metne çeviriyi desteklemiyor. Sadece ses kaydı alınacak.',
    )
    setRecordedBlob(null)
    setTranscriptText('')
    transcriptRef.current = ''

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      chunksRef.current = []
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        })
        setRecordedBlob(blob)
        setStatusText('Ses başarıyla kaydedildi, metne dönüştürülmeye hazır')
        chunksRef.current = []
        recorderRef.current = null
        stopAllTracks()
      }

      recorder.start()

      if (isSpeechRecognitionSupported) {
        const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
        if (Ctor) {
          const recognition = new Ctor()
          recognition.lang = 'tr-TR'
          recognition.continuous = true
          recognition.interimResults = true

          recognition.onresult = (event) => {
            let finalText = transcriptRef.current
            let interimText = ''

            for (let i = event.resultIndex; i < event.results.length; i += 1) {
              const result = event.results[i]
              const text = result[0]?.transcript?.trim()
              if (!text) continue
              if (result.isFinal) finalText = `${finalText} ${text}`.trim()
              else interimText = `${interimText} ${text}`.trim()
            }

            transcriptRef.current = finalText
            setTranscriptText(`${finalText} ${interimText}`.trim())
          }

          recognition.onerror = () => {
            setStatusText('Konuşma metne çevrilirken bir hata oluştu.')
          }

          recognition.onend = () => {
            setTranscriptText((prev) => prev.trim())
          }

          recognitionRef.current = recognition
          recognition.start()
        }
      }

      setIsRecording(true)
      setStatusText(
        isSpeechRecognitionSupported
          ? 'Ses kaydediliyor ve metne cevriliyor...'
          : 'Ses kaydediliyor... (Konusmadan metne ceviri bu tarayicida desteklenmiyor.)',
      )
    } catch {
      setIsRecording(false)
      setStatusText('Mikrofon izni alınamadı. Lütfen izin verip tekrar deneyin.')
      stopAllTracks()
    }
  }, [isSpeechRecognitionSupported, mimeType, stopAllTracks])

  const stopRecording = useCallback(() => {
    try {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      recorderRef.current?.stop()
      setTranscriptText((prev) => prev.trim())
    } finally {
      setIsRecording(false)
    }
  }, [])

  const onToggleRecording = useCallback(() => {
    if (isRecording) stopRecording()
    else void startRecording()
  }, [isRecording, startRecording, stopRecording])

  const onSave = useCallback(() => {
    const payload = {
      transcript: transcriptText,
      analizEdilenBilgiler: analyzedInfo,
      audioSize: recordedBlob?.size ?? 0,
    }

    console.log('Kaydedilecek veriler:', payload)
    setStatusText('Veriler konsola kaydedildi.')
  }, [analyzedInfo, recordedBlob, transcriptText])

  return (
    <main className="home" aria-label="Saha Teknikeri Asistanı">
      <button
        type="button"
        className={`recordButton ${isRecording ? 'isRecording' : ''}`}
        onClick={onToggleRecording}
        aria-label={isRecording ? 'Kaydı durdur' : 'Kayıt yap'}
      >
        <Mic className="recordIcon" aria-hidden="true" />
      </button>
      <p className="hint">Kayıt Yapmak İçin Basın</p>
      {statusText ? <p className="status">{statusText}</p> : null}
      {transcriptText ? (
        <section className="transcriptCard" aria-label="Konusma metni">
          <h2 className="transcriptTitle">Soylenenler</h2>
          <p className="transcriptText">{transcriptText}</p>
        </section>
      ) : null}
      <section className="analysisCard" aria-label="Analiz edilen bilgiler">
        <h2 className="analysisTitle">Analiz Edilen Bilgiler</h2>
        <div className="analysisGrid">
          <div className="analysisField">
            <span className="analysisLabel">Hizmet</span>
            <span className="analysisValue">{analyzedInfo.hizmet || '-'}</span>
          </div>
          <div className="analysisField">
            <span className="analysisLabel">Musteri</span>
            <span className="analysisValue">{analyzedInfo.musteri || '-'}</span>
          </div>
          <div className="analysisField">
            <span className="analysisLabel">Tutar</span>
            <span className="analysisValue">{analyzedInfo.tutar || '-'}</span>
          </div>
        </div>
        <button type="button" className="saveButton" onClick={onSave}>
          Kaydet
        </button>
      </section>
      {/* Blob şimdilik gönderilmiyor; hazır olduğunda burada mevcut. */}
      {recordedBlob ? <span className="srOnly">Kayıt boyutu: {recordedBlob.size}</span> : null}
    </main>
  )
}

export default App
