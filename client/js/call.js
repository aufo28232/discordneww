// Orquestra a tela da sala: pre-entrada (nome + teste de microfone), o
// ciclo de vida da malha WebRTC (webrtc.js), a UI da grade de participantes
// e os controles (mutar, trocar mic, compartilhar tela, sair).

import { getMicStream, listMicDevices, getScreenStream, supportsScreenShare } from './media.js';
import { watchSpeaking } from './audio-meter.js';
import { createSocket } from './socket-client.js';
import { createMeshManager } from './webrtc.js';

const NICK_KEY = 'voicecall.nickname';

function getRoomId() {
  const params = new URLSearchParams(location.search);
  if (params.has('room')) return params.get('room');
  const parts = location.pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

const roomId = getRoomId();

// --- DOM refs ---
const prejoinOverlay = document.getElementById('prejoin-overlay');
const prejoinRoomIdEl = document.getElementById('prejoin-room-id');
const prejoinNickInput = document.getElementById('prejoin-nickname');
const prejoinMicSelect = document.getElementById('prejoin-mic-select');
const prejoinError = document.getElementById('prejoin-error');
const prejoinJoinBtn = document.getElementById('prejoin-join-btn');
const prejoinJoinMutedBtn = document.getElementById('prejoin-join-muted-btn');

const callWrap = document.getElementById('call-wrap');
const roomIdLabel = document.getElementById('room-id-label');
const copyInviteBtn = document.getElementById('copy-invite-btn');
const statusPill = document.getElementById('status-pill');
const participantsGrid = document.getElementById('participants-grid');
const featuredArea = document.getElementById('featured-area');
const featuredSlot = document.getElementById('featured-slot');
const sideRail = document.getElementById('side-rail');
const muteBtn = document.getElementById('mute-btn');
const micSelectControl = document.getElementById('mic-select');
const shareBtn = document.getElementById('share-btn');
const leaveBtn = document.getElementById('leave-btn');
const toastEl = document.getElementById('toast');

// --- estado ---
let prejoinStream = null;
let micTrack = null;
let socket = null;
let mesh = null;
let stopLocalSpeakingWatch = null;
let sharingScreen = false;
let screenStream = null;

const tiles = new Map(); // id ('local' ou socket.id remoto) -> tile

init();

async function init() {
  if (!roomId) {
    showPrejoinError('Link de sala inválido.');
    prejoinJoinBtn.disabled = true;
    return;
  }
  prejoinRoomIdEl.textContent = roomId;
  roomIdLabel.textContent = roomId;
  prejoinNickInput.value = localStorage.getItem(NICK_KEY) || '';

  if (!supportsScreenShare()) {
    shareBtn.disabled = true;
    shareBtn.title = 'Compartilhamento de tela não é suportado neste navegador';
  }

  await requestMicAccess();

  prejoinMicSelect.addEventListener('change', () => requestMicAccess(prejoinMicSelect.value));
  prejoinJoinBtn.addEventListener('click', () => attemptJoin(true));
  prejoinJoinMutedBtn.addEventListener('click', () => attemptJoin(false));
  prejoinNickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !prejoinJoinBtn.disabled) prejoinJoinBtn.click();
  });
}

// ---------- pre-entrada ----------

async function requestMicAccess(deviceId) {
  hidePrejoinError();
  try {
    if (prejoinStream) stopStream(prejoinStream);
    prejoinStream = await getMicStream(deviceId);
    await populateMicSelect(prejoinMicSelect, prejoinStream);
    prejoinJoinBtn.disabled = false;
    prejoinJoinMutedBtn.classList.add('hidden');
  } catch (err) {
    console.error('[call] falha ao acessar microfone', err);
    prejoinStream = null;
    prejoinMicSelect.innerHTML = '<option value="">Nenhum microfone disponível</option>';
    prejoinMicSelect.disabled = true;
    prejoinJoinBtn.disabled = true;
    prejoinJoinMutedBtn.classList.remove('hidden');
    showPrejoinError(microphoneErrorMessage(err));
  }
}

function microphoneErrorMessage(err) {
  if (err.name === 'NotAllowedError') {
    return 'Permissão de microfone negada. Permita o acesso nas configurações do navegador e recarregue, ou entre sem microfone.';
  }
  if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
    return 'Nenhum microfone encontrado. Você pode entrar mesmo assim, só para ouvir.';
  }
  return `Não foi possível acessar o microfone (${err.message || err.name}).`;
}

function showPrejoinError(message) {
  prejoinError.textContent = message;
  prejoinError.classList.add('visible');
}

function hidePrejoinError() {
  prejoinError.classList.remove('visible');
}

