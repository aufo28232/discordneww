// Logica da tela inicial: escolher nickname e criar ou entrar em uma sala.
// Sem contas/login - o nickname fica salvo so localmente (localStorage) para
// nao precisar redigitar em toda visita.

const NICK_KEY = 'voicecall.nickname';

const nickInput = document.getElementById('nickname');
const createBtn = document.getElementById('create-call-btn');
const joinBtn = document.getElementById('join-call-btn');
const joinInput = document.getElementById('join-code');
const errorBanner = document.getElementById('error-banner');

nickInput.value = localStorage.getItem(NICK_KEY) || '';

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
}

function clearError() {
  errorBanner.classList.remove('visible');
}

function saveNickname() {
  const nick = nickInput.value.trim();
  if (!nick) {
    showError('Escolha um nome para continuar.');
    nickInput.focus();
    return null;
  }
  clearError();
  localStorage.setItem(NICK_KEY, nick);
  return nick;
}

// Gera um id de sala curto e legivel (ex: "f83k2q9x"), sem depender de
// nenhuma biblioteca externa - so precisamos de algo praticamente unico
// para compor a URL /call/<id>.
function generateRoomId() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return Array.from(values, (n) => n.toString(36).padStart(7, '0')).join('').slice(0, 10);
}

createBtn.addEventListener('click', () => {
  if (!saveNickname()) return;
  const roomId = generateRoomId();
  window.location.href = `/call/${roomId}`;
});

joinBtn.addEventListener('click', () => {
  if (!saveNickname()) return;
  const raw = joinInput.value.trim();
  if (!raw) {
    showError('Cole o link ou código da sala para entrar.');
    joinInput.focus();
    return;
  }
  // Aceita tanto um link completo quanto so o codigo da sala.
  let roomId = raw;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    roomId = parts[parts.length - 1] || raw;
  } catch {
    // Nao era uma URL valida - assume que o usuario colou so o codigo.
  }
  window.location.href = `/call/${encodeURIComponent(roomId)}`;
});

joinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createBtn.click();
});
