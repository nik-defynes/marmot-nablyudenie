// Един кръг на наблюдението: проверява адресите от celi.json, сравнява със
// sastoyanie/sastoyanie.json и праща в Discord само промените.
//
// Пуска се от .github/workflows/nablyudenie.yml на всеки 5 минути.
// Webhook адресът идва от тайната DISCORD_WEBHOOK_URL и никъде не се печата.
// Вътрешните адреси (уикито за чата, Командният център – случайни имена на
// sslip.io) не са в публичния celi.json, а в тайната SKRITI_CELI (JSON масив
// със същите полета); в лога излизат само с id.
//
// Изход 1 = съобщение не е стигнало до Discord. Тогава състоянието НЕ се
// записва, следващият кръг вижда същата промяна и опитва пак, а GitHub праща
// писмо за проваления кръг.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reshi, vremeZaOtchet, sedmichenOtchet } from "./logika.mjs";

const PAPKA = path.dirname(fileURLToPath(import.meta.url));
const FAIL_SASTOYANIE = process.env.SASTOYANIE_FAIL ?? path.join(PAPKA, "sastoyanie", "sastoyanie.json");
const FAIL_CELI = process.env.CELI_FAIL ?? path.join(PAPKA, "celi.json");
const TAYMAUT_MS = 20_000;
const PAUZA_PREDI_VTORI_OPIT_MS = Number(process.env.PAUZA_MS ?? 45_000);
const PROBA_ADRESI = {
  dolu: "https://marmot.editera.io/__proba-nablyudenie-nyama-takav-adres",
  gore: "https://marmot.editera.io/api/health",
};

async function edinOpit(cel) {
  try {
    const r = await fetch(cel.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TAYMAUT_MS),
      headers: { "User-Agent": "marmot-nablyudenie (github actions)" },
    });
    // Shopify понякога отговаря на адреси на GitHub с 403/429 (защита от ботове) –
    // за магазина това значи „жив“, не „долу“.
    if (cel.dopustimi?.includes(r.status)) return { ok: true, kod: r.status };
    if (r.status >= 400) return { ok: false, kod: r.status };
    if (cel.json) {
      const tyalo = await r.json().catch(() => null);
      if (tyalo?.status !== "ok") return { ok: false, kod: r.status, prichina: "отговорът не казва status: ok" };
    }
    return { ok: true, kod: r.status };
  } catch (e) {
    const ime = e?.name === "TimeoutError" ? `таймаут ${TAYMAUT_MS / 1000} s` : e?.cause?.code || e?.message || "грешка";
    return { ok: false, prichina: ime };
  }
}

// Провал е само ДВА поредни неуспешни опита, с пауза между тях.
async function proveri(cel) {
  const parvi = await edinOpit(cel);
  if (parvi.ok) return { cel, ...parvi };
  await new Promise((r) => setTimeout(r, PAUZA_PREDI_VTORI_OPIT_MS));
  const vtori = await edinOpit(cel);
  return { cel, ...vtori };
}

