// Núcleo da malha (mesh) WebRTC: mantém 1 RTCPeerConnection por participante
// remoto e cuida da troca de offer/answer/ICE candidates via Socket.io.
//
// Cada participante mantém uma conexão direta com TODOS os outros
// participantes da sala (mesh completo). Isso é simples de implementar e
// funciona bem para grupos pequenos, mas o número de conexões cresce em
// O(n²) — por isso o README recomenda não passar de ~6-8 pessoas por sala.
//
// Usamos "perfect negotiation" (padrão recomendado pelo WebRTC WG) para
// evitar condições de corrida quando os dois lados tentam renegociar ao
// mesmo tempo (ex: dois participantes iniciam compartilhamento de tela em
// momentos próximos). Um dos dois lados de cada par é "polite" (definido de
// forma determinística comparando os ids de socket) e cede a vez quando há
// colisão de ofertas.
// Referência: https://developer.chrome.com/blog/perfect-negotiation

// STUN público do Google, suficiente para a maioria das redes domésticas.
// Não há servidor TURN configurado (fora do escopo deste projeto) — atrás
// de NAT/firewall simétrico restritivo a conexão P2P pode falhar. Ver
// limitações no README.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function createMeshManager({ socket, onRemoteStream, onPeerClosed }) {
  // peerId -> { pc, polite, makingOffer, ignoreOffer }
  const peers = new Map();

  // Stream "de saída": agrupa as tracks que enviamos para todo mundo (mic
  // sempre presente; track de tela adicionada/removida dinamicamente).
  // Reaproveitar o mesmo MediaStream em todas as PeerConnections faz o lado
  // remoto reconhecer que audio+tela pertencem ao mesmo participante.
  const outboundStream = new MediaStream();

  function isPolite(peerId) {
    return socket.id < peerId;
  }

  function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, polite: isPolite(peerId), makingOffer: false, ignoreOffer: false };
    peers.set(peerId, entry);

    for (const track of outboundStream.getTracks()) {
      pc.addTrack(track, outboundStream);
    }

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit('signal', {
          to: peerId,
          data: { type: 'description', description: pc.localDescription },
        });
      } catch (err) {
        console.error('[webrtc] falha ao negociar com', peerId, err);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('signal', { to: peerId, data: { type: 'candidate', candidate } });
      }
    };

    pc.ontrack = (event) => {
      onRemoteStream(peerId, event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        closePeer(peerId);
      }
    };

    return entry;
  }

  function getOrCreatePeer(peerId) {
    return peers.get(peerId) || createPeerConnection(peerId);
  }

  // Chamado para cada participante que já estava na sala quando entramos —
  // somos nós que iniciamos a conexão (onnegotiationneeded dispara sozinho
  // assim que addTrack roda dentro de createPeerConnection).
  function connectToExistingPeer(peerId) {
    getOrCreatePeer(peerId);
  }

  async function handleIncomingSignal({ from, data }) {
    const entry = getOrCreatePeer(from);
    const { pc } = entry;

    if (data.type === 'description') {
      const description = data.description;
      const offerCollision =
        description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');

      entry.ignoreOffer = !entry.polite && offerCollision;
      if (entry.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        socket.emit('signal', {
          to: from,
          data: { type: 'description', description: pc.localDescription },
        });
      }
    } else if (data.type === 'candidate') {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!entry.ignoreOffer) console.error('[webrtc] erro ao adicionar ICE candidate', err);
      }
    }
  }

  function closePeer(peerId) {
    const entry = peers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    peers.delete(peerId);
    onPeerClosed(peerId);
  }

  function closeAll() {
    for (const peerId of Array.from(peers.keys())) closePeer(peerId);
  }

  // --- controle das tracks locais enviadas para todo mundo ---

  function setMicTrack(track) {
    const oldTrack = outboundStream.getAudioTracks()[0];
    if (oldTrack) {
      outboundStream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    outboundStream.addTrack(track);
    for (const { pc } of peers.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(track);
      else pc.addTrack(track, outboundStream);
    }
  }

  function addScreenTrack(track) {
    outboundStream.addTrack(track);
    for (const { pc } of peers.values()) {
      pc.addTrack(track, outboundStream); // dispara onnegotiationneeded
    }
  }

  function removeScreenTrack() {
    const track = outboundStream.getVideoTracks()[0];
    if (!track) return;
    outboundStream.removeTrack(track);
    for (const { pc } of peers.values()) {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) pc.removeTrack(sender); // dispara onnegotiationneeded
    }
    track.stop();
  }

  return {
    connectToExistingPeer,
    handleIncomingSignal,
    closePeer,
    closeAll,
    setMicTrack,
    addScreenTrack,
    removeScreenTrack,
  };
}