async function populateMicSelect(selectEl, stream) {
  const devices = await listMicDevices();
  selectEl.innerHTML = '';
  selectEl.disabled = devices.length === 0;
  const currentId = stream ? stream.getAudioTracks()[0]?.getSettings().deviceId : null;
  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microfone ${i + 1}`;
    if (d.deviceId === currentId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function attemptJoin(withMic) {
  const nickname = prejoinNickInput.value.trim();
  if (!nickname) {
    showPrejoinError('Escolha um nome para continuar.');
    prejoinNickInput.focus();
    return;
  }
  localStorage.setItem(NICK_KEY, nickname);
  joinCall(nickname, withMic ? prejoinStream : null);
}

// ---------- entrando na sala ----------

function joinCall(nickname, initialMicStream) {
  prejoinOverlay.classList.add('hidden');
  callWrap.classList.remove('hidden');

  socket = createSocket();
  mesh = createMeshManager({
    socket,
    onRemoteStream: handleRemoteStream,
    onPeerClosed: (peerId) => removeTile(peerId),
  });

  const localTile = createTile('local', nickname, true);

  if (initialMicStream) {
    micTrack = initialMicStream.getAudioTracks()[0];
    mesh.setMicTrack(micTrack);
    stopLocalSpeakingWatch = watchSpeaking(initialMicStream, (speaking) =>
      setTileSpeaking(localTile, speaking)
    );
  } else {
    muteBtn.classList.add('off');
    muteBtn.disabled = true;
  }
  setTileMicState(localTile, Boolean(micTrack && micTrack.enabled));
  populateMicSelect(micSelectControl, initialMicStream);

  socket.on('connect', () => {
    setStatus('connected');
    socket.emit('join-room', { roomId, nickname });
  });

  socket.on('existing-peers', ({ peers }) => {
    for (const p of peers) {
      const tile = createTile(p.id, p.nickname, false);
      mesh.connectToExistingPeer(p.id);
      if (p.sharingScreen) setTileSharing(tile, true);
    }
  });

  // Alguém novo chegou: só criamos a "vaga" dele na grade. Quem inicia a
  // conexão RTCPeerConnection é o lado que acabou de entrar (ver
  // "existing-peers" acima) — assim cada par de peers só troca uma oferta.
  socket.on('peer-joined', ({ id, nickname: peerNick }) => {
    createTile(id, peerNick, false);
  });

  socket.on('signal', (payload) => {
    mesh.handleIncomingSignal(payload).catch((err) => console.error('[call] signal error', err));
  });

  socket.on('peer-left', ({ id }) => {
    mesh.closePeer(id); // dispara onPeerClosed -> removeTile
  });

  socket.on('screen-share-status', ({ id, active }) => {
    const tile = tiles.get(id);
    if (tile) setTileSharing(tile, active);
  });

  socket.on('disconnect', () => setStatus('disconnected'));
  socket.on('connect_error', () => setStatus('disconnected'));

  wireControls();
}

function handleRemoteStream(peerId, stream) {
  const tile = tiles.get(peerId);
  if (!tile) return;
  setTileStream(tile, stream);
  if (!tile.stopSpeaking && stream.getAudioTracks().length) {
    tile.stopSpeaking = watchSpeaking(stream, (speaking) => setTileSpeaking(tile, speaking));
  }
}

// ---------- controles ----------

function wireControls() {
  muteBtn.addEventListener('click', () => {
    if (!micTrack) return;
    micTrack.enabled = !micTrack.enabled;
    muteBtn.classList.toggle('off', !micTrack.enabled);
    muteBtn.textContent = micTrack.enabled ? '🎤' : '🔇';
    setTileMicState(tiles.get('local'), micTrack.enabled);
  });

  micSelectControl.addEventListener('change', async () => {
    try {
      const newStream = await getMicStream(micSelectControl.value);
      const newTrack = newStream.getAudioTracks()[0];
      newTrack.enabled = micTrack ? micTrack.enabled : true;
      mesh.setMicTrack(newTrack);
      micTrack = newTrack;
      muteBtn.disabled = false;
      if (stopLocalSpeakingWatch) stopLocalSpeakingWatch();
      stopLocalSpeakingWatch = watchSpeaking(newStream, (speaking) =>
        setTileSpeaking(tiles.get('local'), speaking)
      );
    } catch (err) {
      showToast(`Não foi possível trocar o microfone: ${err.message || err.name}`);
    }
  });

  shareBtn.addEventListener('click', () => {
    if (sharingScreen) stopScreenShare();
    else startScreenShare();
  });

  leaveBtn.addEventListener('click', leaveCall);

  copyInviteBtn.addEventListener('click', async () => {
    const url = `${location.origin}/call/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copiado!');
    } catch {
      showToast(url);
    }
  });
}

