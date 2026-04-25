const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();

const PIECES_PER_PLAYER = 24;
const CARD_DEFINITIONS = [
  {
    code: "nutrient-basic",
    name: "初级营养",
    description: "按蛇形路线填满 1 个尚未填满的肠碎。己方肠碎得分，对方肠碎也会得分。",
    kind: "material",
    materialType: "nutrient",
    color: "red",
    amount: 1,
    copies: 4
  },
  {
    code: "nutrient-medium",
    name: "中级营养",
    description: "按蛇形路线填满 2 个尚未填满的肠碎。",
    kind: "material",
    materialType: "nutrient",
    color: "red",
    amount: 2,
    copies: 4
  },
  {
    code: "nutrient-advanced",
    name: "高级营养",
    description: "按蛇形路线填满 3 个尚未填满的肠碎。",
    kind: "material",
    materialType: "nutrient",
    color: "red",
    amount: 3,
    copies: 4
  },
  {
    code: "trash-basic",
    name: "初级垃圾",
    description: "按蛇形路线填满 1 个尚未填满的肠碎。被垃圾填满的肠碎计负分。",
    kind: "material",
    materialType: "trash",
    color: "black",
    amount: 1,
    copies: 4
  },
  {
    code: "trash-medium",
    name: "中级垃圾",
    description: "按蛇形路线填满 2 个尚未填满的肠碎。",
    kind: "material",
    materialType: "trash",
    color: "black",
    amount: 2,
    copies: 4
  },
  {
    code: "trash-advanced",
    name: "高级垃圾",
    description: "按蛇形路线填满 3 个尚未填满的肠碎。",
    kind: "material",
    materialType: "trash",
    color: "black",
    amount: 3,
    copies: 4
  },
  {
    code: "steal",
    name: "夺取",
    description: "从对手手牌中随机抽取 1 张加入你的手牌。",
    kind: "skill",
    action: "steal",
    color: "red",
    copies: 4
  },
  {
    code: "counter",
    name: "快手还击",
    description: "只能在对手回合结束后的反击时使用，抵消对手本回合打出的牌，并抽 1 张牌。",
    kind: "skill",
    action: "counter",
    color: "black",
    copies: 4
  },
  {
    code: "flip",
    name: "翻面",
    description: "选择 1 个已被填满的肠碎，改变它的所有者。",
    kind: "skill",
    action: "flip",
    color: "red",
    copies: 4
  },
  {
    code: "jam",
    name: "窜",
    description: "对手下回合不能出技能牌；你指定对手必须出营养或垃圾，若没有对应牌则不行动。",
    kind: "skill",
    action: "jam",
    color: "black",
    copies: 4
  },
  {
    code: "boost",
    name: "超绝消化",
    description: "选择 1 个已被填满的肠碎，使其营养或垃圾的数值变为 2 倍。",
    kind: "skill",
    action: "boost",
    color: "red",
    copies: 4
  },
  {
    code: "weaken",
    name: "超弱消化",
    description: "选择 1 个已被填满的肠碎，使其营养或垃圾的数值变为一半。",
    kind: "skill",
    action: "weaken",
    color: "black",
    copies: 4
  }
];

function makePath() {
  const cells = [];
  for (let row = 0; row < 7; row += 1) {
    const cols = row % 2 === 0 ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];
    for (const col of cols) {
      if (row === 6 && col === 6) continue;
      cells.push({ row, col });
    }
  }
  return cells;
}

const BOARD_PATH = makePath();

