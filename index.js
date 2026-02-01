const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

const games = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [gameId, game] of games.entries()) {
    if (now - game.lastActivity > 30 * 60 * 1000) {
      games.delete(gameId);
      console.log(`Game ${gameId} deleted due to inactivity`);
    }
  }
}, 5 * 60 * 1000);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  let currentGameId = null;
  let currentPlayerName = null;

  socket.on('create_game', ({ gameId, playerName }) => {
    console.log(`Creating game ${gameId} by ${playerName}`);
    
    currentGameId = gameId;
    currentPlayerName = playerName;
    
    games.set(gameId, {
      hostId: socket.id,
      players: [{
        id: socket.id,
        name: playerName,
        isHost: true
      }],
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
    
    socket.join(gameId);
    socket.emit('game_created', { gameId, playerId: socket.id });
  });

  socket.on('join_game', ({ gameId, playerName }) => {
    console.log(`${playerName} trying to join game ${gameId}`);
    
    const game = games.get(gameId);
    
    if (!game) {
      socket.emit('game_not_found');
      return;
    }
    
    if (game.players.length >= 4) {
      socket.emit('game_full');
      return;
    }
    
    if (game.players.find(p => p.name === playerName)) {
      socket.emit('error', { message: 'Name bereits vergeben' });
      return;
    }
    
    currentGameId = gameId;
    currentPlayerName = playerName;
    
    const newPlayer = {
      id: socket.id,
      name: playerName,
      isHost: false
    };
    
    game.players.push(newPlayer);
    game.lastActivity = Date.now();
    
    socket.join(gameId);
    
    socket.emit('joined_game', { 
      gameId, 
      playerId: socket.id,
      players: game.players 
    });
    
    socket.to(gameId).emit('player_joined', {
      playerName,
      playerId: socket.id,
      players: game.players
    });
  });

  socket.on('start_game', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game) return;
    
    if (game.hostId !== socket.id) {
      socket.emit('error', { message: 'Nur der Host kann das Spiel starten' });
      return;
    }
    
    game.lastActivity = Date.now();
    
    io.to(gameId).emit('game_started', {
      startedBy: socket.id,
      players: game.players
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    if (currentGameId) {
      const game = games.get(currentGameId);
      if (game) {
        game.players = game.players.filter(p => p.id !== socket.id);
        
        if (game.hostId === socket.id && game.players.length > 0) {
          game.hostId = game.players[0].id;
          game.players[0].isHost = true;
        }
        
        socket.to(currentGameId).emit('player_left', {
          playerId: socket.id,
          playerName: currentPlayerName,
          players: game.players
        });
        
        if (game.players.length === 0) {
          games.delete(currentGameId);
        }
      }
    }
  });
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Liar\'s Deck Server läuft!',
    activeGames: games.size
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
