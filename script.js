const modeMenu = document.getElementById('mode-menu');
const sizeMenu = document.getElementById('size-menu');
const canvas = document.getElementById('maze-canvas');
const uiOverlay = document.getElementById('ui-overlay');
const botSpeedControl = document.getElementById('bot-speed-control');
const botSpeedSlider = document.getElementById('bot-speed-slider');
const botSpeedValue = document.getElementById('bot-speed-value');
const ctx = canvas.getContext('2d');

const SIZES = {
    "Small": { width: 20, height: 15, cellSize: 35 },
    "Medium": { width: 32, height: 24, cellSize: 25 },
    "Large": { width: 50, height: 40, cellSize: 16 },
};
const COLORS = {
    BACKGROUND: "#2a2a2a", MAZE: "#e0e0e0", WALK: "#3264c8", WALL: "#0a0a0a",
    PLAYER1: "#3c78ff", PLAYER2: "#dc3232", FINISH: "#32c832",
};

// states
let gameState = 'MODE_SELECTION';
let gameMode = null; // '1P' or '2P'
let gameConfig = {};
let grid = [], unvisited = [], path = [];
let players = { p1: null, p2: null };
let finishCell = null, winner = null;
let animationFrameId, botMoveInterval = null;
let botPathMap = null;
let botSpeed = 1000; // default speed
let currentSize = null

class Cell {
    constructor(x, y) { this.x = x; this.y = y; this.isPassage = false; this.walls = { top: true, right: true, bottom: true, left: true }; }
    draw(color, cellSize) {
        const xPos = this.x * cellSize, yPos = this.y * cellSize;
        ctx.fillStyle = color;
        ctx.fillRect(xPos, yPos, cellSize, cellSize);
        ctx.strokeStyle = COLORS.WALL;
        ctx.lineWidth = 2;
        if (this.walls.top) { ctx.beginPath(); ctx.moveTo(xPos, yPos); ctx.lineTo(xPos + cellSize, yPos); ctx.stroke(); }
        if (this.walls.right) { ctx.beginPath(); ctx.moveTo(xPos + cellSize, yPos); ctx.lineTo(xPos + cellSize, yPos + cellSize); ctx.stroke(); }
        if (this.walls.bottom) { ctx.beginPath(); ctx.moveTo(xPos + cellSize, yPos + cellSize); ctx.lineTo(xPos, yPos + cellSize); ctx.stroke(); }
        if (this.walls.left) { ctx.beginPath(); ctx.moveTo(xPos, yPos + cellSize); ctx.lineTo(xPos, yPos); ctx.stroke(); }
    }
}

function getNeighbors(cell) {
    const neighbors = [];
    const { gridWidth, gridHeight } = gameConfig;
    if (cell.y > 0) neighbors.push(grid[cell.x][cell.y - 1]);
    if (cell.x < gridWidth - 1) neighbors.push(grid[cell.x + 1][cell.y]);
    if (cell.y < gridHeight - 1) neighbors.push(grid[cell.x][cell.y + 1]);
    if (cell.x > 0) neighbors.push(grid[cell.x - 1][cell.y]);
    return neighbors;
}

function removeWalls(current, next) {
    const dx = current.x - next.x; const dy = current.y - next.y;
    if (dx === 1) { current.walls.left = false; next.walls.right = false; }
    else if (dx === -1) { current.walls.right = false; next.walls.left = false; }
    else if (dy === 1) { current.walls.top = false; next.walls.bottom = false; }
    else if (dy === -1) { current.walls.bottom = false; next.walls.top = false; }
}

function calculateAllDistances(startNode) {
    const distances = new Map([[startNode, 0]]);
    const queue = [startNode];
    while (queue.length > 0) {
        const currentNode = queue.shift();
        for (const [direction, isWall] of Object.entries(currentNode.walls)) {
            if (!isWall) {
                let nx = currentNode.x, ny = currentNode.y;
                if (direction === 'top') ny--; else if (direction === 'bottom') ny++;
                else if (direction === 'left') nx--; else if (direction === 'right') nx++;
                const neighbor = grid[nx][ny];
                if (!distances.has(neighbor)) { distances.set(neighbor, distances.get(currentNode) + 1); queue.push(neighbor); }
            }
        }
    }
    return distances;
}

