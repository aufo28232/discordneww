// Estado em memoria das salas. Suficiente aqui porque o servidor nao guarda
// nenhuma midia nem historico - so precisa saber "quem esta em qual sala"
// para poder repassar (relay) as mensagens de sinalizacao WebRTC entre eles.
// Se o processo reiniciar, as salas somem - os clientes conectados percebem
// via "disconnect" e podem tentar reentrar.

const rooms = new Map(); // roomId -> Map(socketId -> { nickname })

function joinRoom(roomId, socketId, nickname) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  const room = rooms.get(roomId);
  room.set(socketId, { nickname, sharingScreen: false });
  return room;
}

function leaveRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(socketId);
  if (room.size === 0) {
    rooms.delete(roomId);
  }
}

function getPeers(roomId, excludeSocketId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const peers = [];
  for (const [id, info] of room.entries()) {
    if (id !== excludeSocketId) {
      peers.push({ id, nickname: info.nickname, sharingScreen: info.sharingScreen });
    }
  }
  return peers;
}

function setSharingScreen(roomId, socketId, active) {
  const room = rooms.get(roomId);
  if (!room || !room.has(socketId)) return;
  room.get(socketId).sharingScreen = active;
}

// Encontra em qual sala um socket esta (usado no evento "disconnect", que
// nao carrega o roomId explicitamente).
function findRoomBySocket(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.has(socketId)) return roomId;
  }
  return null;
}

module.exports = {
  joinRoom,
  leaveRoom,
  getPeers,
  setSharingScreen,
  findRoomBySocket,
};
