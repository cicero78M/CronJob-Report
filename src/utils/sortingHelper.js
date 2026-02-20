/**
 * Utility functions for sorting users by position (jabatan) and rank (pangkat)
 * Used in attendance recap messages for Instagram likes and TikTok comments
 */

import { getNamaPriorityIndex } from "./sqlPriority.js";

// Position order (jabatan) - sorted by hierarchy
export const JABATAN_ORDER = [
  "DIR",
  "WADIR", 
  "KASUBDIT",
  "KABAG",
  "KASUBBAG",
  "KASAT",
  "KANIT",
];

// Rank order (pangkat) - comprehensive list from problem statement
export const PANGKAT_ORDER = [
  "KBP",
  "KOMISARIS BESAR POLISI",
  "AKBP",
  "KOMPOL",
  "AKP",
  "IPTU",
  "IPDA",
  "AIPTU",
  "AIPDA",
  "BRIPKA",
  "BRIGADIR",
  "BRIGPOL",
  "BRIGADIR POLISI",
  "BRIPTU",
  "BRIPDA",
  "PEMBINA UTAMA",
  "PEMBINA UTAMA MADYA",
  "PEMBINA UTAMA MUDA",
  "PEMBINA TINGKAT I",
  "PEMBINA",
  "PENATA TINGKAT I",
  "PENATA MUDA TINGKAT I",
  "PENATA MUDA",
  "PENATA",
  "PENGATUR TINGKAT I",
  "PENGATUR",
  "PENGATUR MUDA TINGKAT I",
  "PENGATUR MUDA",
  "JURU TINGKAT I",
  "JURU MUDA TINGKAT I",
  "JURU MUDA",
  "JURU",
  "PPPK",
  "PHL",
];

/**
 * Get position index from jabatan string
 * Searches for keywords (DIR, WADIR, etc.) within the jabatan field
 * Searches in reverse order to match longer/more specific keywords first
 * @param {string} jabatan - The position/jabatan field
 * @returns {number} Index in position order, or Infinity if not found
 */
export function getPositionIndex(jabatan) {
  if (!jabatan) return Infinity;
  const normalized = String(jabatan).toUpperCase();
  
  // Search for position keywords in reverse order to match longer keywords first
  // This ensures "WADIR" is matched before "DIR"
  for (let i = JABATAN_ORDER.length - 1; i >= 0; i--) {
    if (normalized.includes(JABATAN_ORDER[i])) {
      return i;
    }
  }
  
  return Infinity;
}

/**
 * Get rank index from pangkat/title string
 * @param {string} title - The rank/title field
 * @returns {number} Index in rank order, or Infinity if not found
 */
export function getRankIndex(title) {
  if (!title) return Infinity;
  const normalized = String(title).toUpperCase().trim();
  
  const index = PANGKAT_ORDER.indexOf(normalized);
  return index === -1 ? Infinity : index;
}

/**
 * Sort users by position (jabatan), then rank (pangkat), then name
 * This is the main sorting function for attendance recap messages
 * @param {Array} users - Array of user objects with jabatan, title, and nama fields
 * @returns {Array} Sorted array of users
 */
export function sortUsersByPositionRankAndName(users = []) {
  return users.slice().sort((a, b) => {
    // First sort by position (jabatan)
    const positionDiff = getPositionIndex(a.jabatan) - getPositionIndex(b.jabatan);
    if (positionDiff !== 0) return positionDiff;
    
    // Then sort by rank (pangkat)
    const rankDiff = getRankIndex(a.title) - getRankIndex(b.title);
    if (rankDiff !== 0) return rankDiff;
    
    // Then sort by name priority
    const priorityDiff = getNamaPriorityIndex(a?.nama) - getNamaPriorityIndex(b?.nama);
    if (priorityDiff !== 0) return priorityDiff;
    
    // Finally sort alphabetically by name
    return (a.nama || "").localeCompare(b.nama || "", "id-ID", {
      sensitivity: "base",
    });
  });
}

/**
 * Move an active user with a specific NRP/user_id to a fixed 1-based index.
 * If the user is not found, not active, or target index is invalid, array is returned untouched.
 * @param {Array} users - Array of user objects
 * @param {string} userId - target user_id/NRP
 * @param {number} oneBasedIndex - desired 1-based position (e.g. 3)
 * @returns {Array} Reordered array
 */
export function prioritizeActiveUserAtPosition(
  users = [],
  userId,
  oneBasedIndex = 3
) {
  const sortedUsers = Array.isArray(users) ? users.slice() : [];
  if (!userId || !sortedUsers.length) return sortedUsers;

  const targetIndex = Number(oneBasedIndex) - 1;
  if (targetIndex < 0 || targetIndex >= sortedUsers.length) return sortedUsers;

  const normalizedUserId = String(userId).trim();
  const currentIndex = sortedUsers.findIndex(
    (user) =>
      String(user?.user_id || "").trim() === normalizedUserId && user?.status === true
  );
  if (currentIndex === -1 || currentIndex === targetIndex) return sortedUsers;

  const [targetUser] = sortedUsers.splice(currentIndex, 1);
  sortedUsers.splice(targetIndex, 0, targetUser);
  return sortedUsers;
}

export default {
  getPositionIndex,
  getRankIndex,
  sortUsersByPositionRankAndName,
  prioritizeActiveUserAtPosition,
  JABATAN_ORDER,
  PANGKAT_ORDER,
};
