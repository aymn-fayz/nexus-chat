// Configure Server URL (Automatically uses window.location on Web/Electron; update IP for mobile Capacitor builds)
const SERVER_URL = window.location.origin.startsWith('http')
  ? window.location.origin
  : 'http://localhost:3000';

const socket = io(SERVER_URL);

// Application State
const state = {
  currentUser: null,
  activeChatId: 'global', // 'global' or target user's socket.id
  users: [],
  messages: { global: [] }, // Keyed by chatId
  selectedFile: null,
  typingTimeout: null,
  // WebRTC State
  peerConnection: null,
  localStream: null,
  remotePeerId: null,
  incomingOffer: null,
  callType: 'video',
  micEnabled: true,
  camEnabled: true
};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// DOM References
const dom = {
  authModal: document.getElementById('auth-modal'),
  authForm: document.getElementById('auth-form'),
  usernameInput: document.getElementById('username-input'),
  appContainer: document.getElementById('app-container'),
  myAvatar: document.getElementById('my-avatar'),
  myUsername: document.getElementById('my-username'),
  themeToggle: document.getElementById('theme-toggle'),
  contactSearch: document.getElementById('contact-search'),
  contactList: document.getElementById('contact-list'),
  mobileBackBtn: document.getElementById('mobile-back-btn'),
  activeChatAvatar: document.getElementById('active-chat-avatar'),
  activeChatName: document.getElementById('active-chat-name'),
  activeChatStatus: document.getElementById('active-chat-status'),
  callControls: document.getElementById('call-controls'),
  audioCallBtn: document.getElementById('audio-call-btn'),
  videoCallBtn: document.getElementById('video-call-btn'),
  messagesContainer: document.getElementById('messages-container'),
  filePreviewBar: document.getElementById('file-preview-bar'),
  filePreviewContent: document.getElementById('file-preview-content'),
  cancelFileBtn: document.getElementById('cancel-file-btn'),
  fileInput: document.getElementById('file-input'),
  attachBtn: document.getElementById('attach-btn'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  // Call DOM
  callModal: document.getElementById('call-modal'),
  callPeerName: document.getElementById('call-peer-name'),
  callStatusText: document.getElementById('call-status-text'),
  remoteVideo: document.getElementById('remote-video'),
  localVideo: document.getElementById('local-video'),
  incomingCallActions: document.getElementById('incoming-call-actions'),
  activeCallActions: document.getElementById('active-call-actions'),
  acceptCallBtn: document.getElementById('accept-call-btn'),
  rejectCallBtn: document.getElementById('reject-call-btn'),
  toggleMicBtn: document.getElementById('toggle-mic-btn'),
  toggleCamBtn: document.getElementById('toggle-cam-btn'),
  endCallBtn: document.getElementById('end-call-btn')
};

// ==========================================
// 1. INITIALIZATION & THEME
// ==========================================
dom.authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = dom.usernameInput.value.trim();
  if (!username) return;

  state.currentUser = username;
  dom.myUsername.textContent = username;
  dom.myAvatar.textContent = username.charAt(0).toUpperCase();
  dom.authModal.classList.remove('active');

  socket.emit('register', username);
});

dom.themeToggle.addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});

// ==========================================
// 2. CONTACTS & NAVIGATION
// ==========================================
socket.on('users_update', (users) => {
  state.users = users.filter((u) => u.id !== socket.id);
  renderContacts();
});

dom.contactSearch.addEventListener('input', () => renderContacts());

