// Чистата логика на наблюдението: от старото състояние и резултатите от
// кръга прави новото състояние и съобщенията. Без мрежа и без файлове –
// затова се тества сама (test/logika.test.mjs).

export const NAPOMNYANE_MS = 60 * 60 * 1000; // най-много едно напомняне на час
export const PRAG_OBSHT_SRIV = 3; // от толкова „главни“ адреса долу наведнъж – едно общо известие
export const VIKI_SRIV = "уикито: _shared/infrastructure/kakvo-pri-sriv.md";

const FMT = new Intl.DateTimeFormat("bg-BG", {
  timeZone: "Europe/Sofia",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function chas(iso) {
  // „22.11, 03:12“ – денят и часът в София
  const parts = Object.fromEntries(FMT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day}.${parts.month}, ${parts.hour}:${parts.minute}`;
}

export function prodalzhitelnost(otIso, doIso) {
  const min = Math.max(0, Math.round((new Date(doIso) - new Date(otIso)) / 60000));
  if (min < 60) return `${min} мин`;
  const ch = Math.floor(min / 60);
  const ost = min % 60;
  if (ch < 48) return ost ? `${ch} ч ${ost} мин` : `${ch} ч`;
  return `${Math.floor(ch / 24)} дни ${ch % 24} ч`;
}

function opisProval(r) {
  if (r.kod) return `код ${r.kod}${r.prichina ? ` (${r.prichina})` : ""}`;
  return r.prichina || "няма отговор";
}

/**
 * @param {object} staro – { celi: { [id]: { dolu, otKoga, napomneno, prichina } }, sedmica: [...], posledenOtchet }
 * @param {Array} rezultati – [{ cel, ok, kod, prichina }] – ok=false значи ДВА поредни провала в този кръг
 * @param {string} segaIso
 * @returns {{ novo: object, saobshteniya: string[] }}
 */
export function reshi(staro, rezultati, segaIso) {
  const novo = {
    celi: { ...(staro?.celi ?? {}) },
    sedmica: [...(staro?.sedmica ?? [])],
    posledenOtchet: staro?.posledenOtchet ?? null,
  };
  const padnali = [];
  const vazstanoveni = [];
  const napomnyania = [];

  for (const r of rezultati) {
    const id = r.cel.id;
    const s = novo.celi[id];
    if (!r.ok) {
      if (!s?.dolu) {
        novo.celi[id] = { dolu: true, otKoga: segaIso, napomneno: segaIso, prichina: opisProval(r) };
        padnali.push(r);
      } else {
        novo.celi[id] = { ...s, prichina: opisProval(r) };
        if (new Date(segaIso) - new Date(s.napomneno) >= NAPOMNYANE_MS) {
          novo.celi[id].napomneno = segaIso;
          napomnyania.push({ r, s });
        }
      }
    } else if (s?.dolu) {
      novo.celi[id] = { dolu: false };
      vazstanoveni.push({ r, s });
      if (r.cel.id !== "proba") {
        novo.sedmica.push({ id, ime: r.cel.ime, ot: s.otKoga, do: segaIso });
      }
    } else {
      novo.celi[id] = { dolu: false };
    }
  }

  const saobshteniya = [];

  const glavniDolu = padnali.filter((r) => r.cel.glaven);
  if (glavniDolu.length >= PRAG_OBSHT_SRIV) {
    const vsichkiGlavni = rezultati.filter((r) => r.cel.glaven).length;
    saobshteniya.push(
      [
        `🔴 **Главният сървър не отговаря** – ${glavniDolu.length} от ${vsichkiGlavni} адреса на него мълчат (от ${chas(segaIso)}, София).`,
        `Падналите: ${glavniDolu.map((r) => `${r.cel.ime} – ${opisProval(r)}`).join("; ")}.`,
        "Най-вероятно: сървърът е спрял или Hetzner е блокирал акаунта (неплатена фактура – виж пощата). Първо: Hetzner Console и https://status.hetzner.com, после панела на Coolify.",
        `Ред за действие – ${VIKI_SRIV}`,
      ].join("\n"),
    );
    for (const r of padnali.filter((r) => !r.cel.glaven)) saobshteniya.push(saobshtenieDolu(r, segaIso));
  } else {
    for (const r of padnali) saobshteniya.push(saobshtenieDolu(r, segaIso));
  }

  for (const { r, s } of napomnyania) {
    saobshteniya.push(
      `⏰ Още не отговаря: **${r.cel.ime}** – от ${chas(s.otKoga)}, вече ${prodalzhitelnost(s.otKoga, segaIso)} (${opisProval(r)}).`,
    );
  }

  if (vazstanoveni.length >= PRAG_OBSHT_SRIV) {
    saobshteniya.push(
      [
        `🟢 **Работи отново** – ${vazstanoveni.length} адреса отговарят пак (${chas(segaIso)}):`,
        ...vazstanoveni.map(({ r, s }) => `• ${r.cel.ime} – прекъсването трая ${prodalzhitelnost(s.otKoga, segaIso)} (от ${chas(s.otKoga)})`),
      ].join("\n"),
    );
  } else {
    for (const { r, s } of vazstanoveni) {
      saobshteniya.push(
        `🟢 **Работи отново: ${r.cel.ime}** – прекъсването трая ${prodalzhitelnost(s.otKoga, segaIso)} (${chas(s.otKoga)} – ${chas(segaIso)}).`,
      );
    }
  }

  return { novo, saobshteniya };
}

function saobshtenieDolu(r, segaIso) {
  return [
    // Скритите цели (тайната SKRITI_CELI) са без адрес – текстът стига и до публичния лог.
    r.cel.skrit ? `🔴 **Не отговаря: ${r.cel.ime}**` : `🔴 **Не отговаря: ${r.cel.ime}** – ${r.cel.url}`,
    `От ${chas(segaIso)} (София), два поредни опита: ${opisProval(r)}.`,
    `Какво е и къде се гледа: ${r.cel.kakvo}`,
    `Ред за действие – ${VIKI_SRIV}`,
  ].join("\n");
}

/** Понеделник след 09:00 в София и отчетът за тази седмица още не е пратен. */
export function vremeZaOtchet(staro, segaIso) {
  const d = new Date(segaIso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Sofia",
      weekday: "short",
      hour: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const den = `${p.year}-${p.month}-${p.day}`;
  return p.weekday === "Mon" && Number(p.hour) >= 9 && staro?.posledenOtchet !== den ? den : null;
}

export function sedmichenOtchet(sastoyanie, segaIso, broiCeli) {
  const dolu = Object.entries(sastoyanie.celi ?? {}).filter(([id, s]) => s.dolu && id !== "proba");
  const redove = [
    `🫡 **Наблюдението работи** (седмичен знак, ${chas(segaIso)}). Следят се ${broiCeli} адреса на всеки 5 минути, отвън – от GitHub, не от Hetzner.`,
  ];
  if (sastoyanie.sedmica?.length) {
    redove.push(
      `Прекъсвания за седмицата: ${sastoyanie.sedmica
        .map((x) => `${x.ime} ${chas(x.ot)} – ${prodalzhitelnost(x.ot, x.do)}`)
        .join("; ")}.`,
    );
  } else {
    redove.push("Прекъсвания за седмицата: няма.");
  }
  if (dolu.length) redove.push(`В момента долу: ${dolu.map(([id]) => id).join(", ")}.`);
  redove.push("Ако някой понеделник това съобщение не дойде – самото наблюдение е спряло (виж README на marmot-nablyudenie).");
  return redove.join("\n");
}
