// Wrapper fino sobre o socket.io-client (carregado via CDN em call.html,
// que expõe o global `io`). Mantido em módulo próprio só para os outros
// arquivos não precisarem saber que a lib vem de um <script> global.
export function createSocket() {
  if (typeof io === 'undefined') {
    throw new Error('socket.io-client não carregado (verifique o <script> do CDN em call.html)');
  }
  return io(window.SIGNALING_SERVER_URL, {
    transports: ['websocket', 'polling'],
  });
}
