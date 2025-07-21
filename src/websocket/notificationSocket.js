const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;
const userSockets = new Map(); // Map userId to socket IDs

function initializeWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true
    }
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error'));
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.userId} connected`);
    
    // Store the socket ID for this user
    if (!userSockets.has(socket.userId)) {
      userSockets.set(socket.userId, new Set());
    }
    userSockets.get(socket.userId).add(socket.id);
    
    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected`);
      
      // Remove the socket ID for this user
      const userSocketSet = userSockets.get(socket.userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          userSockets.delete(socket.userId);
        }
      }
    });
  });
  
  console.log('WebSocket server initialized');
}

function sendNotification(userId, notification) {
  if (!io) {
    console.error('WebSocket server not initialized');
    return;
  }
  
  const socketIds = userSockets.get(userId);
  if (socketIds && socketIds.size > 0) {
    socketIds.forEach(socketId => {
      io.to(socketId).emit('notification', notification);
    });
    console.log(`Notification sent to user ${userId}`);
  } else {
    console.log(`User ${userId} not connected, notification will be seen when they connect`);
  }
}

module.exports = {
  initializeWebSocket,
  sendNotification
};