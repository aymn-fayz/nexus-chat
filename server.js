const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use(express.json());

// File Upload Endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size
  });
});

// In-Memory State (Replace with Redis/PostgreSQL in multi-node production)
const connectedUsers = new Map(); // socket.id -> { id, username, avatar }

io.on('connection', (socket) => {
  console.log(`[Socket Connected]: ${socket.id}`);

  // 1. User Registration & Presence
  socket.on('register', (username) => {
    const user = {
      id: socket.id,
      username: username.trim() || `User_${socket.id.slice(0, 4)}`,
      avatar: username.trim().charAt(0).toUpperCase() || 'U',
      online: true
    };
    connectedUsers.set(socket.id, user);
    io.emit('users_update', Array.from(connectedUsers.values()));
  });

  // 2. Direct & Room Messaging
  socket.on('send_message', (data) => {
    const sender = connectedUsers.get(socket.id);
    if (!sender) return;

    const messagePayload = {
      id: data.id,
      senderId: socket.id,
      senderName: sender.username,
      recipientId: data.recipientId, // 'global' or specific socket.id
      text: data.text || '',
      file: data.file || null,
      timestamp: new Date().toISOString(),
      status: 'delivered'
    };

    if (data.recipientId === 'global') {
      io.emit('receive_message', messagePayload);
    } else {
      // Send to recipient and echo back to sender
      io.to(data.recipientId).emit('receive_message', messagePayload);
      socket.emit('receive_message', messagePayload);
    }
  });

  // 3. Read Receipts
  socket.on('message_read', ({ messageId, senderId, readerId }) => {
    if (senderId && senderId !== readerId) {
      io.to(senderId).emit('message_status_update', {
        messageId,
        status: 'read'
      });
    }
  });

  // 4. Typing Indicators
  socket.on('typing', ({ recipientId, isTyping }) => {
    const sender = connectedUsers.get(socket.id);
    if (!sender) return;

    const payload = {
      senderId: socket.id,
      senderName: sender.username,
      recipientId,
      isTyping
    };

    if (recipientId === 'global') {
      socket.broadcast.emit('user_typing', payload);
    } else {
      io.to(recipientId).emit('user_typing', payload);
    }
  });

  // 5. WebRTC Signaling (Offer, Answer, ICE Candidates, Hangup)
  socket.on('webrtc_offer', ({ targetId, offer, callType }) => {
    const caller = connectedUsers.get(socket.id);
    io.to(targetId).emit('webrtc_offer', {
      callerId: socket.id,
      callerName: caller ? caller.username : 'Unknown',
      offer,
      callType
    });
  });

  socket.on('webrtc_answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc_answer', {
      answererId: socket.id,
      answer
    });
  });

  socket.on('webrtc_ice_candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc_ice_candidate', {
      senderId: socket.id,
      candidate
    });
  });

  socket.on('webrtc_end_call', ({ targetId }) => {
    io.to(targetId).emit('webrtc_end_call', {
      senderId: socket.id
    });
  });

  // 6. Disconnection Handling
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected]: ${socket.id}`);
    connectedUsers.delete(socket.id);
    io.emit('users_update', Array.from(connectedUsers.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});