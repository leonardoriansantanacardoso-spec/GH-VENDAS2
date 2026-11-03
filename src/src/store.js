const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "products.json");

function ensureStore() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "[]", "utf8");
}

function readProducts() {
  ensureStore();
  try {
    const value = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeProducts(products) {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(products, null, 2), "utf8");
}

function nextId(products) {
  return String(products.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1);
}

module.exports = { readProducts, writeProducts, nextId };