function generateBotPath(targetCell) {
    const path = new Map();
    const queue = [targetCell];
    const visited = new Set([targetCell]);
    while (queue.length > 0) {
        const current = queue.shift();
        for (const [direction, isWall] of Object.entries(current.walls)) {
            if (!isWall) {
                let nx = current.x, ny = current.y;
                if (direction === 'top') ny--; else if (direction === 'bottom') ny++;
                else if (direction === 'left') nx--; else if (direction === 'right') nx++;
                const neighbor = grid[nx][ny];
                if (!visited.has(neighbor)) { visited.add(neighbor); path.set(neighbor, current); queue.push(neighbor); }
            }
        }
    }
    return path;
}

function findStartPoints() {
    const distancesFromFinish = calculateAllDistances(finishCell);
    let nodeA = [...distancesFromFinish.entries()].reduce((a, b) => a[1] > b[1] ? a : b)[0];
    const distancesFromNodeA = calculateAllDistances(nodeA);
    const mazeDiameter = Math.max(...[...distancesFromNodeA.values()]);
    const cellsByDist = new Map();
    for (const [cell, dist] of distancesFromFinish.entries()) {
        if (!cellsByDist.has(dist)) cellsByDist.set(dist, []);
        cellsByDist.get(dist).push(cell);
    }
    const maxDist = Math.max(...[...cellsByDist.keys()]);
    for (let d = maxDist; d >= 0; d--) {
        const candidates = cellsByDist.get(d) || [];
        if (candidates.length < 2) continue;
        candidates.sort(() => 0.5 - Math.random());
        for (const p1 of candidates) {
            const distsFromP1 = calculateAllDistances(p1);
            for (const p2 of candidates) {
                if (p1 === p2) continue;
                if ((distsFromP1.get(p2) || 0) >= mazeDiameter / 2) { players.p1 = p1; players.p2 = p2; return; }
            }
        }
    }
    players.p1 = cellsByDist.get(maxDist)[0];
    players.p2 = cellsByDist.get(maxDist > 0 ? maxDist - 1 : 0)[0];
}

