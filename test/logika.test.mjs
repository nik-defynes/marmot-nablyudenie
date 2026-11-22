import { test } from "node:test";
import assert from "node:assert/strict";
import { reshi, vremeZaOtchet, sedmichenOtchet, prodalzhitelnost, chas } from "../logika.mjs";

const cel = (id, glaven = true) => ({ id, ime: id.toUpperCase(), url: `https://${id}.test`, glaven, kakvo: "к" });
const ok = (c) => ({ cel: c, ok: true, kod: 200 });
const dolu = (c, kod = 502) => ({ cel: c, ok: false, kod });

const T0 = "2026-11-22T01:00:00.000Z"; // 03:00 София
const plus = (min) => new Date(new Date(T0).getTime() + min * 60000).toISOString();

test("всичко е наред – тишина", () => {
  const { saobshteniya, novo } = reshi({ celi: {} }, [ok(cel("a")), ok(cel("b"))], T0);
  assert.deepEqual(saobshteniya, []);
  assert.equal(novo.celi.a.dolu, false);
});

test("паднал адрес – едно известие с кое, от кога и какъв код", () => {
  const { saobshteniya, novo } = reshi({ celi: {} }, [dolu(cel("a"), 503)], T0);
  assert.equal(saobshteniya.length, 1);
  assert.match(saobshteniya[0], /Не отговаря: A/);
  assert.match(saobshteniya[0], /22\.11, 03:00/);
  assert.match(saobshteniya[0], /код 503/);
  assert.equal(novo.celi.a.dolu, true);
});

test("още долу – без повторение до час, после едно напомняне", () => {
  const s1 = reshi({ celi: {} }, [dolu(cel("a"))], T0).novo;
  const r2 = reshi(s1, [dolu(cel("a"))], plus(5));
  assert.deepEqual(r2.saobshteniya, []);
  const r3 = reshi(r2.novo, [dolu(cel("a"))], plus(59));
  assert.deepEqual(r3.saobshteniya, []);
  const r4 = reshi(r3.novo, [dolu(cel("a"))], plus(60));
  assert.equal(r4.saobshteniya.length, 1);
  assert.match(r4.saobshteniya[0], /Още не отговаря.*1 ч/);
  const r5 = reshi(r4.novo, [dolu(cel("a"))], plus(90));
  assert.deepEqual(r5.saobshteniya, []);
});

test("възстановяване – колко е траяло, и влиза в седмичния отчет", () => {
  const s1 = reshi({ celi: {} }, [dolu(cel("a"))], T0).novo;
  const { saobshteniya, novo } = reshi(s1, [ok(cel("a"))], plus(23));
  assert.match(saobshteniya[0], /Работи отново: A.*23 мин/);
  assert.equal(novo.sedmica.length, 1);
});

test("цял сървър долу – едно общо известие за главните, отделно за външните", () => {
  const rez = [dolu(cel("a")), dolu(cel("b")), dolu(cel("c")), dolu(cel("shop", false))];
  const { saobshteniya } = reshi({ celi: {} }, rez, T0);
  assert.equal(saobshteniya.length, 2);
  assert.match(saobshteniya[0], /Главният сървър не отговаря\*\* – 3 от 3/);
  assert.match(saobshteniya[0], /Hetzner/);
  assert.match(saobshteniya[1], /Не отговаря: SHOP/);
});

test("общото възстановяване е едно съобщение", () => {
  const s1 = reshi({ celi: {} }, [dolu(cel("a")), dolu(cel("b")), dolu(cel("c"))], T0).novo;
  const { saobshteniya } = reshi(s1, [ok(cel("a")), ok(cel("b")), ok(cel("c"))], plus(180));
  assert.equal(saobshteniya.length, 1);
  assert.match(saobshteniya[0], /3 адреса отговарят пак/);
});

test("пробата не влиза в седмичния отчет", () => {
  const s1 = reshi({ celi: {} }, [dolu(cel("proba", false))], T0).novo;
  const { novo } = reshi(s1, [ok(cel("proba", false))], plus(5));
  assert.equal(novo.sedmica.length, 0);
});

test("седмичен знак – понеделник след 09:00 София, веднъж", () => {
  assert.equal(vremeZaOtchet({}, "2026-11-23T06:59:00Z"), null); // 08:59 София
  assert.equal(vremeZaOtchet({}, "2026-11-23T07:00:00Z"), "2026-11-23");
  assert.equal(vremeZaOtchet({ posledenOtchet: "2026-11-23" }, "2026-11-23T10:00:00Z"), null);
  assert.equal(vremeZaOtchet({}, "2026-11-24T07:00:00Z"), null); // вторник
  const t = sedmichenOtchet({ celi: {}, sedmica: [] }, "2026-11-23T07:00:00Z", 9);
  assert.match(t, /Наблюдението работи/);
  assert.match(t, /няма/);
});

test("продължителност и час", () => {
  assert.equal(prodalzhitelnost(T0, plus(65)), "1 ч 5 мин");
  assert.equal(prodalzhitelnost(T0, plus(3 * 24 * 60)), "3 дни 0 ч");
  assert.equal(chas("2026-07-01T00:30:00Z"), "01.07, 03:30"); // лятно време
});
