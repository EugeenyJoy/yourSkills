/**
 * Минимальные тесты слоя user_badges (in-memory SQLite)
 */
const assert = require('assert');
const Database = require('better-sqlite3');
const badgeStorage = require('../lib/badgeStorage');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY
    );
    CREATE TABLE user_badges (
      user_id INTEGER NOT NULL,
      badge_key TEXT NOT NULL,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      granted_by TEXT DEFAULT 'system',
      visible INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, badge_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.prepare('INSERT INTO users (id) VALUES (1)').run();
  return db;
}

function testGrantHappyPath() {
  const db = freshDb();
  const r = badgeStorage.grantBadge(db, 1, 'creator', 'system');
  assert.strictEqual(r.granted, true);
  assert.strictEqual(r.alreadyExists, false);
  const keys = badgeStorage.getUserBadgeKeys(db, 1);
  assert.deepStrictEqual(keys, ['creator']);
}

function testGrantDuplicate() {
  const db = freshDb();
  const a = badgeStorage.grantBadge(db, 1, 'creator', 'system');
  const b = badgeStorage.grantBadge(db, 1, 'creator', 'system');
  assert.strictEqual(a.granted, true);
  assert.strictEqual(b.granted, false);
  assert.strictEqual(b.alreadyExists, true);
  assert.strictEqual(badgeStorage.getUserBadgeKeys(db, 1).length, 1);
}

function testRevoke() {
  const db = freshDb();
  badgeStorage.grantBadge(db, 1, 'verified', 'admin');
  assert.strictEqual(badgeStorage.hasBadge(db, 1, 'verified'), true);
  assert.strictEqual(badgeStorage.revokeBadge(db, 1, 'verified'), true);
  assert.strictEqual(badgeStorage.hasBadge(db, 1, 'verified'), false);
  assert.strictEqual(badgeStorage.revokeBadge(db, 1, 'verified'), false);
}

function testInvalidKey() {
  const db = freshDb();
  const r = badgeStorage.grantBadge(db, 1, 'not_a_real_badge', 'system');
  assert.strictEqual(r.invalid, true);
  assert.strictEqual(r.granted, false);
}

function testOrder() {
  const db = freshDb();
  badgeStorage.grantBadge(db, 1, 'early_adopter', 'system');
  badgeStorage.grantBadge(db, 1, 'creator', 'system');
  const keys = badgeStorage.getUserBadgeKeys(db, 1);
  // При одинаковом granted_at порядок фиксируется вторичной сортировкой по badge_key ASC
  assert.deepStrictEqual(keys, ['creator', 'early_adopter']);
}

testGrantHappyPath();
testGrantDuplicate();
testRevoke();
testInvalidKey();
testOrder();

console.log('OK: tests/badges.test.js');
