
const badWords = [
  // English
  "fuck","shit","bitch","asshole",
  // Bangla
  "চোদ","চুদি","মাগী","হারামজাদা",
  // Banglish
  "chod","chudi","magi"
];

module.exports.clean = function (text) {
  if (!text) return text;
  let cleaned = text;
  badWords.forEach(w => {
    const r = new RegExp(w, "gi");
    cleaned = cleaned.replace(r, "***");
  });
  return cleaned;
};

export {};
