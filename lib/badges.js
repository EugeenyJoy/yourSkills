// ============================================
// Публичный API бейджей (приложение)
// ============================================

const db = require('../database');
const constants = require('./badgeConstants');
const storage = require('./badgeStorage');

function grantBadge(userId, badgeKey, grantedBy = 'system') {
  return storage.grantBadge(db, userId, badgeKey, grantedBy);
}

function revokeBadge(userId, badgeKey) {
  return storage.revokeBadge(db, userId, badgeKey);
}

function getUserBadgeKeys(userId) {
  return storage.getUserBadgeKeys(db, userId);
}

function getVisibleUserBadgeKeys(userId) {
  return storage.getVisibleUserBadgeKeys(db, userId);
}

function hasBadge(userId, badgeKey) {
  return storage.hasBadge(db, userId, badgeKey);
}

function getUserBadgesForApi(userId) {
  return storage.getUserBadgesForApi(db, userId);
}

function setBadgeVisibility(userId, badgeKey, visible) {
  return storage.setBadgeVisibility(db, userId, badgeKey, visible);
}

function maybeGrantEarlyAdopter(newUserId) {
  return storage.maybeGrantEarlyAdopter(db, newUserId);
}

function getVisibleBadgeKeysMap(userIds) {
  return storage.getVisibleBadgeKeysMap(db, userIds);
}

module.exports = {
  ...constants,
  grantBadge,
  revokeBadge,
  getUserBadgeKeys,
  getVisibleUserBadgeKeys,
  hasBadge,
  getUserBadgesForApi,
  setBadgeVisibility,
  maybeGrantEarlyAdopter,
  getVisibleBadgeKeysMap,
};
