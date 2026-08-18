// Helpers de captura de midia local (microfone e compartilhamento de tela).
// Mantido separado do webrtc.js para deixar claro o que e "captura de midia"
// (getUserMedia/getDisplayMedia) vs. "transporte P2P" (RTCPeerConnection).

// echoCancellation/noiseSuppression/autoGainControl cobrem o caso comum
// (ruido de fundo, eco do proprio alto-falante, volume desigual entre
// microfones). Para uma supressao de ruido mais avancada (ex: separar voz
// de ruido de teclado/ventilador com um modelo de rede neural), a opcao
// mais usada hoje é RNNoise compilado para WebAssembly e rodando dentro de
// um AudioWorklet, processando o stream antes de entrar na PeerConnection.
// Nao implementado aqui por complexidade/escopo - fica como melhoria futura.
export async function getMicStream(deviceId) {
  const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) {
    audioConstraints.deviceId = { exact: deviceId };
  }
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
}

// Lista os microfones disponiveis. Os labels só vêm preenchidos depois que
// alguma permissão de mídia já foi concedida (por isso call.js chama isso
// de novo depois do primeiro getUserMedia bem-sucedido).
export async function listMicDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export function supportsScreenShare() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

// Tenta capturar a tela em 1080p/60fps; se o navegador/dispositivo não
// atender (constraints não suportadas, hardware fraco, etc.), cai
// automaticamente para 720p/30fps antes de desistir.
export async function getScreenStream() {
  if (!supportsScreenShare()) {
    throw new Error('SCREEN_SHARE_UNSUPPORTED');
  }

  const highQuality = {
    video: { width: 1920, height: 1080, frameRate: 60 },
    audio: false,
  };
  try {
    return await navigator.mediaDevices.getDisplayMedia(highQuality);
  } catch (err) {
    if (err.name === 'NotAllowedError') throw err; // usuário cancelou - não tentar de novo
    const fallback = {
      video: { width: 1280, height: 720, frameRate: 30 },
      audio: false,
    };
    return navigator.mediaDevices.getDisplayMedia(fallback);
  }
}
