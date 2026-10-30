/**
 * Vercel / CI build: stamp asset query strings so browsers pick up new JS/CSS after deploy.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const indexPath = path.join(root, "index.html");

function buildStamp() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
  if (sha) return sha.slice(0, 8);
  return Date.now().toString(36);
}

const stamp = buildStamp();
let html = fs.readFileSync(indexPath, "utf8");
const next = html.replace(/assets\/app\.(css|js)\?v=[^"']+/g, (_, ext) => `assets/app.${ext}?v=${stamp}`);

if (next === html) {
  console.warn("prepare-deploy: no asset version placeholders updated in index.html");
} else {
  fs.writeFileSync(indexPath, next, "utf8");
}

console.log(`prepare-deploy: asset version -> ${stamp}`);
