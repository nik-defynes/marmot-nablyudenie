// Целият кръг (proveri.mjs) срещу местен сървър: истинският Discord и
// истинските адреси не се пипат. Пътищата на celi.json и състоянието се
// подменят през CELI_FAIL и SASTOYANIE_FAIL.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROVERI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "proveri.mjs");
const papki = [];
after(() => papki.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const prateni = [];
let webhookZhiv = true;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/webhook")) {
    if (!webhookZhiv) return res.writeHead(404).end("{}");
    if (req.method === "GET") return res.writeHead(200).end("{}");
    let tyalo = "";
    req.on("data", (c) => (tyalo += c));
    req.on("end", () => {
      prateni.push(JSON.parse(tyalo).content);
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"id":"1"}');
    });
    return;
  }
  if (req.url === "/ok") return res.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"ok"}');
  if (req.url === "/bot") return res.writeHead(429).end();
  res.writeHead(500).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
const baza = `http://127.0.0.1:${server.address().port}`;

function podgotvi() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nablyudenie-"));
  papki.push(d);
  fs.writeFileSync(
    path.join(d, "celi.json"),
    JSON.stringify({
      celi: [
        { id: "zhiva", ime: "Жива", url: `${baza}/ok`, json: true, glaven: true, kakvo: "" },
        { id: "magazin", ime: "Магазин", url: `${baza}/bot`, glaven: false, dopustimi: [403, 429], kakvo: "" },
      ],
    }),
  );
  return d;
}

function krag(d, dop = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [PROVERI],
      {
        env: {
          PATH: process.env.PATH,
          PAUZA_MS: "0",
          DISCORD_WEBHOOK_URL: `${baza}/webhook`,
          CELI_FAIL: path.join(d, "celi.json"),
          SASTOYANIE_FAIL: path.join(d, "sastoyanie.json"),
          ...dop,
        },
      },
      (err, stdout, stderr) => resolve({ kod: err?.code ?? 0, stdout, stderr }),
    );
  });
}

test("всичко живо (и 429 на магазина) – нищо не се праща", async () => {
  const d = podgotvi();
  prateni.length = 0;
  const r = await krag(d);
  assert.equal(r.kod, 0);
  assert.equal(prateni.length, 0);
});

test("скрита цел от SKRITI_CELI пада – едно известие, адресът не се печата", async () => {
  const d = podgotvi();
  prateni.length = 0;
  const skrita = JSON.stringify([{ id: "vatreshna", ime: "Вътрешна", url: `${baza}/padnala`, glaven: false, kakvo: "" }]);
  const r = await krag(d, { SKRITI_CELI: skrita });
  assert.equal(r.kod, 0);
  assert.equal(prateni.length, 1);
  assert.match(prateni[0], /Не отговаря.*Вътрешна/s);
  assert.doesNotMatch(r.stdout + r.stderr + prateni[0], /padnala/);
  // Вторият кръг мълчи – известието е само при промяна.
  await krag(d, { SKRITI_CELI: skrita });
  assert.equal(prateni.length, 1);
});

test("повредено състояние не спира наблюдението", async () => {
  const d = podgotvi();
  fs.writeFileSync(path.join(d, "sastoyanie.json"), "{недописан");
  const r = await krag(d);
  assert.equal(r.kod, 0);
  assert.match(r.stderr, /започвам на чисто/);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(d, "sastoyanie.json"), "utf8")));
});

test("мъртъв webhook – червен кръг веднага, състоянието не се пипа", async () => {
  const d = podgotvi();
  webhookZhiv = false;
  try {
    const r = await krag(d);
    assert.equal(r.kod, 1);
    assert.match(r.stderr, /WEBHOOK-ЪТ НЕ РАБОТИ: Discord върна 404/);
    assert.equal(fs.existsSync(path.join(d, "sastoyanie.json")), false);
  } finally {
    webhookZhiv = true;
  }
});