function makeDeck() {
  const cards = [];
  for (const definition of CARD_DEFINITIONS) {
    for (let copy = 0; copy < definition.copies; copy += 1) {
      cards.push({
        id: `${definition.code}-${crypto.randomUUID().slice(0, 8)}`,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        kind: definition.kind,
        materialType: definition.materialType,
        action: definition.action,
        color: definition.color,
        amount: definition.amount
      });
    }
  }
  return shuffle(cards);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makePlayer(index) {
  return {
    id: crypto.randomUUID(),
    index,
    name: `玩家 ${index + 1}`,
    hand: [],
    connected: true,
    drawnThisTurn: false,
    constraints: null
  };
}

function makeRoom() {
  const starter = Math.random() < 0.5 ? 0 : 1;
  const deck = makeDeck();
  const room = {
    id: crypto.randomBytes(3).toString("hex").toUpperCase(),
    phase: "setup",
    deck,
    players: [makePlayer(0)],
    board: BOARD_PATH.map((pos, index) => ({
      index,
      row: pos.row,
      col: pos.col,
      owner: null,
      filledBy: null,
      value: 0,
      modifier: 1
    })),
    nextPlaceIndex: 0,
    currentPlayer: starter,
    setupStarter: starter,
    reactionFor: null,
    lastAction: null,
    pendingGameOverReason: null,
    log: [`抛硬币结果：玩家 ${starter + 1} 先铺肠碎。`],
    winner: null
  };
  dealCards(room, room.players[0], 3);
  rooms.set(room.id, room);
  return room;
}

function publicState(room, playerId) {
  const viewer = room.players.find((player) => player.id === playerId);
  return {
    id: room.id,
    phase: room.phase,
    board: room.board,
    nextPlaceIndex: room.nextPlaceIndex,
    currentPlayer: room.currentPlayer,
    reactionFor: room.reactionFor,
    pendingGameOverReason: room.pendingGameOverReason,
    lastAction: room.lastAction ? {
      actor: room.lastAction.actor,
      label: room.lastAction.label
    } : null,
    winner: room.winner,
    scores: scoreRoom(room),
    pieceCounts: [countPlayerPieces(room, 0), countPlayerPieces(room, 1)],
    deckCount: room.deck.length,
    log: room.log.slice(-18),
    me: viewer ? playerView(viewer, true) : null,
    opponent: viewer ? playerView(room.players[1 - viewer.index], false) : null,
    players: room.players.map((player) => playerView(player, false))
  };
}

function playerView(player, reveal) {
  if (!player) return null;
  return {
    index: player.index,
    name: player.name,
    connected: player.connected,
    handCount: player.hand.length,
    hand: reveal ? player.hand : [],
    drawnThisTurn: player.drawnThisTurn,
    constraints: player.constraints
  };
}

function scoreRoom(room) {
  const scores = [0, 0];
  for (const cell of room.board) {
    if (cell.owner !== null && cell.filledBy !== null) {
      scores[cell.owner] += cell.value * cell.modifier;
    }
  }
  return scores.map((value) => Number(value.toFixed(2)));
}

function countPlayerPieces(room, playerIndex) {
  return room.board.filter((cell) => cell.owner === playerIndex).length;
}

function requireRoom(body) {
  const room = rooms.get(String(body.room || "").toUpperCase());
  if (!room) throw new Error("房间不存在。");
  return room;
}

function requirePlayer(room, playerId) {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw new Error("玩家身份无效，请重新进入房间。");
  return player;
}

function assertTurn(room, player) {
  if (room.currentPlayer !== player.index) throw new Error("还没轮到你。");
  if (room.reactionFor !== null) throw new Error("正在等待反击确认。");
}

function addLog(room, message) {
  room.log.push(message);
}

function dealCards(room, player, count) {
  for (let i = 0; i < count; i += 1) {
    if (room.deck.length === 0) return;
    player.hand.push(room.deck.shift());
  }
}

function advanceTurn(room) {
  room.currentPlayer = 1 - room.currentPlayer;
  const next = room.players[room.currentPlayer];
  if (next) next.drawnThisTurn = false;
}

function beginCardPhase(room) {
  room.phase = "play";
  room.currentPlayer = room.setupStarter;
  room.players.forEach((player) => {
    player.drawnThisTurn = false;
    player.constraints = null;
  });
  addLog(room, "肠碎铺满，进入抽牌与出牌阶段。");
}

function finishSetupIfPlayerEmpty(room) {
  const counts = [countPlayerPieces(room, 0), countPlayerPieces(room, 1)];
  const emptyPlayer = counts.findIndex((count) => count >= PIECES_PER_PLAYER);
  if (emptyPlayer === -1) return false;

  const otherPlayer = 1 - emptyPlayer;
  const remaining = PIECES_PER_PLAYER - counts[otherPlayer];
  for (let i = 0; i < remaining; i += 1) {
    room.board[room.nextPlaceIndex + i].owner = otherPlayer;
  }
  room.nextPlaceIndex += remaining;
  if (remaining > 0) {
    addLog(room, `玩家 ${otherPlayer + 1} 剩余 ${remaining} 个肠碎已自动铺完。`);
  }
  beginCardPhase(room);
  return true;
}

function placePieces(room, player, count) {
  if (room.phase !== "setup") throw new Error("现在不能铺肠碎。");
  assertTurn(room, player);
  if (!Number.isInteger(count) || count < 1 || count > 6) throw new Error("每次只能铺 1 到 6 个肠碎。");
  if (room.nextPlaceIndex + count > room.board.length) throw new Error("剩余格子不够。");
  const placed = countPlayerPieces(room, player.index);
  if (placed + count > PIECES_PER_PLAYER) {
    throw new Error(`你只剩 ${PIECES_PER_PLAYER - placed} 个肠碎可铺。`);
  }
  for (let i = 0; i < count; i += 1) {
    room.board[room.nextPlaceIndex + i].owner = player.index;
  }
  room.nextPlaceIndex += count;
  addLog(room, `玩家 ${player.index + 1} 铺了 ${count} 个肠碎。`);
  if (finishSetupIfPlayerEmpty(room)) {
    return;
  }
  if (room.nextPlaceIndex >= room.board.length) {
    beginCardPhase(room);
  } else {
    advanceTurn(room);
  }
}

function drawCard(room, player, silent = false) {
  if (room.phase !== "play") throw new Error("现在不能抽牌。");
  if (!silent) assertTurn(room, player);
  if (!silent && player.drawnThisTurn) throw new Error("本回合已经抽过牌。");
  if (room.deck.length > 0) {
    dealCards(room, player, 1);
    if (!silent) addLog(room, `玩家 ${player.index + 1} 抽了一张牌。`);
  } else if (!silent) {
    addLog(room, "公共牌库已空。");
  }
  if (!silent) {
    player.drawnThisTurn = true;
    skipIfNoPlayableCard(room, player);
  }
}

function cloneForUndo(room) {
  return JSON.parse(JSON.stringify({
    deck: room.deck,
    board: room.board,
    pendingGameOverReason: room.pendingGameOverReason,
    players: room.players.map((player) => ({
      hand: player.hand,
      drawnThisTurn: player.drawnThisTurn,
      constraints: player.constraints
    })),
    currentPlayer: room.currentPlayer,
    winner: room.winner
  }));
}

function restoreUndo(room, undo) {
  room.deck = undo.deck;
  room.board = undo.board;
  room.pendingGameOverReason = undo.pendingGameOverReason;
  room.players.forEach((player, index) => {
    player.hand = undo.players[index].hand;
    player.drawnThisTurn = undo.players[index].drawnThisTurn;
    player.constraints = undo.players[index].constraints;
  });
  room.currentPlayer = undo.currentPlayer;
  room.winner = undo.winner;
}

function removeCard(player, cardId) {
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index === -1) throw new Error("手牌里没有这张牌。");
  return player.hand.splice(index, 1)[0];
}

