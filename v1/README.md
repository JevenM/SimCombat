SimCombat MVP

老版本，新版本在d:\Git\SimCombat\pro下

netstat -ano | findstr :3001
tasklist | findstr 16892
taskkill /F /PID 16892

Quickstart:
1. npm install
2. npm start
3. Open http://localhost:3001/

This MVP implements:
- Node.js server with WebSocket
- Simple discrete-time simulation engine (simEngine.js)
- Browser client (client.html + client.js) drawing units on a canvas

Further work: Map integration (Mapbox/Deck.gl), PostGIS persistence, richer unit models, statistical dashboard, save/load, playback management.