async function prati(tekst) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error("липсва тайната DISCORD_WEBHOOK_URL");
  const r = await fetch(`${url}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Наблюдение", content: tekst, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(TAYMAUT_MS),
  });
  if (!r.ok) throw new Error(`Discord върна ${r.status}`);
  const m = await r.json().catch(() => ({}));
  console.log(`Изпратено в Discord (съобщение ${m.id ?? "?"}):\n${tekst}\n`);
}

// Изтрит или сменен webhook трябва да личи веднага, не при първата авария:
// GET към webhook-а не праща нищо, а отговаря 200, докато адресът е жив.
async function webhookZhiv() {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return "липсва тайната DISCORD_WEBHOOK_URL";
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TAYMAUT_MS) });
    return r.ok ? null : `Discord върна ${r.status} за webhook-а`;
  } catch (e) {
    return `Discord не отговаря (${e?.cause?.code || e?.message})`;
  }
}

// Discord приема до 2000 знака; съобщенията от един кръг се събират, докато се побират.
function sabrani(saobshteniya) {
  const pratki = [];
  for (const s of saobshteniya) {
    const posledna = pratki.at(-1);
    if (posledna && posledna.length + 2 + s.length <= 1900) pratki[pratki.length - 1] = `${posledna}\n\n${s}`;
    else pratki.push(s.slice(0, 1900));
  }
  return pratki;
}

function chetiSastoyanie() {
  if (!fs.existsSync(FAIL_SASTOYANIE)) return { celi: {} };
  try {
    return JSON.parse(fs.readFileSync(FAIL_SASTOYANIE, "utf8"));
  } catch (e) {
    // Повреден файл не бива да спира наблюдението: започва се на чисто
    // (най-много едно повторно известие за нещо, което вече е долу).
    console.error(`Състоянието не се чете (${e.message}) – започвам на чисто.`);
    return { celi: {} };
  }
}

function skritiCeli() {
  const surovo = process.env.SKRITI_CELI?.trim();
  if (!surovo) return [];
  try {
    const spisak = JSON.parse(surovo);
    return Array.isArray(spisak) ? spisak.map((c) => ({ ...c, skrit: true })) : [];
  } catch {
    console.error("Тайната SKRITI_CELI не е валиден JSON – вътрешните адреси не се проверяват в този кръг.");
    return [];
  }
}

const celi = [...JSON.parse(fs.readFileSync(FAIL_CELI, "utf8")).celi, ...skritiCeli()];
const staro = chetiSastoyanie();

const webhookGreshka = await webhookZhiv();
if (webhookGreshka) {
  console.error(`WEBHOOK-ЪТ НЕ РАБОТИ: ${webhookGreshka}. Известията не могат да стигнат – кръгът е червен и GitHub праща писмо.`);
  process.exit(1);
}

const proba = process.env.PROBA?.trim();
const zaProverka = [...celi];
if (proba === "dolu" || proba === "gore") {
  zaProverka.push({
    id: "proba",
    ime: "НАРОЧНА ПРОБА (не е авария)",
    url: PROBA_ADRESI[proba],
    json: proba === "gore",
    glaven: false,
    kakvo: "Това е проверка, че известията стигат. Нищо не се прави.",
  });
} else if (staro.celi?.proba?.dolu) {
  // Пробата не остава да виси между ръчните пускания.
  zaProverka.push({ id: "proba", ime: "НАРОЧНА ПРОБА (не е авария)", url: PROBA_ADRESI.gore, json: true, glaven: false, kakvo: "" });
}

const sega = new Date().toISOString();
const rezultati = await Promise.all(zaProverka.map(proveri));
for (const r of rezultati) console.log(`${r.ok ? "OK   " : "ДОЛУ "} ${r.cel.id.padEnd(16)} ${r.kod ?? ""} ${r.prichina ?? ""}`);

const { novo, saobshteniya } = reshi(staro, rezultati, sega);
if (!proba && !rezultati.some((r) => r.cel.id === "proba")) delete novo.celi.proba;

const otchetDen = vremeZaOtchet(staro, sega);
if (otchetDen) {
  saobshteniya.push(sedmichenOtchet(novo, sega, celi.length));
  novo.posledenOtchet = otchetDen;
  novo.sedmica = [];
}

try {
  for (const pratka of sabrani(saobshteniya)) await prati(pratka);
} catch (e) {
  console.error(`НЕ СТИГНА ДО DISCORD: ${e.message}. Състоянието не се записва – следващият кръг опитва пак.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(FAIL_SASTOYANIE), { recursive: true });
fs.writeFileSync(FAIL_SASTOYANIE, `${JSON.stringify(novo, null, 2)}\n`);
if (!saobshteniya.length) console.log("Всичко е наред – нищо не е пратено.");
