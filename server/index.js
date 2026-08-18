// Servidor de sinalizacao WebRTC.
//
// IMPORTANTE: este servidor NUNCA ve nem transporta audio/video/tela.
// Ele so troca metadados (offer/answer/ICE candidates em SDP) entre os
// participantes de uma sala, para que eles consigam abrir conexoes
// P2P diretas entre si (RTCPeerConnection). O trafego de midia em si
// vai direto de peer para peer.
//
// Precisa rodar em um processo persistente (nao serverless) porque
// Socket.io depende de uma conexao WebSocket de longa duracao - por isso
// este servidor vai para o Render (ou similar), nunca para a Vercel.

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const {
  joinRoom,
  leaveRoom,
  getPeers,
  setSharingScreen,
  findRoomBySocket,
} = require('./rooms');

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

// Endpoint simples de health check (util para o Render e para debug de deploy).
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'discord-voice-signaling' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  // O cliente entra em uma sala informando roomId + nickname escolhido.
  socket.on('join-room', ({ roomId, nickname }) => {
    if (!roomId || typeof roomId !== 'string') return;
    const safeNickname = (nickname || 'Usuário').toString().slice(0, 32);

    // Lista de quem ja esta na sala, enviada so para quem acabou de entrar.
    const existingPeers = getPeers(roomId, socket.id);

    joinRoom(roomId, socket.id, safeNickname);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.nickname = safeNickname;

    socket.emit('existing-peers', { peers: existingPeers });

    // Avisa os demais participantes que alguem novo chegou. E o novo peer
    // que vai iniciar as conexoes RTCPeerConnection para cada um deles
    // (ver client/js/webrtc.js) - assim so um lado precisa "existingPeers".
    socket.to(roomId).emit('peer-joined', { id: socket.id, nickname: safeNickname });
  });

  // Relay generico de sinalizacao WebRTC: o servidor so repassa o payload
  // para o destinatario certo, sem interpretar seu conteudo (offer/answer/
  // ICE candidate - quem monta e interpreta isso e o client/js/webrtc.js).
  socket.on('signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Broadcast explicito de "estou compartilhando tela" - usado pelo client
  // para destacar quem esta compartilhando, sem precisar inferir isso a
  // partir das tracks recebidas via WebRTC.
  socket.on('screen-share-status', ({ active }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    setSharingScreen(roomId, socket.id, Boolean(active));
    socket.to(roomId).emit('screen-share-status', { id: socket.id, active: Boolean(active) });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId || findRoomBySocket(socket.id);
    if (!roomId) return;
    leaveRoom(roomId, socket.id);
    socket.to(roomId).emit('peer-left', { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server ouvindo na porta ${PORT}`);
});
