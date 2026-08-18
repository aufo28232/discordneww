// Indicador de "quem está falando", usando a Web Audio API para medir o
// volume de um MediaStream de áudio (local ou remoto) em tempo real.

const SPEAKING_THRESHOLD = 0.02; // RMS mínimo para considerar "falando"
const SPEAKING_HYSTERESIS_MS = 250; // evita piscar ao passar perto do limiar

let sharedAudioCtx = null;
function getAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedAudioCtx;
}

// onChange(isSpeaking: boolean) é chamado sempre que o estado muda.
// Retorna uma função stop() para liberar os recursos do AnalyserNode.
export function watchSpeaking(mediaStream, onChange) {
  if (!mediaStream.getAudioTracks().length) {
    return () => {};
  }

  const ctx = getAudioContext();
  const source = ctx.createMediaStreamSource(mediaStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  let speaking = false;
  let lastChangeAt = 0;
  let rafId = null;

  function tick() {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const centered = (data[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / data.length);

    const now = performance.now();
    const shouldSpeak = rms > SPEAKING_THRESHOLD;
    if (shouldSpeak !== speaking && now - lastChangeAt > SPEAKING_HYSTERESIS_MS) {
      speaking = shouldSpeak;
      lastChangeAt = now;
      onChange(speaking);
    }
    rafId = requestAnimationFrame(tick);
  }
  tick();

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    source.disconnect();
    analyser.disconnect();
  };
}
