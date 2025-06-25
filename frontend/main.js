const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#222',
  parent: 'game',
  scene: {
    preload,
    create,
    update
  }
};

function preload() {}
function create() {
  this.add.text(300, 280, 'Clash Clone', { font: '32px Arial', fill: '#fff' });
}
function update() {}

const game = new Phaser.Game(config);

// --- SOCKET.IO ---
const SERVER_URL = 'http://localhost:3000'; // поменяешь на свой сервер при деплое
const socket = io(SERVER_URL);

let playerProfile = JSON.parse(localStorage.getItem('playerProfile'));
if (!playerProfile) {
  playerProfile = {
    name: 'Player' + Math.floor(Math.random() * 10000),
    deck: [] // позже добавим выбор колоды
  };
  localStorage.setItem('playerProfile', JSON.stringify(playerProfile));
}

socket.on('connect', () => {
  console.log('Connected to server');
  socket.emit('player:login', playerProfile);
});

const FIELD = {
  width: 800,
  height: 600,
  riverY: 270,
  riverHeight: 60,
  bridgeWidth: 80,
  bridgeHeight: 60,
  leftLaneX: 220,
  rightLaneX: 580,
  towerOffsetY: 60
};

const UNIT_SIZE = 32;

function getCardById(id) {
  return ALL_CARDS.find(c => c.id === id);
}

class Unit extends Phaser.GameObjects.Ellipse {
  constructor(scene, lane, isPlayer, card) {
    const x = lane === 'left' ? FIELD.leftLaneX : FIELD.rightLaneX;
    const y = isPlayer ? FIELD.height - FIELD.towerOffsetY - 40 : FIELD.towerOffsetY + 40;
    super(scene, x, y, UNIT_SIZE, UNIT_SIZE, isPlayer ? 0x00ffcc : 0xff8888);
    scene.add.existing(this);
    this.lane = lane;
    this.isPlayer = isPlayer;
    this.card = card;
    this.hp = card.hp;
    this.speed = card.speed;
    this.targetY = isPlayer ? 0 : FIELD.height;
    this.setDepth(1);
    this.alive = true;
  }
  preUpdate(time, delta) {
    if (!this.alive) return;
    // Движение к реке/мосту, потом к башне врага
    let dir = this.isPlayer ? -1 : 1;
    this.y += dir * this.speed;
    // Столкновения с вражескими юнитами
    const enemyUnits = this.scene.units.getChildren().filter(u => u.lane === this.lane && u.isPlayer !== this.isPlayer && u.alive);
    for (let enemy of enemyUnits) {
      if (Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y) < UNIT_SIZE) {
        // Бой: наносим урон друг другу
        this.hp -= enemy.card.dmg * 0.1;
        enemy.hp -= this.card.dmg * 0.1;
        if (this.hp <= 0) { this.alive = false; this.destroy(); }
        if (enemy.hp <= 0) { enemy.alive = false; enemy.destroy(); }
        return;
      }
    }
    // Дошёл до башни
    if ((this.isPlayer && this.y < FIELD.towerOffsetY+25) || (!this.isPlayer && this.y > FIELD.height - FIELD.towerOffsetY-25)) {
      this.scene.damageTower(this.lane, !this.isPlayer, this.card.dmg);
      this.alive = false;
      this.destroy();
    }
  }
}