function findTargetCell(room, index, needsFilled) {
  const cell = room.board[Number(index)];
  if (!cell) throw new Error("目标格子不存在。");
  if (needsFilled && cell.filledBy === null) throw new Error("请选择已经被填满的肠碎。");
  return cell;
}

function checkConstraints(player, card) {
  const constraints = player.constraints;
  if (!constraints) return;
  if (constraints.noSkill && card.kind === "skill") throw new Error("你本回合不能出技能牌。");
  if (constraints.forceColor && card.kind === "material" && card.color !== constraints.forceColor) {
    throw new Error(`对手指定你必须出${constraints.forceColor === "red" ? "营养" : "垃圾"}。`);
  }
  if (constraints.forceColor && card.kind === "skill") {
    throw new Error("对手指定了营养或垃圾，本回合不能出技能。");
  }
}

function canActUnderConstraint(player) {
  if (!player.constraints?.forceColor) return true;
  return player.hand.some((card) => card.kind === "material" && card.color === player.constraints.forceColor);
}

function hasCounterCard(player) {
  return player.hand.some((card) => card.action === "counter");
}

function hasFilledCell(room) {
  return room.board.some((cell) => cell.filledBy !== null);
}

function hasUnfilledCell(room) {
  return room.board.some((cell) => cell.owner !== null && cell.filledBy === null);
}