function moveBot() {
    if (gameState !== 'PLAYING_1P') return;
    const currentPos = players.p2;
    if (currentPos === finishCell) return;
    const nextMove = botPathMap.get(currentPos);
    if (nextMove) {
        players.p2 = nextMove;
        if (players.p2 === finishCell) {
            winner = "The Bot";
            changeState('GAME_OVER');
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { cellSize } = gameConfig;
    for (const row of grid) {
        for (const cell of row) {
            cell.draw(cell.isPassage ? COLORS.MAZE : COLORS.BACKGROUND, cellSize);
        }
    }
    if (gameState === 'GENERATING') {
        path.forEach(cell => cell.draw(COLORS.WALK, cellSize));
    } else if (gameState.startsWith('PLAYING') || gameState === 'GAME_OVER') {
        finishCell.draw(COLORS.FINISH, cellSize);
        players.p1.draw(COLORS.PLAYER1, cellSize);
        players.p2.draw(COLORS.PLAYER2, cellSize);
    }
}

function updateMessage(message = "") { 
    uiOverlay.innerHTML = `<div style="font-size: 0.8em;">${message}</div>`; 
}

function setupGame(config) {
    gameConfig = config;
    canvas.width = config.width * config.cellSize;
    canvas.height = config.height * config.cellSize;
    gameConfig.gridWidth = config.width;
    gameConfig.gridHeight = config.height;
    grid = Array.from({ length: config.width }, (_, x) => Array.from({ length: config.height }, (_, y) => new Cell(x, y)));
    unvisited = grid.flat();
    path = []; players = { p1: null, p2: null }; finishCell = null; winner = null;
    sizeMenu.style.display = 'none';
    canvas.style.display = 'block';
    changeState('PICKING_START');
}

function changeState(newState) {
    gameState = newState;
    if (botMoveInterval) clearInterval(botMoveInterval);

    if (gameState === 'PICKING_START') {
        updateMessage("Click a cell to set the FINISH line");
    } else if (gameState === 'PLAYING_1P') {
        updateMessage("Race the Bot! (WASD)");
        botPathMap = generateBotPath(finishCell);
        botMoveInterval = setInterval(moveBot, botSpeed);
    } else if (gameState === 'PLAYING_2P') {
        updateMessage("Race! P1: WASD, P2: Arrows");
    } else {
        updateMessage("");
    }
}

function resetToMenu() {
    cancelAnimationFrame(animationFrameId);
    if (botMoveInterval) clearInterval(botMoveInterval);
    canvas.style.display = 'none';
    sizeMenu.style.display = 'none';
    modeMenu.style.display = 'block';
    updateMessage('');
    gameState = 'MODE_SELECTION';
}

function resetMode() {
    setupGame(SIZES[currentSize]);
    gameLoop();
}

function gameLoop() {
    if (gameState === 'GENERATING') {
        do {
            if (unvisited.length > 0) {
                if (path.length === 0) { path.push(unvisited[Math.floor(Math.random() * unvisited.length)]); }
                const current = path[path.length - 1]; const neighbors = getNeighbors(current);
                const next = neighbors[Math.floor(Math.random() * neighbors.length)];
                const pathIndex = path.indexOf(next);
                if (pathIndex !== -1) { path.length = pathIndex + 1; } else { path.push(next); }
                if (next.isPassage) {
                    for (let j = 0; j < path.length - 1; j++) {
                        removeWalls(path[j], path[j + 1]); path[j].isPassage = true;
                        const unvisitedIndex = unvisited.indexOf(path[j]);
                        if (unvisitedIndex !== -1) unvisited.splice(unvisitedIndex, 1);
                    }
                    path = [];
                }
            } else {
                findStartPoints();
                changeState(gameMode === '1P' ? 'PLAYING_1P' : 'PLAYING_2P');
                break;
            }
        } while (path.length > 0);
    }
    draw();
    if (gameState === 'GAME_OVER') {
        updateMessage(`${winner} Wins! Space->menu, r->restart`);
        cancelAnimationFrame(animationFrameId);
    } else {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

modeMenu.addEventListener('click', (e) => {
    if (e.target.classList.contains('menu-button')) {
        gameMode = e.target.dataset.mode;
        modeMenu.style.display = 'none';
        sizeMenu.style.display = 'block';
        botSpeedControl.style.display = (gameMode === '1P') ? 'block' : 'none';
        gameState = 'SIZE_SELECTION';
    }
});

sizeMenu.addEventListener('click', (e) => {
    if (e.target.classList.contains('menu-button')) {
        currentSize = e.target.dataset.size;
        setupGame(SIZES[currentSize]);
        gameLoop();
    }
});

botSpeedSlider.addEventListener('input', (e) => {
    botSpeed = parseInt(e.target.value);
    botSpeedValue.textContent = `${(botSpeed / 1000).toFixed(2)} s / move`;
});

canvas.addEventListener('click', (e) => {
    if (gameState !== 'PICKING_START') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const gridX = Math.floor(x / gameConfig.cellSize), gridY = Math.floor(y / gameConfig.cellSize);
    finishCell = grid[gridX][gridY];
    finishCell.isPassage = true;
    unvisited.splice(unvisited.indexOf(finishCell), 1);
    changeState('GENERATING');
});

window.addEventListener('keydown', (e) => {
    if (gameState === 'GAME_OVER' && e.key === ' ') {
        resetToMenu();
        return;
    }
    if (gameState === 'GAME_OVER' && e.key === 'r') {
        resetMode();
        return;
    }
    if (!gameState.startsWith('PLAYING')) return;
    const { p1, p2 } = players;
    if (e.key === 'w' && !p1.walls.top) players.p1 = grid[p1.x][p1.y - 1];
    else if (e.key === 's' && !p1.walls.bottom) players.p1 = grid[p1.x][p1.y + 1];
    else if (e.key === 'a' && !p1.walls.left) players.p1 = grid[p1.x - 1][p1.y];
    else if (e.key === 'd' && !p1.walls.right) players.p1 = grid[p1.x + 1][p1.y];
    if (gameMode === '2P') {
        if (e.key === 'ArrowUp' && !p2.walls.top) players.p2 = grid[p2.x][p2.y - 1];
        else if (e.key === 'ArrowDown' && !p2.walls.bottom) players.p2 = grid[p2.x][p2.y + 1];
        else if (e.key === 'ArrowLeft' && !p2.walls.left) players.p2 = grid[p2.x - 1][p2.y];
        else if (e.key === 'ArrowRight' && !p2.walls.right) players.p2 = grid[p2.x + 1][p2.y];
    }
    if (players.p1 === finishCell) { winner = gameMode === '1P' ? 'Player' : 'Player 1'; changeState('GAME_OVER'); }
    if (gameMode === '2P' && players.p2 === finishCell) { winner = 'Player 2'; changeState('GAME_OVER'); }
});