const GameScene = new Phaser.Class({
  Extends: Phaser.Scene,
  initialize: function GameScene() {
    Phaser.Scene.call(this, { key: 'Game' });
  },
  create: function() {
    // Поле
    this.add.rectangle(FIELD.width/2, FIELD.riverY + FIELD.riverHeight/2, FIELD.width, FIELD.riverHeight, 0x3399ff); // река
    // Мосты
    this.add.rectangle(FIELD.leftLaneX, FIELD.riverY + FIELD.riverHeight/2, FIELD.bridgeWidth, FIELD.bridgeHeight, 0x888888);
    this.add.rectangle(FIELD.rightLaneX, FIELD.riverY + FIELD.riverHeight/2, FIELD.bridgeWidth, FIELD.bridgeHeight, 0x888888);
    // Башни игрока
    this.add.rectangle(FIELD.leftLaneX, FIELD.height - FIELD.towerOffsetY, 50, 50, 0x00ff00);
    this.add.rectangle(FIELD.rightLaneX, FIELD.height - FIELD.towerOffsetY, 50, 50, 0x00ff00);
    // Башни противника
    this.add.rectangle(FIELD.leftLaneX, FIELD.towerOffsetY, 50, 50, 0xff0000);
    this.add.rectangle(FIELD.rightLaneX, FIELD.towerOffsetY, 50, 50, 0xff0000);
    // Текст для наглядности
    this.add.text(FIELD.leftLaneX-30, FIELD.height - FIELD.towerOffsetY+30, 'Твоя башня', {font:'14px Arial', fill:'#0f0'});
    this.add.text(FIELD.rightLaneX-30, FIELD.height - FIELD.towerOffsetY+30, 'Твоя башня', {font:'14px Arial', fill:'#0f0'});
    this.add.text(FIELD.leftLaneX-30, FIELD.towerOffsetY-40, 'Враж. башня', {font:'14px Arial', fill:'#f00'});
    this.add.text(FIELD.rightLaneX-30, FIELD.towerOffsetY-40, 'Враж. башня', {font:'14px Arial', fill:'#f00'});
    this.add.text(FIELD.width/2-40, FIELD.riverY+FIELD.riverHeight/2-10, 'Река', {font:'16px Arial', fill:'#fff'});
    this.add.text(FIELD.leftLaneX-30, FIELD.riverY+FIELD.riverHeight/2-10, 'Мост', {font:'14px Arial', fill:'#fff'});
    this.add.text(FIELD.rightLaneX-30, FIELD.riverY+FIELD.riverHeight/2-10, 'Мост', {font:'14px Arial', fill:'#fff'});

    // --- Панель карт ---
    const deck = playerProfile.deck;
    let selectedLane = 'left';
    this.add.text(10, FIELD.height-40, 'ЛКМ — левая дорожка, ПКМ — правая', {font:'14px Arial', fill:'#fff'});
    deck.forEach((cardId, i) => {
      const card = getCardById(cardId);
      const btn = this.add.text(20 + i*95, FIELD.height-70, card.name, {font:'16px Arial', fill:'#fff', backgroundColor:'#333'})
        .setPadding(8,4,8,4)
        .setInteractive()
        .on('pointerdown', (pointer) => {
          selectedLane = pointer.leftButtonDown() ? 'left' : 'right';
          this.spawnUnit(selectedLane, true, card);
        });
    });

    // --- Группа юнитов ---
    this.units = this.add.group();
    this.spawnUnit = (lane, isPlayer, card) => {
      const unit = new Unit(this, lane, isPlayer, card);
      this.units.add(unit);
    };

    // --- Башни ---
    this.towers = {
      player: { left: 500, right: 500 },
      enemy: { left: 500, right: 500 }
    };

    // --- Бот ---
    this.botTimer = this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => {
        if (this.units.countActive(true) > 20) return; // не спамить
        const botDeck = playerProfile.deck;
        const card = getCardById(botDeck[Math.floor(Math.random()*botDeck.length)]);
        const lane = Math.random() < 0.5 ? 'left' : 'right';
        this.spawnUnit(lane, false, card);
      }
    });

    // --- Текст HP башен ---
    this.towerTexts = {
      player: {
        left: this.add.text(FIELD.leftLaneX-30, FIELD.height - FIELD.towerOffsetY-30, 'HP: 500', {font:'14px Arial', fill:'#0f0'}),
        right: this.add.text(FIELD.rightLaneX-30, FIELD.height - FIELD.towerOffsetY-30, 'HP: 500', {font:'14px Arial', fill:'#0f0'})
      },
      enemy: {
        left: this.add.text(FIELD.leftLaneX-30, FIELD.towerOffsetY+30, 'HP: 500', {font:'14px Arial', fill:'#f00'}),
        right: this.add.text(FIELD.rightLaneX-30, FIELD.towerOffsetY+30, 'HP: 500', {font:'14px Arial', fill:'#f00'})
      }
    };
    this.damageTower = (lane, isEnemy, dmg) => {
      const side = isEnemy ? 'enemy' : 'player';
      this.towers[side][lane] -= dmg;
      if (this.towers[side][lane] < 0) this.towers[side][lane] = 0;
      this.towerTexts[side][lane].setText('HP: ' + this.towers[side][lane]);
      if (this.towers[side][lane] === 0) {
        this.endGame(isEnemy ? 'Победа!' : 'Поражение!');
      }
    };
    this.endGame = (msg) => {
      this.add.text(FIELD.width/2-80, FIELD.height/2-20, msg, {font:'40px Arial', fill:'#ff0', backgroundColor:'#222'});
      this.scene.pause();
    };
  },
  update: function() {
    this.units.children.iterate(unit => {
      if (unit && unit.preUpdate) unit.preUpdate();
    });
  }
}); 