function isCardPlayable(room, player, card) {
  if (player.constraints?.noSkill && card.kind === "skill") return false;
  if (player.constraints?.forceColor) {
    return card.kind === "material" && card.color === player.constraints.forceColor && hasUnfilledCell(room);
  }
  if (card.kind === "material") return hasUnfilledCell(room);
  if (card.action === "counter") return false;
  if (card.action === "steal") return room.players[1 - player.index]?.hand.length > 0;
  if (["flip", "boost", "weaken"].includes(card.action)) return hasFilledCell(room);
  if (card.action === "jam") return Boolean(room.players[1 - player.index]);
  return false;
}

function hasPlayableCard(room, player) {
  return player.hand.some((card) => isCardPlayable(room, player, card));
}

function hasRemainingMaterialCard(room) {
  return room.deck.some((card) => card.kind === "material")
    || room.players.some((player) => player.hand.some((card) => card.kind === "material"));
}

function finishGame(room, reason) {
  const scores = scoreRoom(room);
  room.phase = "ended";
  room.winner = scores[0] === scores[1] ? "draw" : (scores[0] > scores[1] ? 0 : 1);
  room.pendingGameOverReason = null;
  room.reactionFor = null;
  addLog(room, reason);
}

function offerReactionOrAdvance(room, nextPlayerIndex) {
  const nextPlayer = room.players[nextPlayerIndex];
  room.currentPlayer = nextPlayerIndex;
  if (nextPlayer) nextPlayer.drawnThisTurn = false;
  room.reactionFor = nextPlayer && hasCounterCard(nextPlayer) ? nextPlayerIndex : null;
}

function skipIfNoPlayableCard(room, player) {
  if (room.phase !== "play" || room.reactionFor !== null || !player.drawnThisTurn) return false;
  if (hasPlayableCard(room, player)) return false;
  addLog(room, `玩家 ${player.index + 1} 没有可出的牌，自动跳过回合。`);
  player.constraints = null;
  advanceTurn(room);
  return true;
}

function gameOverReason(room) {
  if (!hasRemainingMaterialCard(room)) return "最后一张资源牌已打出，游戏结束。";
  if (room.board.every((cell) => cell.owner !== null && cell.filledBy !== null)) {
    return "所有肠碎都被填满，游戏结束。";
  }
  return null;
}

function playCard(room, player, body) {
  if (room.phase !== "play") throw new Error("现在不能出牌。");
  assertTurn(room, player);
  if (!player.drawnThisTurn) throw new Error("请先抽牌，再出牌。");
  if (!hasPlayableCard(room, player)) {
    skipIfNoPlayableCard(room, player);
    return;
  }
  if (player.constraints?.forceColor && !canActUnderConstraint(player)) {
    addLog(room, `玩家 ${player.index + 1} 没有指定类型的牌，本回合无法行动。`);
    player.constraints = null;
    advanceTurn(room);
    return;
  }

  const card = removeCard(player, body.cardId);
  try {
    if (!isCardPlayable(room, player, card)) throw new Error("这张牌当前不能打出。");
    checkConstraints(player, card);
    const undo = cloneForUndo(room);
    const label = card.name;
    if (card.kind === "material") {
      playMaterial(room, player, card);
    } else {
      playSkill(room, player, card, body);
    }
    player.constraints = null;
    room.lastAction = { actor: player.index, label, undo };
    addLog(room, `玩家 ${player.index + 1} 打出 ${label}。`);
    const reason = gameOverReason(room);
    if (reason) room.pendingGameOverReason = reason;
    if (room.pendingGameOverReason && !hasCounterCard(room.players[1 - player.index])) {
      finishGame(room, room.pendingGameOverReason);
      return;
    }
    if (room.phase !== "ended") {
      offerReactionOrAdvance(room, 1 - player.index);
    }
  } catch (error) {
    player.hand.push(card);
    throw error;
  }
}