function renderContacts() {
  const query = dom.contactSearch.value.toLowerCase();
  const globalActive = state.activeChatId === 'global' ? 'active' : '';

  let html = `
    <div class="contact-item ${globalActive}" data-id="global">
      <div class="avatar global-avatar">#</div>
      <div class="contact-info">
        <div class="contact-top">
          <span class="contact-name">Global Lobby</span>
          <span class="contact-time">Public</span>
        </div>
        <p class="contact-preview">Broadcast channel for all online users</p>
      </div>
    </div>
  `;

  state.users
    .filter((u) => u.username.toLowerCase().includes(query))
    .forEach((user) => {
      const isActive = state.activeChatId === user.id ? 'active' : '';
      const chatHistory = state.messages[user.id] || [];
      const lastMsg = chatHistory[chatHistory.length - 1];
      const preview = lastMsg
        ? lastMsg.text || `📎 ${lastMsg.file?.originalName}`
        : 'Click to start messaging';

      html += `
        <div class="contact-item ${isActive}" data-id="${user.id}">
          <div class="avatar">${user.avatar}</div>
          <div class="contact-info">
            <div class="contact-top">
              <span class="contact-name">${escapeHtml(user.username)}</span>
              <span class="contact-time" style="color: var(--accent)">Online</span>
            </div>
            <p class="contact-preview">${escapeHtml(preview)}</p>
          </div>
        </div>
      `;
    });

  dom.contactList.innerHTML = html;

  document.querySelectorAll('.contact-item').forEach((item) => {
    item.addEventListener('click', () => selectChat(item.dataset.id));
  });
}

function selectChat(chatId) {
  state.activeChatId = chatId;
  dom.appContainer.classList.add('chat-open');

  if (chatId === 'global') {
    dom.activeChatAvatar.textContent = '#';
    dom.activeChatAvatar.classList.add('global-avatar');
    dom.activeChatName.textContent = 'Global Lobby';
    dom.activeChatStatus.textContent = 'Everyone online';
    dom.callControls.classList.add('hidden');
  } else {
    const user = state.users.find((u) => u.id === chatId);
    if (user) {
      dom.activeChatAvatar.textContent = user.avatar;
      dom.activeChatAvatar.classList.remove('global-avatar');
      dom.activeChatName.textContent = user.username;
      dom.activeChatStatus.textContent = 'Online';
      dom.callControls.classList.remove('hidden');
    }
  }

  renderContacts();
  renderMessages();
}

dom.mobileBackBtn.addEventListener('click', () => {
  dom.appContainer.classList.remove('chat-open');
});

// ==========================================
// 3. MESSAGING, MEDIA UPLOADS & RECEIPTS
// ==========================================
dom.attachBtn.addEventListener('click', () => dom.fileInput.click());

dom.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.selectedFile = file;

  dom.filePreviewBar.classList.remove('hidden');
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    dom.filePreviewContent.innerHTML = `<img src="${url}" alt="Preview"/><span>${escapeHtml(file.name)}</span>`;
  } else {
    dom.filePreviewContent.innerHTML = `<span>📄 ${escapeHtml(file.name)} (${(file.size / 1024).toFixed(1)} KB)</span>`;
  }
});

dom.cancelFileBtn.addEventListener('click', clearFileSelection);

function clearFileSelection() {
  state.selectedFile = null;
  dom.fileInput.value = '';
  dom.filePreviewBar.classList.add('hidden');
  dom.filePreviewContent.innerHTML = '';
}

dom.sendBtn.addEventListener('click', handleSendMessage);
dom.messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSendMessage();
});