async function startScreenShare() {
  try {
    screenStream = await getScreenStream();
    const track = screenStream.getVideoTracks()[0];
    // Se o usuário parar o compartilhamento pelo painel nativo do navegador
    // (em vez do nosso botão), a track termina sozinha - detectamos aqui.
    track.onended = () => stopScreenShare();

    mesh.addScreenTrack(track);
    sharingScreen = true;
    shareBtn.classList.add('active');

    const localTile = tiles.get('local');
    setTileStream(localTile, screenStream);
    setTileSharing(localTile, true);
    socket.emit('screen-share-status', { active: true });
  } catch (err) {
    if (err.name === 'NotAllowedError') return; // usuário cancelou o picker - sem erro
    showToast(`Não foi possível compartilhar a tela: ${err.message || err.name}`);
  }
}

function stopScreenShare() {
  if (!sharingScreen) return;
  mesh.removeScreenTrack();
  if (screenStream) stopStream(screenStream);
  screenStream = null;
  sharingScreen = false;
  shareBtn.classList.remove('active');

  const localTile = tiles.get('local');
  setTileStream(localTile, null);
  setTileSharing(localTile, false);
  socket.emit('screen-share-status', { active: false });
}

function leaveCall() {
  if (mesh) mesh.closeAll();
  if (socket) socket.disconnect();
  if (micTrack) micTrack.stop();
  if (screenStream) stopStream(screenStream);
  if (stopLocalSpeakingWatch) stopLocalSpeakingWatch();
  window.location.href = '/';
}

// ---------- UI: tiles de participantes ----------

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function createTile(id, nickname, isLocal) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.id = id;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true; // nunca reproduzimos nosso próprio áudio de volta

  const avatar = document.createElement('div');
  avatar.className = 'avatar-circle';
  avatar.textContent = initials(nickname);

  const label = document.createElement('div');
  label.className = 'tile-label';

  const micIcon = document.createElement('span');
  micIcon.className = 'mic-icon';
  micIcon.textContent = '🎤';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = isLocal ? `${nickname} (você)` : nickname;

  const screenBadge = document.createElement('span');
  screenBadge.className = 'screen-badge hidden';
  screenBadge.textContent = 'Tela';

  label.append(micIcon, name, screenBadge);
  el.append(video, avatar, label);
  participantsGrid.appendChild(el);

  const tile = {
    id,
    nickname,
    isLocal,
    el,
    video,
    micIcon,
    screenBadge,
    sharingScreen: false,
    stopSpeaking: null,
  };
  tiles.set(id, tile);
  updateLayout();
  return tile;
}

function setTileStream(tile, stream) {
  tile.video.srcObject = stream || null;
  const hasVideo = Boolean(stream && stream.getVideoTracks().length);
  tile.el.classList.toggle('has-video', hasVideo);
}

function setTileSpeaking(tile, speaking) {
  if (!tile) return;
  tile.el.classList.toggle('speaking', speaking);
}

function setTileMicState(tile, enabled) {
  if (!tile) return;
  tile.micIcon.textContent = enabled ? '🎤' : '🔇';
}

function setTileSharing(tile, sharing) {
  if (!tile) return;
  tile.sharingScreen = sharing;
  tile.screenBadge.classList.toggle('hidden', !sharing);
  updateLayout();
}

function removeTile(id) {
  const tile = tiles.get(id);
  if (!tile) return;
  if (tile.stopSpeaking) tile.stopSpeaking();
  const stream = tile.video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  tile.el.remove();
  tiles.delete(id);
  updateLayout();
}

// Quando alguém está compartilhando tela, essa pessoa ganha destaque na
// área principal e os demais migram para a barra lateral; sem ninguém
// compartilhando, todos voltam para a grade normal.
function updateLayout() {
  const sharer = Array.from(tiles.values()).find((t) => t.sharingScreen);
  if (sharer) {
    participantsGrid.classList.add('hidden');
    featuredArea.classList.remove('hidden');
    sharer.el.classList.add('featured');
    featuredSlot.appendChild(sharer.el);
    for (const t of tiles.values()) {
      if (t !== sharer) sideRail.appendChild(t.el);
    }
  } else {
    featuredArea.classList.add('hidden');
    participantsGrid.classList.remove('hidden');
    for (const t of tiles.values()) {
      t.el.classList.remove('featured');
      participantsGrid.appendChild(t.el);
    }
  }
}

// ---------- utilidades ----------

function setStatus(state) {
  statusPill.textContent = state === 'connected' ? 'conectado' : 'desconectado';
  statusPill.classList.toggle('connected', state === 'connected');
  statusPill.classList.toggle('disconnected', state === 'disconnected');
}

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

function stopStream(stream) {
  stream.getTracks().forEach((t) => t.stop());
}