function playMaterial(room, player, card) {
  const amount = card.amount;
  const emptyOwned = room.board.filter((cell) => cell.owner !== null && cell.filledBy === null);
  if (emptyOwned.length === 0) throw new Error("没有可填满的肠碎。");
  for (const cell of emptyOwned.slice(0, amount)) {
    cell.filledBy = card.materialType;
    cell.value = card.materialType === "nutrient" ? 1 : -1;
  }
}

function playSkill(room, player, card, body) {
  const opponent = room.players[1 - player.index];
  if (card.action === "steal") {
    if (opponent.hand.length === 0) throw new Error("对手没有手牌可夺取。");
    const index = Math.floor(Math.random() * opponent.hand.length);
    player.hand.push(opponent.hand.splice(index, 1)[0]);
    return;
  }
  if (card.action === "counter") {
    throw new Error("快手还击只能在对手回合后用“反击”按钮打出。");
  }
  if (card.action === "flip") {
    const cell = findTargetCell(room, body.target, true);
    cell.owner = 1 - cell.owner;
    return;
  }
  if (card.action === "jam") {
    const forceColor = body.forceColor === "black" ? "black" : "red";
    opponent.constraints = { noSkill: true, forceColor };
    return;
  }
  if (card.action === "boost") {
    findTargetCell(room, body.target, true).modifier *= 2;
    return;
  }
  if (card.action === "weaken") {
    findTargetCell(room, body.target, true).modifier *= 0.5;
    return;
  }
  throw new Error("未知技能牌。");
}

function counter(room, player, cardId) {
  if (room.phase !== "play") throw new Error("现在不能反击。");
  if (room.reactionFor !== player.index) throw new Error("当前没有轮到你确认反击。");
  if (!room.lastAction || room.lastAction.actor === player.index) throw new Error("没有可反击的行动。");
  const card = player.hand.find((item) => item.id === cardId);
  if (!card) throw new Error("手牌里没有这张牌。");
  if (card.action !== "counter") throw new Error("只有快手还击可以反击。");
  restoreUndo(room, room.lastAction.undo);
  room.currentPlayer = player.index;
  removeCard(player, cardId);
  drawCard(room, player, true);
  addLog(room, `玩家 ${player.index + 1} 打出快手还击，抵消了 ${room.lastAction.label}，并抽一张牌。`);
  room.lastAction = null;
  room.reactionFor = null;
  const reason = gameOverReason(room);
  if (reason) finishGame(room, reason);
}

function passReaction(room, player) {
  if (room.reactionFor !== player.index) throw new Error("当前不需要你确认反击。");
  room.reactionFor = null;
  if (room.pendingGameOverReason) finishGame(room, room.pendingGameOverReason);
}

function checkGameOver(room) {
  const reason = gameOverReason(room);
  if (reason) finishGame(room, reason);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rawPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
    response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/state") {
      const room = rooms.get(String(url.searchParams.get("room") || "").toUpperCase());
      if (!room) throw new Error("房间不存在。");
      sendJson(response, 200, publicState(room, url.searchParams.get("player")));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/")) {
      const body = await readBody(request);
      if (url.pathname === "/api/create") {
        const room = makeRoom();
        sendJson(response, 200, { room: room.id, player: room.players[0].id, state: publicState(room, room.players[0].id) });
        return;
      }
      const room = requireRoom(body);
      if (url.pathname === "/api/join") {
        if (room.players[1]) throw new Error("房间已经满员。");
        room.players[1] = makePlayer(1);
        dealCards(room, room.players[1], 3);
        addLog(room, "玩家 2 加入房间。");
        sendJson(response, 200, { room: room.id, player: room.players[1].id, state: publicState(room, room.players[1].id) });
        return;
      }
      const player = requirePlayer(room, body.player);
      if (url.pathname === "/api/place") placePieces(room, player, Number(body.count));
      else if (url.pathname === "/api/draw") drawCard(room, player);
      else if (url.pathname === "/api/play") playCard(room, player, body);
      else if (url.pathname === "/api/counter") counter(room, player, body.cardId);
      else if (url.pathname === "/api/pass-reaction") passReaction(room, player);
      else throw new Error("未知操作。");
      sendJson(response, 200, { state: publicState(room, player.id) });
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`EasyGame is running at http://localhost:${PORT}`);
  });
}

module.exports = { server, rooms };
