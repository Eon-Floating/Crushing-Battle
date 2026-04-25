const state = {
  room: localStorage.getItem("easygame.room") || "",
  player: localStorage.getItem("easygame.player") || "",
  data: null,
  selectedCard: null
};

const $ = (id) => document.getElementById(id);

const lobby = $("lobby");
const game = $("game");
const lobbyError = $("lobbyError");

function cardName(card) {
  return `${card.suitName}${card.rank}`;
}

function materialName(color) {
  return color === "red" ? "营养" : "垃圾";
}

async function api(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "请求失败");
  if (data.room) {
    state.room = data.room;
    state.player = data.player;
    localStorage.setItem("easygame.room", state.room);
    localStorage.setItem("easygame.player", state.player);
  }
  if (data.state) {
    state.data = data.state;
    render();
  }
  return data;
}

async function refresh() {
  if (!state.room || !state.player) return;
  try {
    const response = await fetch(`/api/state?room=${encodeURIComponent(state.room)}&player=${encodeURIComponent(state.player)}`);
    const data = await response.json();
    if (response.ok && !data.error) {
      state.data = data;
      render();
    }
  } catch {
    // Polling will try again.
  }
}

function showError(message) {
  lobbyError.textContent = message;
}

function render() {
  if (!state.data?.me) return;
  lobby.classList.add("hidden");
  game.classList.remove("hidden");
  $("roomCode").textContent = state.data.id;
  $("score0").textContent = state.data.scores[0];
  $("score1").textContent = state.data.scores[1];
  renderHeader();
  renderBoard();
  renderControls();
  renderLog();
}

function renderHeader() {
  const data = state.data;
  const me = data.me;
  const phaseText = {
    setup: "铺肠碎阶段",
    play: "抽牌出牌阶段",
    ended: "游戏结束"
  }[data.phase];
  $("phaseTitle").textContent = phaseText;
  $("identity").textContent = `你是玩家 ${me.index + 1}，牌库 ${me.deckCount} 张，对手手牌 ${data.opponent?.handCount ?? 0} 张`;
  const waitingPlayer = data.players.length < 2 ? "等待玩家 2 加入。" : "";
  const turn = data.currentPlayer === me.index ? "轮到你行动。" : `等待玩家 ${data.currentPlayer + 1}。`;
  const reaction = data.reactionFor === me.index ? `可以反击对手的 ${data.lastAction?.label || "行动"}。` : "";
  const ended = data.phase === "ended" ? winnerText(data) : "";
  $("turnText").textContent = ended || reaction || waitingPlayer || turn;
  $("constraintText").textContent = constraintText(me.constraints);
}

function winnerText(data) {
  if (data.winner === "draw") return "平局。";
  return `玩家 ${data.winner + 1} 获胜。`;
}

function constraintText(constraints) {
  if (!constraints) return "";
  const parts = [];
  if (constraints.noSkill) parts.push("不能出技能牌");
  if (constraints.forceColor) parts.push(`必须出${materialName(constraints.forceColor)}`);
  return `限制：${parts.join("，")}`;
}

function renderBoard() {
  const board = $("board");
  board.innerHTML = "";
  const byPos = new Map(state.data.board.map((cell) => [`${cell.row}-${cell.col}`, cell]));
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const cell = byPos.get(`${row}-${col}`);
      const button = document.createElement("button");
      if (!cell) {
        button.className = "cell finish";
        button.innerHTML = "<span>终点</span>";
        button.disabled = true;
      } else {
        const ownerClass = cell.owner === null ? "" : ` p${cell.owner}`;
        const filledClass = cell.filledBy ? ` filled ${cell.filledBy}` : "";
        const nextClass = state.data.phase === "setup" && cell.index === state.data.nextPlaceIndex ? " next" : "";
        button.className = `cell${ownerClass}${filledClass}${nextClass}`;
        button.dataset.index = cell.index;
        button.innerHTML = `<span class="index">${cell.index + 1}</span>${cell.modifier !== 1 ? `<span class="mod">x${cell.modifier}</span>` : ""}`;
        button.addEventListener("click", () => chooseCell(cell.index));
      }
      board.appendChild(button);
    }
  }
}

