// URL do servidor de sinalizacao (Socket.io).
//
// Em desenvolvimento local, aponta para o server rodando em server/ (npm start).
// Em producao, troque pela URL publica do seu Web Service no Render
// (ex: "https://discord-voice-signaling.onrender.com") ANTES de fazer o
// deploy do client/ na Vercel. Nao ha build step neste projeto, entao essa
// troca precisa ser manual neste arquivo - ver README.md > Deploy.
window.SIGNALING_SERVER_URL =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://SEU-APP.onrender.com'; // <-- troque isso depois de criar o Web Service no Render
