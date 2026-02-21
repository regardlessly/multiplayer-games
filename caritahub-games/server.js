require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || '*';

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  // Fly.io: ensure WebSocket upgrades work behind the proxy
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Rate limit static/API routes (generous; join_xiangqi is rate-limited in socket events)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// /join encodes ?room=&game= — serve the game lobby page
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

// Health endpoint
app.get('/health', (req, res) => {
  const roomManager = require('./src/rooms/roomManager');
  res.json({
    status: 'ok',
    rooms: roomManager.roomCount(),
    connections: io.engine.clientsCount
  });
});

// Socket.IO setup — room events wired in rooms module
require('./src/rooms/socketEvents')(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`caritahub-games listening on port ${PORT}`);
});

module.exports = { io };