function renderControls() {
  const data = state.data;
  const myTurn = data.currentPlayer === data.me.index && data.reactionFor === null && data.phase !== "ended";
  $("setupControls").classList.toggle("hidden", data.phase !== "setup");
  $("playControls").classList.toggle("hidden", data.phase !== "play");
  document.querySelectorAll("[data-place]").forEach((button) => {
    const count = Number(button.dataset.place);
    const placed = data.pieceCounts?.[data.me.index] ?? 0;
    const remainingMine = 24 - placed;
    const remainingBoard = 48 - data.nextPlaceIndex;
    button.disabled = !myTurn || data.phase !== "setup" || data.players.length < 2 || count > remainingMine || count > remainingBoard;
  });
  $("drawCard").disabled = !myTurn || data.phase !== "play" || data.me.drawnThisTurn;
  renderHand();
  renderReaction();
}

function renderHand() {
  const hand = $("hand");
  hand.innerHTML = "";
  state.data.me.hand.forEach((card) => {
    const button = document.createElement("button");
    const kind = card.kind === "material" ? materialName(card.color) : "技能";
    button.className = `card ${card.color}${state.selectedCard === card.id ? " selected" : ""}`;
    button.innerHTML = `<strong>${card.suitName}${card.rank}</strong><span>${kind}</span>`;
    button.addEventListener("click", () => selectCard(card));
    hand.appendChild(button);
  });
}

function renderReaction() {
  const canReact = state.data.reactionFor === state.data.me.index;
  $("reactionTools").classList.toggle("hidden", !canReact);
  $("counterBtn").disabled = !state.data.me.hand.some((card) => card.color === "black" && card.rank === "J");
}

function renderLog() {
  const log = $("log");
  log.innerHTML = "";
  state.data.log.slice().reverse().forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    log.appendChild(item);
  });
}

function selectCard(card) {
  const data = state.data;
  if (data.currentPlayer !== data.me.index || data.reactionFor !== null || data.phase !== "play") return;
  state.selectedCard = card.id;
  renderHand();
  const targetTools = $("targetTools");
  const needsTarget = card.kind === "skill" && card.color === "red" && ["Q", "K"].includes(card.rank)
    || card.kind === "skill" && card.color === "black" && card.rank === "K";
  targetTools.classList.toggle("hidden", !(needsTarget || (card.color === "black" && card.rank === "Q")));
  if (card.kind === "material" || card.rank === "J") playSelected({});
}

async function chooseCell(index) {
  if (!state.selectedCard) return;
  const card = state.data.me.hand.find((item) => item.id === state.selectedCard);
  if (!card) return;
  if (card.kind === "skill" && ["Q", "K"].includes(card.rank)) {
    await playSelected({ target: index });
  }
}

async function playSelected(extra) {
  if (!state.selectedCard) return;
  try {
    await api("/api/play", { room: state.room, player: state.player, cardId: state.selectedCard, ...extra });
    state.selectedCard = null;
    $("targetTools").classList.add("hidden");
  } catch (error) {
    alert(error.message);
  }
}

document.querySelectorAll("[data-place]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await api("/api/place", { room: state.room, player: state.player, count: Number(button.dataset.place) });
    } catch (error) {
      alert(error.message);
    }
  });
});

$("createRoom").addEventListener("click", async () => {
  try {
    showError("");
    await api("/api/create");
  } catch (error) {
    showError(error.message);
  }
});

$("joinRoom").addEventListener("click", async () => {
  try {
    showError("");
    await api("/api/join", { room: $("roomInput").value.trim().toUpperCase() });
  } catch (error) {
    showError(error.message);
  }
});

$("drawCard").addEventListener("click", async () => {
  try {
    await api("/api/draw", { room: state.room, player: state.player });
  } catch (error) {
    alert(error.message);
  }
});

$("forceRed").addEventListener("click", () => playSelected({ forceColor: "red" }));
$("forceBlack").addEventListener("click", () => playSelected({ forceColor: "black" }));

$("counterBtn").addEventListener("click", async () => {
  const card = state.data.me.hand.find((item) => item.color === "black" && item.rank === "J");
  if (!card) return;
  try {
    await api("/api/counter", { room: state.room, player: state.player, cardId: card.id });
  } catch (error) {
    alert(error.message);
  }
});

$("passReaction").addEventListener("click", async () => {
  try {
    await api("/api/pass-reaction", { room: state.room, player: state.player });
  } catch (error) {
    alert(error.message);
  }
});

refresh();
setInterval(refresh, 1000);
