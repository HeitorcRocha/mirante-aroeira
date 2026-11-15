#!/usr/bin/env node
/**
 * Copia o three.js de node_modules para vendor/three/, só com os arquivos que
 * o tour usa. O site não tem bundler nem CDN: o navegador carrega estes
 * arquivos direto, pelo import map de tour.html.
 *
 *   npm run vendor
 *
 * Rode depois de atualizar a versão do three (npm install --save-dev three).
 * A pasta vendor/ entra no repositório, então o deploy não precisa de npm.
 *
 * O que é copiado: os pontos de entrada abaixo e, recursivamente, todo
 * arquivo que eles importam por caminho relativo. Import de "three" (nome
 * puro) é resolvido pelo import map e não precisa de cópia extra.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "node_modules", "three");
const DEST = path.join(ROOT, "vendor", "three");

// Os mesmos caminhos que o import map de tour.html aponta.
const ENTRIES = [
  "build/three.module.js",
  "examples/jsm/controls/OrbitControls.js",
];
// nomes puros que o import map sabe resolver
const BARE_OK = (spec) => spec === "three" || spec.startsWith("three/addons/");

// import ... from "x", export ... from "x", import "x" e import("x")
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']+)\1/g;

function imports(file) {
  const code = fs.readFileSync(file, "utf8");
  const head = code.slice(0, 200_000);            // imports ficam no topo do arquivo
  const found = new Set();
  for (const m of head.matchAll(IMPORT_RE)) found.add(m[2]);
  return [...found];
}

if (!fs.existsSync(SRC)) {
  console.error("node_modules/three não existe. Rode: npm install");
  process.exit(1);
}

const copied = new Set();
const queue = [...ENTRIES];
while (queue.length) {
  const rel = queue.shift();
  if (copied.has(rel)) continue;
  const from = path.join(SRC, rel);
  if (!fs.existsSync(from)) throw new Error(`arquivo do three não encontrado: ${rel}`);
  copied.add(rel);
  for (const spec of imports(from)) {
    if (spec.startsWith(".")) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
    } else if (!BARE_OK(spec)) {
      throw new Error(`${rel} importa "${spec}", que o import map de tour.html não resolve`);
    }
  }
}

fs.rmSync(DEST, { recursive: true, force: true });
let bytes = 0;
for (const rel of [...copied, "LICENSE"]) {
  const to = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(SRC, rel), to);
  bytes += fs.statSync(to).size;
}

const { version } = JSON.parse(fs.readFileSync(path.join(SRC, "package.json"), "utf8"));
fs.writeFileSync(path.join(DEST, "VERSION"), version + "\n");
for (const rel of copied) console.log("  vendor/three/" + rel);
console.log(`three ${version}: ${copied.size} arquivos, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