async function handleSendMessage() {
  const text = dom.messageInput.value.trim();
  if (!text && !state.selectedFile) return;

  let uploadedFileMeta = null;

  if (state.selectedFile) {
    const formData = new FormData();
    formData.append('file', state.selectedFile);

    try {
      dom.sendBtn.disabled = true;
      const response = await fetch(`${SERVER_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Upload failed');
      uploadedFileMeta = await response.json();
    } catch (err) {
      alert('Failed to upload file. Please try again.');
      dom.sendBtn.disabled = false;
      return;
    } finally {
      dom.sendBtn.disabled = false;
    }
  }

  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  socket.emit('send_message', {
    id: msgId,
    recipientId: state.activeChatId,
    text,
    file: uploadedFileMeta
  });

  socket.emit('typing', { recipientId: state.activeChatId, isTyping: false });
  dom.messageInput.value = '';
  clearFileSelection();
}

socket.on('receive_message', (msg) => {
  const conversationKey =
    msg.recipientId === 'global'
      ? 'global'
      : msg.senderId === socket.id
      ? msg.recipientId
      : msg.senderId;

  if (!state.messages[conversationKey]) {
    state.messages[conversationKey] = [];
  }
  state.messages[conversationKey].push(msg);

  // Send read receipt if chat is open and message is incoming
  if (msg.senderId !== socket.id && state.activeChatId === conversationKey) {
    socket.emit('message_read', {
      messageId: msg.id,
      senderId: msg.senderId,
      readerId: socket.id
    });
  }

  renderContacts();
  if (state.activeChatId === conversationKey) {
    renderMessages();
  }
});

socket.on('message_status_update', ({ messageId, status }) => {
  Object.values(state.messages).forEach((msgList) => {
    const target = msgList.find((m) => m.id === messageId);
    if (target) target.status = status;
  });
  renderMessages();
});

function renderMessages() {
  const msgs = state.messages[state.activeChatId] || [];
  dom.messagesContainer.innerHTML = msgs
    .map((msg) => {
      const isOutgoing = msg.senderId === socket.id;
      const time = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      let mediaHtml = '';
      if (msg.file) {
        const fullUrl = `${SERVER_URL}${msg.file.url}`;
        if (msg.file.mimeType.startsWith('image/')) {
          mediaHtml = `<div class="msg-media"><img src="${fullUrl}" alt="${escapeHtml(msg.file.originalName)}" loading="lazy"/></div>`;
        } else if (msg.file.mimeType.startsWith('video/')) {
          mediaHtml = `<div class="msg-media"><video src="${fullUrl}" controls></video></div>`;
        } else {
          mediaHtml = `<a class="msg-doc" href="${fullUrl}" target="_blank" download="${escapeHtml(msg.file.originalName)}">📄 ${escapeHtml(msg.file.originalName)}</a>`;
        }
      }

      const ticksHtml = isOutgoing
        ? `<span class="tick-icon ${msg.status === 'read' ? 'read' : ''}">✓✓</span>`
        : '';

      const senderLabel =
        !isOutgoing && state.activeChatId === 'global'
          ? `<div class="msg-sender">${escapeHtml(msg.senderName)}</div>`
          : '';

      return `
        <div class="message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}">
          ${senderLabel}
          ${mediaHtml}
          ${msg.text ? `<div class="msg-text">${escapeHtml(msg.text)}</div>` : ''}
          <div class="msg-meta">
            <span>${time}</span>
            ${ticksHtml}
          </div>
        </div>
      `;
    })
    .join('');

  dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
}

// ==========================================
// 4. TYPING INDICATORS
// ==========================================
dom.messageInput.addEventListener('input', () => {
  socket.emit('typing', { recipientId: state.activeChatId, isTyping: true });
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    socket.emit('typing', { recipientId: state.activeChatId, isTyping: false });
  }, 1500);
});

socket.on('user_typing', ({ senderId, senderName, recipientId, isTyping }) => {
  const isRelevant =
    (recipientId === 'global' && state.activeChatId === 'global') ||
    (recipientId === socket.id && state.activeChatId === senderId);

  if (!isRelevant) return;

  if (isTyping) {
    dom.activeChatStatus.textContent = `${senderName} is typing...`;
    dom.activeChatStatus.classList.add('typing-active');
  } else {
    dom.activeChatStatus.textContent =
      state.activeChatId === 'global' ? 'Everyone online' : 'Online';
    dom.activeChatStatus.classList.remove('typing-active');
  }
});

// ==========================================
// 5. WEBRTC AUDIO & VIDEO CALLING
// ==========================================
dom.audioCallBtn.addEventListener('click', () => initiateCall('audio'));
dom.videoCallBtn.addEventListener('click', () => initiateCall('video'));

async function initiateCall(callType) {
  if (state.activeChatId === 'global') return;

  state.remotePeerId = state.activeChatId;
  state.callType = callType;
  const peer = state.users.find((u) => u.id === state.remotePeerId);

  openCallModal(peer ? peer.username : 'User', 'Calling...', false);

  try {
    await setupLocalMedia(callType);
    createPeerConnection();

    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);

    socket.emit('webrtc_offer', {
      targetId: state.remotePeerId,
      offer,
      callType
    });
  } catch (err) {
    console.error('WebRTC Offer Error:', err);
    closeCallModal();
  }
}

socket.on('webrtc_offer', async ({ callerId, callerName, offer, callType }) => {
  state.remotePeerId = callerId;
  state.incomingOffer = offer;
  state.callType = callType;

  openCallModal(callerName, `Incoming ${callType} call...`, true);
});

dom.acceptCallBtn.addEventListener('click', async () => {
  dom.incomingCallActions.classList.add('hidden');
  dom.activeCallActions.classList.remove('hidden');
  dom.callStatusText.textContent = 'Connected';

  try {
    await setupLocalMedia(state.callType);
    createPeerConnection();

    await state.peerConnection.setRemoteDescription(
      new RTCSessionDescription(state.incomingOffer)
    );
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);

    socket.emit('webrtc_answer', {
      targetId: state.remotePeerId,
      answer
    });
  } catch (err) {
    console.error('WebRTC Answer Error:', err);
    endCall();
  }
});

dom.rejectCallBtn.addEventListener('click', endCall);
dom.endCallBtn.addEventListener('click', endCall);

socket.on('webrtc_answer', async ({ answer }) => {
  dom.callStatusText.textContent = 'Connected';
  if (state.peerConnection) {
    await state.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
  }
});

socket.on('webrtc_ice_candidate', async ({ candidate }) => {
  if (state.peerConnection && candidate) {
    try {
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});

socket.on('webrtc_end_call', () => {
  closeCallModal();
});

async function setupLocalMedia(callType) {
  const constraints = {
    audio: true,
    video: callType === 'video'
  };
  state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  dom.localVideo.srcObject = state.localStream;
  dom.localVideo.style.display = callType === 'video' ? 'block' : 'none';
}

function createPeerConnection() {
  state.peerConnection = new RTCPeerConnection(rtcConfig);

  state.localStream.getTracks().forEach((track) => {
    state.peerConnection.addTrack(track, state.localStream);
  });

  state.peerConnection.ontrack = (event) => {
    dom.remoteVideo.srcObject = event.streams[0];
  };

  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate && state.remotePeerId) {
      socket.emit('webrtc_ice_candidate', {
        targetId: state.remotePeerId,
        candidate: event.candidate
      });
    }
  };
}

dom.toggleMicBtn.addEventListener('click', () => {
  if (!state.localStream) return;
  state.micEnabled = !state.micEnabled;
  state.localStream.getAudioTracks().forEach((t) => (t.enabled = state.micEnabled));
  dom.toggleMicBtn.textContent = state.micEnabled ? 'Mic On' : 'Mic Muted';
});

dom.toggleCamBtn.addEventListener('click', () => {
  if (!state.localStream) return;
  state.camEnabled = !state.camEnabled;
  state.localStream.getVideoTracks().forEach((t) => (t.enabled = state.camEnabled));
  dom.toggleCamBtn.textContent = state.camEnabled ? 'Cam On' : 'Cam Off';
});

function endCall() {
  if (state.remotePeerId) {
    socket.emit('webrtc_end_call', { targetId: state.remotePeerId });
  }
  closeCallModal();
}

function openCallModal(peerName, statusText, isIncoming) {
  dom.callPeerName.textContent = peerName;
  dom.callStatusText.textContent = statusText;
  dom.callModal.classList.add('active');

  if (isIncoming) {
    dom.incomingCallActions.classList.remove('hidden');
    dom.activeCallActions.classList.add('hidden');
  } else {
    dom.incomingCallActions.classList.add('hidden');
    dom.activeCallActions.classList.remove('hidden');
  }
}

function closeCallModal() {
  dom.callModal.classList.remove('active');
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
  }
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  dom.remoteVideo.srcObject = null;
  dom.localVideo.srcObject = null;
  state.remotePeerId = null;
  state.incomingOffer = null;
}

// XSS Prevention Utility
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}